import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runWizard } from '../src/wizard.mjs';
import { scaffoldProject, createSpec } from '../src/generator.mjs';

describe('Regression R07, R09 & R10: Wizard Configuration & Profile Security Questions Injection', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omnispec-wizard-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {}
    }
  });

  test('runWizard rejects unknown profile with descriptive error', async () => {
    await assert.rejects(async () => {
      await runWizard(tempDir, { profile: 'invalid-profile', yes: true });
    }, /Invalid profile "invalid-profile"/);
  });

  test('runWizard records explicit Python stack without inventing installed test tools', async () => {
    const config = await runWizard(tempDir, {
      yes: true,
      stack: 'Python',
      profile: 'general',
    });

    assert.strictEqual(config.profile, 'general');
    assert.ok(config.stack.includes('Python'));
    assert.equal(config.qualityGates, '');
  });

  test('createSpec in general profile injects universal security, data and state invariants into spec.md', async () => {
    await scaffoldProject(tempDir, {
      projectName: 'CoreServiceApp',
      profile: 'general',
      stack: 'Python',
    });

    const spec = await createSpec(tempDir, 'feature', 'fund-transfer', { full: true });
    const specContent = await readFile(join(spec.specDir, 'spec.md'), 'utf-8');

    // Verify universal security & state questions are injected in Section 3
    assert.ok(
      specContent.includes('Does it touch sensitive personal data (PII) or secrets?'),
      'General spec must include PII/secrets question in Section 3',
    );
    assert.ok(
      specContent.includes('Does it mutate critical state, balances, or external contracts?'),
      'General spec must include critical state/idempotency question in Section 3',
    );
  });
});
