import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { loadChecks } from '../src/checks.mjs';
import { verifySpec, completeSpec } from '../src/verification.mjs';
import { fillSpec } from '../test-support/fixtures.mjs';

let root, spec;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omni-checks-'));
  await scaffoldProject(root, { qualityGates: '' });
  spec = await createSpec(root, 'feature', 'catalogue');
  await fillSpec(root, spec);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
async function catalogue(checks) {
  await writeFile(join(root, 'specs/checks.json'), JSON.stringify({ schemaVersion: 1, checks }));
}

test('catalogue executes a submodule cwd and keeps full output separately from its tail', async () => {
  await mkdir(join(root, 'module'));
  await writeFile(
    join(root, 'module/check.cjs'),
    "if (!process.cwd().endsWith('module')) process.exit(2); console.log('x'.repeat(30000));",
  );
  await catalogue([{ id: 'module-test', command: 'node check.cjs', cwd: 'module', kind: 'automated' }]);
  const record = await verifySpec(root, spec.id);
  assert.equal(record.passed, true);
  const result = record.results[0];
  assert.equal(result.checkId, 'module-test');
  assert.equal(result.cwd, join(root, 'module'));
  assert.equal(result.errorType, null);
  assert.equal(result.outputTruncated, true);
  assert.equal(result.outputLimitExceeded, false);
  assert.equal((await readFile(join(root, result.outputLog))).length, 30001);
  assert.ok(result.output.length <= 16000);
  assert.equal((await completeSpec(root, spec.id)).status, 'COMPLETED');
});

test('legacy gate IDs remain stable and only identical catalogue checks deduplicate', async () => {
  const command = 'node -e "process.exit(0)"';
  await catalogue([{ id: 'named-test', command, cwd: './' }]);
  assert.deepEqual(
    (await loadChecks(root, { qualityGates: command + '\nnode another.cjs' })).map(check => check.id),
    ['named-test', 'gate-2'],
  );
  await catalogue([{ id: 'named-test', command, timeoutMs: 1000 }]);
  assert.equal((await loadChecks(root, { qualityGates: command })).length, 2);
});

test('invalid IDs, commands, timeout, fields and escaping cwd fail before command execution', async () => {
  for (const invalid of [
    { id: 'gate-1', command: 'node check.cjs' },
    { id: 'test', command: '' },
    { id: 'test', command: 'node check.cjs', timeoutMs: 0 },
    { id: 'test', command: 'node check.cjs', cwd: '../outside' },
    { id: 'test', command: 'node check.cjs', cwd: 'C:\\Windows' },
    { id: 'test', command: 'node check.cjs', cwd: 'C:Windows' },
    { id: 'test', command: 'node check.cjs', cwd: 'module\0' },
    { id: 'test', command: 'node check.cjs', surprise: true },
  ]) {
    await catalogue([invalid]);
    await assert.rejects(loadChecks(root, {}), /Invalid|Unsafe/);
  }
  await catalogue([
    { id: 'test', command: 'node check.cjs' },
    { id: 'test', command: 'node other.cjs' },
  ]);
  await assert.rejects(loadChecks(root, {}), /unique/);
});

test('disabled checks are not executed and missing environment is rejected before running', async () => {
  await catalogue([{ id: 'disabled', command: 'node must-never-run.cjs', enabled: false }]);
  assert.deepEqual(await loadChecks(root, {}), []);
  await catalogue([{ id: 'missing-module', command: 'node must-never-run.cjs', cwd: 'missing' }]);
  await assert.rejects(verifySpec(root, spec.id), /ENOENT/);
});

test('an unavailable command shell is an environment failure rather than a failed application assertion', async t => {
  if (process.platform !== 'win32') {
    t.skip('ComSpec shell selection is specific to Windows.');
    return;
  }
  await catalogue([{ id: 'shell-test', command: 'node -e "process.exit(0)"' }]);
  const previous = process.env.ComSpec;
  try {
    process.env.ComSpec = join(root, 'unavailable-shell.exe');
    const record = await verifySpec(root, spec.id);
    assert.equal(record.passed, false);
    assert.equal(record.results[0].exitCode, null);
    assert.equal(record.results[0].errorType, 'environment');
    assert.match(record.results[0].error, /ENOENT/);
  } finally {
    if (previous === undefined) delete process.env.ComSpec;
    else process.env.ComSpec = previous;
  }
});

test('symlink working directories are rejected without running their check', async t => {
  await mkdir(join(root, 'real'));
  try {
    await symlink(join(root, 'real'), join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
      t.skip(`Symlinks unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  await catalogue([{ id: 'linked-test', command: 'node must-never-run.cjs', cwd: 'linked' }]);
  await assert.rejects(loadChecks(root, {}), /symlink/);
});

test('failing checks and timeout remain explicit failed records and block completion', async () => {
  await catalogue([{ id: 'failure', command: 'node -e "process.exit(2)"' }]);
  let record = await verifySpec(root, spec.id);
  assert.equal(record.passed, false);
  assert.equal(record.results[0].errorType, 'check-failed');
  assert.equal(record.results[0].exitCode, 2);
  await catalogue([{ id: 'timeout', command: 'node -e "setTimeout(()=>process.exit(0),5000)"', timeoutMs: 200 }]);
  record = await verifySpec(root, spec.id);
  assert.equal(record.passed, false);
  assert.equal(record.results[0].errorType, 'timeout');
  assert.equal(record.results[0].timedOut, true);
  await assert.rejects(completeSpec(root, spec.id), /did not pass/);
  if (record.results[0].error) await delay(5000);
});

test('output exceeding the bounded full log fails closed with an explicit incomplete-log diagnostic', async () => {
  await catalogue([{ id: 'large-output', command: 'node -e "process.stdout.write(Buffer.alloc(9*1024*1024,120))"' }]);
  const record = await verifySpec(root, spec.id);
  const result = record.results[0];
  assert.equal(record.passed, false);
  assert.equal(result.errorType, 'output-limit');
  assert.equal(result.outputLimitExceeded, true);
  assert.match(result.error, /log is incomplete/);
  assert.equal((await readFile(join(root, result.outputLog))).length, result.outputLimitBytes);
  await assert.rejects(completeSpec(root, spec.id), /did not pass/);
});

test('completion rejects changed check identity and changed output logs', async () => {
  await catalogue([{ id: 'original', command: 'node -e "console.log(1)"' }]);
  let record = await verifySpec(root, spec.id);
  assert.equal(record.passed, true);
  record.results[0].checkId = 'forged';
  await writeFile(join(spec.specDir, 'verification.json'), JSON.stringify(record));
  await assert.rejects(completeSpec(root, spec.id), /checks did not pass/);
  record = await verifySpec(root, spec.id);
  await writeFile(join(root, record.results[0].outputLog), 'replaced');
  await assert.rejects(completeSpec(root, spec.id), /output log changed/);
});

test('catalogue edits and shared contracts invalidate the fingerprint after a passing run', async () => {
  await catalogue([{ id: 'test', command: 'node -e "process.exit(0)"' }]);
  assert.equal((await verifySpec(root, spec.id)).passed, true);
  await catalogue([{ id: 'changed-id', command: 'node -e "process.exit(0)"' }]);
  await assert.rejects(completeSpec(root, spec.id), /identity\/configuration changed/);
  assert.equal((await verifySpec(root, spec.id)).passed, true);
  await writeFile(join(root, 'specs/contracts.json'), '{"changed":true}');
  await assert.rejects(completeSpec(root, spec.id), /changed after verification/);
});
