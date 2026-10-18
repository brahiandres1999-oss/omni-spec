import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { loadManifest, updateSpecStatus, saveManifest, focusSpec } from '../src/manifest.mjs';
import { verifySpec } from '../src/verification.mjs';
import { updateProject, checkProjectVersion, getCliVersion } from '../src/updater.mjs';
import { runCli } from '../src/cli.mjs';
import { detectProjectEnvironment } from '../src/detector.mjs';
import { fillSpec } from '../test-support/fixtures.mjs';
import { auditSpec } from '../src/auditor.mjs';
let root;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'omnispec-contract-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
const manual = { manual: 'Reviewed the deterministic greeting contract locally.' };

test('new and unknown projects do not invent stacks or commands', async () => {
  const fresh = await detectProjectEnvironment(root);
  assert.equal(fresh.detectedStack, null); assert.equal(fresh.qualityGates, '');
  await writeFile(join(root, 'legacy.xyz'), 'opaque');
  const old = await detectProjectEnvironment(root);
  assert.equal(old.type, 'brownfield'); assert.equal(old.qualityGates, '');
  assert.match(old.detectedStack, /Unknown/);
});

test('monorepo inventory includes root and nested commands with their working directory', async () => {
  await writeFile(join(root, 'package.json'), '{"scripts":{"lint":"lint-command"}}');
  await mkdir(join(root, 'packages', 'app'), { recursive: true });
  await writeFile(join(root, 'packages', 'app', 'package.json'), '{"scripts":{"test":"test-command"},"packageManager":"pnpm@10.0.0"}');
  const result = await detectProjectEnvironment(root);
  assert.match(result.qualityGates, /^npm run lint/m);
  assert.match(result.qualityGates, /cd "packages\/app" && pnpm test/);
  assert.equal(result.modules.length, 2);
});

test('invalid agent init has no side effects and uninitialized check fails', async () => {
  assert.equal(await runCli(['init', '--yes', '--agent', 'invalid-agent'], root), 1);
  assert.deepEqual(await readdir(root), []);
  assert.equal(await runCli(['check'], root), 1);
});

test('CLI rejects misspelled flags rather than silently choosing a default', async () => {
  assert.equal(await runCli(['init', '--yes', '--agen', 'claude'], root), 1);
  assert.deepEqual(await readdir(root), []);
});

test('onboarding writes a local runtime and user-owned context; reinit preserves context', async () => {
  await scaffoldProject(root, { projectName: 'NewProject' });
  assert.match(await readFile(join(root, 'specs', '.omni', 'runtime', 'bin', 'omni-spec.mjs'), 'utf8'), /runCli/);
  const path = join(root, 'specs', 'project-context.md');
  await writeFile(path, '# Confirmed local decisions');
  await scaffoldProject(root, { projectName: 'NewProject' });
  assert.equal(await readFile(path, 'utf8'), '# Confirmed local decisions');
});

test('setup-agent persists selection and rejects invalid agents without changing manifest', async () => {
  await scaffoldProject(root, { agent: 'antigravity' });
  assert.equal(await runCli(['setup-agent', 'cursor'], root), 0);
  assert.equal((await loadManifest(root)).agent, 'cursor');
  const before = await readFile(join(root, 'specs', 'manifest.json'), 'utf8');
  assert.equal(await runCli(['setup-agent', 'misspelled'], root), 1);
  assert.equal(await readFile(join(root, 'specs', 'manifest.json'), 'utf8'), before);
  assert.match(await readFile(join(root, '.cursor', 'commands', 'omni-init.md'), 'utf8'), /omni-init/);
});

test('update previews conflicts, preserves edits, then backs up explicit replacement', async () => {
  await scaffoldProject(root);
  const name = 'specs/_templates/01-feature/spec.md';
  await writeFile(join(root, name), '# My custom template');
  const before = await readFile(join(root, 'specs', 'manifest.json'), 'utf8');
  const preview = await updateProject(root, { dryRun: true });
  assert.ok(preview.assets.conflicts.includes(name));
  await assert.rejects(updateProject(root), /Local changes preserved/);
  assert.equal(await readFile(join(root, name), 'utf8'), '# My custom template');
  assert.equal(await readFile(join(root, 'specs', 'manifest.json'), 'utf8'), before);
  const updated = await updateProject(root, { acceptUpdates: true });
  assert.equal(await readFile(join(root, updated.assets.backups.find(p => p.endsWith(name))), 'utf8'), '# My custom template');
  assert.equal((await checkProjectVersion(root)).healthy, true);
});

test('integration write failures do not report successful initialization', async () => {
  await writeFile(join(root, '.agents'), 'block directory creation');
  assert.equal(await runCli(['init', '--yes'], root), 1);
  assert.equal(await loadManifest(root), null);
});

for (const type of ['feature', 'bugfix', 'debt', 'rfc']) test(`${type}: block draft, verify evidence, complete and preserve history`, async () => {
  await scaffoldProject(root);
  const created = await createSpec(root, type, `work-${type}`);
  await assert.rejects(updateSpecStatus(root, created.id, 'COMPLETED'), /Cannot verify\/complete/);
  await fillSpec(root, { ...created, type });
  if (type !== 'rfc') {
    await fillSpec(root, { ...created, type }, { pending: true });
    await assert.rejects(verifySpec(root, created.id, manual), /tasks remain pending/);
    await fillSpec(root, { ...created, type });
  }
  const record = await verifySpec(root, created.id, manual);
  assert.equal(record.passed, true);
  assert.equal(record.mode, type === 'rfc' ? 'decision' : 'manual');
  const closed = await updateSpecStatus(root, created.id, 'COMPLETED');
  assert.equal(closed.status, 'COMPLETED');
  assert.equal((await loadManifest(root)).active_spec, null);
});

test('automated checks run in project root; failing checks cannot close', async () => {
  await scaffoldProject(root, { qualityGates: 'node check.cjs' });
  await writeFile(join(root, 'check.cjs'), 'process.exit(1)');
  const spec = await createSpec(root, 'feature', 'greeting'); await fillSpec(root, spec);
  assert.equal((await verifySpec(root, spec.id)).passed, false);
  await assert.rejects(updateSpecStatus(root, spec.id, 'COMPLETED'), /did not pass/);
  await assert.rejects(verifySpec(root, spec.id, manual), /cannot bypass/);
  await writeFile(join(root, 'check.cjs'), 'require("node:assert/strict").equal("Hello " + "Ada", "Hello Ada")');
  assert.equal((await verifySpec(root, spec.id)).passed, true);
  assert.equal((await updateSpecStatus(root, spec.id, 'COMPLETED')).verification.mode, 'automated');
});

test('changed source invalidates verification until rerun', async () => {
  await scaffoldProject(root); const spec = await createSpec(root, 'feature', 'greeting'); await fillSpec(root, spec);
  await verifySpec(root, spec.id, manual);
  await writeFile(join(root, 'greeting.txt'), 'changed');
  await assert.rejects(updateSpecStatus(root, spec.id, 'COMPLETED'), /changed after verification/);
  await verifySpec(root, spec.id, manual);
  assert.equal((await updateSpecStatus(root, spec.id, 'COMPLETED')).status, 'COMPLETED');
});

test('changed gates invalidate evidence and configure keeps constitution in sync', async () => {
  await scaffoldProject(root); const spec = await createSpec(root, 'feature', 'greeting'); await fillSpec(root, spec);
  await verifySpec(root, spec.id, manual);
  assert.equal(await runCli(['configure', '--gates', 'node check.cjs'], root), 0);
  assert.match(await readFile(join(root, 'CONSTITUTION.md'), 'utf8'), /node check.cjs/);
  await assert.rejects(updateSpecStatus(root, spec.id, 'COMPLETED'), /changed after verification/);
});

test('manual evidence requires a specific reason and authored verification document', async () => {
  await scaffoldProject(root); const spec = await createSpec(root, 'feature', 'greeting'); await fillSpec(root, spec);
  await assert.rejects(verifySpec(root, spec.id), /No quality gates/);
  await writeFile(join(spec.specDir, 'verification.md'), '# Empty\n[TODO]');
  await assert.rejects(verifySpec(root, spec.id, manual), /verification.md/);
});

test('focus rejects ambiguous partial names and aliases route correctly', async () => {
  await scaffoldProject(root);
  await createSpec(root, 'fix', 'login-one'); await createSpec(root, 'bug', 'login-two');
  await assert.rejects(focusSpec(root, 'login'), /Ambiguous/);
  assert.equal((await focusSpec(root, '001')).type, 'bugfix');
});

test('setup-agent --dry-run is rejected without mutating selected adapters', async () => {
  await scaffoldProject(root);
  const before = await readFile(join(root, 'specs', 'manifest.json'), 'utf8');
  assert.equal(await runCli(['setup-agent', 'cursor', '--dry-run'], root), 1);
  assert.equal(await readFile(join(root, 'specs', 'manifest.json'), 'utf8'), before);
  await assert.rejects(readFile(join(root, '.cursor', 'commands', 'omni-init.md')), { code: 'ENOENT' });
});

test('legacy upgrade supplies local runtime and missing project context without changing specs', async () => {
  await mkdir(join(root, 'specs'));
  await saveManifest(root, { project: 'Legacy', version: '0.4.1', specs: [], agent: 'antigravity' });
  await writeFile(join(root, 'CONSTITUTION.md'), '# Existing policy');
  await updateProject(root);
  assert.match(await readFile(join(root, 'specs', 'project-context.md'), 'utf8'), /Project context/);
  assert.equal(await readFile(join(root, 'CONSTITUTION.md'), 'utf8'), '# Existing policy');
});

test('newer project versions cannot be downgraded by update', async () => {
  await scaffoldProject(root);
  const manifest = await loadManifest(root); manifest.version = '0.6.0'; await saveManifest(root, manifest);
  await assert.rejects(updateProject(root), /Refusing downgrade/);
  assert.equal((await loadManifest(root)).version, '0.6.0');
});

test('downgrade requires explicit consent and preserves authored state', async () => {
  const cliVersion = await getCliVersion();
  await scaffoldProject(root);
  const manifest = await loadManifest(root); manifest.version = '999.0.0'; await saveManifest(root, manifest);
  const contextPath = join(root, 'specs/project-context.md');
  await writeFile(contextPath, '# Confirmed decisions\nPreserve all existing user choices.\n');
  await assert.rejects(updateProject(root), /Refusing downgrade/);
  const preview = await updateProject(root, { allowDowngrade: true, dryRun: true });
  assert.equal(preview.downgrade, true);
  assert.equal((await loadManifest(root)).version, manifest.version);
  const updated = await updateProject(root, { allowDowngrade: true });
  assert.equal(updated.toVersion, cliVersion);
  assert.equal(await readFile(contextPath, 'utf8'), '# Confirmed decisions\nPreserve all existing user choices.\n');
});

test('downgrade option cannot be used to bypass unrelated command contracts', async () => {
  assert.equal(await runCli(['init', '--yes', '--allow-downgrade'], root), 1);
  assert.deepEqual(await readdir(root), []);
});

test('manifest path traversal is rejected before artifacts can be accessed', async () => {
  await mkdir(join(root, 'specs'));
  await writeFile(join(root, 'specs', 'manifest.json'), JSON.stringify({ specs: [{ id: '001', slug: '../outside' }] }));
  await assert.rejects(loadManifest(root), /Invalid specification/);
});

test('verification timeout fails and cannot close the specification', async () => {
  await scaffoldProject(root, { qualityGates: 'node hang.cjs' });
  await writeFile(join(root, 'hang.cjs'), 'setInterval(() => {}, 1000)');
  const spec = await createSpec(root, 'feature', 'timeout'); await fillSpec(root, spec);
  const result = await verifySpec(root, spec.id, { timeout: 500 });
  assert.equal(result.passed, false); assert.equal(result.results[0].timedOut, true);
  await assert.rejects(updateSpecStatus(root, spec.id, 'COMPLETED'), /did not pass/);
});

test('concurrent initializations preserve a usable managed installation', async () => {
  await Promise.all([scaffoldProject(root), scaffoldProject(root), scaffoldProject(root)]);
  assert.equal((await checkProjectVersion(root)).healthy, true);
  assert.equal((await loadManifest(root)).specs.length, 0);
});

test('example checkboxes in code fences cannot satisfy required tasks', async () => {
  await scaffoldProject(root); const spec = await createSpec(root, 'feature', 'examples'); await fillSpec(root, spec);
  await writeFile(join(spec.specDir, 'tasks.md'), '# Example only\n```markdown\n- [x] This was never performed.\n```\n');
  assert.equal((await auditSpec(root, spec.id)).valid, false);
});

test('general profile does not require creating a database or tenant architecture', async () => {
  await scaffoldProject(root);
  const constitution = await readFile(join(root, 'CONSTITUTION.md'), 'utf8');
  assert.match(constitution, /If the project is multi-tenant/);
  assert.match(constitution, /If no database/);
  assert.doesNotMatch(constitution, /must include a tested down-migration/);
});
