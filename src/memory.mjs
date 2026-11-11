import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { workspaceMemoryPath } from './workspace.mjs';

export const MEMORY_SCHEMA_VERSION = 4;

const SQLITE_BUSY = 5;
const SQLITE_IOERR = 10;
const SQLITE_CORRUPT = 11;
const SQLITE_CANTOPEN = 14;
const SQLITE_NOTADB = 26;
const RETRY_CEILINGS_MS = [25, 50, 100];
const RENAME_TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const CHECKPOINT_MODES = new Set(['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE']);
const DECISION_STATUSES = new Set(['pending', 'approved', 'delegated', 'deprecated', 'superseded']);
const TOPIC = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DECISION_FILE =
  /^([a-z0-9]+(?:-[a-z0-9]+)*)__([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/;
const CONFLICT_MARKER = /^(?:<{7}|={7}|>{7})(?: |$)/m;
const DECISIONS_DIR = 'specs/decisions';
const SPECS_STATE_KEY = 'specs';
const CANONICAL_PATHSPECS = ['specs/manifest.json', 'specs/contracts.json', DECISIONS_DIR];
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');
const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));
const execFileAsync = promisify(execFile);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  model TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  capabilities_json TEXT
);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'delegated', 'deprecated', 'superseded')),
  basis TEXT NOT NULL,
  sources_json TEXT,
  recorded_at TEXT NOT NULL,
  review_after TEXT,
  file_path TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK(category IN ('pattern', 'gotcha', 'convention', 'constraint')),
  scope TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS modules_graph (
  module_path TEXT PRIMARY KEY,
  framework TEXT,
  loc INTEGER,
  exports_json TEXT,
  dependencies_json TEXT,
  last_analyzed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS barrel_symbol_routes (
  barrel_path TEXT NOT NULL,
  exported_symbol TEXT NOT NULL,
  source_module TEXT NOT NULL,
  is_reexport INTEGER DEFAULT 1,
  PRIMARY KEY (barrel_path, exported_symbol)
);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  source_type,
  source_id UNINDEXED,
  content,
  tokenize='porter unicode61'
);
CREATE TABLE IF NOT EXISTS _git_sync_state (
  file_path TEXT PRIMARY KEY,
  tree_oid TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  last_sync_mtime INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS project_state_store (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS context_history (
  id TEXT PRIMARY KEY,
  recorded_at TEXT NOT NULL,
  context_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decision_history (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  archived_at TEXT NOT NULL
);
`;

/**
 * Version 3 (Phase 3 cartography): incremental-cache columns on modules_graph, the typed edge table,
 * barrel routes that keep the original symbol and ambiguity, and resolver state. barrel_symbol_routes
 * is recreated because version 2 never wrote it and its primary key cannot hold ambiguous routes.
 */
const MIGRATION_V3 = `
ALTER TABLE modules_graph ADD COLUMN language TEXT;
ALTER TABLE modules_graph ADD COLUMN node_type TEXT;
ALTER TABLE modules_graph ADD COLUMN content_hash TEXT;
ALTER TABLE modules_graph ADD COLUMN mtime_ms INTEGER;
ALTER TABLE modules_graph ADD COLUMN size_bytes INTEGER;
ALTER TABLE modules_graph ADD COLUMN has_opaque_deps INTEGER NOT NULL DEFAULT 0;
CREATE TABLE module_dependencies (
  source_module TEXT NOT NULL REFERENCES modules_graph(module_path) ON DELETE CASCADE,
  target_module TEXT NOT NULL,
  edge_type TEXT NOT NULL CHECK(edge_type IN ('value', 'type_only', 'synthetic')),
  target_kind TEXT NOT NULL CHECK(target_kind IN ('internal', 'external', 'unresolved')),
  symbols_json TEXT NOT NULL,
  PRIMARY KEY (source_module, target_module, edge_type)
);
-- Covering index: the recursive blast-radius step reads every column it needs from the index.
CREATE INDEX idx_deps_target ON module_dependencies(target_module, target_kind, source_module, edge_type);
CREATE INDEX idx_deps_source ON module_dependencies(source_module);
DROP TABLE IF EXISTS barrel_symbol_routes;
CREATE TABLE barrel_symbol_routes (
  barrel_path TEXT NOT NULL REFERENCES modules_graph(module_path) ON DELETE CASCADE,
  exported_symbol TEXT NOT NULL,
  source_module TEXT NOT NULL,
  source_symbol TEXT NOT NULL,
  is_reexport INTEGER NOT NULL DEFAULT 1,
  ambiguous INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (barrel_path, exported_symbol, source_module)
);
CREATE INDEX idx_barrel_source ON barrel_symbol_routes(source_module, source_symbol);
CREATE TABLE cartography_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
/**
 * Version 4 (Phase 4 Omni Studio): append-only token usage events for the FinOps view, per-hunk
 * review decisions, and observations that accept inline review remarks. SQLite cannot alter a
 * CHECK constraint, so observations is rebuilt; nothing references it by foreign key and the FTS
 * rows join it by id, which the copy preserves.
 */
const MIGRATION_V4 = `
CREATE TABLE token_usage_events (
  id INTEGER PRIMARY KEY,
  task_id TEXT NOT NULL,
  tokens INTEGER NOT NULL CHECK(tokens >= 0),
  source TEXT,
  provider TEXT,
  recorded_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_token_events_task_time ON token_usage_events(task_id, recorded_at_ms);
CREATE TABLE review_decisions (
  spec_id TEXT NOT NULL,
  hunk_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approve', 'reject')),
  actor TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  PRIMARY KEY (spec_id, hunk_id)
);
CREATE TABLE observations_v4 (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK(category IN ('pattern', 'gotcha', 'convention', 'constraint', 'review-remark')),
  scope TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO observations_v4 SELECT id, session_id, category, scope, summary, evidence, created_at FROM observations;
DROP TABLE observations;
ALTER TABLE observations_v4 RENAME TO observations;
`;
const MIGRATIONS = new Map([
  [2, MIGRATION_V3],
  [3, MIGRATION_V4],
]);

const sha256 = text => createHash('sha256').update(text).digest('hex');
const CLEAN_STATUS_HASH = sha256('');

function sleepSync(ms) {
  Atomics.wait(SLEEP_CELL, 0, 0, ms);
}

function sqlitePrimaryCode(error) {
  return error?.code === 'ERR_SQLITE_ERROR' ? error.errcode & 0xff : null;
}

function isCorruptionError(error) {
  const code = sqlitePrimaryCode(error);
  return code === SQLITE_CORRUPT || code === SQLITE_NOTADB;
}

/**
 * Runs a synchronous SQLite operation, retrying the transient SQLITE_IOERR / SQLITE_CANTOPEN
 * failures that Windows antivirus minifilters cause regardless of busy_timeout.
 */
export function withSqliteRetry(operation, { sleep = sleepSync, random = Math.random } = {}) {
  for (let retry = 0; ; retry++) {
    try {
      return operation();
    } catch (error) {
      const code = sqlitePrimaryCode(error);
      if (retry >= RETRY_CEILINGS_MS.length || (code !== SQLITE_IOERR && code !== SQLITE_CANTOPEN)) throw error;
      const ceiling = RETRY_CEILINGS_MS[retry];
      sleep(ceiling / 2 + (random() * ceiling) / 2);
    }
  }
}

function renameWithRetrySync(from, to, attempts = 8) {
  for (let attempt = 1; ; attempt++) {
    try {
      return fs.renameSync(from, to);
    } catch (error) {
      if (!RENAME_TRANSIENT.has(error.code) || attempt >= attempts) throw error;
      sleepSync(25 * 2 ** (attempt - 1));
    }
  }
}

/** Replaces `path` through a fsynced `<path>.tmp.<pid>` sibling so a failed write never truncates it. */
export function writeFileAtomicSync(path, content) {
  const temporary = `${path}.tmp.${process.pid}`;
  try {
    const fd = fs.openSync(temporary, 'w');
    try {
      const buffer = Buffer.from(content);
      for (let offset = 0; offset < buffer.length; ) offset += fs.writeSync(fd, buffer, offset);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    renameWithRetrySync(temporary, path);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

let lastUuidMs = -1;
let uuidCounter = 0;

/** RFC 9562 UUIDv7 with a 12-bit monotonic counter in rand_a (method 1). */
export function uuidv7() {
  const now = Date.now();
  if (now > lastUuidMs) {
    lastUuidMs = now;
    uuidCounter = randomBytes(2).readUInt16BE() & 0x7ff;
  } else if (++uuidCounter > 0xfff) {
    lastUuidMs++;
    uuidCounter = randomBytes(2).readUInt16BE() & 0x7ff;
  }
  const bytes = randomBytes(16);
  bytes.writeUIntBE(lastUuidMs, 0, 6);
  bytes[6] = 0x70 | (uuidCounter >> 8);
  bytes[7] = uuidCounter & 0xff;
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function decisionFileName(topic, id) {
  if (!TOPIC.test(topic) || topic.length > 64) throw new Error(`Invalid decision topic "${topic}": use kebab-case.`);
  const name = `${topic}__${id}.json`;
  parseDecisionFileName(name);
  return name;
}

export function parseDecisionFileName(name) {
  const match = DECISION_FILE.exec(name);
  if (!match) throw new Error(`Invalid decision file name "${name}": expected <topic>__<uuidv7>.json.`);
  return { topic: match[1], id: match[2] };
}

/**
 * The project's memory, stored in the OmniSpec per-user workspaces directory.
 */
export function memoryPath(root, env = process.env) {
  return workspaceMemoryPath(root, env);
}

export function openMemory(path) {
  fs.mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      return withSqliteRetry(() => {
        const db = new DatabaseSync(path);
        try {
          db.exec(`PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;
        PRAGMA temp_store = MEMORY;`);
          const { user_version: version } = db.prepare('PRAGMA user_version').get();
          if (version === 0 || MIGRATIONS.has(version)) {
            // Re-read inside BEGIN IMMEDIATE: a concurrent opener may have created or migrated it first.
            db.exec('BEGIN IMMEDIATE');
            try {
              let current = db.prepare('PRAGMA user_version').get().user_version;
              if (current === 0) {
                db.exec(SCHEMA);
                current = 2;
              }
              while (MIGRATIONS.has(current)) db.exec(MIGRATIONS.get(current++));
              if (current !== MEMORY_SCHEMA_VERSION)
                throw new Error(
                  `Unsupported memory schema version ${current} in ${path}; expected ${MEMORY_SCHEMA_VERSION}.`,
                );
              db.exec(`PRAGMA user_version = ${MEMORY_SCHEMA_VERSION}`);
              db.exec('COMMIT');
            } catch (error) {
              if (db.isTransaction) db.exec('ROLLBACK');
              throw error;
            }
          } else if (version !== MEMORY_SCHEMA_VERSION) {
            throw new Error(
              `Unsupported memory schema version ${version} in ${path}; expected ${MEMORY_SCHEMA_VERSION}.`,
            );
          }
          db.exec(`
        CREATE TABLE IF NOT EXISTS project_state_store (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS context_history (
          id TEXT PRIMARY KEY,
          recorded_at TEXT NOT NULL,
          context_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS decision_history (
          id TEXT PRIMARY KEY,
          decision_id TEXT NOT NULL,
          revision INTEGER NOT NULL,
          payload_json TEXT NOT NULL,
          archived_at TEXT NOT NULL
        );
      `);
          return new Memory(db, path);
        } catch (error) {
          db.close();
          throw error;
        }
      });
    } catch (error) {
      if (sqlitePrimaryCode(error) === SQLITE_BUSY && attempt < 8) {
        sleepSync(25 * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
}

function quarantineTriad(path) {
  const directory = join(dirname(path), 'quarantine', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(directory, { recursive: true });
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    if (fs.existsSync(file)) renameWithRetrySync(file, join(directory, basename(file)));
  }
  return directory;
}

function hasSqliteHeader(path) {
  if (!fs.existsSync(path) || fs.statSync(path).size === 0) return true;
  const header = Buffer.alloc(SQLITE_HEADER.length);
  const fd = fs.openSync(path, 'r');
  try {
    fs.readSync(fd, header, 0, header.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  return header.equals(SQLITE_HEADER);
}

/**
 * Opens specs/.omni/memory.db, quarantining a corrupt triad, and hydrates it from Git.
 * The header is checked before any handle exists because closing a SQLite handle deletes -wal and -shm.
 */
export async function openProjectMemory(root) {
  const path = memoryPath(root);
  let memory;
  let quarantined = hasSqliteHeader(path) ? null : quarantineTriad(path);
  try {
    memory = openMemory(path);
  } catch (error) {
    if (quarantined || !isCorruptionError(error)) throw error;
    quarantined = quarantineTriad(path);
    memory = openMemory(path);
  }
  try {
    return { memory, quarantined, sync: await syncFromGit(memory, root) };
  } catch (error) {
    memory.close();
    throw error;
  }
}

async function git(root, args) {
  try {
    return (await execFileAsync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })).stdout;
  } catch (error) {
    throw new Error(`git ${args.join(' ')} failed in ${root}: ${(error.stderr || error.message).trim()}`, {
      cause: error,
    });
  }
}

/** Reads the committed specs tree OID and the dirty canonical paths with two parallel git calls. */
export async function readSpecsGitState(root) {
  const [revParse, status] = await Promise.all([
    git(root, ['rev-parse', '--show-prefix', 'HEAD:./specs']),
    git(root, [
      'status',
      '--porcelain=v1',
      '-z',
      '--no-renames',
      '--untracked-files=all',
      '--',
      ...CANONICAL_PATHSPECS,
    ]),
  ]);
  const [prefix, treeOid] = revParse.split('\n');
  return { treeOid, status, prefix };
}

/** True when `root` is inside a Git working tree; a folder that was never a repository answers false. */
export async function isGitWorkTree(root) {
  try {
    return (await git(root, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
  } catch (error) {
    if (/not a git repository/i.test(error.message)) return false;
    throw error;
  }
}

export async function syncFromGit(memory, root) {
  // A folder opened in Omni Studio does not have to be a repository: with no history there is nothing to sync.
  if (!(await isGitWorkTree(root))) return null;
  return memory.syncSpecs(root, await readSpecsGitState(root));
}

function dirtyDecisionPaths({ status, prefix }) {
  return status
    .split('\0')
    .filter(Boolean)
    .map(entry => entry.slice(3))
    .filter(path => path.startsWith(prefix))
    .map(path => path.slice(prefix.length))
    .filter(path => path.startsWith(`${DECISIONS_DIR}/`) && path.endsWith('.json'));
}

function listDecisionPaths(root) {
  const directory = join(root, DECISIONS_DIR);
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => `${DECISIONS_DIR}/${entry.name}`)
    .sort();
}

function readDecisionFiles(root, paths) {
  const present = new Map();
  const absent = [];
  const conflicts = [];
  const invalidNames = [];
  for (const path of paths) {
    const absolute = join(root, path);
    if (!fs.existsSync(absolute)) {
      absent.push(path);
      continue;
    }
    if (!DECISION_FILE.test(basename(path))) {
      invalidNames.push(path);
      continue;
    }
    const raw = fs.readFileSync(absolute, 'utf8');
    if (CONFLICT_MARKER.test(raw)) conflicts.push(path);
    else present.set(path, raw);
  }
  if (invalidNames.length)
    throw new Error(`Invalid decision file names (expected <topic>__<uuidv7>.json): ${invalidNames.join(', ')}`);
  if (conflicts.length)
    throw Object.assign(new Error(`Git conflict markers found; hydration aborted: ${conflicts.join(', ')}`), {
      files: conflicts,
    });
  const decisions = new Map();
  for (const [path, raw] of present) decisions.set(path, { record: parseDecision(path, raw), hash: sha256(raw) });
  return { decisions, absent };
}

function parseDecision(path, raw) {
  const { topic, id } = parseDecisionFileName(basename(path));
  const record = JSON.parse(raw.replace(/^﻿/, ''));
  const problems = [];
  if (record.id !== id) problems.push(`id ${record.id} does not match file name`);
  if (record.topic !== topic) problems.push(`topic ${record.topic} does not match file name`);
  if (!DECISION_STATUSES.has(record.status)) problems.push(`invalid status ${record.status}`);
  if (typeof record.basis !== 'string' || !record.basis.trim()) problems.push('missing basis');
  if (typeof record.recorded_at !== 'string') problems.push('missing recorded_at');
  if (record.sources !== undefined && !Array.isArray(record.sources)) problems.push('sources must be an array');
  if (problems.length) throw new Error(`Invalid decision ${path}: ${problems.join('; ')}`);
  return record;
}

function toFtsQuery(text) {
  const terms = String(text).match(/[\p{L}\p{N}_]+/gu);
  if (!terms) throw new Error('Search query must contain at least one word.');
  return terms.map(term => `"${term}"`).join(' ');
}

class Memory {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.lastWriteAt = 0;
    this.lastCheckpointAt = 0;
    this.statements = {
      specsState: db.prepare('SELECT tree_oid, content_hash FROM _git_sync_state WHERE file_path = ?'),
      syncState: db.prepare('SELECT file_path, content_hash FROM _git_sync_state WHERE file_path <> ?'),
      upsertSyncState: db.prepare(`INSERT INTO _git_sync_state (file_path, tree_oid, content_hash, last_sync_mtime)
        VALUES (?, ?, ?, ?) ON CONFLICT(file_path) DO UPDATE SET tree_oid = excluded.tree_oid,
        content_hash = excluded.content_hash, last_sync_mtime = excluded.last_sync_mtime`),
      deleteSyncState: db.prepare('DELETE FROM _git_sync_state WHERE file_path = ?'),
      decisionsByPath: db.prepare('SELECT id, file_path FROM decisions'),
      upsertDecision:
        db.prepare(`INSERT INTO decisions (id, topic, status, basis, sources_json, recorded_at, review_after, file_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET topic = excluded.topic, status = excluded.status,
        basis = excluded.basis, sources_json = excluded.sources_json, recorded_at = excluded.recorded_at,
        review_after = excluded.review_after, file_path = excluded.file_path`),
      deleteDecision: db.prepare('DELETE FROM decisions WHERE id = ?'),
      deleteFts: db.prepare('DELETE FROM memory_fts WHERE source_type = ? AND source_id = ?'),
      insertFts: db.prepare('INSERT INTO memory_fts (source_type, source_id, content) VALUES (?, ?, ?)'),
      insertObservation:
        db.prepare(`INSERT INTO observations (id, session_id, category, scope, summary, evidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`),
      getProjectState: db.prepare('SELECT value_json FROM project_state_store WHERE key = ?'),
      setProjectState: db.prepare(`INSERT INTO project_state_store (key, value_json, updated_at)
        VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`),
      insertContextHistory: db.prepare('INSERT INTO context_history (id, recorded_at, context_json) VALUES (?, ?, ?)'),
      listContextHistory: db.prepare(
        'SELECT id, recorded_at, context_json FROM context_history ORDER BY recorded_at DESC, rowid DESC',
      ),
      insertDecisionHistory: db.prepare(
        'INSERT INTO decision_history (id, decision_id, revision, payload_json, archived_at) VALUES (?, ?, ?, ?, ?)',
      ),
      listDecisionHistory: db.prepare(
        'SELECT id, decision_id, revision, payload_json, archived_at FROM decision_history ORDER BY archived_at DESC, rowid DESC',
      ),
      listObservations: db.prepare(`SELECT id, category, scope, summary, evidence, created_at
        FROM observations
        WHERE (:category IS NULL OR category = :category)
          AND (:scope IS NULL OR substr(scope, 1, length(:scope)) = :scope)
        ORDER BY created_at DESC, rowid DESC
        LIMIT :limit`),
      search: db.prepare(`SELECT f.source_type, f.source_id, f.content
        FROM memory_fts f
        LEFT JOIN observations o ON f.source_type = 'observation' AND o.id = f.source_id
        LEFT JOIN decisions d ON f.source_type = 'decision' AND d.id = f.source_id
        WHERE memory_fts MATCH :query
          AND (:scope IS NULL OR substr(o.scope, 1, length(:scope)) = :scope OR instr(d.sources_json, :scope) > 0)
        ORDER BY f.rank LIMIT :limit`),
    };
  }

  /** Runs `action` inside BEGIN IMMEDIATE; never uses deferred transactions. */
  write(action) {
    const result = withSqliteRetry(() => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const value = action();
        this.db.exec('COMMIT');
        return value;
      } catch (error) {
        if (this.db.isTransaction) {
          try {
            this.db.exec('ROLLBACK');
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], 'ROLLBACK failed after a transaction error');
          }
        }
        throw error;
      }
    });
    this.lastWriteAt = Date.now();
    return result;
  }

  checkpoint(mode) {
    if (!CHECKPOINT_MODES.has(mode)) throw new Error(`Unknown checkpoint mode ${mode}.`);
    const { busy, log, checkpointed } = this.db.prepare(`PRAGMA wal_checkpoint(${mode})`).get();
    this.lastCheckpointAt = Date.now();
    return { busy, log, checkpointed };
  }

  close() {
    const result = this.checkpoint('TRUNCATE');
    this.db.close();
    return result;
  }

  addObservations(observations) {
    return this.write(() =>
      observations.map(({ category, scope, summary, evidence = null, sessionId = null }) => {
        const id = uuidv7();
        this.statements.insertObservation.run(
          id,
          sessionId,
          category,
          scope,
          summary,
          evidence,
          new Date().toISOString(),
        );
        this.statements.insertFts.run('observation', id, [scope, summary, evidence].filter(Boolean).join('\n'));
        return id;
      }),
    );
  }

  searchContext(query, { scope = null, limit = 20 } = {}) {
    return this.statements.search.all({ query: toFtsQuery(query), scope, limit });
  }

  isSpecsTreeCurrent({ treeOid, status }) {
    const stored = this.statements.specsState.get(SPECS_STATE_KEY);
    return status === '' && stored?.tree_oid === treeOid && stored.content_hash === CLEAN_STATUS_HASH;
  }

  syncSpecs(root, state) {
    const report = { fastPath: true, treeOid: state.treeOid, scanned: 0, hydrated: 0, updated: 0, pruned: 0 };
    if (this.isSpecsTreeCurrent(state)) return report;
    report.fastPath = false;

    const stored = this.statements.specsState.get(SPECS_STATE_KEY);
    const dirtyOnly = stored?.tree_oid === state.treeOid && stored.content_hash === CLEAN_STATUS_HASH;
    const paths = dirtyOnly ? dirtyDecisionPaths(state) : listDecisionPaths(root);
    const { decisions, absent } = readDecisionFiles(root, paths);
    report.scanned = decisions.size;

    const absentSet = new Set(absent);
    const isRemoved = path => (dirtyOnly ? absentSet.has(path) : !decisions.has(path));

    this.write(() => {
      const known = new Map(
        this.statements.syncState.all(SPECS_STATE_KEY).map(row => [row.file_path, row.content_hash]),
      );
      for (const { id, file_path: path } of this.statements.decisionsByPath.all()) {
        if (!isRemoved(path)) continue;
        this.#deleteDecision(id, path);
        report.pruned++;
      }
      for (const path of known.keys()) if (isRemoved(path)) this.statements.deleteSyncState.run(path);
      for (const [path, { record, hash }] of decisions) {
        if (known.get(path) === hash) continue;
        if (known.has(path)) report.updated++;
        else report.hydrated++;
        this.#upsertDecision(path, record, hash, state.treeOid);
      }
      this.statements.upsertSyncState.run(SPECS_STATE_KEY, state.treeOid, sha256(state.status), Date.now());
    });
    return report;
  }

  getProjectState() {
    const row = this.statements.getProjectState.get('state');
    return row ? JSON.parse(row.value_json) : null;
  }

  setProjectState(state) {
    const json = typeof state === 'string' ? state : JSON.stringify(state, null, 2);
    const now = new Date().toISOString();
    return this.write(() => {
      this.statements.setProjectState.run('state', json, now);
      return state;
    });
  }

  appendContextHistory(id, context) {
    const json = typeof context === 'string' ? context : JSON.stringify(context);
    const now = new Date().toISOString();
    return this.write(() => {
      this.statements.insertContextHistory.run(id, now, json);
    });
  }

  listContextHistory() {
    return this.statements.listContextHistory.all().map(row => ({
      id: row.id,
      recorded_at: row.recorded_at,
      context: JSON.parse(row.context_json),
    }));
  }

  appendDecisionHistory(id, decision) {
    const decisionId = decision.id || decision.decision_id || '';
    const revision = decision.revision ?? 0;
    const payload = typeof decision === 'string' ? decision : JSON.stringify(decision);
    const archivedAt = new Date().toISOString();
    return this.write(() => {
      this.statements.insertDecisionHistory.run(id, decisionId, revision, payload, archivedAt);
    });
  }

  listDecisionHistory() {
    return this.statements.listDecisionHistory.all().map(row => ({
      id: row.id,
      decision_id: row.decision_id,
      revision: row.revision,
      decision: JSON.parse(row.payload_json),
      archived_at: row.archived_at,
    }));
  }

  listObservations({ scope = null, category = null, limit = 20 } = {}) {
    return this.statements.listObservations.all({
      category: category ?? null,
      scope: scope ?? null,
      limit: limit ?? 20,
    });
  }

  indexDecision(decision) {
    const id = decision.id;
    const topic = decision.topic || '';
    const basis = decision.basis || '';
    const sources = Array.isArray(decision.sources)
      ? decision.sources.map(s => (typeof s === 'string' ? s : s.url || s.appliesTo || JSON.stringify(s)))
      : [];
    const content = [topic, basis, decision.value || '', ...sources].filter(Boolean).join('\n');
    return this.write(() => {
      const validStatuses = new Set(['pending', 'approved', 'delegated', 'deprecated', 'superseded']);
      const status = validStatuses.has(decision.status) ? decision.status : 'pending';
      this.statements.upsertDecision.run(
        id,
        topic,
        status,
        basis || topic || id,
        JSON.stringify(sources),
        decision.recordedAt || new Date().toISOString(),
        decision.reviewAfter || null,
        null,
      );
      this.statements.deleteFts.run('decision', id);
      this.statements.insertFts.run('decision', id, content);
    });
  }

  recordDecision(root, { topic, basis, sources = [], writeSpecs = false }) {
    if (typeof basis !== 'string' || basis.trim().length < 10)
      throw new Error('Decision basis must have at least 10 characters.');
    if (!Array.isArray(sources) || sources.some(source => typeof source !== 'string'))
      throw new Error('Decision sources must be an array of strings.');
    const id = uuidv7();
    const shouldWrite = Boolean(writeSpecs);
    const path = shouldWrite ? `${DECISIONS_DIR}/${decisionFileName(topic, id)}` : null;
    const record = {
      id,
      topic,
      status: 'pending',
      basis: basis.trim(),
      sources,
      recorded_at: new Date().toISOString(),
    };
    let contentHash = '';
    if (shouldWrite) {
      fs.mkdirSync(join(root, DECISIONS_DIR), { recursive: true });
      const content = JSON.stringify(record, null, 2) + '\n';
      writeFileAtomicSync(join(root, path), content);
      contentHash = sha256(content);
    } else {
      contentHash = sha256(JSON.stringify(record));
    }
    const treeOid = this.statements.specsState.get(SPECS_STATE_KEY)?.tree_oid ?? '';
    this.write(() => this.#upsertDecision(path, record, contentHash, treeOid));
    return { ...record, file_path: path };
  }

  #upsertDecision(path, record, hash, treeOid) {
    const sources = record.sources ?? [];
    this.statements.upsertDecision.run(
      record.id,
      record.topic,
      record.status,
      record.basis,
      JSON.stringify(sources),
      record.recorded_at,
      record.review_after ?? null,
      path,
    );
    this.statements.deleteFts.run('decision', record.id);
    this.statements.insertFts.run('decision', record.id, [record.topic, record.basis, ...sources].join('\n'));
    if (path) this.statements.upsertSyncState.run(path, treeOid, hash, Date.now());
  }

  #deleteDecision(id, path) {
    this.statements.deleteDecision.run(id);
    this.statements.deleteFts.run('decision', id);
    this.statements.deleteSyncState.run(path);
  }
}

/** Drains the WAL with PASSIVE checkpoints whenever the connection has been idle for `idleMs`. */
export function startCheckpointSupervisor(memory, { idleMs = 30_000 } = {}) {
  const timer = setInterval(() => {
    if (!memory.db.isOpen || memory.lastCheckpointAt > memory.lastWriteAt) return;
    if (Date.now() - memory.lastWriteAt >= idleMs) memory.checkpoint('PASSIVE');
  }, idleMs);
  timer.unref();
  return timer;
}
