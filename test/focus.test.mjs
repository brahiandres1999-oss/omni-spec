import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { focusSpec, listSpecs, loadManifest } from '../src/manifest.mjs';
import { runCli } from '../src/cli.mjs';

describe('Specification Focus & List Engine', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omnispec-focus-test-'));
    await scaffoldProject(tempDir, { projectName: 'FocusTestApp', profile: 'general' });
  });

  afterEach(async () => {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // Safe cleanup
      }
    }
  });

  test('focusSpec switches active spec and updates active_archetype atomically', async () => {
    const spec1 = await createSpec(tempDir, 'feature', 'user-login');
    const spec2 = await createSpec(tempDir, 'bugfix', 'session-leak');

    let manifest = await loadManifest(tempDir);
    assert.equal(manifest.active_spec, spec2.slug);
    assert.equal(manifest.active_archetype, 'bugfix');

    // Switch focus back to spec1 by ID
    const focused1 = await focusSpec(tempDir, spec1.id);
    assert.equal(focused1.id, spec1.id);

    manifest = await loadManifest(tempDir);
    assert.equal(manifest.active_spec, spec1.slug);
    assert.equal(manifest.active_archetype, 'feature');

    // Switch focus to spec2 by slug
    const focused2 = await focusSpec(tempDir, spec2.slug);
    assert.equal(focused2.id, spec2.id);

    manifest = await loadManifest(tempDir);
    assert.equal(manifest.active_spec, spec2.slug);
    assert.equal(manifest.active_archetype, 'bugfix');
  });

  test('focusSpec throws an error if identifier does not exist', async () => {
    await assert.rejects(
      focusSpec(tempDir, 'non-existent-999'),
      /Specification with identifier "non-existent-999" not found in manifest/
    );
  });

  test('listSpecs returns all specifications and active marker', async () => {
    await createSpec(tempDir, 'feature', 'feat-alpha');
    await createSpec(tempDir, 'debt', 'clean-imports');

    const result = await listSpecs(tempDir);
    assert.equal(result.project, 'FocusTestApp');
    assert.equal(result.specs.length, 2);
    assert.equal(result.active_spec, '002-clean-imports');
  });

  test('CLI focus and list commands run successfully', async () => {
    await createSpec(tempDir, 'feature', 'cli-feature');
    await createSpec(tempDir, 'bugfix', 'cli-bugfix');

    const originalLog = console.log;
    let output = [];
    console.log = (msg) => output.push(msg);

    try {
      // Test CLI list
      const listExit = await runCli(['list'], tempDir);
      assert.equal(listExit, 0);

      // Test CLI focus
      const focusExit = await runCli(['focus', '001'], tempDir);
      assert.equal(focusExit, 0);
    } finally {
      console.log = originalLog;
    }

    const manifest = await loadManifest(tempDir);
    assert.equal(manifest.active_spec, '001-cli-feature');
  });
});
