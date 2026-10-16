import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { loadManifest } from '../src/manifest.mjs';

describe('Regression R02 & R13: Concurrency & Lock Integrity', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omnispec-concurrency-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {}
    }
  });

  test('concurrent createSpec calls allocate unique IDs and do not corrupt manifest.json', async () => {
    await scaffoldProject(tempDir, { projectName: 'ConcurrentApp', profile: 'general' });

    const totalSpecs = 8;
    const promises = Array.from({ length: totalSpecs }, (_, i) =>
      createSpec(tempDir, 'feature', `parallel-task-${i}`)
    );

    const results = await Promise.all(promises);

    // Verify all 8 succeeded
    assert.strictEqual(results.length, totalSpecs);

    // Verify all IDs are unique
    const ids = results.map(r => r.id);
    const uniqueIds = new Set(ids);
    assert.strictEqual(uniqueIds.size, totalSpecs, `Expected ${totalSpecs} unique IDs, got: ${ids.join(', ')}`);

    // Verify manifest has all 8 entries and parses cleanly
    const manifest = await loadManifest(tempDir);
    assert.ok(manifest, 'Manifest must be valid JSON');
    assert.strictEqual(manifest.specs.length, totalSpecs);

    const manifestIds = manifest.specs.map(s => s.id);
    const uniqueManifestIds = new Set(manifestIds);
    assert.strictEqual(uniqueManifestIds.size, totalSpecs);

    // Verify directories created on disk match manifest count
    const specDirs = (await readdir(join(tempDir, 'specs'))).filter(d => /^\d{3}-/.test(d));
    assert.strictEqual(specDirs.length, totalSpecs);
  });
});
