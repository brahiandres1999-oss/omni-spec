import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { changedTestFiles, inspectTestSource } from '../src/hollow-guard.mjs';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { verifySpec, completeSpec } from '../src/verification.mjs';
import { fillSpec } from '../test-support/fixtures.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const header = "import assert from 'node:assert/strict';\nimport { sum } from '../src/sum.mjs';\n";
const codes = (source, file = 'test/a.test.mjs') => inspectTestSource(file, source).findings.map(item => item.code);

describe('Hollow assertion guard (C-06 / T-03)', () => {
  test('HA-01 a file whose only assertion is expect(true).toBe(true) is hollow', () => {
    const found = codes(`import { sum } from '../src/sum.mjs';\ntest('x', () => { expect(true).toBe(true); });\n`);
    assert.ok(found.includes('HOLLOW_TEST_DETECTED'));
    assert.ok(found.includes('TAUTOLOGICAL_ASSERTION'));
  });

  test('HA-02 constant assertions are tautologies', () => {
    for (const line of ['assert.ok(true);', 'assert(true);', 'assert.equal(1, 1);', "assert.strictEqual('a', 'a');"])
      assert.ok(codes(`${header}${line}\nassert.equal(sum(1, 2), 3);\n`).includes('TAUTOLOGICAL_ASSERTION'), line);
  });

  test('HA-03 the same expression on both sides is a tautology', () => {
    for (const line of [
      'expect(value).toBe(value);',
      'assert.equal(sum(1, 2), sum(1, 2));',
      'assert.deepEqual(x.y, x.y);',
    ])
      assert.ok(codes(`${header}${line}\nassert.equal(sum(1, 2), 3);\n`).includes('TAUTOLOGICAL_ASSERTION'), line);
  });

  test('HA-04 a test file without assertions is hollow', () => {
    assert.deepEqual(codes(`${header}test('x', () => { sum(1, 2); });\n`), ['HOLLOW_TEST_DETECTED']);
  });

  test('HA-05 real assertions against project code pass', () => {
    assert.deepEqual(codes(`${header}assert.equal(sum(2, 2), 4);\nexpect(sum(1, 2)).toBe(3);\n`), []);
  });

  test('HA-06 every common assertion form is recognized', () => {
    const report = inspectTestSource(
      'test/a.test.mjs',
      `${header}assert.deepStrictEqual(sum(1, 1), 2);
assert.throws(() => sum());
await assert.rejects(sum.async());
assert.match(String(sum(1, 1)), /2/);
t.assert.equal(sum(0, 0), 0);
expect(sum(1, 1)).toEqual(2);
expect(() => sum()).toThrow();
expect(sum(1, 1)).not.toBe(3);
`,
    );
    assert.equal(report.assertions, 8);
    assert.deepEqual(report.findings, []);
  });

  test('HA-07 tautologies inside comments or strings are ignored', () => {
    assert.deepEqual(
      codes(`${header}// expect(true).toBe(true)\nconst s = 'assert.ok(true)';\nassert.equal(sum(1, 1), 2);\n`),
      [],
    );
  });

  test('HA-08 an assertion written inside a string does not count', () => {
    assert.deepEqual(codes(`${header}const fake = "assert.equal(sum(1, 1), 2)";\n`), ['HOLLOW_TEST_DETECTED']);
  });

  test('HA-09 a test that references no project code is contract fraud', () => {
    const found = codes("import assert from 'node:assert/strict';\nassert.equal(Math.max(1, 2), 2);\n");
    assert.deepEqual(found, ['CONTRACT_FRAUD_DETECTED']);
  });

  test('HA-10 imports, requires and relative paths to project code all count', () => {
    for (const reference of [
      "import { sum } from '../src/sum.mjs';",
      "const { sum } = require('./sum.cjs');",
      "const { sum } = await import('../lib/sum.js');",
      "const cli = new URL('../bin/cli.mjs', import.meta.url);",
    ])
      assert.deepEqual(codes(`${reference}\nassert.equal(sum(1, 1), 2);\n`), [], reference);
  });

  test('HA-11 a real assertion does not excuse a tautology; the line is reported', () => {
    const report = inspectTestSource('test/a.test.mjs', `${header}assert.equal(sum(1, 1), 2);\nassert.ok(true);\n`);
    assert.deepEqual(
      report.findings.map(item => [item.file, item.line, item.code]),
      [['test/a.test.mjs', 4, 'TAUTOLOGICAL_ASSERTION']],
    );
  });

  test('HA-12 only changed test files are judged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omni-hollow-'));
    try {
      const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
      git(['init', '-q']);
      git(['config', 'user.email', 'hollow@example.invalid']);
      git(['config', 'user.name', 'Hollow']);
      git(['config', 'commit.gpgsign', 'false']);
      await mkdir(join(root, 'test'));
      await writeFile(join(root, 'test', 'legacy.test.mjs'), 'assert.ok(true);\n');
      await writeFile(join(root, 'test', 'touched.test.mjs'), header);
      git(['add', '.']);
      git(['commit', '-q', '-m', 'base', '--no-verify']);
      await writeFile(join(root, 'test', 'touched.test.mjs'), `${header}assert.equal(sum(1, 1), 2);\n`);
      await writeFile(join(root, 'test', 'new.spec.ts'), header);
      await writeFile(join(root, 'notes.md'), 'x');
      assert.deepEqual((await changedTestFiles(root)).sort(), ['test/new.spec.ts', 'test/touched.test.mjs']);
      assert.deepEqual(await changedTestFiles(join(tmpdir())), []);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test('HA-13 dogfooding: the repository tests have no findings', async () => {
    const found = [];
    for (const name of await readdir(join(repoRoot, 'test'))) {
      if (!name.endsWith('.test.mjs')) continue;
      const file = `test/${name}`;
      for (const item of inspectTestSource(file, await readFile(join(repoRoot, file), 'utf8')).findings)
        found.push(`${item.file}:${item.line} ${item.code}`);
    }
    assert.deepEqual(found, []);
  });

  test('HA-14 verify fails when a changed test is hollow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omni-hollow-verify-'));
    try {
      await scaffoldProject(root, { qualityGates: '' });
      const spec = await createSpec(root, 'feature', 'hollow', { full: true });
      await fillSpec(root, spec);
      const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
      git(['init', '-q']);
      git(['config', 'user.email', 'hollow@example.invalid']);
      git(['config', 'user.name', 'Hollow']);
      git(['config', 'commit.gpgsign', 'false']);
      git(['add', '.']);
      git(['commit', '-q', '-m', 'base', '--no-verify']);
      await mkdir(join(root, 'test'));
      await writeFile(
        join(root, 'test', 'greet.test.mjs'),
        "import { greet } from '../greet.mjs';\nexpect(true).toBe(true);\n",
      );
      await writeFile(
        join(root, 'specs', 'checks.json'),
        JSON.stringify({ schemaVersion: 1, checks: [{ id: 'unit', command: 'node -e "process.exit(0)"' }] }),
      );
      const record = await verifySpec(root, spec.id);
      assert.equal(record.passed, false);
      assert.deepEqual(
        record.hollowTests.map(item => [item.file, item.code]),
        [
          ['test/greet.test.mjs', 'HOLLOW_TEST_DETECTED'],
          ['test/greet.test.mjs', 'TAUTOLOGICAL_ASSERTION'],
        ],
      );
      await assert.rejects(completeSpec(root, spec.id), /HOLLOW_TEST_DETECTED: test\/greet\.test\.mjs/);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
