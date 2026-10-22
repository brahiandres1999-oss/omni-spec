import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fillSpec } from '../test-support/fixtures.mjs';
import { seedOnboardingFixture } from '../test-support/onboarding-fixtures.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'omnispec-package-'));
const npm = process.env.npm_execpath;
if (!npm)
  throw new Error('Run via npm run test:package so the current npm CLI can be resolved without shell assumptions.');
function exec(args, cwd, expected = 0) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 120000, windowsHide: true });
  assert.equal(result.status, expected, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
const packageInfo = JSON.parse(
  exec([npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', temporary], source),
)[0];
assert.ok(packageInfo.files.some(f => f.path === 'schema/manifest.schema.json'));
assert.ok(packageInfo.files.some(f => f.path === 'schema/acceptance.schema.json'));
assert.ok(packageInfo.files.some(f => f.path === 'src/workflows.mjs'));
assert.ok(!packageInfo.files.some(f => f.path.startsWith('test/')));
assert.ok(
  !packageInfo.files.some(f => /^(?:biome\.json|package-lock\.json|coverage\/|scripts\/coverage\.mjs)/.test(f.path)),
  'Development and verification tooling must never reach the published package',
);
assert.ok(packageInfo.files.some(f => f.path === 'assets/omni-spec-banner.svg'));
assert.ok(
  !packageInfo.files.some(f => /(?:BASELINE-|VALIDATION-|^artifacts\/|^docs\/releases\/)/.test(f.path)),
  'Exclude internal reports and repository release history from the user package',
);
const tool = join(temporary, 'installed-tool');
await mkdir(tool);
exec(
  [
    npm,
    'install',
    '--prefix',
    tool,
    '--offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    join(temporary, packageInfo.filename),
  ],
  tool,
);
const installed = join(tool, 'node_modules', 'omni-spec', 'bin', 'omni-spec.mjs');
assert.equal(
  exec([npm, 'exec', '--offline', '--no', '--', 'omni-spec', 'version'], tool).trim(),
  `omni-spec v${packageInfo.version}`,
);
assert.equal(
  exec(
    [
      npm,
      'exec',
      '--offline',
      '--yes',
      '--package',
      join(temporary, packageInfo.filename),
      '--',
      'omni-spec',
      'version',
    ],
    temporary,
  ).trim(),
  `omni-spec v${packageInfo.version}`,
);
const globalPrefix = join(temporary, 'global-tool');
exec(
  [
    npm,
    'install',
    '--global',
    '--prefix',
    globalPrefix,
    '--offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    join(temporary, packageInfo.filename),
  ],
  temporary,
);
const globalBin = process.platform === 'win32' ? globalPrefix : join(globalPrefix, 'bin');
const globalResult = spawnSync('omni-spec version', {
  shell: true,
  cwd: temporary,
  encoding: 'utf8',
  timeout: 30000,
  windowsHide: true,
  env: { ...process.env, PATH: `${globalBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}` },
});
assert.equal(globalResult.status, 0, globalResult.stderr);
assert.equal(globalResult.stdout.trim(), `omni-spec v${packageInfo.version}`);

const fresh = join(temporary, 'fresh project');
await mkdir(fresh);
exec([installed, 'init', '--yes', '--agent', 'antigravity'], fresh);
const local = join(fresh, 'specs', '.omni', 'runtime', 'bin', 'omni-spec.mjs');
assert.equal(exec([local, 'version'], fresh).trim(), `omni-spec v${packageInfo.version}`);
assert.equal((await readdir(join(fresh, '.agents', 'skills'))).length, 9);
exec([local, 'check'], fresh);
exec([local, 'configure', '--gates', 'node check.cjs'], fresh);
await writeFile(join(fresh, 'app.cjs'), 'exports.greet = name => "Hello " + name;\n');
await writeFile(
  join(fresh, 'check.cjs'),
  'require("node:assert/strict").equal(require("./app.cjs").greet("Ada"), "Hello Ada");\n',
);
for (const [index, type] of ['feature', 'bugfix', 'debt', 'rfc'].entries()) {
  exec([local, 'create', type, `case-${type}`], fresh);
  const id = String(index + 1).padStart(3, '0');
  exec([local, 'complete', id], fresh, 1);
  await fillSpec(fresh, { slug: `${id}-case-${type}`, type });
  exec([local, 'audit', id], fresh);
  exec([local, 'verify', id], fresh);
  exec([local, 'complete', id], fresh);
}
await mkdir(join(fresh, 'nested'));
const state = JSON.parse(exec([local, 'status', '--json'], join(fresh, 'nested')));
assert.equal(state.specs.length, 4);
assert.ok(state.specs.every(s => s.status === 'COMPLETED'));
exec([local, 'setup-agent', 'not-real'], fresh, 1);
exec([local, 'setup-agent', 'cursor'], fresh);
assert.equal(JSON.parse(exec([local, 'status', '--json'], fresh)).agent, 'cursor');
await writeFile(join(fresh, 'specs', '_templates', '01-feature', 'spec.md'), '# Customized template');
const preview = JSON.parse(exec([local, 'update', '--dry-run', '--json'], fresh, 1));
assert.ok(preview.assets.conflicts.length > 0);
exec([local, 'update'], fresh, 1);
exec([local, 'update', '--accept-updates'], fresh);
exec([local, 'check'], fresh);

const existing = join(temporary, 'existing-broken');
await mkdir(existing);
await writeFile(join(existing, 'package.json'), '{"scripts":{"test":"node check.cjs"}}');
await writeFile(join(existing, 'app.cjs'), 'exports.greet = () => undefined;');
await writeFile(
  join(existing, 'check.cjs'),
  'require("node:assert/strict").equal(require("./app.cjs").greet("Ada"), "Hello Ada");',
);
exec([installed, 'init', '--yes', '--agent', 'antigravity'], existing);
assert.equal(await readFile(join(existing, 'app.cjs'), 'utf8'), 'exports.greet = () => undefined;');
const adopted = join(existing, 'specs', '.omni', 'runtime', 'bin', 'omni-spec.mjs');
exec([adopted, 'create', 'fix', 'greeting'], existing);
await fillSpec(existing, { slug: '001-greeting', type: 'bugfix' });
exec([adopted, 'verify', '001'], existing, 1);
exec([adopted, 'complete', '001'], existing, 1);
await writeFile(join(existing, 'app.cjs'), 'exports.greet = name => "Hello " + name;');
exec([adopted, 'verify', '001'], existing);
exec([adopted, 'complete', '001'], existing);

const unknown = join(temporary, 'unknown-stack');
await mkdir(unknown);
await writeFile(join(unknown, 'main.xyz'), 'Legacy system with no recognized build manifest.');
exec([installed, 'init', '--yes'], unknown);
const manifest = JSON.parse(await readFile(join(unknown, 'specs', 'manifest.json'), 'utf8'));
assert.equal(manifest.qualityGates, '');
assert.match(manifest.stack, /Unknown/);
for (const scenario of ['empty', 'existing', 'broken', 'noncode', 'conflicting', 'conflicting-python']) {
  const root = join(temporary, `onboarding-${scenario}`);
  const original = await seedOnboardingFixture(root, scenario);
  exec([installed, 'init', '--yes', '--agent', 'antigravity'], root);
  const runner = join(root, 'specs/.omni/runtime/bin/omni-spec.mjs');
  const inventory = JSON.parse(exec([runner, 'inspect', '--json'], root));
  assert.equal(inventory.assessment.applicationValidation, 'APPLICATION_NOT_VALIDATED');
  assert.equal(inventory.assessment.projectScriptsExecuted, false);
  const contextPath = join(root, 'specs/project-context.md');
  const context = await readFile(contextPath, 'utf8');
  assert.match(context, /State: CONTEXT_PENDING/);
  const checked = JSON.parse(exec([runner, 'context-check', '--json'], root));
  assert.equal(checked.scope, 'STRUCTURE_AND_LOCAL_LINKS_ONLY');
  assert.equal(checked.semanticReview, 'REQUIRED');
  await writeFile(contextPath, context + '\n[Invalid local citation](file:///C:/Users/someone/README.md)\n');
  exec([runner, 'context-check', '--json'], root, 1);
  await writeFile(contextPath, context);
  assert.match(
    await readFile(join(root, '.agents/skills/omni-init/SKILL.md'), 'utf8'),
    /bare command \/omni-init is sufficient/,
  );
  for (const [path, content] of Object.entries(original))
    assert.equal(await readFile(join(root, path), 'utf8'), content);
  if (['existing', 'conflicting'].includes(scenario))
    assert.ok(!(await readdir(join(root, 'api'))).includes('UNAUTHORIZED_EXECUTION'));
}
console.log(
  JSON.stringify(
    {
      passed: true,
      version: packageInfo.version,
      integrity: packageInfo.integrity,
      package: join(temporary, packageInfo.filename),
      evidenceDirectory: temporary,
      scenarios: [
        'offline package install and npm binary',
        'npm-exec/npx-style execution from tarball',
        'temporary-prefix global command',
        'portable local runtime',
        'nine Antigravity skill files',
        'four archetype lifecycles with criterion evidence',
        'nested resume',
        'invalid/changed adapter',
        'conflict preview and backup update',
        'existing failing project repaired and verified',
        'unknown stack without invented gates',
        'onboarding contract: empty, polyglot, broken, non-code and conflicting declarations',
        'context structural check and nonportable citation rejection',
      ],
      liveAgentChatTested: false,
    },
    null,
    2,
  ),
);
