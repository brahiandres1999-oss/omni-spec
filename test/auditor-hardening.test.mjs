import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { auditSpec } from '../src/auditor.mjs';

describe('Regression R03 & R04: Auditor Hardening against Bypasses and Empty Files', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omnispec-auditor-hardening-'));
  });

  afterEach(async () => {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {}
    }
  });

  test('blocks feature spec when keywords are hidden only inside HTML comments', async () => {
    await scaffoldProject(tempDir, { projectName: 'AuditApp' });
    const spec = await createSpec(tempDir, 'feature', 'empty-bypass');

    // Case 1: Spec has only HTML comments -> rejected as empty
    await writeFile(
      join(spec.specDir, 'spec.md'),
      '<!-- ## 0. Clarification Non-Goals Acceptance Criteria Gherkin -->\n',
      'utf-8',
    );
    await writeFile(join(spec.specDir, 'plan.md'), '<!-- API Contracts Rollback -->\n', 'utf-8');
    await writeFile(join(spec.specDir, 'tasks.md'), '- [x] fake task\n', 'utf-8');

    let report = await auditSpec(tempDir, spec.id);
    assert.strictEqual(report.valid, false, 'HTML comments alone must not satisfy mandatory content');
    assert.ok(report.errors.some(e => e.includes('spec.md is empty')));

    // Case 2: Spec has general content, but Section 0 is only inside an HTML comment
    await writeFile(
      join(spec.specDir, 'spec.md'),
      '# SPEC-001 Title\n<!-- ## 0. Clarification -->\n## 1. Description\nSome description text',
      'utf-8',
    );
    await writeFile(join(spec.specDir, 'plan.md'), '# PLAN\nContracts and Rollback defined.', 'utf-8');

    report = await auditSpec(tempDir, spec.id);
    assert.strictEqual(report.valid, false, 'Commented Section 0 must not pass');
    assert.ok(report.errors.some(e => e.includes('Section 0')));
  });

  test('blocks feature spec when tasks.md has zero checkbox tasks', async () => {
    await scaffoldProject(tempDir, { projectName: 'AuditApp' });
    const spec = await createSpec(tempDir, 'feature', 'no-tasks');

    await writeFile(
      join(spec.specDir, 'spec.md'),
      '# SPEC-001\n## 0. Fase de Clarificación y Supuestos\n- Q: Valid? A: Yes verified.\n## 1. Alcance\nReal content here.\n## 2. Non-Goals\nNone.\n## 3. Criterios de Aceptación Gherkin\nGiven valid When test Then pass',
      'utf-8',
    );
    await writeFile(
      join(spec.specDir, 'plan.md'),
      '# PLAN\nContratos API definidos.\nReversión y Rollback definidos.',
      'utf-8',
    );
    await writeFile(join(spec.specDir, 'tasks.md'), '# TASKS\nNo checkbox tasks here!', 'utf-8');

    const report = await auditSpec(tempDir, spec.id);
    assert.strictEqual(report.valid, false, 'Zero checkbox tasks should be blocked');
    assert.ok(report.errors.some(e => e.includes('tasks.md has no actionable checkbox tasks')));
  });

  test('blocks bugfix, debt, and rfc when mandatory artifacts are empty or directories', async () => {
    await scaffoldProject(tempDir, { projectName: 'AuditApp' });

    // 1. Bugfix with empty files
    const bugSpec = await createSpec(tempDir, 'bugfix', 'crash-fix');
    await writeFile(join(bugSpec.specDir, 'bug.md'), '', 'utf-8');
    await writeFile(join(bugSpec.specDir, 'rca.md'), '', 'utf-8');
    await writeFile(join(bugSpec.specDir, 'fix.md'), '', 'utf-8');

    const bugReport = await auditSpec(tempDir, bugSpec.id);
    assert.strictEqual(bugReport.valid, false);
    assert.ok(bugReport.errors.some(e => e.includes('bug.md is empty')));

    // 2. Tech-debt where an artifact is a directory instead of a regular file
    const debtSpec = await createSpec(tempDir, 'debt', 'remove-legacy');
    await rm(join(debtSpec.specDir, 'audit.md'), { force: true });
    await mkdir(join(debtSpec.specDir, 'audit.md')); // Create directory with filename

    const debtReport = await auditSpec(tempDir, debtSpec.id);
    assert.strictEqual(debtReport.valid, false);
    assert.ok(
      debtReport.errors.some(
        e => e.includes('could not be read as a regular file') || e.includes('not a regular file'),
      ),
    );

    // 3. RFC with empty rfc.md
    const rfcSpec = await createSpec(tempDir, 'rfc', 'database-choice');
    await writeFile(join(rfcSpec.specDir, 'rfc.md'), '', 'utf-8');

    const rfcReport = await auditSpec(tempDir, rfcSpec.id);
    assert.strictEqual(rfcReport.valid, false);
    assert.ok(rfcReport.errors.some(e => e.includes('rfc.md is empty')));
  });
});
