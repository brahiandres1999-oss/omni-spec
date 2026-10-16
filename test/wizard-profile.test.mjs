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
    await assert.rejects(
      async () => {
        await runWizard(tempDir, { profile: 'invalid-profile', yes: true });
      },
      /Invalid profile "invalid-profile"/
    );
  });

  test('runWizard in --yes mode maps Python stack to Python quality gates', async () => {
    const config = await runWizard(tempDir, {
      yes: true,
      stack: 'Python',
      profile: 'fintech'
    });

    assert.strictEqual(config.profile, 'fintech');
    assert.ok(config.stack.includes('Python'));
    assert.ok(config.qualityGates.includes('pytest'));
    assert.ok(config.qualityGates.includes('ruff'));
  });

  test('createSpec in fintech profile injects specialized financial invariants into spec.md', async () => {
    await scaffoldProject(tempDir, {
      projectName: 'FintechApp',
      profile: 'fintech',
      stack: 'Python'
    });

    const spec = await createSpec(tempDir, 'feature', 'fund-transfer');
    const specContent = await readFile(join(spec.specDir, 'spec.md'), 'utf-8');

    // Verify specialized fintech questions are injected in Section 3
    assert.ok(
      specContent.includes('Does it touch balances, money, or ledger?'),
      'Fintech spec must include balance/ledger question in Section 3'
    );
    assert.ok(
      specContent.includes('Double-entry ledger transaction with `Idempotency-Key`'),
      'Fintech spec must include double-entry ledger enforcement'
    );
  });
});
