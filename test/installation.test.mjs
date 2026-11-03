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
  assert.match(result.stdout, /1\. Abre esta carpeta en Codex\./);
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
  const spec = await createSpec(root, 'feature', 'loans', { full: true });
  await writeFile(join(root, 'specs/project-context.md'), '# User-owned context');
  const constitution = await readFile(join(root, 'CONSTITUTION.md'), 'utf8');
  const result = run(['init'], 's\n');
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Herramienta \[generic\]|Language \/ Idioma/);
  assert.match(result.stdout, /3\. Pídele que retome el trabajo pendiente\./);
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
  assert.match(plain.stdout, /Siguiente paso/);
  assert.match(await readFile(join(root, '.agents/agents/omni-auditor.md'), 'utf8'), /omni-auditor/);
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

test('AC-01: the init closing shows numbered steps, the tool name and a fallback, without internal notices', async () => {
  const es = run(['init', '--yes', '--agent', 'antigravity', '--lang', 'es']);
  assert.equal(es.code, 0, es.stderr);
  for (const text of [
    `OmniSpec ${version} está listo en`,
    'Siguiente paso',
    '1. Abre esta carpeta en Antigravity.',
    '2. En el chat escribe:  /omni-init',
    '3. Cuéntale qué quieres construir.',
    '¿No aparece /omni-init? Pega esto en el chat:',
    'Lee .agents/skills/omni-init/SKILL.md y sigue sus instrucciones.',
  ])
    assert.ok(es.stdout.includes(text), text);
  for (const text of ['ESTADO Y ALCANCE', 'Local CLI', 'omni-auditor', 'descubrimiento', 'No se publicó'])
    assert.ok(!es.stdout.includes(text), text);

  const many = run(
    ['init', '--yes', '--agent', 'claude,codex', '--lang', 'en'],
    '',
    await mkdtemp(join(tmpdir(), 'omni-many-')),
  );
  assert.equal(many.code, 0, many.stderr);
  assert.match(many.stdout, /1\. Open this folder in Claude Code or Codex\./);
  assert.match(many.stdout, /2\. In the chat, type: Claude Code → \/omni-init · Codex → \$omni-init/);
  assert.doesNotMatch(many.stdout, /STATUS AND SCOPE|Local CLI/);

  const generic = run(['init', '--yes', '--lang', 'es'], '', await mkdtemp(join(tmpdir(), 'omni-generic-')));
  assert.match(generic.stdout, /1\. Abre esta carpeta en tu herramienta de IA\./);
  assert.match(
    generic.stdout,
    /2\. Pega esto en el chat: Lee specs\/commands\/omni-init\.md y sigue sus instrucciones\./,
  );
  assert.doesNotMatch(generic.stdout, /¿No aparece/);
});

test('AC-02: the JSON report of init keeps discovery, onboarding, steps, fallback and auditor', async () => {
  const result = run(['init', '--yes', '--agent', 'antigravity', '--lang', 'es', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const { installation } = JSON.parse(result.stdout);
  assert.equal(installation.agentDiscovery, 'NOT_CHECKED');
  assert.equal(installation.projectOnboarding, 'PENDING');
  assert.deepEqual(installation.nextSteps, [{ agent: 'antigravity', invocation: '/omni-init' }]);
  assert.equal(installation.fallback, '.agents/skills/omni-init/SKILL.md');
  assert.equal(installation.auditor, '.agents/agents/omni-auditor.md');
});

test('AC-03, AC-04 and AC-05: README and context follow the installer language and the ceremony routes', async () => {
  for (const [language, expected] of [
    [
      'es',
      {
        readme: /Cómo avanza un cambio[\s\S]*\*\*Ligera\*\*[\s\S]*Solo el documento principal/,
        context: /^# Contexto del proyecto/,
      },
    ],
    [
      'en',
      { readme: /How a change moves[\s\S]*\*\*Light\*\*[\s\S]*Primary document only/, context: /^# Project context/ },
    ],
  ]) {
    const dir = await mkdtemp(join(tmpdir(), `omni-lang-${language}-`));
    assert.equal(run(['init', '--yes', '--agent', 'claude', '--lang', language], '', dir).code, 0);
    const readme = await readFile(join(dir, 'specs/README.md'), 'utf8');
    const context = await readFile(join(dir, 'specs/project-context.md'), 'utf8');
    assert.match(readme, expected.readme, language);
    assert.match(readme, /`fit`/, language);
    assert.doesNotMatch(readme, /Spec-Driven Development|specification and plan before implementation/, language);
    assert.match(context, expected.context, language);
    for (const marker of ['CONTEXT_PENDING', 'APPLICATION_NOT_VALIDATED', '<!-- omni:source-conflicts -->'])
      assert.ok(context.includes(marker), `${language}: ${marker}`);
    const check = run(['context-check', '--json'], '', dir);
    assert.equal(JSON.parse(check.stdout).valid, true, `${language}: ${check.stdout}`);
    assert.match(await readFile(join(dir, 'CONSTITUTION.md'), 'utf8'), /^# CONSTITUTION — /, language);
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('spec 028 AC-03: configure sets stack, profile and documentation without init --force', async () => {
  assert.equal(run(['init', '--yes', '--agent', 'claude', '--lang', 'es']).code, 0);
  const before = await readFile(join(root, 'CONSTITUTION.md'), 'utf8');
  const result = run(['configure', '--stack', 'Java 25 + Spring Boot', '--profile', 'fintech', '--doc', 'Javadoc']);
  assert.equal(result.code, 0, result.stderr);
  const manifest = await loadManifest(root);
  assert.equal(manifest.stack, 'Java 25 + Spring Boot');
  assert.equal(manifest.profile, 'fintech');
  assert.equal(manifest.documentationStandard, 'Javadoc');
  const after = await readFile(join(root, 'CONSTITUTION.md'), 'utf8');
  assert.match(after, /^\* \*\*Primary Tech Stack:\*\* `Java 25 \+ Spring Boot`$/m);
  assert.match(after, /^\* \*\*Documentation Standard:\*\* `Javadoc` \(All public APIs/m);
  assert.match(after, /^## 2\. Domain & Regulatory Invariants \(Fintech, Banking & Payments\)$/m);
  assert.match(after, /idempotency/);
  for (const kept of ['## 1. Governance & Code Surgery', '## 4. Delivery Quality Gates', '## 5. UI Ergonomics'])
    assert.ok(after.includes(kept), kept);
  assert.equal(after.split('\n## ').length, before.split('\n## ').length);

  const invalid = run(['configure', '--profile', 'nope']);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /Invalid profile "nope"/);
  assert.equal(await readFile(join(root, 'CONSTITUTION.md'), 'utf8'), after);

  await writeFile(join(root, 'CONSTITUTION.md'), '# Our own rules\n');
  const custom = run(['configure', '--stack', 'Go']);
  assert.equal(custom.code, 1);
  assert.match(custom.stderr, /no recognizable Primary Tech Stack line/);
  assert.equal(await readFile(join(root, 'CONSTITUTION.md'), 'utf8'), '# Our own rules\n');
  assert.equal((await loadManifest(root)).stack, 'Java 25 + Spring Boot');
});

test('spec 028 AC-04: specs/.gitignore ignores the regenerated reference and keeps histories versioned', async () => {
  assert.equal(run(['init', '--yes', '--lang', 'en']).code, 0);
  const ignore = await readFile(join(root, 'specs/.gitignore'), 'utf8');
  assert.match(ignore, /^\.omni\/reference\/$/m);
  assert.doesNotMatch(ignore, /^\.omni\/(context|decision)-history\/$/m);
  assert.match(ignore, /\.omni\/context-history\/ and \.omni\/decision-history\/ stay versioned/);
});

test('spec 029 AC-01 and AC-02: status asks to confirm placeholder configuration only after context is recorded', async () => {
  assert.equal(run(['init', '--yes', '--agent', 'claude', '--lang', 'es']).code, 0);
  const pending = () =>
    JSON.parse(run(['status', '--json']).stdout).progress.warnings.find(item => item.code === 'CONFIGURATION_PENDING');
  assert.equal(pending(), undefined);
  assert.equal(run(['context-record']).code, 0);
  const warning = pending();
  assert.deepEqual(warning.fields, ['stack', 'doc']);
  assert.equal(warning.profile, 'general');
  assert.match(warning.action, /^configure --stack "<confirmed value>" --doc "<confirmed value>"$/);
  assert.match(warning.message, /run configure only after confirmation/);
  assert.match(warning.message, /fintech/);
  assert.equal(run(['configure', '--stack', 'Node.js 24', '--doc', 'JSDoc']).code, 0);
  assert.equal(run(['context-record']).code, 0);
  assert.equal(pending(), undefined);
});

test('spec 029 AC-03: the omni-init closing is written for the person and asks for pending configuration', async () => {
  const { OMNI_SKILLS } = await import('../src/workflows.mjs');
  const { instructions } = OMNI_SKILLS.find(skill => skill.name === 'omni-init');
  for (const text of [
    'Write the final chat reply for the person, in their language and plain words',
    'keep internal labels (CONTEXT_RECORDED, delivery, blockers, session IDs, command logs) in project-context.md',
    'every CONFIGURATION_PENDING field from status',
    'run configure only after they confirm',
    "Do not announce '100% ready'",
  ])
    assert.ok(instructions.includes(text), text);
  assert.ok(!instructions.includes('Return a concise summary: onboarding state'));
});

test('spec 030 AC-01: gateProblems rejects directory changes and ";" chains, and accepts portable lines', async () => {
  const { gateProblems } = await import('../src/checks.mjs');
  assert.equal(gateProblems('cd backend && .\\mvnw.cmd test; cd frontend && npm run build').length, 2);
  assert.match(gateProblems('pushd api && go test ./...')[0], /changes directory/);
  assert.match(gateProblems('npm test; npm run lint')[0], /cmd\.exe/);
  assert.deepEqual(gateProblems('npm test\nnpm run lint\n# cd comment; ignored'), []);
  assert.deepEqual(gateProblems('node -e "console.log(1); console.log(2)"'), []);
  assert.deepEqual(gateProblems('npm run build:cd-docs'), []);
});

test('spec 030 AC-02 and AC-03: configure and init refuse non-portable gates without writing; catalogue overlap warns', async () => {
  const rejected = run(['init', '--yes', '--gates', 'cd app && npm test']);
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /changes directory/);
  assert.deepEqual(await readdir(root), []);

  assert.equal(run(['init', '--yes', '--lang', 'en']).code, 0);
  const constitution = await readFile(join(root, 'CONSTITUTION.md'), 'utf8');
  const broken = run(['configure', '--gates', 'cd backend && npm test; cd web && npm run build']);
  assert.equal(broken.code, 1);
  assert.match(broken.stderr, /changes directory[\s\S]*cmd\.exe/);
  assert.equal(await readFile(join(root, 'CONSTITUTION.md'), 'utf8'), constitution);
  assert.equal((await loadManifest(root)).qualityGates, '');

  await mkdir(join(root, 'web'));
  await writeFile(
    join(root, 'specs/checks.json'),
    JSON.stringify({ schemaVersion: 1, checks: [{ id: 'web-build', command: 'npm run build', cwd: 'web' }] }),
  );
  // Spec 031 AC-01: with a catalogue, gates are refused instead of duplicating checks.
  const before = await readFile(join(root, 'specs/manifest.json'), 'utf8');
  const overlap = run(['configure', '--gates', 'npm test']);
  assert.equal(overlap.code, 1);
  assert.match(
    overlap.stderr,
    /specs\/checks\.json already defines web-build\. Add new checks there with checks --from/,
  );
  assert.equal(await readFile(join(root, 'specs/manifest.json'), 'utf8'), before);
  assert.equal(run(['configure', '--gates', '']).code, 0);
});

test('spec 030 AC-04: omni-init records configuration confirmations and refreshes context afterwards', async () => {
  const { OMNI_SKILLS } = await import('../src/workflows.mjs');
  const { instructions } = OMNI_SKILLS.find(skill => skill.name === 'omni-init');
  for (const text of [
    'Record the confirmation with decision-record',
    'update project-context.md to the configured values before context-record',
    'Register module commands with checks --from and a cwd per module',
  ])
    assert.ok(instructions.includes(text), text);
});

test('BUG-032: --name=value works, so an empty gates value survives shells that drop "" arguments', async () => {
  assert.equal(run(['init', '--yes', '--lang', 'en', '--gates=npm test']).code, 0);
  assert.equal((await loadManifest(root)).qualityGates, 'npm test');
  const dropped = run(['configure', '--gates']);
  assert.equal(dropped.code, 1);
  assert.match(dropped.stderr, /Missing value for --gates\. Use --gates= to clear it/);
  const cleared = run(['configure', '--gates=']);
  assert.equal(cleared.code, 0, cleared.stderr);
  assert.equal((await loadManifest(root)).qualityGates, '');
  assert.match(run(['configure', '--stack=']).stderr, /Empty value for --stack/);
  assert.match(run(['status', '--json=yes']).stderr, /--json does not take a value/);
});
