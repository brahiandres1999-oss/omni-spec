import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkProjectVersion, updateProject, getCliVersion } from '../src/updater.mjs';
import { saveManifest } from '../src/manifest.mjs';

describe('OmniSpec Project Updater & Migration Engine', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omnispec-updater-test-'));
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

  test('checkProjectVersion identifies uninitialized directory', async () => {
    const status = await checkProjectVersion(tempDir);
    assert.equal(status.isInstalled, false);
    assert.equal(status.isOutdated, false);
    assert.match(status.message, /not initialized/);
  });

  test('checkProjectVersion flags outdated project version', async () => {
    const manifest = {
      project: 'LegacyApp',
      version: '0.3.1',
      schemaVersion: 1,
      specs: []
    };
    await saveManifest(tempDir, manifest);

    const status = await checkProjectVersion(tempDir);
    assert.equal(status.isInstalled, true);
    assert.equal(status.projectVersion, '0.3.1');
    assert.equal(status.isOutdated, true);
    assert.match(status.message, /update/i);
  });

  test('updateProject dry-run previews changes without modifying manifest', async () => {
    const manifest = {
      project: 'LegacyApp',
      version: '0.3.1',
      schemaVersion: 1,
      specs: [{ id: '001', slug: '001-existing-feature', status: 'IN_PROGRESS' }]
    };
    await saveManifest(tempDir, manifest);

    const result = await updateProject(tempDir, { dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.fromVersion, '0.3.1');
    assert.equal(result.specsCount, 1);

    // Verify manifest version was NOT changed on disk
    const check = await checkProjectVersion(tempDir);
    assert.equal(check.projectVersion, '0.3.1');
  });

  test('updateProject performs non-destructive upgrade preserving specs and constitution', async () => {
    // 1. Setup a v0.3.1 project with custom Constitution and existing spec
    const customConstitution = '# CONSTITUTION — My Custom Business Rules\n\n- Rule 1: Never touch this\n';
    await writeFile(join(tempDir, 'CONSTITUTION.md'), customConstitution, 'utf-8');

    const specDir = join(tempDir, 'specs', '001-user-auth');
    await mkdir(specDir, { recursive: true });
    const originalSpecContent = '# Spec 001 User Auth\n\nCustom detailed content that must be preserved.';
    await writeFile(join(specDir, 'spec.md'), originalSpecContent, 'utf-8');

    const manifest = {
      project: 'MyBrownfieldApp',
      version: '0.3.1',
      schemaVersion: 1,
      profile: 'bpo',
      stack: 'Node.js / JavaScript (ESM)',
      documentationStandard: 'JSDoc',
      qualityGates: 'npm test',
      active_spec: '001-user-auth',
      active_archetype: 'feature',
      specs: [
        {
          id: '001',
          slug: '001-user-auth',
          type: 'feature',
          status: 'IN_PROGRESS',
          title: 'User Auth'
        }
      ]
    };
    await saveManifest(tempDir, manifest);

    // 2. Run updateProject
    const cliVersion = await getCliVersion();
    const updateResult = await updateProject(tempDir);

    assert.equal(updateResult.success, true);
    assert.equal(updateResult.fromVersion, '0.3.1');
    assert.equal(updateResult.toVersion, cliVersion);
    assert.equal(updateResult.specsPreserved, 1);

    // 3. Verify CONSTITUTION.md was 100% preserved
    const constitutionAfter = await readFile(join(tempDir, 'CONSTITUTION.md'), 'utf-8');
    assert.equal(constitutionAfter, customConstitution);

    // 4. Verify existing spec file was 100% preserved
    const specAfter = await readFile(join(specDir, 'spec.md'), 'utf-8');
    assert.equal(specAfter, originalSpecContent);

    // 5. Verify agent skills were installed
    const specifySkill = await readFile(join(tempDir, '.agents', 'skills', 'omni-specify', 'SKILL.md'), 'utf-8');
    assert.match(specifySkill, /omni-specify/);

    // 6. Verify manifest is now synchronized with CLI version
    const checkAfter = await checkProjectVersion(tempDir);
    assert.equal(checkAfter.isOutdated, false);
    assert.equal(checkAfter.projectVersion, cliVersion);
  });
});
