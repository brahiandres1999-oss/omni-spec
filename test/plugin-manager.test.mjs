import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installPlugin, updatePlugin, getPluginStatus, cleanProject } from '../src/plugin-manager.mjs';
import { checkProjectVersion, getCliVersion } from '../src/updater.mjs';
import { saveManifest, loadManifest } from '../src/manifest.mjs';
import { scaffoldProject, createSpec } from '../src/generator.mjs';

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
    await stat(join(targetDir, 'rules', 'AGENTS.md'));
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

  test('cleanProject removes in-repo runtime and .agents while preserving specs', async () => {
    const projectDir = join(tempDir, 'sample-app');
    await mkdir(projectDir, { recursive: true });

    // Bootstrap project with traditional antigravity agent
    await scaffoldProject(projectDir, {
      name: 'SampleApp',
      agent: 'antigravity',
      profile: 'general'
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
});
