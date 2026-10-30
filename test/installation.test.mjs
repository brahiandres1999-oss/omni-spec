import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/manifest.mjs';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { inspectInstallation, assertInstallationRuntime } from '../src/installation.mjs';
import { runWizard } from '../src/wizard.mjs';
import { loadRegistry, saveRegistry, managedHash } from '../src/managed.mjs';

const cli = fileURLToPath(new URL('../bin/omni-spec.mjs', import.meta.url));
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
let root;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omni-install-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function run(args, input = '', cwd = root) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
    env: {
      ...process.env,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      HOME: join(root, 'isolated-home'),
      USERPROFILE: join(root, 'isolated-home'),
    },
  });
  assert.ifError(result.error);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('bare init asks language, tool and destination confirmation, with no engineering questionnaire', async () => {
  const result = run(['init'], '2\ncodex\nsí\n');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Language \/ Idioma/);
  assert.match(result.stdout, /Herramienta \[generic\]/);
  assert.match(result.stdout, /\$omni-init/);
  assert.match(result.stdout, /abre esta misma carpeta/);
  assert.doesNotMatch(
    result.stdout,
    /primary technology stack|Preferred Documentation Standard|Quality Gates command|regulatory & architectural/,
  );
  const manifest = await loadManifest(root);
  assert.equal(manifest.agent, 'codex');
  assert.equal(manifest.language, 'es');
  assert.equal(manifest.stack, 'Undecided');
  assert.equal(manifest.qualityGates, '');
  assert.equal(manifest.specs.length, 0);
  assert.match(await readFile(join(root, '.agents/skills/omni-init/SKILL.md'), 'utf8'), /bare command/);
  assert.ok((await readFile(join(root, 'specs/commands/omni-init.md'), 'utf8')).length < 1000);
});

test('invalid language, tool and confirmation are retried rather than silently accepted', async () => {
  const result = run(['init'], 'oops\n2\ncluade\nclaude\nmaybe\nno\n');
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Choose a number/);
  assert.match(result.stdout, /Invalid agent/);
  assert.match(result.stdout, /Escribe sí o no/);
  assert.match(result.stdout, /Cancelado/);
  assert.deepEqual(await readdir(root), []);
});

test('EOF and cancellation leave no installation, and explain the npx/OmniSpec yes distinction', async () => {
  const closed = run(['init']);
  assert.equal(closed.code, 1);
  assert.match(closed.stderr, /npx, not OmniSpec/);
  assert.match(closed.stderr, /init --yes --agent/);
  assert.deepEqual(await readdir(root), []);
  const cancelled = run(['init', '--lang', 'en', '--agent', 'claude'], 'no\n');
  assert.equal(cancelled.code, 0);
  assert.match(cancelled.stdout, /Cancelled/);
  assert.deepEqual(await readdir(root), []);
});

test('unattended init has a generic fallback, without claiming host discovery or application readiness', async () => {
  const result = run(['init', '--yes', '--lang', 'en', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const { installation } = JSON.parse(result.stdout);
  assert.equal(installation.state, 'FILES_READY');
  assert.equal(installation.agentDiscovery, 'NOT_CHECKED');
  assert.equal(installation.projectOnboarding, 'PENDING');
  assert.equal(installation.integrity, 'PASSED');
  assert.equal(installation.version, version);
  assert.equal((await loadManifest(root)).agent, 'generic');
  await accessFallback();
});

async function accessFallback(path = 'specs/commands/omni-init.md', plugin = false) {
  assert.match(await readFile(join(root, path), 'utf8'), plugin ? /installed plugin skill/ : /inspect --json/);
}

for (const agent of [
  'antigravity',
  'cursor',
  'copilot',
  'claude',
  'codex',
  'kilo',
  'opencode',
  'gemini',
  'generic',
  'plugin',
  'all',
  'cursor,claude',
])
  test(`${agent}: installed integration gets versioned handoff and a local recovery prompt`, async () => {
    const result = run(['init', '--yes', '--lang', 'en', '--agent', agent, '--json']);
    assert.equal(result.code, 0, result.stderr);
    const { installation } = JSON.parse(result.stdout);
    assert.ok(installation.nextSteps.length >= 1);
    assert.ok(installation.nextSteps.every(step => step.invocation));
    if (agent === 'all') assert.equal(installation.nextSteps.length, 8);
    if (agent === 'cursor,claude') assert.equal(installation.nextSteps.length, 2);
    await accessFallback(installation.fallback, agent === 'plugin');
  });

test('explicit declarations bypass repeated questions and are preserved in the constitution', async () => {
  const result = run(
    [
      'init',
      '--lang',
      'en',
      '--agent',
      'claude',
      '--name',
      'Loans',
      '--stack',
      'Python',
      '--profile',
      'fintech',
      '--doc',
      'PEP257',
      '--gates',
      'python -m unittest',
    ],
    'yes\n',
  );
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Tool \[generic\]|Language \/ Idioma/);
  const manifest = await loadManifest(root);
  assert.equal(manifest.project, 'Loans');
  assert.equal(manifest.stack, 'Python');
  assert.equal(manifest.profile, 'fintech');
  assert.equal(manifest.qualityGates, 'python -m unittest');
  assert.match(await readFile(join(root, 'CONSTITUTION.md'), 'utf8'), /PEP257/);
});

test('existing scripts are candidates in either mode and are never run by installation', async () => {
  const contents = JSON.stringify({ scripts: { test: "node -e \"require('fs').writeFileSync('EXECUTED','bad')\"" } });
  await writeFile(join(root, 'package.json'), contents);
  const result = run(['init', '--lang', 'es', '--agent', 'cursor'], 's\n');
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await loadManifest(root)).qualityGates, '');
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), contents);
  assert.ok(!(await readdir(root)).includes('EXECUTED'));
  assert.match(await readFile(join(root, 'specs/project-context.md'), 'utf8'), /NOT_RUN/);
});

test('reinitialization preserves configuration, language, authored context and active work', async () => {
  await scaffoldProject(root, {
    agent: 'claude',
    language: 'es',
    profile: 'fintech',
    stack: 'Python',
    docStandard: 'PEP257',
  });
  const spec = await createSpec(root, 'feature', 'loans');
  await writeFile(join(root, 'specs/project-context.md'), '# User-owned context');
  const constitution = await readFile(join(root, 'CONSTITUTION.md'), 'utf8');
  const result = run(['init'], 's\n');
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Herramienta \[generic\]|Language \/ Idioma/);
  assert.match(result.stdout, /retoma la especificación activa/);
  const manifest = await loadManifest(root);
  assert.equal(manifest.active_spec, spec.slug);
  assert.equal(manifest.profile, 'fintech');
  assert.equal(manifest.stack, 'Python');
  assert.equal(await readFile(join(root, 'CONSTITUTION.md'), 'utf8'), constitution);
  assert.equal(await readFile(join(root, 'specs/project-context.md'), 'utf8'), '# User-owned context');
});

test('reinitialization replaces a tracked full fallback with a pointer to the native skill', async () => {
  await scaffoldProject(root, { agent: 'antigravity' });
  const native = await readFile(join(root, '.agents/skills/omni-init/SKILL.md'), 'utf8');
  const fallback = 'specs/commands/omni-init.md';
  // Reproduce the earlier rc.2 installer, which tracked another full copy of this workflow.
  await writeFile(join(root, fallback), native);
  const registry = await loadRegistry(root);
  registry.files[fallback] = { hash: managedHash(native), section: false };
  await saveRegistry(root, registry);
  const result = run(['init', '--yes', '--lang', 'es']);
  assert.equal(result.code, 0, result.stderr);
  const pointer = await readFile(join(root, fallback), 'utf8');
  assert.ok(pointer.length < 1000);
  assert.match(pointer, /\.agents\/skills\/omni-init\/SKILL\.md/);
  assert.equal(await readFile(join(root, '.agents/skills/omni-init/SKILL.md'), 'utf8'), native);
  assert.match(await readFile(join(root, '.agents/agents/omni-auditor.md'), 'utf8'), /subagent: true/);
});

test('reinitialization preserves an edited fallback and reports the conflict', async () => {
  await scaffoldProject(root, { agent: 'antigravity' });
  const path = join(root, 'specs/commands/omni-init.md');
  const edited = (await readFile(path, 'utf8')) + '\nTeam onboarding instructions.\n';
  await writeFile(path, edited);
  const result = run(['init', '--yes']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Local changes preserved.*specs\/commands\/omni-init\.md/);
  assert.equal(await readFile(path, 'utf8'), edited);
});

test('plain and JSON installation keep machine-safe output without ANSI sequences', async () => {
  const plain = run(['init', '--plain', '--lang', 'es', '--agent', 'antigravity'], 's\n');
  assert.equal(plain.code, 0, plain.stderr);
  assert.match(plain.stdout, /SIGUIENTE PASO/);
  assert.match(plain.stdout, /\.agents\/agents\/omni-auditor\.md/);
  assert.ok(!plain.stdout.includes(String.fromCharCode(27)));
  const json = run(['init', '--yes', '--json', '--plain']);
  assert.equal(json.code, 0, json.stderr);
  assert.ok(!json.stdout.includes(String.fromCharCode(27)));
  assert.equal(JSON.parse(json.stdout).installation.integrity, 'PASSED');
});

test('invalid flags and a nested destination fail before any installation writes', async () => {
  for (const flags of [
    ['--lang', 'xx'],
    ['--agent', 'cluade'],
    ['--profile', 'unknown'],
  ]) {
    const result = run(['init', '--yes', ...flags]);
    assert.equal(result.code, 1);
    assert.deepEqual(await readdir(root), []);
  }
  await scaffoldProject(root);
  const nested = join(root, 'child');
  await mkdir(nested);
  assert.equal(run(['init', '--yes'], '', nested).code, 1);
  assert.deepEqual(await readdir(nested), []);
  await assert.rejects(runWizard(homedir(), { yes: true }), /project folder/);
});

test('init does not migrate or downgrade a previously installed version', async () => {
  await scaffoldProject(root);
  const path = join(root, 'specs/manifest.json');
  const manifest = await loadManifest(root);
  for (const other of ['0.6.1', '99.0.0']) {
    await writeFile(path, JSON.stringify({ ...manifest, version: other }));
    const before = await readFile(path, 'utf8');
    const result = run(['init', '--yes']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /update --dry-run/);
    assert.equal(await readFile(path, 'utf8'), before);
  }
});

test('readiness rejects a damaged local runtime instead of claiming successful installation', async () => {
  await scaffoldProject(root);
  await writeFile(join(root, 'specs/.omni/runtime/bin/omni-spec.mjs'), 'damaged');
  await assert.rejects(
    inspectInstallation(root, { agent: 'antigravity', language: 'en' }, version),
    /Installation incomplete/,
  );
});

test('installation checks the package Node minimum before writing', async () => {
  await assert.rejects(assertInstallationRuntime('22.18.0'), /requires Node.js >=22.19.0/);
  await assert.rejects(assertInstallationRuntime('20.19.0'), /requires Node.js/);
  await assertInstallationRuntime('22.19.0');
  await assertInstallationRuntime('24.0.0');
  await assertInstallationRuntime('18.0.0', { bun: '1.2.0' });
  assert.deepEqual(await readdir(root), []);
});
