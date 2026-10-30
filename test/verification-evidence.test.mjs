import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, rename, symlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { verifySpec, completeSpec, projectFingerprint } from '../src/verification.mjs';
import { fillSpec } from '../test-support/fixtures.mjs';

let root, spec;
const gates = 'node -e "process.exit(0)"';
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omni-evidence-'));
  await scaffoldProject(root, { qualityGates: gates });
  spec = await createSpec(root, 'feature', 'nested evidence');
  spec.type = 'feature';
  await fillSpec(root, spec);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('changing, adding, moving or deleting nested evidence invalidates completion', async () => {
  const dir = join(spec.specDir, 'evidence', 'browser');
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'observation.txt');
  await writeFile(file, 'Initial observation');
  const mutations = [
    () => writeFile(file, 'Changed observation'),
    () => rename(file, join(dir, 'renamed.txt')),
    () => rm(join(dir, 'renamed.txt')),
    () => writeFile(file, 'New observation'),
  ];
  for (const mutate of mutations) {
    assert.equal((await verifySpec(root, spec.id)).passed, true);
    await mutate();
    await assert.rejects(completeSpec(root, spec.id), /changed after verification/);
  }
  const record = await verifySpec(root, spec.id);
  assert.equal(record.passed, true);
  assert.equal((await completeSpec(root, spec.id)).status, 'COMPLETED');
});

test('only the root verification record is excluded, not nested records or cache-named evidence', async () => {
  const evidence = join(spec.specDir, 'evidence', 'build');
  await mkdir(evidence, { recursive: true });
  const file = join(evidence, 'verification.json');
  await writeFile(file, '{"observed":true}');
  const first = await projectFingerprint(root, spec, gates);
  await writeFile(join(spec.specDir, 'verification.json'), '{"untrusted":"record"}');
  assert.equal(await projectFingerprint(root, spec, gates), first);
  await writeFile(file, '{"observed":false}');
  assert.notEqual(await projectFingerprint(root, spec, gates), first);
});

test('nested symlinked evidence is rejected without reading its target', async t => {
  const target = join(root, 'external-evidence');
  const evidence = join(spec.specDir, 'evidence');
  await mkdir(target);
  await mkdir(evidence);
  await writeFile(join(target, 'trace.txt'), 'External observation');
  try {
    await symlink(target, join(evidence, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
      t.skip(`This environment cannot create symlinks: ${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(projectFingerprint(root, spec, gates), /symlinked source/);
});

test('the snapshot byte limit also applies to nested specification evidence', async () => {
  const evidence = join(spec.specDir, 'evidence');
  await mkdir(evidence);
  const file = await open(join(evidence, 'large-trace.bin'), 'w');
  try {
    await file.truncate(256 * 1024 * 1024 + 1);
  } finally {
    await file.close();
  }
  await assert.rejects(projectFingerprint(root, spec, gates), /snapshot exceeds/);
});

test('context edits invalidate verification and unrelated archived specs stay outside the snapshot', async () => {
  const first = await projectFingerprint(root, spec, gates);
  const archive = join(root, 'specs', '999-archived');
  await mkdir(archive);
  await writeFile(join(archive, 'spec.md'), 'Historical record');
  assert.equal(await projectFingerprint(root, spec, gates), first);
  const context = join(root, 'specs', 'project-context.md');
  await writeFile(context, (await readFile(context, 'utf8')) + '\nA revised domain decision.\n');
  assert.notEqual(await projectFingerprint(root, spec, gates), first);
});

test('files inside .astro/ build directory are ignored by default and do not invalidate snapshot', async () => {
  const first = await projectFingerprint(root, spec, gates);
  const astroDir = join(root, '.astro');
  await mkdir(astroDir, { recursive: true });
  await writeFile(join(astroDir, 'types.d.ts'), '// Astro generated types');
  await writeFile(join(astroDir, 'settings.json'), '{"cache":true}');
  assert.equal(await projectFingerprint(root, spec, gates), first);
});
