#!/usr/bin/env node
// Phase 3 cartography benchmark (D-5). The test suite enforces conservative floors; this script
// measures the EARS targets of the blueprint and exits 1 when any of them is missed, printing the
// numbers either way. Each measurement runs in a fresh process so test-runner state cannot skew it.
//   npm run bench:cartography [-- --files 4000 --loc 129 --keep]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGETS = Object.freeze({ locPerSecond: 3_000_000, coldIndexMs: 200, maxRssBytes: 60 * 1024 * 1024, cteMs: 1.2 });
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
};
const files = argument('files', 4000);
const loc = argument('loc', 129);
const keep = process.argv.includes('--keep');

const run = script =>
  JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }),
  );

const lexer = run(`
  import { scanModule } from './src/cartography/lexer.mjs';
  import { syntheticTypeScript } from './test-support/cartography-fixtures.mjs';
  const source = syntheticTypeScript(100000, 3);
  for (let warm = 0; warm < 3; warm++) scanModule(source, { language: 'typescript' });
  const runs = [];
  for (let index = 0; index < 7; index++) {
    const start = performance.now();
    scanModule(source, { language: 'typescript' });
    runs.push(performance.now() - start);
  }
  const median = runs.sort((a, b) => a - b)[3];
  console.log(JSON.stringify({ medianMs: median, bytes: source.length, lines: 100000 }));
`);

const directory = mkdtempSync(join(tmpdir(), 'omni-bench-'));
try {
  const fixture = run(`
    import { writeSyntheticMonorepo } from './test-support/cartography-fixtures.mjs';
    console.log(JSON.stringify(writeSyntheticMonorepo(${JSON.stringify(directory)}, { files: ${files}, loc: ${loc} })));
  `);
  const index = JSON.parse(
    execFileSync(process.execPath, [join(ROOT, 'test-support', 'cartography-perf-worker.mjs'), directory], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
  const cte = run(`
    import { openMemory } from './src/memory.mjs';
    import { reverseDependencies } from './src/cartography/graph.mjs';
    import { join } from 'node:path';
    const memory = openMemory(join(${JSON.stringify(directory)}, 'specs', '.omni', 'cte.db'));
    const node = memory.db.prepare("INSERT OR IGNORE INTO modules_graph (module_path, language, last_analyzed_at) VALUES (?, 'typescript', 'now')");
    const edge = memory.db.prepare("INSERT INTO module_dependencies (source_module, target_module, edge_type, target_kind, symbols_json) VALUES (?, ?, 'value', 'internal', '[]')");
    memory.write(() => { for (let index = 1; index < 10000; index++) { node.run('m' + index); node.run('m' + (index - 1)); edge.run('m' + index, 'm' + (index - 1)); } });
    for (let warm = 0; warm < 3; warm++) reverseDependencies(memory, 'm0', { maxDepth: 10 });
    const runs = [];
    for (let index = 0; index < 21; index++) {
      const start = performance.now();
      reverseDependencies(memory, 'm0', { maxDepth: 10 });
      runs.push(performance.now() - start);
    }
    memory.close();
    console.log(JSON.stringify({ medianMs: runs.sort((a, b) => a - b)[10] }));
  `);

  const locPerSecond = lexer.lines / (lexer.medianMs / 1000);
  const rows = [
    [
      'Lexer (100k LOC TS)',
      `${Math.round(locPerSecond).toLocaleString('en')} LOC/s · ${(lexer.bytes / 1048576 / (lexer.medianMs / 1000)).toFixed(0)} MB/s`,
      `>= ${TARGETS.locPerSecond.toLocaleString('en')} LOC/s`,
      locPerSecond >= TARGETS.locPerSecond,
    ],
    [
      `Cold index (${fixture.files} files, ${fixture.loc.toLocaleString('en')} LOC)`,
      `${index.coldMs.toFixed(0)} ms`,
      `< ${TARGETS.coldIndexMs} ms`,
      index.coldMs < TARGETS.coldIndexMs,
    ],
    ['Warm index (no changes)', `${index.warmMs.toFixed(0)} ms`, 'informative', true],
    [
      'Peak RSS of the indexing process',
      `${(index.coldMaxRss / 1048576).toFixed(1)} MB (baseline ${(index.baselineRss / 1048576).toFixed(1)} MB)`,
      `< ${TARGETS.maxRssBytes / 1048576} MB`,
      index.coldMaxRss < TARGETS.maxRssBytes,
    ],
    [
      'CTE depth 10 over 10,000 nodes',
      `${cte.medianMs.toFixed(2)} ms`,
      `< ${TARGETS.cteMs} ms`,
      cte.medianMs < TARGETS.cteMs,
    ],
  ];
  for (const [name, measured, target, ok] of rows)
    console.log(`${ok ? 'PASS' : 'MISS'}  ${name}: ${measured} (target ${target})`);
  console.log(
    `Graph: ${index.nodes} nodes, ${index.edges} edges, ${index.skipped.length} skipped. Node ${process.version} on ${process.platform}.`,
  );
  process.exitCode = rows.every(row => row[3]) ? 0 : 1;
} finally {
  if (keep) console.log(`Fixture kept at ${directory}`);
  else rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
