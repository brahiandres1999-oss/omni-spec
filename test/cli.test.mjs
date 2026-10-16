import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../src/cli.mjs';
import { loadManifest } from '../src/manifest.mjs';

describe('OmniSpec CLI', () => {
  let tempDir;
  let origLog;
  let origError;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omnispec-cli-test-'));
    origLog = console.log;
    origError = console.error;
    console.log = () => {};
    console.error = () => {};
  });

  afterEach(async () => {
    if (origLog) console.log = origLog;
    if (origError) console.error = origError;
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // Safe temp dir cleanup
      }
    }
  });

  test('prints help and exits with 0', async () => {
    const code = await runCli(['--help'], tempDir);
    assert.equal(code, 0);
  });

  test('prints version and exits with 0', async () => {
    const code = await runCli(['--version'], tempDir);
    assert.equal(code, 0);
  });

  test('runs init with --yes and flags non-interactively', async () => {
    const code = await runCli(
      ['init', '--yes', '--name', 'HealthApp', '--profile', 'healthtech', '--stack', 'TypeScript / PostgreSQL', '--doc', 'TSDoc'],
      tempDir
    );

    assert.equal(code, 0);

    const constitution = await readFile(join(tempDir, 'CONSTITUTION.md'), 'utf-8');
    assert.match(constitution, /HealthApp/);
    assert.match(constitution, /HIPAA/);
    assert.match(constitution, /TSDoc/);

    const manifest = await loadManifest(tempDir);
    assert.equal(manifest.project, 'HealthApp');
    assert.equal(manifest.profile, 'healthtech');
    assert.equal(manifest.documentationStandard, 'TSDoc');
  });

  test('full end-to-end workflow: init -> create -> status -> complete', async () => {
    // 1. Init
    let code = await runCli(['init', '--yes', '--name', 'FullFlowApp'], tempDir);
    assert.equal(code, 0);

    // 2. Create Feature
    code = await runCli(['create', 'feature', 'user-profile'], tempDir);
    assert.equal(code, 0);

    // 3. Status check
    code = await runCli(['status'], tempDir);
    assert.equal(code, 0);

    let manifest = await loadManifest(tempDir);
    assert.equal(manifest.active_spec, '001-user-profile');
    assert.equal(manifest.specs[0].status, 'IN_PROGRESS');

    // 4. Complete Spec
    code = await runCli(['complete', '001'], tempDir);
    assert.equal(code, 0);

    manifest = await loadManifest(tempDir);
    assert.equal(manifest.active_spec, null);
    assert.equal(manifest.specs[0].status, 'COMPLETED');

    // 5. Status check after completion
    code = await runCli(['status'], tempDir);
    assert.equal(code, 0);
  });

  test('handles invalid commands gracefully', async () => {
    const code = await runCli(['nonexistent-command'], tempDir);
    assert.equal(code, 1);
  });

  test('handles missing arguments for create', async () => {
    const code = await runCli(['create'], tempDir);
    assert.equal(code, 1);
  });

  test('handles missing arguments for complete', async () => {
    const code = await runCli(['complete'], tempDir);
    assert.equal(code, 1);
  });
});
