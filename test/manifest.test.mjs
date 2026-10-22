import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fillSpec } from '../test-support/fixtures.mjs';
import { verifySpec } from '../src/verification.mjs';
import { initManifest, loadManifest, addSpec, updateSpecStatus, getActiveSpec } from '../src/manifest.mjs';

describe('Manifest State Machine', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omnispec-manifest-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // Safe temp dir cleanup
      }
    }
  });

  test('initManifest creates a valid initial manifest file', async () => {
    const manifest = await initManifest(tempDir, {
      projectName: 'TestApp',
      profile: 'fintech',
      techStack: 'Node / Express',
      documentationStandard: 'JSDoc',
    });

    assert.equal(manifest.project, 'TestApp');
    assert.equal(manifest.profile, 'fintech');
    assert.equal(manifest.stack, 'Node / Express');
    assert.equal(manifest.documentationStandard, 'JSDoc');
    assert.equal(manifest.active_spec, null);
    assert.deepEqual(manifest.specs, []);

    const loaded = await loadManifest(tempDir);
    assert.deepEqual(loaded, manifest);
  });

  test('loadManifest returns null if file does not exist', async () => {
    const loaded = await loadManifest(tempDir);
    assert.equal(loaded, null);
  });

  test('addSpec registers a new spec and sets it as active', async () => {
    await initManifest(tempDir, { projectName: 'TestApp', profile: 'general' });

    const spec = await addSpec(tempDir, {
      id: '001',
      slug: '001-user-auth',
      title: 'User Authentication',
      type: 'feature',
      branch: 'spec/001-user-auth',
      files: ['spec.md', 'plan.md', 'tasks.md'],
    });

    assert.equal(spec.id, '001');
    assert.equal(spec.status, 'IN_PROGRESS');

    const manifest = await loadManifest(tempDir);
    assert.equal(manifest.active_spec, '001-user-auth');
    assert.equal(manifest.specs.length, 1);
    assert.equal(manifest.specs[0].id, '001');

    const active = await getActiveSpec(tempDir);
    assert.ok(active);
    assert.equal(active.id, '001');
  });

  test('updateSpecStatus updates state and clears active_spec when completed', async () => {
    await initManifest(tempDir, { projectName: 'TestApp' });
    await addSpec(tempDir, {
      id: '001',
      slug: '001-fix-login',
      title: 'Fix Login',
      type: 'bugfix',
      branch: 'spec/001-fix-login',
      files: ['bug.md', 'rca.md', 'fix.md'],
    });

    await assert.rejects(updateSpecStatus(tempDir, '001', 'COMPLETED'), /Cannot verify\/complete/);
    await fillSpec(tempDir, { slug: '001-fix-login', type: 'bugfix' });
    await verifySpec(tempDir, '001', { manual: 'Reviewed the fixture greeting contract with explicit evidence.' });
    const updated = await updateSpecStatus(tempDir, '001', 'COMPLETED');
    assert.equal(updated.status, 'COMPLETED');
    assert.ok(updated.completed_at);

    const manifest = await loadManifest(tempDir);
    assert.equal(manifest.active_spec, null);
    assert.equal(manifest.specs[0].status, 'COMPLETED');

    const active = await getActiveSpec(tempDir);
    assert.equal(active, null);
  });

  test('updateSpecStatus throws if spec is not found', async () => {
    await initManifest(tempDir, { projectName: 'TestApp' });
    await assert.rejects(async () => {
      await updateSpecStatus(tempDir, '999', 'COMPLETED');
    }, /not found/i);
  });
});
