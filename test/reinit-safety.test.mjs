import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { loadManifest } from '../src/manifest.mjs';

describe('Regression R01: Re-initialization & Non-destructive Safety', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omnispec-reinit-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {}
    }
  });

  test('re-running scaffoldProject preserves customized CONSTITUTION.md and existing specs', async () => {
    const options = { projectName: 'PaymentService', profile: 'fintech', stack: 'Node.js', docStandard: 'TSDoc' };
    await scaffoldProject(tempDir, options);

    // Create a first specification and customize constitution
    const spec1 = await createSpec(tempDir, 'feature', 'payment-gateway');
    const customConstitution = '# CUSTOM CONSTITUTION WITH SPECIAL SECURITY RULES';
    await writeFile(join(tempDir, 'CONSTITUTION.md'), customConstitution, 'utf-8');

    // Customize the spec
    const customSpecContent = '# CUSTOM SPEC PAYMENT GATEWAY\n## 0. Fase de Clarificación y Supuestos\n- Decisión acordada';
    await writeFile(join(spec1.specDir, 'spec.md'), customSpecContent, 'utf-8');

    // Re-run scaffoldProject without force
    await scaffoldProject(tempDir, { ...options, projectName: 'NewName' });

    // Verify manifest preserved the existing spec
    const manifestAfterReinit = await loadManifest(tempDir);
    assert.strictEqual(manifestAfterReinit.specs.length, 1);
    assert.strictEqual(manifestAfterReinit.specs[0].id, '001');
    assert.strictEqual(manifestAfterReinit.specs[0].slug, '001-payment-gateway');

    // Verify CONSTITUTION.md was NOT overwritten
    const constitutionAfterReinit = await readFile(join(tempDir, 'CONSTITUTION.md'), 'utf-8');
    assert.strictEqual(constitutionAfterReinit, customConstitution);

    // Verify custom spec was NOT overwritten
    const specAfterReinit = await readFile(join(spec1.specDir, 'spec.md'), 'utf-8');
    assert.strictEqual(specAfterReinit, customSpecContent);

    // Creating another spec with the same name increments sequence ID safely without collision
    const spec2 = await createSpec(tempDir, 'feature', 'payment-gateway');
    assert.strictEqual(spec2.id, '002');
    assert.strictEqual(spec2.slug, '002-payment-gateway');

    const manifestFinal = await loadManifest(tempDir);
    assert.strictEqual(manifestFinal.specs.length, 2);
    assert.strictEqual(manifestFinal.specs[0].id, '001');
    assert.strictEqual(manifestFinal.specs[1].id, '002');
  });

  test('scaffoldProject with force overwrites CONSTITUTION.md while preserving specs', async () => {
    const options = { projectName: 'PaymentService', profile: 'general' };
    await scaffoldProject(tempDir, options);
    await createSpec(tempDir, 'bugfix', 'critical-bug');

    await writeFile(join(tempDir, 'CONSTITUTION.md'), '# CUSTOM', 'utf-8');

    // Re-run with force
    await scaffoldProject(tempDir, { ...options, force: true });

    const constitution = await readFile(join(tempDir, 'CONSTITUTION.md'), 'utf-8');
    assert.ok(constitution.includes('CONSTITUTION — PaymentService'));

    const manifest = await loadManifest(tempDir);
    assert.strictEqual(manifest.specs.length, 1);
    assert.strictEqual(manifest.specs[0].id, '001');
  });
});
