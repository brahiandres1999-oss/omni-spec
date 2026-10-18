import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auditSpec } from '../src/auditor.mjs';
import { scaffoldProject, createSpec } from '../src/generator.mjs';

describe('Specification Health Auditor (SDD Gate)', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omnispec-audit-test-'));
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

  test('returns error when manifest does not exist', async () => {
    const report = await auditSpec(tempDir);
    assert.strictEqual(report.valid, false);
    assert.match(report.errors[0], /No OmniSpec manifest found/);
  });

  test('returns error when no active spec exists', async () => {
    await scaffoldProject(tempDir, {
      projectName: 'TestApp',
      profile: 'general',
      stack: 'Node.js',
      docStandard: 'JSDoc'
    });

    const report = await auditSpec(tempDir);
    assert.strictEqual(report.valid, false);
    assert.match(report.errors[0], /No active specification found/);
  });

  test('detects placeholder tokens in created spec', async () => {
    await scaffoldProject(tempDir, {
      projectName: 'TestApp',
      profile: 'general',
      stack: 'Node.js',
      docStandard: 'JSDoc'
    });

    await createSpec(tempDir, 'feature', 'user-login');

    const report = await auditSpec(tempDir);
    // Newly created template files contain sample template text
    assert.strictEqual(report.valid, false);
    assert.ok(report.errors.some(e => e.includes('unreplaced placeholder tokens or sample template text')));
  });

  test('validates clean spec and calculates task progress accurately', async () => {
    await scaffoldProject(tempDir, {
      projectName: 'TestApp',
      profile: 'general',
      stack: 'Node.js',
      docStandard: 'JSDoc'
    });

    const spec = await createSpec(tempDir, 'feature', 'user-login');
    const specDir = join(tempDir, 'specs', spec.slug);

    // Overwrite template files with clean, filled-in content without SPEC-XXX
    const cleanSpec = `# SPEC-001: User Login
## 0. Fase de Clarificación y Supuestos
- Q: ¿Se permite OAuth? A: No, solo email/password en V1.
## 1. Visión y Valor de Negocio
Permitir a los usuarios iniciar sesión.
## 2. Non-Goals (Fuera de Alcance)
- 2FA no soportado en esta versión.
## 3. Criterios de Aceptación (Gherkin)
- Given user exists When logs in Then session created.
`;

    const cleanPlan = `# PLAN-001: Architecture & Technical Plan
## 1. Contratos de API
POST /api/v1/auth/login
## 2. Estrategia de Reversión (Rollback)
Revert migrations if needed.
`;

    const cleanTasks = `# TASKS-001: Implementation Checklist
- [x] Create auth controller
- [x] Add JWT signing
- [ ] Add integration tests
- [ ] Add rate limiter
`;

    await writeFile(join(specDir, 'spec.md'), cleanSpec, 'utf-8');
    await writeFile(join(specDir, 'plan.md'), cleanPlan, 'utf-8');
    await writeFile(join(specDir, 'tasks.md'), cleanTasks, 'utf-8');

    const report = await auditSpec(tempDir, '001');

    assert.strictEqual(report.valid, true);
    assert.strictEqual(report.errors.length, 0);
    assert.strictEqual(report.tasks.total, 4);
    assert.strictEqual(report.tasks.completed, 2);
    assert.strictEqual(report.tasks.pending, 2);
    assert.strictEqual(report.tasks.percentage, 50);
  });

  test('detects missing Phase 0 clarification gate as blocker', async () => {
    await scaffoldProject(tempDir, {
      projectName: 'TestApp',
      profile: 'general',
      stack: 'Node.js',
      docStandard: 'JSDoc'
    });

    const spec = await createSpec(tempDir, 'feature', 'payment-gateway');
    const specDir = join(tempDir, 'specs', spec.slug);

    // Spec without Phase 0
    const unclarifiedSpec = `# SPEC-001: Payment Gateway
## 1. Visión
Add Stripe payments.
`;

    await writeFile(join(specDir, 'spec.md'), unclarifiedSpec, 'utf-8');
    await writeFile(join(specDir, 'plan.md'), '# PLAN\nContracts and Rollback included', 'utf-8');
    await writeFile(join(specDir, 'tasks.md'), '# TASKS\n- [ ] Task 1', 'utf-8');

    const report = await auditSpec(tempDir);
    assert.strictEqual(report.valid, false);
    assert.ok(report.errors.some(e => e.includes('Section 0: Clarification & Assumptions')));
  });

  test('audits bugfix archetype and checks 5 Whys RCA', async () => {
    await scaffoldProject(tempDir, {
      projectName: 'TestApp',
      profile: 'general',
      stack: 'Node.js',
      docStandard: 'JSDoc'
    });

    const spec = await createSpec(tempDir, 'bugfix', 'crash-on-null');
    const specDir = join(tempDir, 'specs', spec.slug);

    // Replace bug.md, rca.md, fix.md without BUG-XXX
    await writeFile(join(specDir, 'bug.md'), '# BUG-001: Crash on null user\nError log here', 'utf-8');
    await writeFile(join(specDir, 'rca.md'), '# RCA-001\n5 Whys root cause analysis...', 'utf-8');
    await writeFile(join(specDir, 'fix.md'), '# FIX-001\nRegression test and patch\n- [ ] Reproduce the null input and verify the regression.', 'utf-8');

    const report = await auditSpec(tempDir);
    assert.strictEqual(report.valid, true);
    assert.strictEqual(report.errors.length, 0);
  });
});
