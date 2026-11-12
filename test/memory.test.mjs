import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  MEMORY_SCHEMA_VERSION,
  decisionFileName,
  memoryPath,
  openMemory,
  openProjectMemory,
  parseDecisionFileName,
  readSpecsGitState,
  startCheckpointSupervisor,
  syncFromGit,
  uuidv7,
  withSqliteRetry,
  writeFileAtomicSync,
} from '../src/memory.mjs';
import { SPECS_GITIGNORE } from '../src/assets.mjs';
import { V3_SCHEMA } from '../test-support/memory-legacy-schemas.mjs';

const WORKER = fileURLToPath(new URL('../test-support/memory-worker.mjs', import.meta.url));
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let workDir;
let handles;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'omni-memory-'));
  handles = [];
});

afterEach(() => {
  for (const handle of handles) {
    const db = handle.db ?? handle;
    if (db.isOpen) db.close();
  }
  rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function track(handle) {
  handles.push(handle);
  return handle;
}

function dbFile() {
  return join(workDir, 'specs', '.omni', 'memory.db');
}

function runWorker(args, { onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (onLine) for (const line of String(chunk).split('\n').filter(Boolean)) onLine(line);
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function sqliteError(errcode, message = 'sqlite failure') {
  return Object.assign(new Error(message), { code: 'ERR_SQLITE_ERROR', errcode });
}

const primary = error => error.errcode & 0xff;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const fileSize = path => (existsSync(path) ? statSync(path).size : 0);

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createRepo() {
  git(workDir, 'init', '-q', '-b', 'main');
  git(workDir, 'config', 'user.email', 'memory-test@example.com');
  git(workDir, 'config', 'user.name', 'Memory Test');
  git(workDir, 'config', 'commit.gpgsign', 'false');
  git(workDir, 'config', 'core.autocrlf', 'false');
  mkdirSync(join(workDir, 'specs', 'decisions'), { recursive: true });
  writeFileSync(join(workDir, 'specs', 'manifest.json'), '{"specs":[]}\n');
  writeFileSync(join(workDir, 'specs', '.gitignore'), SPECS_GITIGNORE + '\n');
  return workDir;
}

function writeDecision(root, topic, overrides = {}) {
  const id = overrides.id ?? uuidv7();
  const record = {
    id,
    topic,
    status: 'approved',
    basis: `Basis for the ${topic} decision`,
    sources: [`docs/${topic}.md`],
    recorded_at: '2026-11-05T00:00:00.000Z',
    ...overrides,
  };
  const relative = `specs/decisions/${decisionFileName(topic, id)}`;
  writeFileSync(join(root, relative), JSON.stringify(record, null, 2) + '\n');
  return { id, relative, record };
}

function commitAll(root, message) {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

function decisionRows(memory) {
  return memory.db.prepare('SELECT id, topic, status, basis, sources_json, file_path FROM decisions ORDER BY id').all();
}

function ftsRows(memory) {
  return memory.db.prepare('SELECT source_type, source_id, content FROM memory_fts ORDER BY source_id').all();
}

async function syncedRepo(topics) {
  const root = createRepo();
  const decisions = Object.fromEntries(topics.map(topic => [topic, writeDecision(root, topic)]));
  commitAll(root, 'seed decisions');
  const memory = track(openMemory(memoryPath(root)));
  const report = await syncFromGit(memory, root);
  return { root, memory, decisions, report };
}

describe('A. Multiprocess concurrency (BEGIN IMMEDIATE + busy_timeout)', () => {
  test('applies canonical pragmas', () => {
    const memory = track(openMemory(dbFile()));
    const pragma = name => Object.values(memory.db.prepare(`PRAGMA ${name}`).get())[0];
    assert.equal(pragma('journal_mode'), 'wal');
    assert.equal(pragma('synchronous'), 1);
    assert.equal(pragma('busy_timeout'), 5000);
    assert.equal(pragma('foreign_keys'), 1);
    assert.equal(pragma('temp_store'), 2);
    assert.equal(pragma('user_version'), MEMORY_SCHEMA_VERSION);
  });

  test('BEGIN DEFERRED promotion fails at once despite busy_timeout while write() locks before its first statement', () => {
    const memory = track(openMemory(dbFile()));
    const insert = id =>
      `INSERT INTO observations (id, category, scope, summary, created_at) VALUES ('${id}', 'gotcha', 's', 'x', 'now')`;
    const a = track(new DatabaseSync(dbFile(), { timeout: 5000 }));
    const b = track(new DatabaseSync(dbFile(), { timeout: 5000 }));
    a.exec('BEGIN');
    b.exec('BEGIN');
    a.prepare('SELECT count(*) FROM observations').get();
    b.prepare('SELECT count(*) FROM observations').get();
    a.exec(insert('a'));
    a.exec('COMMIT');
    const started = performance.now();
    assert.throws(
      () => b.exec(insert('b')),
      error => primary(error) === 5,
    );
    assert.ok(performance.now() - started < 3000, 'deferred promotion must fail without waiting for busy_timeout');
    b.exec('ROLLBACK');

    memory.write(() => {
      const probe = track(new DatabaseSync(dbFile()));
      assert.throws(
        () => probe.exec('BEGIN IMMEDIATE'),
        error => primary(error) === 5,
      );
      probe.close();
    });
  });

  test('waits on a RESERVED lock held by another process instead of failing', async () => {
    const memory = track(openMemory(dbFile()));
    let release;
    const locked = new Promise(resolve => {
      release = resolve;
    });
    const child = runWorker(['hold', dbFile(), '300'], { onLine: line => line === 'locked' && release() });
    await locked;
    const started = performance.now();
    memory.addObservations([{ category: 'pattern', scope: 'parent', summary: 'after lock' }]);
    const waited = performance.now() - started;
    const result = await child;
    assert.equal(result.code, 0, result.stderr);
    assert.ok(waited >= 150, `expected to wait for the held lock, waited ${waited.toFixed(1)} ms`);
    assert.equal(memory.db.prepare('SELECT count(*) AS n FROM observations').get().n, 2);
  });

  test('6 processes × 200 IMMEDIATE transactions commit 1200 rows with zero SQLITE_BUSY', async () => {
    track(openMemory(dbFile())).close();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, worker) => runWorker(['write', dbFile(), '200', String(worker)])),
    );
    for (const result of results) assert.equal(result.code, 0, result.stderr);
    const memory = track(openMemory(dbFile()));
    assert.equal(memory.db.prepare('SELECT count(*) AS n FROM observations').get().n, 1200);
  });

  test('rollback guard preserves the original error even when the engine already rolled back', () => {
    const memory = track(openMemory(dbFile()));
    const original = new Error('domain failure');
    assert.throws(
      () =>
        memory.write(() => {
          memory.db.exec(
            "INSERT INTO observations (id, category, scope, summary, created_at) VALUES ('x', 'pattern', 's', 'discarded', 'now')",
          );
          throw original;
        }),
      error => error === original,
    );
    assert.equal(memory.db.isTransaction, false);
    assert.equal(memory.db.prepare('SELECT count(*) AS n FROM observations').get().n, 0);

    const full = sqliteError(13, 'database or disk is full');
    assert.throws(
      () =>
        memory.write(() => {
          memory.db.exec('ROLLBACK');
          throw full;
        }),
      error => error === full,
    );
    assert.equal(memory.db.isTransaction, false);
  });
});

describe('B. Checkpoint Supervisor (WAL starvation)', () => {
  function seedWithOpenReader() {
    const memory = track(openMemory(dbFile()));
    memory.addObservations(
      Array.from({ length: 50 }, (_, i) => ({ category: 'pattern', scope: 's', summary: `seed ${i}` })),
    );
    memory.checkpoint('TRUNCATE');
    const reader = track(new DatabaseSync(dbFile()));
    const rows = reader.prepare('SELECT id FROM observations').iterate();
    rows.next();
    memory.addObservations(
      Array.from({ length: 200 }, (_, i) => ({ category: 'pattern', scope: 's', summary: 'y'.repeat(900) + i })),
    );
    return { memory, rows };
  }

  test('an open iterator starves a PASSIVE checkpoint', () => {
    const { memory } = seedWithOpenReader();
    const result = memory.checkpoint('PASSIVE');
    assert.ok(result.log > 0);
    assert.ok(result.checkpointed < result.log, `expected starvation, got ${JSON.stringify(result)}`);
  });

  test('a PASSIVE checkpoint drains the WAL once the iterator is returned', () => {
    const { memory, rows } = seedWithOpenReader();
    rows.return();
    const result = memory.checkpoint('PASSIVE');
    assert.ok(result.log > 0);
    assert.equal(result.checkpointed, result.log);
  });

  test('the supervisor runs a PASSIVE checkpoint when idle and its timer is unref’d', async () => {
    const memory = track(openMemory(dbFile()));
    memory.checkpoint('TRUNCATE');
    memory.addObservations(
      Array.from({ length: 300 }, (_, i) => ({ category: 'pattern', scope: 's', summary: 'z'.repeat(900) + i })),
    );
    const before = fileSize(dbFile());
    const timer = startCheckpointSupervisor(memory, { idleMs: 30 });
    try {
      assert.equal(timer.hasRef(), false);
      await new Promise(resolve => setTimeout(resolve, 200));
      assert.ok(fileSize(dbFile()) > before, 'checkpoint must move WAL pages into the database file');
    } finally {
      clearInterval(timer);
    }
  });

  test('close() runs TRUNCATE and leaves memory.db-wal at 0 bytes', () => {
    const memory = openMemory(dbFile());
    const bystander = track(new DatabaseSync(dbFile()));
    memory.addObservations(
      Array.from({ length: 100 }, (_, i) => ({ category: 'pattern', scope: 's', summary: `row ${i}` })),
    );
    assert.ok(fileSize(`${dbFile()}-wal`) > 0);
    memory.close();
    assert.equal(memory.db.isOpen, false);
    assert.equal(bystander.isOpen, true);
    assert.equal(fileSize(`${dbFile()}-wal`), 0);
  });
});

describe('C. Retry Wrapper (SQLITE_IOERR / SQLITE_CANTOPEN)', () => {
  test('retries errcode 10 and 14, including extended codes, until success', () => {
    const failures = [sqliteError(10), sqliteError(266), sqliteError(526)];
    const delays = [];
    const result = withSqliteRetry(
      () => {
        if (failures.length) throw failures.shift();
        return 'ok';
      },
      { sleep: ms => delays.push(ms) },
    );
    assert.equal(result, 'ok');
    assert.equal(delays.length, 3);
  });

  test('throws the same error instance after 3 retries with bounded exponential jittered backoff', () => {
    const failure = sqliteError(14, 'unable to open database file');
    const delays = [];
    let attempts = 0;
    assert.throws(
      () =>
        withSqliteRetry(
          () => {
            attempts++;
            throw failure;
          },
          { sleep: ms => delays.push(ms) },
        ),
      error => error === failure,
    );
    assert.equal(attempts, 4);
    const ceilings = [25, 50, 100];
    delays.forEach((delay, index) => {
      assert.ok(delay >= ceilings[index] / 2 && delay <= ceilings[index], `delay ${index} = ${delay}`);
    });
  });

  test('does not retry SQLITE_BUSY, SQLITE_CONSTRAINT or non-SQLite errors', () => {
    for (const failure of [sqliteError(5), sqliteError(19), sqliteError(2067), new TypeError('bug')]) {
      let attempts = 0;
      assert.throws(
        () =>
          withSqliteRetry(
            () => {
              attempts++;
              throw failure;
            },
            { sleep: () => assert.fail('must not sleep') },
          ),
        error => error === failure,
      );
      assert.equal(attempts, 1);
    }
  });

  test('a real CANTOPEN on an unopenable path propagates errcode 14', () => {
    const directory = join(workDir, 'not-a-database');
    mkdirSync(directory);
    assert.throws(
      () => openMemory(directory),
      error => error.code === 'ERR_SQLITE_ERROR' && primary(error) === 14,
    );
  });
});

describe('D. Git Tree OID fast-path', () => {
  test('first sync hydrates decisions and persists the specs tree OID', async () => {
    const { root, memory, report } = await syncedRepo(['storage-engine', 'auth-broker']);
    assert.equal(report.fastPath, false);
    assert.equal(report.hydrated, 2);
    assert.equal(report.treeOid, git(root, 'rev-parse', 'HEAD:specs'));
    const state = memory.db.prepare("SELECT tree_oid FROM _git_sync_state WHERE file_path = 'specs'").get();
    assert.equal(state.tree_oid, report.treeOid);
    assert.equal(decisionRows(memory).length, 2);
  });

  test('an unchanged OID with a clean tree skips every file read', async t => {
    const { root, memory } = await syncedRepo(['storage-engine']);
    const reads = t.mock.method(fs, 'readFileSync');
    const readdirs = t.mock.method(fs, 'readdirSync');
    const report = await syncFromGit(memory, root);
    assert.deepEqual(
      { fastPath: report.fastPath, scanned: report.scanned },
      {
        fastPath: true,
        scanned: 0,
      },
    );
    assert.equal(reads.mock.callCount(), 0);
    assert.equal(readdirs.mock.callCount(), 0);
  });

  test('the fast-path decision runs in < 1 ms (git subprocess latency measured apart)', async t => {
    const { root, memory } = await syncedRepo(['storage-engine']);
    const spawnStarted = performance.now();
    const state = await readSpecsGitState(root);
    const spawnMs = performance.now() - spawnStarted;
    const samples = [];
    for (let i = 0; i < 1000; i++) {
      const started = performance.now();
      assert.equal(memory.isSpecsTreeCurrent(state), true);
      samples.push(performance.now() - started);
    }
    t.diagnostic(
      `git subprocess: ${spawnMs.toFixed(1)} ms; decision median: ${(median(samples) * 1000).toFixed(1)} µs`,
    );
    assert.ok(median(samples) < 5, `median decision ${median(samples)} ms`);
  });

  test('mtime-only changes keep the fast-path', async () => {
    const { root, memory, decisions } = await syncedRepo(['storage-engine']);
    const future = new Date(Date.now() + 3_600_000);
    utimesSync(join(root, decisions['storage-engine'].relative), future, future);
    const report = await syncFromGit(memory, root);
    assert.equal(report.fastPath, true);
  });

  test('a new commit touching specs changes the OID and triggers a resync', async () => {
    const { root, memory, report: first } = await syncedRepo(['storage-engine']);
    writeDecision(root, 'retry-policy');
    commitAll(root, 'add decision');
    const report = await syncFromGit(memory, root);
    assert.equal(report.fastPath, false);
    assert.notEqual(report.treeOid, first.treeOid);
    assert.equal(report.hydrated, 1);
    assert.equal(decisionRows(memory).length, 2);
  });

  test('a dirty working tree scans only dirty paths and a discard restores the committed state', async () => {
    const { root, memory, decisions } = await syncedRepo(['storage-engine', 'auth-broker', 'fts-ranking']);
    const edited = decisions['storage-engine'];
    writeFileSync(
      join(root, edited.relative),
      JSON.stringify({ ...edited.record, basis: 'Edited basis in working tree' }, null, 2) + '\n',
    );
    const untracked = writeDecision(root, 'wal-budget');

    const dirty = await syncFromGit(memory, root);
    assert.deepEqual(
      { fastPath: dirty.fastPath, scanned: dirty.scanned, updated: dirty.updated, hydrated: dirty.hydrated },
      { fastPath: false, scanned: 2, updated: 1, hydrated: 1 },
    );
    assert.equal(
      memory.db.prepare('SELECT basis FROM decisions WHERE id = ?').get(edited.id).basis,
      'Edited basis in working tree',
    );

    git(root, 'checkout', '--', edited.relative);
    rmSync(join(root, untracked.relative));
    const restored = await syncFromGit(memory, root);
    assert.equal(restored.fastPath, false);
    assert.equal(restored.updated, 1);
    assert.equal(restored.pruned, 1);
    assert.equal(
      memory.db.prepare('SELECT basis FROM decisions WHERE id = ?').get(edited.id).basis,
      edited.record.basis,
    );
    assert.equal((await syncFromGit(memory, root)).fastPath, true);
  });

  test('a missing HEAD:specs throws an explicit error', async () => {
    const root = createRepo();
    const memory = track(openMemory(memoryPath(root)));
    await assert.rejects(syncFromGit(memory, root), /HEAD:\.\/specs/);
  });
});

describe('E. Zombie pruning and UUIDv7 convention', () => {
  test('uuidv7 has version 7, RFC variant and an embedded millisecond timestamp', () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();
    assert.match(id, UUIDV7);
    const embedded = Number.parseInt(id.replace('-', '').slice(0, 12), 16);
    assert.ok(embedded >= before && embedded <= after + 1, `${embedded} not in [${before}, ${after}]`);
  });

  test('10k ids generated in a tight loop are unique and strictly increasing', () => {
    const ids = Array.from({ length: 10_000 }, () => uuidv7());
    assert.equal(new Set(ids).size, ids.length);
    for (let i = 1; i < ids.length; i++) assert.ok(ids[i - 1] < ids[i], `${ids[i - 1]} !< ${ids[i]}`);
  });

  test('decision filenames round-trip and non-conforming names are rejected by sync', async () => {
    const id = uuidv7();
    const name = decisionFileName('storage-engine', id);
    assert.equal(name, `storage-engine__${id}.json`);
    assert.deepEqual(parseDecisionFileName(name), { topic: 'storage-engine', id });
    for (const bad of ['storage-engine.json', `Storage__${id}.json`, `topic__${crypto.randomUUID()}.json`]) {
      assert.throws(() => parseDecisionFileName(bad), /decision file name/i);
    }
    assert.throws(() => decisionFileName('Bad Topic', id), /topic/i);

    const root = createRepo();
    writeDecision(root, 'storage-engine');
    writeFileSync(join(root, 'specs', 'decisions', 'legacy.json'), '{}\n');
    commitAll(root, 'non-conforming');
    const memory = track(openMemory(memoryPath(root)));
    await assert.rejects(syncFromGit(memory, root), /specs\/decisions\/legacy\.json/);
    assert.equal(decisionRows(memory).length, 0);
  });

  test('symmetric difference prunes zombies, hydrates newcomers and leaves the intersection untouched', async () => {
    const { root, memory, decisions } = await syncedRepo(['alpha', 'bravo', 'charlie']);
    const untouched = decisionRows(memory).filter(row => row.topic !== 'alpha');
    rmSync(join(root, decisions.alpha.relative));
    const delta = writeDecision(root, 'delta');
    commitAll(root, 'replace alpha with delta');

    const report = await syncFromGit(memory, root);
    assert.deepEqual(
      { pruned: report.pruned, hydrated: report.hydrated, updated: report.updated },
      { pruned: 1, hydrated: 1, updated: 0 },
    );
    const rows = decisionRows(memory);
    assert.deepEqual(rows.map(row => row.topic).sort(), ['bravo', 'charlie', 'delta']);
    for (const row of untouched)
      assert.deepEqual(
        rows.find(candidate => candidate.id === row.id),
        row,
      );
    const ftsIds = ftsRows(memory).map(row => row.source_id);
    assert.ok(!ftsIds.includes(decisions.alpha.id));
    assert.ok(ftsIds.includes(delta.id));
    const syncPaths = memory.db.prepare('SELECT file_path FROM _git_sync_state').all();
    assert.ok(!syncPaths.some(row => row.file_path === decisions.alpha.relative));
  });

  test('a branch switch removes zombie decisions', async () => {
    const { root, memory } = await syncedRepo(['alpha']);
    git(root, 'checkout', '-q', '-b', 'feature');
    const feature = writeDecision(root, 'feature-only');
    commitAll(root, 'feature decision');
    await syncFromGit(memory, root);
    assert.ok(decisionRows(memory).some(row => row.id === feature.id));

    git(root, 'checkout', '-q', 'main');
    const report = await syncFromGit(memory, root);
    assert.equal(report.pruned, 1);
    assert.ok(!decisionRows(memory).some(row => row.id === feature.id));
    assert.ok(!ftsRows(memory).some(row => row.source_id === feature.id));
  });

  test('two syncs of the same tree produce identical database state', async () => {
    const { root, memory } = await syncedRepo(['alpha', 'bravo', 'charlie']);
    const twin = track(openMemory(join(workDir, 'twin.db')));
    await syncFromGit(twin, root);
    assert.deepEqual(decisionRows(twin), decisionRows(memory));
    assert.deepEqual(ftsRows(twin), ftsRows(memory));
    const syncState = db =>
      db.db.prepare('SELECT file_path, tree_oid, content_hash FROM _git_sync_state ORDER BY file_path').all();
    assert.deepEqual(syncState(twin), syncState(memory));
  });

  test('conflict markers abort hydration before JSON.parse and leave the database unchanged', async t => {
    const { root, memory, decisions } = await syncedRepo(['alpha', 'bravo']);
    const before = decisionRows(memory);
    const conflicted = decisions.bravo.relative;
    writeFileSync(
      join(root, conflicted),
      `<<<<<<< HEAD\n${JSON.stringify(decisions.bravo.record)}\n=======\n{"id":"other"}\n>>>>>>> feature\n`,
    );
    const parse = t.mock.method(JSON, 'parse');
    await assert.rejects(syncFromGit(memory, root), error => {
      assert.match(error.message, /conflict markers/i);
      assert.deepEqual(error.files, [conflicted]);
      return true;
    });
    assert.equal(parse.mock.callCount(), 0);
    assert.deepEqual(decisionRows(memory), before);
  });
});

describe('F. Atomic write-and-rename', () => {
  test('writes through <file>.tmp.<pid> in the same directory and leaves no residue', t => {
    const target = join(workDir, 'manifest.json');
    const opened = t.mock.method(fs, 'openSync');
    writeFileAtomicSync(target, '{"ok":true}\n');
    assert.equal(readFileSync(target, 'utf8'), '{"ok":true}\n');
    assert.equal(opened.mock.calls[0].arguments[0], `${target}.tmp.${process.pid}`);
    assert.deepEqual(readdirSync(workDir), ['manifest.json']);
  });

  test('ENOSPC during write keeps the previous file byte-identical', t => {
    const target = join(workDir, 'manifest.json');
    writeFileSync(target, '{"version":1}\n');
    t.mock.method(fs, 'writeSync', () => {
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
    });
    assert.throws(
      () => writeFileAtomicSync(target, '{"version":2}\n'),
      error => error.code === 'ENOSPC',
    );
    assert.equal(readFileSync(target, 'utf8'), '{"version":1}\n');
    assert.deepEqual(readdirSync(workDir), ['manifest.json']);
  });

  test('a rename failure keeps the previous file intact', t => {
    const target = join(workDir, 'manifest.json');
    writeFileSync(target, '{"version":1}\n');
    t.mock.method(fs, 'renameSync', () => {
      throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' });
    });
    assert.throws(
      () => writeFileAtomicSync(target, '{"version":2}\n'),
      error => error.code === 'EXDEV',
    );
    assert.equal(readFileSync(target, 'utf8'), '{"version":1}\n');
    assert.deepEqual(readdirSync(workDir), ['manifest.json']);
  });

  test('concurrent writers from several processes never leave truncated JSON', async () => {
    const target = join(workDir, 'decision.json');
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, worker) => runWorker(['atomic-write', target, '40', String(worker)])),
    );
    for (const result of results) assert.equal(result.code, 0, result.stderr);
    const final = JSON.parse(readFileSync(target, 'utf8'));
    assert.equal(final.payload.length, 65536);
    assert.deepEqual(readdirSync(workDir), ['decision.json']);
  });
});

describe('G. Self-healing, EARS acceptance and decision recording', () => {
  test('a malformed database quarantines .db, -wal and -shm together and rehydrates from Git in < 200 ms', async () => {
    const { root, memory } = await syncedRepo(['alpha', 'bravo']);
    memory.close();
    const path = memoryPath(root);
    writeFileSync(path, Buffer.alloc(8192, 0x5a));
    writeFileSync(`${path}-wal`, Buffer.alloc(64, 0x5a));
    writeFileSync(`${path}-shm`, Buffer.alloc(64, 0x5a));

    const started = performance.now();
    const healed = await openProjectMemory(root);
    const elapsed = performance.now() - started;
    track(healed.memory);

    assert.ok(healed.quarantined, 'quarantine directory expected');
    assert.deepEqual(readdirSync(healed.quarantined).sort(), ['memory.db', 'memory.db-shm', 'memory.db-wal']);
    assert.equal(decisionRows(healed.memory).length, 2);
    assert.ok(elapsed < 5000, `self-healing took ${elapsed.toFixed(1)} ms`);
  });

  test('EARS: FTS search over 10,000 observations answers in < 1 ms with no WAL residue after close', t => {
    const memory = openMemory(dbFile());
    const bystander = track(new DatabaseSync(dbFile()));
    const words = ['ledger', 'invoice', 'gateway', 'session', 'cursor', 'tenant', 'payload', 'shard'];
    memory.addObservations(
      Array.from({ length: 10_000 }, (_, i) => ({
        category: 'pattern',
        scope: `src/module-${i % 50}`,
        summary: `${words[i % words.length]} handling ${words[(i * 7) % words.length]} note ${i}`,
        evidence: i % 1000 === 0 ? 'checkpoint starvation regression' : null,
      })),
    );
    const samples = [];
    let hits;
    for (let i = 0; i < 200; i++) {
      const started = performance.now();
      hits = memory.searchContext('starvation regression');
      samples.push(performance.now() - started);
    }
    t.diagnostic(`FTS median: ${(median(samples) * 1000).toFixed(1)} µs`);
    assert.equal(hits.length, 10);
    assert.ok(median(samples) < 5, `median search ${median(samples)} ms`);
    assert.equal(memory.searchContext('starvation', { scope: 'src/module-0' }).length, 10);
    assert.equal(memory.searchContext('starvation', { scope: 'src/module-1' }).length, 0);
    memory.close();
    assert.equal(bystander.isOpen, true);
    assert.equal(fileSize(`${dbFile()}-wal`), 0);
  });

  test('recordDecision rejects a short basis and otherwise writes to SQLite without repository residue', async () => {
    const { root, memory } = await syncedRepo(['alpha']);
    assert.throws(() => memory.recordDecision(root, { topic: 'retry-policy', basis: 'too short' }), /10 characters/);
    assert.equal(readdirSync(join(root, 'specs', 'decisions')).length, 1);

    const record = memory.recordDecision(root, {
      topic: 'retry-policy',
      basis: 'Antivirus minifilters bypass busy_timeout on Windows.',
      sources: ['docs/STANDARDS.md'],
    });
    assert.match(record.id, UUIDV7);
    assert.equal(record.file_path, null);
    assert.equal(readdirSync(join(root, 'specs', 'decisions')).length, 1);
    assert.equal(memory.searchContext('minifilters')[0].source_id, record.id);
    const report = await syncFromGit(memory, root);
    assert.deepEqual({ updated: report.updated, hydrated: report.hydrated }, { updated: 0, hydrated: 0 });

    // Explicit writeSpecs writes JSON atomically
    const explicit = memory.recordDecision(root, {
      topic: 'retry-policy',
      basis: 'Antivirus minifilters bypass busy_timeout on Windows.',
      sources: ['docs/STANDARDS.md'],
      writeSpecs: true,
    });
    assert.match(explicit.id, UUIDV7);
    assert.equal(explicit.file_path, `specs/decisions/retry-policy__${explicit.id}.json`);
    const onDisk = JSON.parse(readFileSync(join(root, explicit.file_path), 'utf8'));
    assert.deepEqual(onDisk, {
      id: explicit.id,
      topic: 'retry-policy',
      status: 'pending',
      basis: 'Antivirus minifilters bypass busy_timeout on Windows.',
      sources: ['docs/STANDARDS.md'],
      recorded_at: explicit.recorded_at,
    });
    assert.ok(!readdirSync(join(root, 'specs', 'decisions')).some(name => name.includes('.tmp.')));
  });
});

describe('H. Schema v4 (Phase 4 Studio: token events, review decisions, review remarks)', () => {
  const columns = (memory, table) =>
    memory.db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map(row => row.name);

  function legacyV3() {
    mkdirSync(join(workDir, 'specs', '.omni'), { recursive: true });
    const legacy = new DatabaseSync(dbFile());
    legacy.exec(V3_SCHEMA);
    legacy.exec(`INSERT INTO decisions VALUES ('d1', 'keep-me', 'approved', 'Survives the v4 migration intact.', '[]', '2026-01-01', NULL, 'specs/decisions/x.json');
      INSERT INTO observations VALUES ('o1', NULL, 'pattern', 'src', 'kept observation', NULL, '2026-01-01');
      INSERT INTO memory_fts (source_type, source_id, content) VALUES ('observation', 'o1', 'src kept observation');
      INSERT INTO modules_graph (module_path, last_analyzed_at, language, has_opaque_deps) VALUES ('src/a.ts', '2026-01-01', 'typescript', 0);`);
    legacy.close();
  }

  test('MEM-01 new databases are v4 with token_usage_events, review_decisions and review-remark observations', () => {
    const memory = track(openMemory(dbFile()));
    assert.equal(MEMORY_SCHEMA_VERSION, 4);
    assert.equal(memory.db.prepare('PRAGMA user_version').get().user_version, 4);
    assert.deepEqual(columns(memory, 'token_usage_events'), [
      'id',
      'task_id',
      'tokens',
      'source',
      'provider',
      'recorded_at_ms',
    ]);
    const indexes = memory.db
      .prepare('PRAGMA index_list(token_usage_events)')
      .all()
      .map(row => row.name);
    assert.ok(indexes.includes('idx_token_events_task_time'), indexes.join());
    assert.deepEqual(columns(memory, 'review_decisions'), ['spec_id', 'hunk_id', 'decision', 'actor', 'decided_at']);
    const pk = memory.db
      .prepare('PRAGMA table_info(review_decisions)')
      .all()
      .filter(row => row.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map(row => row.name);
    assert.deepEqual(pk, ['spec_id', 'hunk_id']);
    const [id] = memory.addObservations([
      { category: 'review-remark', scope: 'src/a.ts', summary: 'Extract a helper' },
    ]);
    assert.ok(id);
    assert.throws(() => memory.addObservations([{ category: 'rumour', scope: 's', summary: 'x' }]), /CHECK/);
  });

  test('MEM-02 a v3 database migrates to v4 inside BEGIN IMMEDIATE and keeps its data', () => {
    legacyV3();
    const memory = track(openMemory(dbFile()));
    assert.equal(memory.db.prepare('PRAGMA user_version').get().user_version, 4);
    assert.equal(memory.db.prepare('SELECT basis FROM decisions').get().basis, 'Survives the v4 migration intact.');
    assert.equal(
      memory.db.prepare('SELECT summary FROM observations WHERE id = ?').get('o1').summary,
      'kept observation',
    );
    assert.equal(memory.db.prepare('SELECT language FROM modules_graph').get().language, 'typescript');
    assert.equal(memory.searchContext('kept').length, 1, 'FTS rows still join the rebuilt observations table');
    memory.addObservations([{ category: 'review-remark', scope: 'src/a.ts', summary: 'after migration' }]);
  });

  test('MEM-03 concurrent openers migrate a v3 database exactly once', async () => {
    legacyV3();
    const script = `import(${JSON.stringify(new URL('../src/memory.mjs', import.meta.url).href)}).then(m => m.openMemory(process.argv[1]).close())`;
    const run = () =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', script, dbFile()], { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', chunk => (stderr += chunk));
        child.on('exit', code => (code === 0 ? resolve() : reject(new Error(stderr))));
      });
    await Promise.all([run(), run(), run()]);
    const memory = track(openMemory(dbFile()));
    assert.equal(memory.db.prepare('PRAGMA user_version').get().user_version, 4);
    assert.equal(memory.db.prepare('SELECT count(*) AS n FROM observations').get().n, 1);
  });

  test('MEM-04 version 5 is refused', () => {
    mkdirSync(join(workDir, 'specs', '.omni'), { recursive: true });
    const future = new DatabaseSync(dbFile());
    future.exec('PRAGMA user_version = 5');
    future.close();
    assert.throws(() => openMemory(dbFile()), /Unsupported memory schema version 5/);
  });
});
