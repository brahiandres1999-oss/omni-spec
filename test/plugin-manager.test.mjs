import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, stat, readFile, writeFile, readdir, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installPlugin, getPluginStatus, cleanProject } from '../src/plugin-manager.mjs';
import { checkProjectVersion, getCliVersion } from '../src/updater.mjs';
import { loadManifest } from '../src/manifest.mjs';
import { scaffoldProject, createSpec } from '../src/generator.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
// The bundled CLI reads schema/ and LICENSE from its own package root (packageEntries in src/assets.mjs).
const bundleItems = [
  'plugin.json',
  'README.md',
  'package.json',
  'rules',
  'skills',
  'agents',
  'assets',
  'bin',
  'src',
  'schema',
  'companions',
  'LICENSE',
];

function runCli(bin, args, cwd, home) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.ifError(result.error);
  return result;
}

async function assertPackageFiles(dir) {
  const schemas = await readdir(join(packageRoot, 'schema'));
  assert.deepEqual((await readdir(join(dir, 'schema'))).sort(), schemas.sort());
  for (const name of schemas)
    assert.deepEqual(
      await readFile(join(dir, 'schema', name)),
      await readFile(join(packageRoot, 'schema', name)),
      name,
    );
  assert.deepEqual(await readFile(join(dir, 'LICENSE')), await readFile(join(packageRoot, 'LICENSE')), 'LICENSE');
}

describe('OmniSpec Plugin Manager & Project Cleaner', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omnispec-plugin-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {}
    }
  });

  test('installPlugin copies clean plugin bundle without tests or git repository slop', async () => {
    const targetDir = join(tempDir, 'plugins', 'omni-spec');
    const result = await installPlugin({ targetDir });

    assert.equal(result.success, true);
    assert.equal(result.targetDir, targetDir);

    // Verify mandatory plugin elements exist
    await stat(join(targetDir, 'plugin.json'));
    await stat(join(targetDir, 'rules', 'constitution.md'));
    await stat(join(targetDir, 'agents', 'omni-auditor.md'));
    await stat(join(targetDir, 'assets', 'omni-spec-icon.svg'));
    await stat(join(targetDir, 'bin', 'omni-spec.mjs'));
    await stat(join(targetDir, 'src', 'cli.mjs'));

    // Verify slop directories are NOT copied
    let hasTests = false;
    try {
      await stat(join(targetDir, 'test'));
      hasTests = true;
    } catch {}
    assert.equal(hasTests, false, 'test directory must not be deployed in plugin');

    let hasGit = false;
    try {
      await stat(join(targetDir, '.git'));
      hasGit = true;
    } catch {}
    assert.equal(hasGit, false, '.git directory must not be deployed in plugin');
  });

  test('plugin manifest stays inside the published Antigravity schema', async () => {
    const targetDir = join(tempDir, 'plugins', 'omni-spec');
    await installPlugin({ targetDir });
    const manifest = JSON.parse(await readFile(join(targetDir, 'plugin.json'), 'utf8'));
    // The published schema is a closed object: unknown fields make `agy plugin validate --strict` fail.
    assert.deepEqual(Object.keys(manifest).sort(), ['$schema', 'description', 'name']);
    assert.match(manifest.name, /^[a-zA-Z0-9-_]+$/);
    assert.equal(manifest.$schema, 'https://antigravity.google/schemas/v1/plugin.json');
  });

  test('plugin rules carry the frontmatter Antigravity requires or the rule is discarded', async () => {
    const targetDir = join(tempDir, 'plugins', 'omni-spec');
    await installPlugin({ targetDir });
    const rule = await readFile(join(targetDir, 'rules', 'constitution.md'), 'utf8');
    assert.ok(rule.startsWith('---\n'), 'rules need YAML frontmatter on the first line');
    const frontmatter = rule.slice(4, rule.indexOf('\n---', 4));
    assert.match(frontmatter, /trigger: (always_on|model_decision|glob|manual)/);
    assert.match(frontmatter, /description: /);
  });

  test('plugin install reports the Antigravity validator outcome', async () => {
    const targetDir = join(tempDir, 'plugins', 'omni-spec');
    const result = await installPlugin({ targetDir });
    assert.equal(typeof result.validation.ran, 'boolean');
    assert.ok('ok' in result.validation);
    if (!result.validation.ran) assert.match(result.validation.reason, /Antigravity CLI/);
  });

  test('getPluginStatus returns accurate state and detects installed version', async () => {
    const targetDir = join(tempDir, 'plugins', 'omni-spec');
    const statusBefore = await getPluginStatus({ targetDir });
    assert.equal(statusBefore.installed, false);

    await installPlugin({ targetDir });
    const statusAfter = await getPluginStatus({ targetDir });
    assert.equal(statusAfter.installed, true);
    assert.equal(statusAfter.version, await getCliVersion());
    assert.equal(statusAfter.isOutdated, false);
  });

  test('the installed plugin CLI runs init and update with the files it reads from the bundle', async () => {
    const targetDir = join(tempDir, 'plugins', 'omni-spec');
    const home = join(tempDir, 'home');
    const projectDir = join(tempDir, 'project');
    await mkdir(home, { recursive: true });
    await mkdir(projectDir, { recursive: true });
    await installPlugin({ targetDir });
    const bin = join(targetDir, 'bin', 'omni-spec.mjs');

    const init = runCli(
      bin,
      [
        'init',
        '--yes',
        '--agent',
        'plugin',
        '--lang',
        'es',
        '--ui-companion',
        'better',
        '--ui-components',
        'shadcn',
        '--json',
      ],
      projectDir,
      home,
    );
    assert.equal(init.status, 0, init.stderr);
    assert.equal(JSON.parse(init.stdout).installation.integrity, 'PASSED');
    await assertPackageFiles(join(projectDir, 'specs', '.omni', 'runtime'));
    assert.deepEqual((await loadManifest(projectDir)).ui, { companion: 'better', components: 'shadcn' });
    const registry = JSON.parse(await readFile(join(projectDir, 'specs/.omni/managed.json'), 'utf8'));
    const catalog = await readdir(join(packageRoot, 'companions/better'), { recursive: true });
    for (const path of catalog.filter(path => /\.md$|^LICENSE$/.test(path))) {
      const key = `specs/.omni/companions/better/${path.replaceAll('\\', '/')}`;
      assert.ok(registry.files[key], key);
      assert.deepEqual(
        await readFile(join(projectDir, key)),
        await readFile(join(packageRoot, 'companions/better', path)),
        key,
      );
    }
    for (const host of ['.agents', '.claude', '.codex', '.cursor', '.gemini', '.github', '.kilo', '.opencode'])
      await assert.rejects(stat(join(projectDir, host)), { code: 'ENOENT' });
    await assert.rejects(stat(join(projectDir, 'specs/.omni/runtime/companions')), { code: 'ENOENT' });

    const update = runCli(bin, ['update', '--json'], projectDir, home);
    assert.equal(update.status, 0, update.stderr);
    assert.deepEqual(JSON.parse(update.stdout).assets.conflicts, []);
    assert.deepEqual((await loadManifest(projectDir)).ui, { companion: 'better', components: 'shadcn' });
  });

  test('plugin bundle carries the schemas and license its CLI reads', async () => {
    const targetDir = join(tempDir, 'plugins', 'omni-spec');
    const result = await installPlugin({ targetDir });
    assert.deepEqual((await readdir(targetDir)).sort(), [...bundleItems].sort());
    assert.deepEqual(result.copied, bundleItems);
    await assertPackageFiles(targetDir);
  });

  test('plugin install names the item and removes the incomplete plugin when a copy fails', async () => {
    const packageCopy = join(tempDir, 'package');
    const home = join(tempDir, 'home');
    await mkdir(home, { recursive: true });
    for (const item of bundleItems.filter(item => item !== 'assets'))
      await cp(join(packageRoot, item), join(packageCopy, item), { recursive: true });

    const install = runCli(join(packageCopy, 'bin', 'omni-spec.mjs'), ['plugin', 'install', '--json'], tempDir, home);
    assert.equal(install.status, 1, install.stdout);
    const { error } = JSON.parse(install.stderr);
    assert.match(error, /Cannot copy assets into the Antigravity plugin: ENOENT/);
    assert.match(error, /Removed the incomplete plugin at /);
    const targetDir = join(home, '.gemini', 'config', 'plugins', 'omni-spec');
    await assert.rejects(stat(targetDir), { code: 'ENOENT' });
    assert.equal((await getPluginStatus({ targetDir })).installed, false);
  });

  test('cleanProject removes in-repo runtime and .agents while preserving specs', async () => {
    const projectDir = join(tempDir, 'sample-app');
    await mkdir(projectDir, { recursive: true });

    // Bootstrap project with traditional antigravity agent
    await scaffoldProject(projectDir, {
      name: 'SampleApp',
      agent: 'antigravity',
      profile: 'general',
    });

    await createSpec(projectDir, 'feature', 'demo-feature');

    // Confirm legacy elements existed
    await stat(join(projectDir, '.agents', 'skills'));
    await stat(join(projectDir, 'specs', '.omni', 'runtime'));
    await stat(join(projectDir, 'specs', '001-demo-feature', 'spec.md'));

    // Dry run first
    const dryRun = await cleanProject(projectDir, { dryRun: true });
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.specsCount, 1);
    assert.ok(dryRun.toRemove.length >= 2);

    // Verify files still exist after dry run
    await stat(join(projectDir, '.agents', 'skills'));

    // Execute actual clean
    const cleaned = await cleanProject(projectDir);
    assert.equal(cleaned.success, true);
    assert.equal(cleaned.agent, 'plugin');
    assert.equal(cleaned.specsCount, 1);

    // Verify legacy runtime & skills are gone
    let hasSkills = false;
    try {
      await stat(join(projectDir, '.agents', 'skills'));
      hasSkills = true;
    } catch {}
    assert.equal(hasSkills, false, '.agents/skills must be removed');

    let hasRuntime = false;
    try {
      await stat(join(projectDir, 'specs', '.omni', 'runtime'));
      hasRuntime = true;
    } catch {}
    assert.equal(hasRuntime, false, 'specs/.omni/runtime must be removed');

    // Verify specifications are 100% intact
    await stat(join(projectDir, 'specs', '001-demo-feature', 'spec.md'));
    const manifest = await loadManifest(projectDir);
    assert.equal(manifest.agent, 'plugin');
    assert.equal(manifest.specs.length, 1);

    // Verify doctor check passes cleanly without needing .agents
    const check = await checkProjectVersion(projectDir);
    assert.equal(check.healthy, true);
    assert.match(check.message, /Plugin mode active/);
  });

  test('clean blocks on an edited handoff before deleting adapters, and backs it up when accepted', async () => {
    await scaffoldProject(tempDir, { agent: 'antigravity' });
    const path = join(tempDir, 'specs', 'commands', 'omni-init.md');
    const edited = (await readFile(path, 'utf8')) + '\nTeam instructions.\n';
    await writeFile(path, edited);
    await assert.rejects(cleanProject(tempDir), /Locally modified OmniSpec files block clean/);
    assert.equal(await readFile(path, 'utf8'), edited);
    await stat(join(tempDir, '.agents', 'agents', 'omni-auditor.md'));
    await stat(join(tempDir, 'specs', '.omni', 'runtime', 'bin', 'omni-spec.mjs'));
    const result = await cleanProject(tempDir, { acceptUpdates: true });
    assert.equal(result.backups.length, 1);
    assert.equal(await readFile(join(tempDir, result.backups[0]), 'utf8'), edited);
    assert.match(await readFile(path, 'utf8'), /installed plugin skill/);
  });
});
