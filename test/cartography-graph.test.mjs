import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, symlinkSync, utimesSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { MEMORY_SCHEMA_VERSION, openMemory } from '../src/memory.mjs';
import { barrelRoutes, indexRepository, reverseDependencies } from '../src/cartography/graph.mjs';
import { makeRepo, writeSyntheticMonorepo } from '../test-support/cartography-fixtures.mjs';

const execFileAsync = promisify(execFile);
const PERF_WORKER = fileURLToPath(new URL('../test-support/cartography-perf-worker.mjs', import.meta.url));
const CARTOGRAPHY_SRC = fileURLToPath(new URL('../src/cartography/', import.meta.url));
const MEMORY_MODULE = new URL('../src/memory.mjs', import.meta.url).href;

const V2_SCHEMA = `
CREATE TABLE sessions (id TEXT PRIMARY KEY, host TEXT NOT NULL, model TEXT, started_at TEXT NOT NULL, ended_at TEXT, capabilities_json TEXT);
CREATE TABLE decisions (id TEXT PRIMARY KEY, topic TEXT NOT NULL, status TEXT NOT NULL, basis TEXT NOT NULL, sources_json TEXT, recorded_at TEXT NOT NULL, review_after TEXT, file_path TEXT UNIQUE);
CREATE TABLE observations (id TEXT PRIMARY KEY, session_id TEXT, category TEXT NOT NULL, scope TEXT NOT NULL, summary TEXT NOT NULL, evidence TEXT, created_at TEXT NOT NULL);
CREATE TABLE modules_graph (module_path TEXT PRIMARY KEY, framework TEXT, loc INTEGER, exports_json TEXT, dependencies_json TEXT, last_analyzed_at TEXT NOT NULL);
CREATE TABLE barrel_symbol_routes (barrel_path TEXT NOT NULL, exported_symbol TEXT NOT NULL, source_module TEXT NOT NULL, is_reexport INTEGER DEFAULT 1, PRIMARY KEY (barrel_path, exported_symbol));
CREATE VIRTUAL TABLE memory_fts USING fts5(source_type, source_id UNINDEXED, content, tokenize='porter unicode61');
CREATE TABLE _git_sync_state (file_path TEXT PRIMARY KEY, tree_oid TEXT NOT NULL, content_hash TEXT NOT NULL, last_sync_mtime INTEGER NOT NULL);
INSERT INTO decisions VALUES ('d1', 'keep-me', 'approved', 'Survives the v3 migration intact.', '[]', '2026-01-01', NULL, 'specs/decisions/x.json');
INSERT INTO observations VALUES ('o1', NULL, 'pattern', 'src', 'kept observation', NULL, '2026-01-01');
PRAGMA user_version = 2;
`;

let repo;
let memories;
beforeEach(() => {
  repo = makeRepo('omni-graph-');
  memories = [];
});
afterEach(() => {
  for (const memory of memories) if (memory.db.isOpen) memory.close();
  repo.cleanup();
});

const dbPath = () => join(repo.root, 'specs', '.omni', 'memory.db');
function open() {
  const memory = openMemory(dbPath());
  memories.push(memory);
  return memory;
}
const columns = (memory, table) =>
  memory.db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map(row => row.name);
const edges = memory =>
  memory.db
    .prepare(
      `SELECT source_module AS source, target_module AS target, edge_type AS type, target_kind AS kind, symbols_json AS symbols
       FROM module_dependencies ORDER BY source, target, type`,
    )
    .all()
    .map(row => ({ ...row, symbols: JSON.parse(row.symbols) }));
const node = (memory, path) => memory.db.prepare('SELECT * FROM modules_graph WHERE module_path = ?').get(path);
const paths = memory =>
  memory.db
    .prepare('SELECT module_path FROM modules_graph ORDER BY module_path')
    .all()
    .map(row => row.module_path);
const consumers = result => result.consumers.map(item => [item.path, item.distance]);

/** Inserts nodes and internal edges directly, for query tests that need exotic shapes. */
function seed(memory, list) {
  const insertNode = memory.db.prepare(
    "INSERT OR IGNORE INTO modules_graph (module_path, language, last_analyzed_at) VALUES (?, 'typescript', 'now')",
  );
  const insertEdge = memory.db.prepare(
    "INSERT INTO module_dependencies (source_module, target_module, edge_type, target_kind, symbols_json) VALUES (?, ?, ?, 'internal', '[\"*\"]')",
  );
  memory.write(() => {
    for (const [source, target, type = 'value'] of list) {
      insertNode.run(source);
      insertNode.run(target);
      insertEdge.run(source, target, type);
    }
  });
}

describe('GR-SCH schema v3', () => {
  test('GR-SCH-01 new databases get module_dependencies and its indexes', () => {
    const memory = open();
    assert.equal(MEMORY_SCHEMA_VERSION, 3);
    assert.equal(memory.db.prepare('PRAGMA user_version').get().user_version, 3);
    assert.deepEqual(columns(memory, 'module_dependencies'), [
      'source_module',
      'target_module',
      'edge_type',
      'target_kind',
      'symbols_json',
    ]);
    const indexes = memory.db
      .prepare('PRAGMA index_list(module_dependencies)')
      .all()
      .map(row => row.name);
    assert.ok(indexes.includes('idx_deps_target') && indexes.includes('idx_deps_source'), indexes.join(','));
    assert.deepEqual(columns(memory, 'barrel_symbol_routes'), [
      'barrel_path',
      'exported_symbol',
      'source_module',
      'source_symbol',
      'is_reexport',
      'ambiguous',
    ]);
  });

  test('GR-SCH-02 modules_graph carries the incremental cache columns', () => {
    const memory = open();
    for (const column of ['language', 'node_type', 'content_hash', 'mtime_ms', 'size_bytes', 'has_opaque_deps'])
      assert.ok(columns(memory, 'modules_graph').includes(column), column);
  });

  test('GR-SCH-03 a v2 database migrates and keeps its data', () => {
    repo.write('specs/.omni/.keep', '');
    const legacy = new DatabaseSync(dbPath());
    legacy.exec(V2_SCHEMA);
    legacy.close();
    const memory = open();
    assert.equal(memory.db.prepare('PRAGMA user_version').get().user_version, 3);
    assert.equal(
      memory.db.prepare('SELECT basis FROM decisions WHERE id = ?').get('d1').basis,
      'Survives the v3 migration intact.',
    );
    assert.equal(memory.db.prepare('SELECT summary FROM observations').get().summary, 'kept observation');
    assert.ok(columns(memory, 'module_dependencies').length > 0);
  });

  test('GR-SCH-04 concurrent openers migrate exactly once', async () => {
    repo.write('specs/.omni/.keep', '');
    const legacy = new DatabaseSync(dbPath());
    legacy.exec(V2_SCHEMA);
    legacy.close();
    const script = `import(${JSON.stringify(MEMORY_MODULE)}).then(m => m.openMemory(process.argv[1]).close())`;
    const run = () =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', script, dbPath()], { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', chunk => (stderr += chunk));
        child.on('exit', code => (code === 0 ? resolve() : reject(new Error(stderr))));
      });
    await Promise.all([run(), run(), run()]);
    const memory = open();
    assert.equal(memory.db.prepare('PRAGMA user_version').get().user_version, 3);
    assert.equal(memory.db.prepare('SELECT count(*) AS n FROM decisions').get().n, 1);
  });

  test('GR-SCH-05 newer schema versions are refused', () => {
    repo.write('specs/.omni/.keep', '');
    const future = new DatabaseSync(dbPath());
    future.exec('PRAGMA user_version = 4');
    future.close();
    assert.throws(() => openMemory(dbPath()), /Unsupported memory schema version 4/);
  });

  test('GR-SCH-06 deleting a module cascades to its outgoing edges', () => {
    const memory = open();
    seed(memory, [
      ['a.ts', 'b.ts'],
      ['b.ts', 'c.ts'],
    ]);
    memory.write(() => memory.db.prepare('DELETE FROM modules_graph WHERE module_path = ?').run('a.ts'));
    assert.deepEqual(
      edges(memory).map(edge => [edge.source, edge.target]),
      [['b.ts', 'c.ts']],
    );
  });
});

describe('GR-IDX streaming indexer', () => {
  const tsRepo = {
    'tsconfig.json': { compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } },
    'src/main.ts':
      "import { run } from './app.js';\nimport type { Cfg } from '@/types';\nimport React from 'react';\nimport { gone } from './missing';\nrun();",
    'src/app.ts': "import { slug } from './utils/index';\nexport function run() { return slug('x'); }",
    'src/types.ts': 'export interface Cfg { a: string }',
    'src/utils/index.ts': "export { slug } from './slug';",
    'src/utils/slug.ts': 'export const slug = (s: string) => s.toLowerCase();',
    'src/lazy.ts': 'export async function load(name: string) { return import(name); }',
  };

  test('GR-IDX-01 nodes, edges and edge types', () => {
    repo.tree(tsRepo);
    const memory = open();
    const report = indexRepository(repo.root, memory);
    assert.equal(report.files, 6);
    assert.deepEqual(paths(memory), [
      'src/app.ts',
      'src/lazy.ts',
      'src/main.ts',
      'src/types.ts',
      'src/utils/index.ts',
      'src/utils/slug.ts',
    ]);
    const internal = edges(memory).filter(edge => edge.kind === 'internal');
    assert.deepEqual(
      internal.map(edge => [edge.source, edge.target, edge.type, edge.symbols]),
      [
        ['src/app.ts', 'src/utils/index.ts', 'value', ['slug']],
        ['src/main.ts', 'src/app.ts', 'value', ['run']],
        ['src/main.ts', 'src/types.ts', 'type_only', ['Cfg']],
        ['src/utils/index.ts', 'src/utils/slug.ts', 'value', ['slug']],
      ],
    );
    assert.equal(node(memory, 'src/lazy.ts').has_opaque_deps, 1);
    assert.equal(node(memory, 'src/main.ts').language, 'typescript');
  });

  test('GR-IDX-02 external and unresolved specifiers are edges without nodes', () => {
    repo.tree(tsRepo);
    const memory = open();
    indexRepository(repo.root, memory);
    const outside = edges(memory).filter(edge => edge.kind !== 'internal');
    assert.deepEqual(
      outside.map(edge => [edge.target, edge.kind]),
      [
        ['react', 'external'],
        ['./missing', 'unresolved'],
      ].sort(),
    );
    assert.equal(node(memory, 'react'), undefined);
  });

  test('GR-IDX-03 ignore rules exclude dependencies, outputs and the memory itself', () => {
    repo.tree({
      'src/a.ts': 'export const a = 1;',
      'node_modules/x/index.js': 'module.exports = 1;',
      'dist/a.js': 'exports.a = 1;',
      'generated/skip.ts': 'export const s = 1;',
      '.gitignore': 'generated/\n',
      'specs/.omni/runtime/x.mjs': 'export {};',
    });
    const memory = open();
    indexRepository(repo.root, memory);
    assert.deepEqual(paths(memory), ['src/a.ts']);
  });

  test('GR-IDX-04 directory link loops are not followed', () => {
    repo.write('src/a.ts', 'export const a = 1;');
    try {
      symlinkSync(
        join(repo.root, 'src'),
        join(repo.root, 'src', 'loop'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if (error.code === 'EPERM') return;
      throw error;
    }
    const memory = open();
    const report = indexRepository(repo.root, memory);
    assert.deepEqual(paths(memory), ['src/a.ts']);
    assert.equal(report.files, 1);
  });

  test('GR-IDX-05 oversized and binary files are skipped with a reason', () => {
    repo.tree({ 'src/a.ts': 'export const a = 1;', 'src/huge.js': `// ${'x'.repeat(2048)}`, 'src/bin.js': 'a\u0000b' });
    const memory = open();
    const report = indexRepository(repo.root, memory, { maxFileBytes: 1024 });
    assert.deepEqual(paths(memory), ['src/a.ts']);
    assert.deepEqual(report.skipped, [
      { path: 'src/bin.js', reason: 'binary' },
      { path: 'src/huge.js', reason: 'too-large' },
    ]);
  });

  test('GR-IDX-06 batches commit through BEGIN IMMEDIATE only', () => {
    for (let index = 0; index < 1000; index++) repo.write(`src/m${index}.ts`, `export const v${index} = ${index};`);
    const memory = open();
    let writes = 0;
    const write = memory.write.bind(memory);
    memory.write = action => {
      writes++;
      return write(action);
    };
    const begins = [];
    const exec = memory.db.exec.bind(memory.db);
    memory.db.exec = sql => {
      if (/^\s*BEGIN/i.test(sql)) begins.push(sql.trim());
      return exec(sql);
    };
    const report = indexRepository(repo.root, memory, { batchSize: 250 });
    assert.equal(report.batches, 4);
    assert.ok(writes >= 4);
    assert.ok(begins.length > 0 && begins.every(sql => sql === 'BEGIN IMMEDIATE'), begins.join('|'));
    assert.equal(paths(memory).length, 1000);
  });

  test('GR-IDX-07 an unreadable file is skipped and its batch still commits', () => {
    repo.tree({ 'src/a.ts': 'export const a = 1;', 'src/b.ts': "import { a } from './a';", 'src/locked.ts': 'x' });
    const memory = open();
    const readFile = path => {
      if (path.endsWith('locked.ts')) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      return readFileSync(path);
    };
    const report = indexRepository(repo.root, memory, { readFile });
    assert.deepEqual(paths(memory), ['src/a.ts', 'src/b.ts']);
    assert.deepEqual(report.skipped, [{ path: 'src/locked.ts', reason: 'unreadable' }]);
  });

  test('GR-IDX-08 stored paths are POSIX relative', () => {
    repo.write('src/deep/inner/a.ts', "import './b';");
    repo.write('src/deep/inner/b.ts', '');
    const memory = open();
    indexRepository(repo.root, memory);
    assert.deepEqual(paths(memory), ['src/deep/inner/a.ts', 'src/deep/inner/b.ts']);
    assert.equal(edges(memory)[0].target, 'src/deep/inner/b.ts');
  });

  test('GR-IDX-09 topological classification thresholds', () => {
    repo.write('src/core.ts', 'export const c = 1;');
    repo.write('src/almost.ts', 'export const a = 1;');
    repo.write('src/hub.ts', "import './d1';\nimport './d2';\nimport './d3';\nimport './d4';\nexport const h = 1;");
    for (const name of ['d1', 'd2', 'd3', 'd4']) repo.write(`src/${name}.ts`, '');
    for (let index = 0; index < 20; index++)
      repo.write(
        `src/c${index}.ts`,
        `import { c } from './core';\nimport { h } from './hub';\n${index < 19 ? "import { a } from './almost';" : ''}`,
      );
    repo.write('src/leaf.ts', "import { c } from './c0';");
    const memory = open();
    indexRepository(repo.root, memory);
    assert.equal(node(memory, 'src/core.ts').node_type, 'core');
    assert.equal(node(memory, 'src/almost.ts').node_type, 'domain');
    assert.equal(node(memory, 'src/hub.ts').node_type, 'domain');
    assert.equal(node(memory, 'src/c0.ts').node_type, 'leaf');
    assert.equal(node(memory, 'src/leaf.ts').node_type, 'leaf');
  });

  test('GR-IDX-10 polyglot repositories', () => {
    repo.tree({
      'go.mod': 'module example.com/svc\n',
      'app/main.py': 'from . import helpers\nimport requests',
      'app/helpers.py': 'def h(): pass',
      'app/__init__.py': '',
      'cmd/main.go': 'package main\nimport "example.com/svc/pkg/auth"\n',
      'pkg/auth/auth.go': 'package auth\n',
      'web/a.ts': "import { b } from './b';",
      'web/b.ts': 'export const b = 1;',
    });
    const memory = open();
    indexRepository(repo.root, memory);
    assert.equal(node(memory, 'app/main.py').language, 'python');
    assert.equal(node(memory, 'cmd/main.go').language, 'go');
    const internal = edges(memory)
      .filter(edge => edge.kind === 'internal')
      .map(edge => [edge.source, edge.target]);
    assert.deepEqual(internal, [
      ['app/main.py', 'app/helpers.py'],
      ['cmd/main.go', 'pkg/auth/auth.go'],
      ['web/a.ts', 'web/b.ts'],
    ]);
  });

  test('GR-IDX-11 a reader sees each committed batch without SQLITE_BUSY', () => {
    for (let index = 0; index < 60; index++) repo.write(`src/m${index}.ts`, `export const v = ${index};`);
    const memory = open();
    const reader = new DatabaseSync(dbPath(), { readOnly: true });
    const seen = [];
    try {
      indexRepository(repo.root, memory, {
        batchSize: 20,
        onBatch: () => seen.push(reader.prepare('SELECT count(*) AS n FROM modules_graph').get().n),
      });
    } finally {
      reader.close();
    }
    assert.deepEqual(seen, [20, 40, 60]);
  });
});

describe('GR-INC incremental cache', () => {
  const counting = () => {
    const reads = [];
    return {
      reads,
      readFile: path => {
        reads.push(path);
        return readFileSync(path);
      },
    };
  };

  test('GR-INC-01 an unchanged repository is not read again', () => {
    repo.tree({ 'src/a.ts': "import { b } from './b';", 'src/b.ts': 'export const b = 1;' });
    const memory = open();
    indexRepository(repo.root, memory);
    const spy = counting();
    const report = indexRepository(repo.root, memory, { readFile: spy.readFile });
    assert.deepEqual(spy.reads, []);
    assert.equal(report.parsed, 0);
    assert.equal(report.unchanged, 2);
    assert.equal(report.incremental, true);
  });

  test('GR-INC-02 a touched file with identical content is hashed, not parsed', () => {
    repo.tree({ 'src/a.ts': 'export const a = 1;' });
    const memory = open();
    indexRepository(repo.root, memory);
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(repo.root, 'src', 'a.ts'), future, future);
    const report = indexRepository(repo.root, memory);
    assert.equal(report.parsed, 0);
    assert.equal(report.rehashed, 1);
  });

  test('GR-INC-03 a changed file is the only one parsed and its edges are replaced', () => {
    repo.tree({
      'src/a.ts': "import { b } from './b';",
      'src/b.ts': 'export const b = 1;',
      'src/c.ts': 'export const c = 1;',
    });
    const memory = open();
    indexRepository(repo.root, memory);
    repo.write('src/a.ts', "import { c } from './c';\n// changed");
    const spy = counting();
    const report = indexRepository(repo.root, memory, { readFile: spy.readFile });
    assert.equal(report.parsed, 1);
    assert.deepEqual(
      spy.reads.map(path => path.replaceAll('\\', '/').split('/').pop()),
      ['a.ts'],
    );
    assert.deepEqual(
      edges(memory).map(edge => [edge.source, edge.target]),
      [['src/a.ts', 'src/c.ts']],
    );
  });

  test('GR-INC-04 a deleted file disappears and its importers become unresolved', () => {
    repo.tree({ 'src/a.ts': "import { b } from './b';", 'src/b.ts': "import './c';", 'src/c.ts': '' });
    const memory = open();
    indexRepository(repo.root, memory);
    repo.remove('src/b.ts');
    const report = indexRepository(repo.root, memory);
    assert.equal(report.removed, 1);
    assert.deepEqual(paths(memory), ['src/a.ts', 'src/c.ts']);
    assert.deepEqual(
      edges(memory).map(edge => [edge.source, edge.target, edge.kind]),
      [['src/a.ts', './b', 'unresolved']],
    );
  });

  test('GR-INC-05 a new file satisfies a previously unresolved import', () => {
    repo.tree({ 'src/a.ts': "import { b } from './b';" });
    const memory = open();
    indexRepository(repo.root, memory);
    assert.equal(edges(memory)[0].kind, 'unresolved');
    repo.write('src/b.ts', 'export const b = 1;');
    indexRepository(repo.root, memory);
    assert.deepEqual(
      edges(memory).map(edge => [edge.target, edge.kind]),
      [['src/b.ts', 'internal']],
    );
  });

  test('GR-INC-06 a configuration change re-resolves without re-reading sources', () => {
    repo.tree({
      'tsconfig.json': { compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/one/*'] } } },
      'src/main.ts': "import { x } from '@/x';",
      'src/one/x.ts': 'export const x = 1;',
      'src/two/x.ts': 'export const x = 2;',
    });
    const memory = open();
    indexRepository(repo.root, memory);
    repo.write('tsconfig.json', { compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/two/*'] } } });
    const spy = counting();
    const report = indexRepository(repo.root, memory, { readFile: spy.readFile });
    assert.equal(report.parsed, 0);
    assert.deepEqual(spy.reads, []);
    assert.equal(edges(memory).find(edge => edge.source === 'src/main.ts').target, 'src/two/x.ts');
  });
});

describe('GR-CTE recursive reverse dependencies', () => {
  test('GR-CTE-01 transitive consumers ordered by distance', () => {
    const memory = open();
    seed(memory, [
      ['B', 'A'],
      ['C', 'B'],
      ['D', 'C'],
    ]);
    assert.deepEqual(consumers(reverseDependencies(memory, 'A', { maxDepth: 5 })), [
      ['B', 1],
      ['C', 2],
      ['D', 3],
    ]);
  });

  test('GR-CTE-02 maxDepth bounds the walk', () => {
    const memory = open();
    seed(memory, [
      ['B', 'A'],
      ['C', 'B'],
      ['D', 'C'],
    ]);
    assert.deepEqual(consumers(reverseDependencies(memory, 'A', { maxDepth: 2 })), [
      ['B', 1],
      ['C', 2],
    ]);
  });

  test('GR-CTE-03 a two-node cycle terminates and the target is not its own consumer', () => {
    const memory = open();
    seed(memory, [
      ['A', 'B'],
      ['B', 'A'],
    ]);
    assert.deepEqual(consumers(reverseDependencies(memory, 'A', { maxDepth: 10 })), [['B', 1]]);
  });

  test('GR-CTE-04 self-loops and triangles terminate with minimum distances', () => {
    const memory = open();
    seed(memory, [
      ['A', 'A'],
      ['B', 'A'],
      ['C', 'B'],
      ['A', 'C'],
    ]);
    assert.deepEqual(consumers(reverseDependencies(memory, 'A', { maxDepth: 10 })), [
      ['B', 1],
      ['C', 2],
    ]);
  });

  test('GR-CTE-05 LIKE wildcards in paths do not hide consumers', () => {
    const memory = open();
    seed(memory, [
      ['src/a_b.py', 'src/t.py'],
      ['src/axb.py', 'src/a_b.py'],
      ['src/axb.py', 'src/t.py'],
      ['src/z.py', 'src/axb.py'],
    ]);
    assert.deepEqual(consumers(reverseDependencies(memory, 'src/t.py', { maxDepth: 5 })), [
      ['src/a_b.py', 1],
      ['src/axb.py', 1],
      ['src/z.py', 2],
    ]);
  });

  test('GR-CTE-06 percent signs, commas and spaces in paths', () => {
    const memory = open();
    seed(memory, [
      ['src/100% done.ts', 'src/t.ts'],
      ['src/a,b.ts', 'src/100% done.ts'],
      ['src/b.ts', 'src/a,b.ts'],
      ['src/100 done.ts', 'src/b.ts'],
    ]);
    assert.deepEqual(consumers(reverseDependencies(memory, 'src/t.ts', { maxDepth: 6 })), [
      ['src/100% done.ts', 1],
      ['src/a,b.ts', 2],
      ['src/b.ts', 3],
      ['src/100 done.ts', 4],
    ]);
  });

  test('GR-CTE-07 a type-only edge weakens every later hop', () => {
    const memory = open();
    seed(memory, [
      ['A', 'F', 'type_only'],
      ['B', 'A', 'value'],
    ]);
    const result = reverseDependencies(memory, 'F', { maxDepth: 3 });
    assert.deepEqual(
      result.consumers.map(item => [item.path, item.edgeClass]),
      [
        ['A', 'type_only'],
        ['B', 'type_only'],
      ],
    );
  });

  test('GR-CTE-08 any runtime path makes the consumer a value consumer', () => {
    const memory = open();
    seed(memory, [
      ['A', 'F', 'type_only'],
      ['C', 'F', 'value'],
      ['B', 'A', 'value'],
      ['B', 'C', 'value'],
    ]);
    const result = reverseDependencies(memory, 'F', { maxDepth: 3 });
    assert.deepEqual(
      result.consumers.map(item => [item.path, item.distance, item.edgeClass]),
      [
        ['A', 1, 'type_only'],
        ['C', 1, 'value'],
        ['B', 2, 'value'],
      ],
    );
  });

  test('GR-CTE-09 [perf] a dense graph is bounded by the row budget', () => {
    const memory = open();
    const layers = Array.from({ length: 6 }, (_, layer) =>
      Array.from({ length: 20 }, (_, index) => `L${layer + 1}/n${index}.ts`),
    );
    const list = layers[0].map(path => [path, 'T.ts']);
    for (let layer = 1; layer < layers.length; layer++)
      for (const source of layers[layer]) for (const target of layers[layer - 1]) list.push([source, target]);
    seed(memory, list);
    const start = performance.now();
    const result = reverseDependencies(memory, 'T.ts', { maxDepth: 6 });
    const elapsed = performance.now() - start;
    assert.equal(result.truncated, true);
    // The default budget (D-1: 200,000 rows) costs about 15 µs per row in SQLite on the reference
    // Windows machine, so the worst case is about 3 s; the floor leaves room for a loaded CI host.
    assert.ok(elapsed < 5000, `${elapsed.toFixed(0)} ms`);
    for (const path of [...layers[0], ...layers[1], ...layers[2]])
      assert.ok(
        result.consumers.some(item => item.path === path),
        path,
      );
    const small = reverseDependencies(memory, 'T.ts', { maxDepth: 6, rowBudget: 100 });
    assert.equal(small.truncated, true);
  });

  test('GR-CTE-10 [perf] a 10,000-node chain at depth 10', () => {
    const memory = open();
    const list = [];
    for (let index = 1; index < 10_000; index++) list.push([`m${index}.ts`, `m${index - 1}.ts`]);
    seed(memory, list);
    reverseDependencies(memory, 'm0.ts', { maxDepth: 10 });
    const start = performance.now();
    const result = reverseDependencies(memory, 'm0.ts', { maxDepth: 10 });
    const elapsed = performance.now() - start;
    assert.equal(result.consumers.length, 10);
    assert.equal(result.truncated, false);
    assert.ok(elapsed < 50, `${elapsed.toFixed(1)} ms`);
  });

  test('GR-CTE-11 ties are ordered by path', () => {
    const memory = open();
    seed(memory, [
      ['z.ts', 'T'],
      ['a.ts', 'T'],
      ['m.ts', 'T'],
    ]);
    assert.deepEqual(
      reverseDependencies(memory, 'T').consumers.map(item => item.path),
      ['a.ts', 'm.ts', 'z.ts'],
    );
  });
});

describe('GR-BRL barrel unwinding', () => {
  const routes = (memory, barrel) =>
    barrelRoutes(memory, barrel).map(route => [route.exported, route.source, route.sourceSymbol, route.ambiguous]);
  const indexTree = files => {
    repo.tree(files);
    const memory = open();
    indexRepository(repo.root, memory);
    return memory;
  };

  test('GR-BRL-01 named re-exports route each symbol', () => {
    const memory = indexTree({
      'src/utils/index.ts': "export { slugify } from './slug';\nexport { calculateTax } from './tax';",
      'src/utils/slug.ts': 'export const slugify = 1;',
      'src/utils/tax.ts': 'export const calculateTax = 1;',
    });
    assert.deepEqual(routes(memory, 'src/utils/index.ts'), [
      ['calculateTax', 'src/utils/tax.ts', 'calculateTax', false],
      ['slugify', 'src/utils/slug.ts', 'slugify', false],
    ]);
  });

  test('GR-BRL-02 aliases keep the original symbol', () => {
    const memory = indexTree({ 'src/i.ts': "export { a as b } from './x';", 'src/x.ts': 'export const a = 1;' });
    assert.deepEqual(routes(memory, 'src/i.ts'), [['b', 'src/x.ts', 'a', false]]);
  });

  test('GR-BRL-03 star re-exports expand with the indexed exports', () => {
    const memory = indexTree({
      'src/i.ts': "export * from './x';",
      'src/x.ts': 'export const a = 1;\nexport function b() {}\nexport default 3;',
    });
    assert.deepEqual(routes(memory, 'src/i.ts'), [
      ['a', 'src/x.ts', 'a', false],
      ['b', 'src/x.ts', 'b', false],
    ]);
  });

  test('GR-BRL-04 namespace re-exports route a single name', () => {
    const memory = indexTree({ 'src/i.ts': "export * as ns from './x';", 'src/x.ts': 'export const a = 1;' });
    assert.deepEqual(routes(memory, 'src/i.ts'), [['ns', 'src/x.ts', '*', false]]);
  });

  test('GR-BRL-05 chained barrels reach the real origin', () => {
    const memory = indexTree({
      'src/index.ts': "export * from './sub/index';",
      'src/sub/index.ts': "export { leaf as renamed } from './leaf';",
      'src/sub/leaf.ts': 'export const leaf = 1;',
    });
    assert.deepEqual(routes(memory, 'src/index.ts'), [['renamed', 'src/sub/leaf.ts', 'leaf', false]]);
  });

  test('GR-BRL-06 cyclic star barrels terminate without duplicates', () => {
    const memory = indexTree({
      'src/a.ts': "export * from './b';\nexport const fromA = 1;",
      'src/b.ts': "export * from './a';\nexport const fromB = 1;",
    });
    assert.deepEqual(routes(memory, 'src/a.ts'), [['fromB', 'src/b.ts', 'fromB', false]]);
    assert.deepEqual(routes(memory, 'src/b.ts'), [['fromA', 'src/a.ts', 'fromA', false]]);
  });

  test('GR-BRL-07 a local export shadows a star export', () => {
    const memory = indexTree({
      'src/i.ts': "export * from './x';\nexport const a = 'local';",
      'src/x.ts': 'export const a = 1;\nexport const b = 2;',
    });
    assert.deepEqual(routes(memory, 'src/i.ts'), [['b', 'src/x.ts', 'b', false]]);
  });

  test('GR-BRL-08 conflicting star exports are ambiguous and route to both', () => {
    const memory = indexTree({
      'src/i.ts': "export * from './x';\nexport * from './y';",
      'src/x.ts': 'export const dup = 1;',
      'src/y.ts': 'export const dup = 2;',
    });
    assert.deepEqual(routes(memory, 'src/i.ts'), [
      ['dup', 'src/x.ts', 'dup', true],
      ['dup', 'src/y.ts', 'dup', true],
    ]);
  });

  test('GR-BRL-09 import then export routes to the import origin', () => {
    const memory = indexTree({
      'src/i.ts': "import { a as local } from './x';\nexport { local as a };",
      'src/x.ts': 'export const a = 1;',
    });
    assert.deepEqual(routes(memory, 'src/i.ts'), [['a', 'src/x.ts', 'a', false]]);
    assert.equal(barrelRoutes(memory, 'src/i.ts')[0].isReexport, true);
  });

  test('GR-BRL-10 default re-exports', () => {
    const memory = indexTree({
      'src/i.ts': "export { default } from './Btn';\nexport { default as Btn } from './Btn';",
      'src/Btn.tsx': 'export default function Btn() {}',
    });
    assert.deepEqual(routes(memory, 'src/i.ts'), [
      ['Btn', 'src/Btn.tsx', 'default', false],
      ['default', 'src/Btn.tsx', 'default', false],
    ]);
  });

  test('GR-BRL-11 changing a barrel recomputes its routes and leaves the others identical', () => {
    const memory = indexTree({
      'src/one.ts': "export { a } from './x';",
      'src/two.ts': "export { b } from './x';",
      'src/x.ts': 'export const a = 1;\nexport const b = 2;\nexport const c = 3;',
    });
    const before = routes(memory, 'src/two.ts');
    repo.write('src/one.ts', "export { c } from './x';");
    indexRepository(repo.root, memory);
    assert.deepEqual(routes(memory, 'src/one.ts'), [['c', 'src/x.ts', 'c', false]]);
    assert.deepEqual(routes(memory, 'src/two.ts'), before);
  });
});

describe('GR-PERF scale and memory', () => {
  let big;
  let measured;

  before(async () => {
    big = makeRepo('omni-graph-perf-');
    big.fixture = writeSyntheticMonorepo(big.root, { files: 4000, loc: 129 });
    const { stdout } = await execFileAsync(process.execPath, [PERF_WORKER, big.root], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    });
    measured = JSON.parse(stdout);
  });
  after(() => big?.cleanup());

  test('GR-PERF-01 a 500k LOC, 4,000-file monorepo indexes completely', () => {
    assert.ok(big.fixture.loc >= 500_000, `${big.fixture.loc} LOC`);
    assert.equal(measured.files, big.fixture.files);
    assert.equal(measured.nodes, big.fixture.files);
    assert.deepEqual(measured.skipped, []);
    assert.ok(measured.edges > big.fixture.files * 3);
  });

  test('GR-PERF-02 [perf] cold indexing floor', () => {
    assert.ok(measured.coldMs < 5000, `${measured.coldMs.toFixed(0)} ms`);
  });

  test('GR-PERF-03 [perf] RSS growth floor', () => {
    const growth = measured.coldMaxRss - measured.baselineRss;
    assert.ok(
      growth < 40 * 1024 * 1024,
      `${(growth / 1048576).toFixed(1)} MB over a ${(measured.baselineRss / 1048576).toFixed(1)} MB baseline`,
    );
  });

  test('GR-PERF-04 [perf] an unchanged second pass is much cheaper', () => {
    assert.equal(measured.warmParsed, 0);
    assert.ok(
      measured.warmMs < measured.coldMs * 0.25,
      `cold ${measured.coldMs.toFixed(0)} ms, warm ${measured.warmMs.toFixed(0)} ms`,
    );
  });

  test('GR-PERF-05 the cartography pipeline never uses worker_threads', () => {
    for (const name of readdirSync(CARTOGRAPHY_SRC)) {
      const text = readFileSync(join(CARTOGRAPHY_SRC, name), 'utf8');
      assert.ok(!/worker_threads/.test(text), name);
    }
  });
});
