import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { runCli } from '../src/cli.mjs';
import { makeRepo } from '../test-support/cartography-fixtures.mjs';

let repo;
let output;
let restore;

beforeEach(() => {
  repo = makeRepo('omni-carto-cli-');
  output = { log: [], error: [] };
  const { log, error } = console;
  console.log = (...args) => output.log.push(args.join(' '));
  console.error = (...args) => output.error.push(args.join(' '));
  restore = () => Object.assign(console, { log, error });
});
afterEach(() => {
  restore();
  repo.cleanup();
});

const PROJECT = {
  'specs/manifest.json': { specs: [] },
  'package.json': { name: 'demo' },
  'src/utils.ts': 'export const slugify = s => s;\nexport const formatDate = d => d;',
  'src/a.ts': "import { slugify } from './utils';\nexport const a = 1;",
  'src/b.ts': "import { formatDate } from './utils';\nimport { c } from './c';",
  'src/c.ts': "import { b } from './b';\nexport const c = 1;",
  'src/main.py': 'import os\n',
};

async function cli(args, cwd = repo.root) {
  output.log.length = 0;
  output.error.length = 0;
  const code = await runCli(args, cwd);
  return { code, stdout: output.log.join('\n'), stderr: output.error.join('\n') };
}
const json = async (args, cwd) => {
  const result = await cli([...args, '--json'], cwd);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
};

describe('omni-spec cartography', () => {
  test('CLI-01 human summary', async () => {
    repo.tree(PROJECT);
    const result = await cli(['cartography']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /5 files/);
    assert.match(result.stdout, /typescript: 4/);
    assert.match(result.stdout, /python: 1/);
    assert.match(result.stdout, /1 cycle/);
  });

  test('CLI-02 JSON report shape', async () => {
    repo.tree(PROJECT);
    const report = await json(['cartography']);
    assert.deepEqual(Object.keys(report), [
      'schemaVersion',
      'files',
      'nodes',
      'edges',
      'languages',
      'nodeTypes',
      'core',
      'cycles',
      'incremental',
      'parsed',
      'unchanged',
      'removed',
      'skipped',
      'warnings',
      'timings',
    ]);
    assert.deepEqual(report.languages, { python: 1, typescript: 4 });
    assert.deepEqual(report.cycles, { count: 1, samples: [['src/b.ts', 'src/c.ts']] });
    assert.equal(typeof report.timings.durationMs, 'number');
  });

  test('CLI-03 outside an OmniSpec project', async () => {
    repo.write('src/a.ts', '');
    const result = await cli(['cartography']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /No OmniSpec project found/);
  });

  test('CLI-12 a second run is incremental', async () => {
    repo.tree(PROJECT);
    await json(['cartography']);
    const second = await json(['cartography']);
    assert.equal(second.incremental, true);
    assert.equal(second.parsed, 0);
  });
});

describe('omni-spec blast-radius', () => {
  test('CLI-04 human table after an automatic incremental index', async () => {
    repo.tree(PROJECT);
    const result = await cli(['blast-radius', 'src/utils.ts', 'src/a.ts']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /src\/utils\.ts\s+(LOW|MEDIUM|HIGH)\s+\d+(\.\d+)?/);
    assert.match(result.stdout, /src\/a\.ts \(1, value\)/);
    assert.match(result.stdout, /src\/b\.ts/);
  });

  test('CLI-05 --json, --depth and explicit symbols', async () => {
    repo.tree(PROJECT);
    const report = await json(['blast-radius', 'src/utils.ts#slugify', '--depth', '5']);
    assert.equal(report.maxDepth, 5);
    assert.deepEqual(report.files[0].symbols, ['slugify']);
    assert.deepEqual(
      report.files[0].impactedConsumers.map(item => item.path),
      ['src/a.ts'],
    );
  });

  test('CLI-06 paths are normalised to POSIX project-relative', async () => {
    repo.tree(PROJECT);
    const fromSub = await json(['blast-radius', './utils.ts'], join(repo.root, 'src'));
    assert.equal(fromSub.files[0].file, 'src/utils.ts');
    const absolute = await json(['blast-radius', resolve(repo.root, 'src', 'a.ts')]);
    assert.equal(absolute.files[0].file, 'src/a.ts');
    const backslashes = await json(['blast-radius', 'src\\a.ts']);
    assert.equal(backslashes.files[0].file, 'src/a.ts');
  });

  test('CLI-07 paths outside the project are refused', async () => {
    repo.tree(PROJECT);
    for (const path of ['../../etc/passwd', resolve(repo.root, '..', 'elsewhere.ts')]) {
      const result = await cli(['blast-radius', path]);
      assert.equal(result.code, 1, path);
      assert.match(result.stderr, /PATH_OUTSIDE_ROOT/, path);
    }
  });

  test('CLI-08 --fail-on sets exit code 2 at the threshold', async () => {
    repo.tree(PROJECT);
    assert.equal((await cli(['blast-radius', 'src/c.ts'])).code, 0);
    assert.equal((await cli(['blast-radius', 'package.json', '--fail-on', 'high'])).code, 2);
    assert.equal((await cli(['blast-radius', 'src/a.ts', '--fail-on', 'high'])).code, 0);
    assert.equal((await cli(['blast-radius', 'src/a.ts', '--fail-on', 'low'])).code, 2);
    const invalid = await cli(['blast-radius', 'src/a.ts', '--fail-on', 'severe']);
    assert.equal(invalid.code, 1);
    assert.match(invalid.stderr, /--fail-on/);
  });

  test('CLI-09 files are required', async () => {
    repo.tree(PROJECT);
    const result = await cli(['blast-radius']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Usage: blast-radius/);
  });

  test('CLI-10 help lists both commands', async () => {
    const result = await cli(['--help']);
    assert.match(result.stdout, /cartography/);
    assert.match(result.stdout, /blast-radius <files/);
  });

  test('CLI-11 --depth must be 1..10', async () => {
    repo.tree(PROJECT);
    for (const depth of ['0', '11', 'x']) {
      const result = await cli(['blast-radius', 'src/a.ts', '--depth', depth]);
      assert.equal(result.code, 1, depth);
      assert.match(result.stderr, /--depth/, depth);
    }
  });
});
