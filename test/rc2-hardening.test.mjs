import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile, stat, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { verifySpec, completeSpec, projectSnapshot } from '../src/verification.mjs';
import {
  recordContext,
  contextFreshness,
  recordSession,
  recordDecision,
  projectStatus,
} from '../src/project-state.mjs';
import { cleanProject } from '../src/plugin-manager.mjs';
import { updateProject } from '../src/updater.mjs';
import { loadManifest, saveManifest } from '../src/manifest.mjs';
import { compileIgnoreText, isIgnored } from '../src/snapshot.mjs';
import { runCli } from '../src/cli.mjs';
import { fillSpec } from '../test-support/fixtures.mjs';

const cli = fileURLToPath(new URL('../bin/omni-spec.mjs', import.meta.url));
let root;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omni-rc2-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function project(gates = 'node check.mjs') {
  await scaffoldProject(root, { qualityGates: gates });
  await writeFile(join(root, 'check.mjs'), 'process.exit(0);\n');
  const spec = await createSpec(root, 'feature', 'greeting');
  await fillSpec(root, spec);
  return spec;
}

function run(args, input) {
  const child = spawn(process.execPath, [cli, ...args], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', data => (stdout += data));
  child.stderr.on('data', data => (stderr += data));
  child.stdin.end(input ?? '');
  return once(child, 'close').then(([code]) => ({ code, stdout, stderr }));
}

test('gitignore subset: anchoring, globstar, negation, directory-only and escapes', () => {
  const rules = compileIgnoreText('/root.txt\n*.log\n!keep.log\nout/\na/**/b.txt\n**/cache\n\\#hash\n# comment\n');
  const cases = [
    ['root.txt', false, true],
    ['nested/root.txt', false, false],
    ['x/y.log', false, true],
    ['x/keep.log', false, false],
    ['out', true, true],
    ['out', false, false],
    ['src/out', true, true],
    ['a/b.txt', false, true],
    ['a/x/y/b.txt', false, true],
    ['deep/cache', true, true],
    ['#hash', false, true],
    ['comment', false, false],
  ];
  for (const [path, directory, expected] of cases)
    assert.equal(isIgnored(rules, path, directory), expected, `${path} (${directory ? 'dir' : 'file'})`);
});

test('check outputs in default, .gitignore and .omnispecignore locations do not invalidate verification', async () => {
  const spec = await project('node e2e.mjs');
  await writeFile(join(root, '.gitignore'), 'reports/\n');
  await writeFile(
    join(root, 'e2e.mjs'),
    [
      'import { mkdirSync, writeFileSync } from "node:fs";',
      'for (const dir of ["test-results", "playwright-report", ".gradle", "reports", "artifacts"]) {',
      '  mkdirSync(dir, { recursive: true });',
      '  writeFileSync(dir + "/run.json", String(Date.now() + Math.random()));',
      '}',
    ].join('\n'),
  );
  await writeFile(join(root, '.omnispecignore'), 'artifacts/\n');
  for (let attempt = 0; attempt < 2; attempt++) {
    const record = await verifySpec(root, spec.id);
    assert.equal(record.passed, true, JSON.stringify(record.changedDuringVerification));
  }
  await completeSpec(root, spec.id);
});

test('a non-ignored file written by a check fails verification and names the changed path', async () => {
  const spec = await project('node e2e.mjs');
  await writeFile(
    join(root, 'e2e.mjs'),
    'import { writeFileSync } from "node:fs"; writeFileSync("junit.xml", String(Date.now()));',
  );
  const record = await verifySpec(root, spec.id);
  assert.equal(record.passed, false);
  assert.deepEqual(record.changedDuringVerification, ['junit.xml']);
  const status = await projectStatus(root);
  assert.equal(status.progress.blockers[0].code, 'VERIFICATION_SOURCE_CHANGED');
  assert.match(status.progress.blockers[0].message, /junit\.xml.*\.omnispecignore/);
  await writeFile(join(root, '.omnispecignore'), 'junit.xml\n');
  assert.equal((await verifySpec(root, spec.id)).passed, true);
});

test('.omnispecignore can re-include a default directory that contains source', async () => {
  const spec = await project();
  await mkdir(join(root, 'build'), { recursive: true });
  await writeFile(join(root, 'build', 'source.mjs'), 'export const a = 1;');
  const gates = { qualityGates: 'node check.mjs', checks: [] };
  assert.equal((await projectSnapshot(root, spec, gates)).files.has('build/source.mjs'), false);
  await writeFile(join(root, '.omnispecignore'), '!build/\n');
  assert.equal((await projectSnapshot(root, spec, gates)).files.has('build/source.mjs'), true);
});

test('session observations do not change the snapshot; decisions and context do', async () => {
  const spec = await project();
  const gates = { qualityGates: 'node check.mjs', checks: [] };
  const first = (await projectSnapshot(root, spec, gates)).fingerprint;
  await recordSession(root, { host: 'h', capabilities: { render: { status: 'available', source: 'browser' } } });
  assert.equal((await projectSnapshot(root, spec, gates)).fingerprint, first);
  await recordDecision(root, { id: 'scope', topic: 'scope', status: 'approved', basis: 'User approved scope.' });
  assert.notEqual((await projectSnapshot(root, spec, gates)).fingerprint, first);
});

test('context staleness follows context inputs, cited files and user AGENTS.md text, not source edits', async () => {
  await project();
  await writeFile(join(root, 'src.mjs'), 'export const x = 1;');
  await writeFile(join(root, 'notes.md'), 'decision log');
  const context = join(root, 'specs', 'project-context.md');
  await writeFile(context, (await readFile(context, 'utf8')) + '\nSee [notes](../notes.md).\n');
  await recordContext(root);
  await writeFile(join(root, 'src.mjs'), 'export const x = 2;');
  await mkdir(join(root, '.idea'), { recursive: true });
  await writeFile(join(root, '.idea', 'workspace.xml'), '<x/>');
  assert.equal((await contextFreshness(root)).status, 'CURRENT');
  const agents = join(root, 'AGENTS.md');
  const original = await readFile(agents, 'utf8');
  await writeFile(agents, original.replace(/(<!-- OMNI-SPEC-START -->)/, '$1\nmanaged change'));
  assert.equal((await contextFreshness(root)).status, 'CURRENT', 'managed section is not user context');
  await writeFile(join(root, 'notes.md'), 'decision log revised');
  assert.deepEqual((await contextFreshness(root)).changed, ['notes.md']);
  await recordContext(root);
  await mkdir(join(root, '.github', 'workflows'), { recursive: true });
  await writeFile(join(root, '.github', 'workflows', 'ci.yml'), 'on: push');
  assert.deepEqual((await contextFreshness(root)).changed, ['.github/workflows/ci.yml']);
});

test('a legacy full-tree context baseline is compared only on current context inputs', async () => {
  await project();
  await writeFile(join(root, 'src.mjs'), 'export const x = 1;');
  await recordContext(root);
  const path = join(root, 'specs', 'project-state.json');
  const state = JSON.parse(await readFile(path, 'utf8'));
  delete state.context.scope;
  state.context.inputs['src.mjs'] = 'legacy-hash-of-source';
  await writeFile(path, JSON.stringify(state));
  const freshness = await contextFreshness(root);
  assert.equal(freshness.status, 'CURRENT');
  assert.equal(freshness.scope, 'LEGACY_FULL_SNAPSHOT');
});

test('agent UI evidence stays valid across later sessions and accepts second-precision times', async () => {
  const spec = await project();
  await writeFile(
    join(spec.specDir, 'spec.md'),
    '# UI\n## 0. Clarification\nThe user approved the mobile agenda layout and sample data.\n## Acceptance Criteria\nAC-01 [visual]: no horizontal overflow at 375px.\n## Non-Goals\nNo redesign.\n',
  );
  await mkdir(join(spec.specDir, 'evidence'));
  await writeFile(join(spec.specDir, 'evidence', 'shot.png'), 'png-bytes');
  const sessionStart = new Date(Date.now() - 10000);
  const session = await recordSession(root, {
    host: 'browser-host',
    observedAt: sessionStart.toISOString(),
    capabilities: { render: { status: 'available', source: 'Browser opened the local app.' } },
  });
  // Same second as the session start, written without milliseconds as many hosts do.
  const observedAt = new Date(Math.floor(sessionStart.getTime() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
  const observation = {
    actor: 'agent',
    observer: 'agent',
    surface: '/agenda',
    environment: 'Chromium local',
    steps: ['Open /agenda at 375px', 'Measure scrollWidth'],
    expected: 'scrollWidth <= 375',
    actual: '360',
    result: 'passed',
    observedAt,
    viewport: { width: 375, height: 812 },
    artifact: 'evidence/shot.png',
  };
  const write = item =>
    writeFile(
      join(spec.specDir, 'acceptance.json'),
      JSON.stringify({
        schemaVersion: 2,
        criteria: [
          {
            id: 'AC-01',
            kind: 'visual',
            status: 'passed',
            method: 'manual',
            evidence: 'Observed at 375x812 without overflow.',
            observations: [item],
          },
        ],
      }),
    );
  await write(observation);
  assert.equal((await verifySpec(root, spec.id)).passed, true, 'second-precision time inside the session');
  await recordSession(root, {
    host: 'next-day-host',
    capabilities: { render: { status: 'unavailable', source: 'No browser today.' } },
  });
  assert.equal((await projectStatus(root)).progress.delivery, 'READY_TO_COMPLETE', 'earlier session remains valid');
  await write({ ...observation, sessionId: session.id });
  assert.equal((await verifySpec(root, spec.id)).passed, true);
  await write({ ...observation, observedAt: new Date().toISOString(), sessionId: undefined });
  await assert.rejects(verifySpec(root, spec.id), /render capability/, 'latest session has no render');
});

test('state commands are not blocked by a running verification, and complete refuses to race it', async () => {
  const spec = await project('node slow.mjs');
  await writeFile(join(root, 'slow.mjs'), 'setTimeout(() => {}, 1500);');
  const running = verifySpec(root, spec.id);
  await new Promise(done => setTimeout(done, 400));
  const started = Date.now();
  await recordSession(root, { host: 'h', capabilities: {} });
  assert.ok(Date.now() - started < 1000, 'session-record completed while checks ran');
  await assert.rejects(completeSpec(root, spec.id), /verification is already running/);
  const record = await running;
  assert.equal(record.passed, true, 'session records do not invalidate the running verification');
});

test('a decision recorded while checks run is reported as a state change', async () => {
  const spec = await project('node slow.mjs');
  await writeFile(join(root, 'slow.mjs'), 'setTimeout(() => {}, 1200);');
  const running = verifySpec(root, spec.id);
  await new Promise(done => setTimeout(done, 400));
  await recordDecision(root, { id: 'x', topic: 'scope', status: 'approved', basis: 'Approved by the user.' });
  const record = await running;
  assert.equal(record.passed, false);
  assert.deepEqual(record.changedDuringVerification, ['specs/project-state.json#decisions-context']);
});

test('verification survives moving the project folder (portable check cwd)', async () => {
  const spec = await project();
  await verifySpec(root, spec.id);
  const moved = `${root}-moved`;
  await cp(root, moved, { recursive: true });
  try {
    assert.equal((await completeSpec(moved, spec.id)).status, 'COMPLETED');
  } finally {
    await rm(moved, { recursive: true, force: true });
  }
});

test('a verification record from an earlier version asks for a fresh run', async () => {
  const spec = await project();
  await verifySpec(root, spec.id);
  const path = join(spec.specDir, 'verification.json');
  const record = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...record, version: 2 }));
  await assert.rejects(completeSpec(root, spec.id), /earlier OmniSpec version/);
});

test('--from reads JSON outside the project and from stdin', async () => {
  await project();
  const outside = await mkdtemp(join(tmpdir(), 'omni-input-'));
  try {
    const file = join(outside, 'session.json');
    await writeFile(file, JSON.stringify({ host: 'outside', capabilities: {} }));
    assert.equal(await runCli(['session-record', '--from', file, '--json'], root), 0);
    const piped = await run(
      ['decision-record', '--from', '-', '--json'],
      JSON.stringify({ id: 'd', topic: 'scope', status: 'pending' }),
    );
    assert.equal(piped.code, 0, piped.stderr);
    assert.equal(JSON.parse(piped.stdout).id, 'd');
    const broken = await run(['session-record', '--from', '-'], '{not json');
    assert.notEqual(broken.code, 0);
    assert.match(broken.stderr, /Invalid JSON in standard input/);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test('clean preserves user skills and backups, removes only unmodified managed copies', async () => {
  await scaffoldProject(root, { agent: 'antigravity' });
  await mkdir(join(root, '.agents', 'skills', 'team-skill'), { recursive: true });
  await writeFile(join(root, '.agents', 'skills', 'team-skill', 'SKILL.md'), '# Team skill');
  await mkdir(join(root, 'specs', '.omni', 'backups', 'old'), { recursive: true });
  await writeFile(join(root, 'specs', '.omni', 'backups', 'old', 'spec.md'), 'user customization');
  const preview = await cleanProject(root, { dryRun: true });
  assert.ok(
    preview.toRemove.every(name => name.startsWith('specs/.omni/runtime/') || name.startsWith('.agents/skills/omni-')),
  );
  await cleanProject(root);
  assert.equal(await readFile(join(root, '.agents', 'skills', 'team-skill', 'SKILL.md'), 'utf8'), '# Team skill');
  assert.equal(await readFile(join(root, 'specs', '.omni', 'backups', 'old', 'spec.md'), 'utf8'), 'user customization');
  await assert.rejects(stat(join(root, '.agents', 'skills', 'omni-init')), { code: 'ENOENT' });
  await assert.rejects(stat(join(root, 'specs', '.omni', 'runtime')), { code: 'ENOENT' });
  assert.equal((await loadManifest(root)).agent, 'plugin');
});

test('clean blocks on modified managed files and on adapters that need the local runtime', async () => {
  await scaffoldProject(root, { agent: 'antigravity,claude' });
  await assert.rejects(cleanProject(root), /Antigravity only.*claude/);
  const manifest = await loadManifest(root);
  await saveManifest(root, { ...manifest, agent: 'antigravity' });
  const skill = join(root, '.agents', 'skills', 'omni-plan', 'SKILL.md');
  await writeFile(skill, (await readFile(skill, 'utf8')) + '\nlocal edit');
  await assert.rejects(cleanProject(root), /Locally modified OmniSpec files block clean/);
  assert.match(await readFile(skill, 'utf8'), /local edit/);
  const result = await cleanProject(root, { acceptUpdates: true });
  assert.equal(result.backups.length, 1);
  assert.match(await readFile(join(root, result.backups[0]), 'utf8'), /local edit/);
});

test('init installs specs/.gitignore and update offers a constitution reference without replacing it', async () => {
  await scaffoldProject(root);
  const ignore = await readFile(join(root, 'specs', '.gitignore'), 'utf8');
  for (const entry of ['.omni/verification-logs/', '.omni/backups/', '.omni/inputs/', 'manifest.lock/'])
    assert.ok(ignore.includes(entry), entry);
  const constitution = join(root, 'CONSTITUTION.md');
  await writeFile(constitution, '# Our constitution\n## 4. Delivery Quality Gates\n```text\n```\n');
  const result = await updateProject(root, {});
  assert.equal(result.constitution.status, 'PRESERVED_REVIEW_RECOMMENDED');
  assert.equal(
    await readFile(constitution, 'utf8'),
    '# Our constitution\n## 4. Delivery Quality Gates\n```text\n```\n',
  );
  assert.match(await readFile(join(root, result.constitution.reference), 'utf8'), /## 5\. UI Ergonomics/);
});

test('the init wizard accepts piped answers that arrive before each prompt', async () => {
  const result = await run(['init', '--agent', 'claude'], 'Piped\n8\n\n1\nnone\nY\n');
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await loadManifest(root)).project, 'Piped');
  assert.equal((await loadManifest(root)).qualityGates, '');
});

test('fit explains the exact file and schema for an unclassified spec', async () => {
  const spec = await project();
  const result = await run(['fit', spec.id]);
  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes(`specs/${spec.slug}/fit.json`));
  assert.match(result.stdout, /"schemaVersion":\s*2/);
  assert.equal(JSON.parse((await run(['fit', spec.id, '--json'])).stdout).example.schemaVersion, 2);
});

test('guide evidence documents every validated record shape', async () => {
  await project();
  const result = await run(['guide', 'evidence', '--json']);
  assert.equal(result.code, 0);
  const { content } = JSON.parse(result.stdout);
  for (const text of [
    'acceptance.json',
    'checks --from',
    'session-record',
    'decision-record',
    'fit.json',
    'specs/.omni/inputs/',
  ])
    assert.ok(content.includes(text), text);
});

test('symlinked dependency directories are ignored like the directories they replace', async () => {
  const spec = await project();
  const { symlink } = await import('node:fs/promises');
  await mkdir(join(root, 'real-modules'), { recursive: true });
  await writeFile(join(root, '.gitignore'), 'real-modules/\n');
  await symlink(join(root, 'real-modules'), join(root, 'node_modules'), 'junction');
  assert.equal((await verifySpec(root, spec.id)).passed, true);
});

test('clean ignores crafted registry keys that escape the managed trees', async () => {
  await scaffoldProject(root, { agent: 'antigravity' });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.js'), 'keep me');
  const registryPath = join(root, 'specs', '.omni', 'managed.json');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const { createHash } = await import('node:crypto');
  registry.files['.agents/skills/omni-x/../../../src/index.js'] = {
    hash: createHash('sha256').update('keep me').digest('hex'),
    section: false,
  };
  await writeFile(registryPath, JSON.stringify(registry));
  const preview = await cleanProject(root, { dryRun: true });
  assert.ok(!preview.toRemove.some(name => name.includes('..')));
  await cleanProject(root);
  assert.equal(await readFile(join(root, 'src', 'index.js'), 'utf8'), 'keep me');
});

test('a sessionId only covers observations made before the next recorded session', async () => {
  const { observationSession } = await import('../src/project-state.mjs');
  const state = {
    sessions: [{ id: 's1', observedAt: '2026-10-01T10:00:00Z', capabilities: {} }],
    session: { id: 's2', observedAt: '2026-10-20T10:00:00Z', capabilities: {} },
  };
  assert.equal(observationSession(state, { sessionId: 's1', observedAt: '2026-10-05T10:00:00Z' })?.id, 's1');
  assert.equal(observationSession(state, { sessionId: 's1', observedAt: '2026-10-22T10:00:00Z' }), null);
  assert.equal(observationSession(state, { observedAt: '2026-10-22T10:00:00Z' })?.id, 's2');
  assert.equal(observationSession(state, { observedAt: '2026-09-01T10:00:00Z' }), null);
});

test('an existing specs/.gitignore keeps user rules and receives a managed section', async () => {
  await mkdir(join(root, 'specs'), { recursive: true });
  await writeFile(join(root, 'specs', '.gitignore'), 'drafts/\n');
  await scaffoldProject(root);
  const first = await readFile(join(root, 'specs', '.gitignore'), 'utf8');
  assert.match(first, /^drafts\/\n/);
  assert.match(first, /# OMNI-SPEC-START[\s\S]*\.omni\/verification-logs\/[\s\S]*# OMNI-SPEC-END/);
  await writeFile(join(root, 'specs', '.gitignore'), first + 'more-user-rules/\n');
  const result = await updateProject(root, {});
  assert.deepEqual(result.assets.conflicts, []);
  assert.match(await readFile(join(root, 'specs', '.gitignore'), 'utf8'), /more-user-rules\//);
});

test('legacy baselines detect deleted context inputs and ignore never-hashed spec citations', async () => {
  await project();
  await writeFile(join(root, 'Dockerfile'), 'FROM node');
  await mkdir(join(root, 'specs', 'adr'), { recursive: true });
  await writeFile(join(root, 'specs', 'adr', '001.md'), '# ADR');
  const context = join(root, 'specs', 'project-context.md');
  await writeFile(context, (await readFile(context, 'utf8')) + '\nSee [ADR](adr/001.md).\n');
  await recordContext(root);
  const path = join(root, 'specs', 'project-state.json');
  const state = JSON.parse(await readFile(path, 'utf8'));
  delete state.context.scope;
  delete state.context.inputs['specs/adr/001.md'];
  await writeFile(path, JSON.stringify(state));
  assert.equal((await contextFreshness(root)).status, 'CURRENT');
  await rm(join(root, 'Dockerfile'));
  assert.deepEqual((await contextFreshness(root)).changed, ['Dockerfile']);
});

test('citing OmniSpec state files never leaves context permanently stale', async () => {
  const spec = await project();
  await verifySpec(root, spec.id);
  await recordSession(root, { host: 'h', capabilities: {} });
  const context = join(root, 'specs', 'project-context.md');
  await writeFile(
    context,
    (await readFile(context, 'utf8')) +
      `\n[state](project-state.json) [manifest](manifest.json) [record](${spec.slug}/verification.json)\n`,
  );
  await recordContext(root);
  assert.equal((await contextFreshness(root)).status, 'CURRENT');
  await verifySpec(root, spec.id);
  assert.equal((await contextFreshness(root)).status, 'CURRENT');
  assert.equal((await completeSpec(root, spec.id)).status, 'COMPLETED');
});

test('.omnispecignore overrides nested .gitignore files; parent repository ignore files do not apply', async () => {
  const repository = root;
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('git', ['init', '-q'], { cwd: repository });
  } catch {
    return;
  }
  await writeFile(join(repository, '.gitignore'), 'generated-*.json\n');
  const nested = join(repository, 'apps', 'web');
  await mkdir(join(nested, 'pkg', 'gen'), { recursive: true });
  await writeFile(join(nested, 'pkg', '.gitignore'), '!gen/\n');
  await writeFile(join(nested, 'pkg', 'gen', 'a.js'), 'x');
  await writeFile(join(nested, 'generated-report.json'), '{}');
  await writeFile(join(nested, 'main.js'), 'x');
  await writeFile(join(nested, '.omnispecignore'), 'pkg/gen/\n');
  const { hashProjectFiles } = await import('../src/snapshot.mjs');
  const files = [...(await hashProjectFiles(nested)).keys()];
  assert.ok(files.includes('main.js'));
  assert.ok(!files.includes('pkg/gen/a.js'), '.omnispecignore wins over nested negation');
  assert.ok(files.includes('generated-report.json'), 'a parent repository cannot switch off attestation');
});

test('a CRLF checkout of managed files is not treated as a local edit', async () => {
  await scaffoldProject(root, { agent: 'claude' });
  for (const name of ['.claude/skills/omni-plan/SKILL.md', 'specs/.gitignore', 'AGENTS.md']) {
    const path = join(root, name);
    await writeFile(path, (await readFile(path, 'utf8')).replace(/\n/g, '\r\n'));
  }
  const preview = await updateProject(root, { dryRun: true });
  assert.deepEqual(preview.assets.conflicts, []);
  assert.deepEqual((await (await import('../src/managed.mjs')).checkManagedFiles(root)).changed, []);
});

test('a symlink to a file inside the project is attested by content; external links are refused', async () => {
  const spec = await project();
  const { symlink } = await import('node:fs/promises');
  try {
    await symlink(join(root, 'AGENTS.md'), join(root, 'CLAUDE.md'));
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') return; // symlinks need privileges
    throw error;
  }
  await recordContext(root);
  assert.equal((await verifySpec(root, spec.id)).passed, true);
  const outside = await mkdtemp(join(tmpdir(), 'omni-outside-'));
  try {
    await writeFile(join(outside, 'secret.txt'), 'x');
    await symlink(join(outside, 'secret.txt'), join(root, 'linked.txt'));
    await assert.rejects(verifySpec(root, spec.id), /outside the project/);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test('legacy baselines do not report files that are merely ignored today as deleted', async () => {
  await project();
  await writeFile(join(root, 'composer.json'), '{}');
  await writeFile(join(root, '.gitignore'), 'vendor/\n');
  await mkdir(join(root, 'vendor', 'lib'), { recursive: true });
  await writeFile(join(root, 'vendor', 'lib', 'composer.json'), '{}');
  await recordContext(root);
  const path = join(root, 'specs', 'project-state.json');
  const state = JSON.parse(await readFile(path, 'utf8'));
  delete state.context.scope;
  state.context.inputs['vendor/lib/composer.json'] = 'hash-from-a-full-tree-baseline';
  await writeFile(path, JSON.stringify(state));
  assert.equal((await contextFreshness(root)).status, 'CURRENT');
});

test('session windows follow declared start times, not recording order', async () => {
  const { observationSession } = await import('../src/project-state.mjs');
  const state = {
    sessions: [{ id: 's1', observedAt: '2026-10-01T10:00:00Z', capabilities: {} }],
    session: { id: 's2', observedAt: '2026-09-01T09:00:00Z', capabilities: {} },
  };
  assert.equal(observationSession(state, { sessionId: 's1', observedAt: '2026-10-01T10:30:00Z' })?.id, 's1');
  assert.equal(observationSession(state, { observedAt: '2026-09-15T00:00:00Z' })?.id, 's2');
});

test('ignore matching is case-sensitive on every platform so snapshots are portable', () => {
  const rules = compileIgnoreText('build/\n*.log\n');
  assert.equal(isIgnored(rules, 'Build', true), false);
  assert.equal(isIgnored(rules, 'src/CHANGES.LOG', false), false);
  assert.equal(isIgnored(rules, 'build', true), true);
});

test('clean treats a CRLF checkout of managed skills as unmodified', async () => {
  await scaffoldProject(root, { agent: 'antigravity' });
  const skill = join(root, '.agents', 'skills', 'omni-init', 'SKILL.md');
  await writeFile(skill, (await readFile(skill, 'utf8')).replace(/\n/g, '\r\n'));
  const preview = await cleanProject(root, { dryRun: true });
  assert.deepEqual(preview.conflicts, []);
  await cleanProject(root);
  await assert.rejects(stat(skill), { code: 'ENOENT' });
});

test('symlinks into specs, .git or OmniSpec state are refused; AGENTS.md may itself be a link', async () => {
  const spec = await project();
  const { symlink, rename } = await import('node:fs/promises');
  try {
    await symlink(join(root, 'specs', 'manifest.json'), join(root, 'manifest-link.json'));
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') return;
    throw error;
  }
  await assert.rejects(verifySpec(root, spec.id), /into \.git\/specs\/\.omni/);
  await rm(join(root, 'manifest-link.json'));
  await rename(join(root, 'AGENTS.md'), join(root, 'CLAUDE.md'));
  await symlink(join(root, 'CLAUDE.md'), join(root, 'AGENTS.md'));
  await recordContext(root);
  assert.equal((await contextFreshness(root)).status, 'CURRENT');
});
