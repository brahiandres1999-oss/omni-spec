import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { classifyFit, validateFitAnswers, specRoute, FIT_QUESTIONS, FIT_SCHEMA_VERSION } from '../src/fit.mjs';
import { auditSpec } from '../src/auditor.mjs';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { runCli } from '../src/cli.mjs';

const baseAnswers = {
  schemaVersion: FIT_SCHEMA_VERSION,
  reasoning: 'done',
  files: 1,
  modules: 1,
  crossesContract: false,
  ambiguity: 'none',
  existingTests: true,
};

const lightSpec = `# [SPEC-001] Small copy fix

Date: 2026-10-22

## 0. Fase de Clarificación y Supuestos
The request is a single label change in one module. No API, schema or storage format changes.
The change is covered by existing tests and needs no design artifact.

## 1. Need and scope
Users see a wrong label in the settings panel. Change the label text in one component file.

## 2. Acceptance Criteria and Non-Goals
AC-01: the settings panel shows the corrected label.
Non-Goals: no layout, copy or localization changes beyond the single label.

## 3. Domain applicability
No sensitive data is accessed or processed by this change.

| Control de Seguridad | Applies? | Evidence / decision |
| --- | --- | --- |
| Accede o procesa datos sensibles | No | The change only alters a static label. |

## 4. Experiencia y límites
No interaction state changes; the label is static text.

## 5. Traceability
AC-01 is verified by the existing component test suite.
`;

const planArtifact = `# Plan

## Data Contracts
No API or contract changes. Not applicable.

## Rollback
Revert the single commit.
`;

const tasksArtifact = `# Tasks

- [ ] AC-01 update the label
`;

describe('Spec Fit route selection', () => {
  test('a small, local, unambiguous and covered change takes the light route', () => {
    const route = classifyFit(baseAnswers, { type: 'feature' });
    assert.equal(route.route, 'light');
    assert.equal(route.artifacts.plan, false);
    assert.equal(route.artifacts.tasks, false);
    assert.match(route.reasons.join(' '), /light route is enough/);
  });

  test('planning overhead only pays back from three files upwards', () => {
    assert.equal(classifyFit({ ...baseAnswers, files: 2 }, { type: 'feature' }).route, 'light');
    const full = classifyFit({ ...baseAnswers, files: 3 }, { type: 'feature' });
    assert.equal(full.route, 'full');
    assert.match(full.reasons.join(' '), /three files upwards/);
  });

  test('a change without existing coverage keeps the design but drops the task breakdown', () => {
    const route = classifyFit({ ...baseAnswers, existingTests: false }, { type: 'feature' });
    assert.equal(route.route, 'standard');
    assert.equal(route.artifacts.plan, true);
    assert.equal(route.artifacts.tasks, false);
  });

  test('cross-module work, contract changes, ambiguity and missing reasoning all escalate to full', () => {
    assert.equal(classifyFit({ ...baseAnswers, modules: 2 }, { type: 'feature' }).route, 'full');
    assert.equal(classifyFit({ ...baseAnswers, crossesContract: true }, { type: 'feature' }).route, 'full');
    assert.equal(classifyFit({ ...baseAnswers, ambiguity: 'material' }, { type: 'feature' }).route, 'full');
    assert.equal(classifyFit({ ...baseAnswers, reasoning: 'skipped' }, { type: 'feature' }).route, 'full');
  });

  test('a bugfix keeps the full route and an RFC is a decision', () => {
    assert.equal(classifyFit(baseAnswers, { type: 'bugfix' }).route, 'full');
    assert.equal(classifyFit(baseAnswers, { type: 'rfc' }).route, 'decision');
  });

  test('the route is derived from the answers, never read from the file', () => {
    const tampered = { ...baseAnswers, files: 9, route: 'light' };
    assert.equal(classifyFit(tampered, { type: 'feature' }).route, 'full');
  });
});

describe('Spec Fit answer validation', () => {
  test('every question must be answered with a valid value', () => {
    assert.equal(validateFitAnswers(baseAnswers).valid, true);
    const missing = validateFitAnswers({ ...baseAnswers, ambiguity: undefined });
    assert.equal(missing.valid, false);
    assert.match(missing.errors.join(' '), /missing the answer "ambiguity"/);
  });

  test('invalid values and unknown keys are rejected', () => {
    assert.match(validateFitAnswers({ ...baseAnswers, reasoning: 'maybe' }).errors.join(' '), /"reasoning" is invalid/);
    assert.match(validateFitAnswers({ ...baseAnswers, files: 0 }).errors.join(' '), /"files" is invalid/);
    assert.match(validateFitAnswers({ ...baseAnswers, extra: 1 }).errors.join(' '), /unknown answer "extra"/);
    assert.match(validateFitAnswers({ ...baseAnswers, schemaVersion: 2 }).errors.join(' '), /schemaVersion must be 1/);
  });

  test('the questionnaire covers every validated answer', () => {
    assert.deepEqual(
      FIT_QUESTIONS.map(q => q.id).sort(),
      Object.keys(baseAnswers)
        .filter(k => k !== 'schemaVersion')
        .sort(),
    );
  });
});

describe('Spec Fit in the working project', () => {
  let tempDir;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omnispec-fit-test-'));
  });
  afterEach(async () => {
    if (tempDir)
      try {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // Safe cleanup
      }
  });

  async function project(type = 'feature') {
    await scaffoldProject(tempDir, {
      projectName: 'FitApp',
      profile: 'general',
      stack: 'Node.js',
      docStandard: 'JSDoc',
    });
    const spec = await createSpec(tempDir, type, 'small change');
    const dir = join(tempDir, 'specs', spec.slug);
    await writeFile(join(dir, 'spec.md'), lightSpec, 'utf8');
    // The generator also drops template design and task artifacts. A light change keeps
    // none of them, so remove the untouched templates and let each test add what it needs.
    await rm(join(dir, 'plan.md'), { force: true });
    await rm(join(dir, 'tasks.md'), { force: true });
    return { spec, dir };
  }

  test('the light route lets a feature close without plan.md and tasks.md', async () => {
    const { spec, dir } = await project();
    await writeFile(join(dir, 'fit.json'), JSON.stringify(baseAnswers, null, 2), 'utf8');
    const route = await specRoute(tempDir, spec);
    assert.equal(route.route, 'light');
    const report = await auditSpec(tempDir, spec.id);
    assert.deepEqual(report.errors, []);
    assert.equal(report.valid, true);
    assert.equal(report.tasks.total, 0);
  });

  test('without a fit.json the full route still demands the design and the task breakdown', async () => {
    const { spec } = await project();
    const report = await auditSpec(tempDir, spec.id);
    assert.equal(report.valid, false);
    assert.match(report.errors.join(' '), /Missing mandatory feature artifact: plan.md/);
    assert.match(report.errors.join(' '), /Missing mandatory feature artifact: tasks.md/);
  });

  test('an invalid fit.json is reported instead of silently falling back', async () => {
    const { spec, dir } = await project();
    await writeFile(join(dir, 'fit.json'), JSON.stringify({ ...baseAnswers, files: 0 }), 'utf8');
    const report = await auditSpec(tempDir, spec.id);
    assert.equal(report.valid, false);
    assert.match(report.errors.join(' '), /fit.json is invalid/);
  });

  test('the full route keeps requiring plan.md and tasks.md', async () => {
    const { spec, dir } = await project();
    await writeFile(join(dir, 'fit.json'), JSON.stringify({ ...baseAnswers, files: 5 }), 'utf8');
    const report = await auditSpec(tempDir, spec.id);
    assert.equal(report.valid, false);
    assert.match(report.errors.join(' '), /Missing mandatory feature artifact: plan.md/);
    await writeFile(join(dir, 'plan.md'), planArtifact, 'utf8');
    await writeFile(join(dir, 'tasks.md'), tasksArtifact, 'utf8');
    const ready = await auditSpec(tempDir, spec.id);
    assert.deepEqual(ready.errors, []);
  });

  test('the CLI prints the questionnaire when the change is not classified yet', async () => {
    const { spec } = await project();
    const lines = [];
    const original = console.log;
    console.log = value => lines.push(value);
    try {
      const code = await runCli(['fit', spec.id, '--json'], tempDir);
      assert.equal(code, 0);
    } finally {
      console.log = original;
    }
    const report = JSON.parse(lines.join('\n'));
    assert.equal(report.classified, false);
    assert.equal(report.questions.length, FIT_QUESTIONS.length);
  });

  test('the CLI reports the derived route and its reasons', async () => {
    const { spec, dir } = await project();
    await writeFile(join(dir, 'fit.json'), JSON.stringify(baseAnswers, null, 2), 'utf8');
    const lines = [];
    const original = console.log;
    console.log = value => lines.push(value);
    try {
      const code = await runCli(['fit', spec.id, '--json'], tempDir);
      assert.equal(code, 0);
    } finally {
      console.log = original;
    }
    const report = JSON.parse(lines.join('\n'));
    assert.equal(report.route, 'light');
    assert.equal(report.artifacts.plan, false);
    assert.ok(report.reasons.length);
  });

  test('the recorded answers stay readable and the route is recomputed, not stored', async () => {
    const { dir } = await project();
    await writeFile(join(dir, 'fit.json'), JSON.stringify(baseAnswers, null, 2), 'utf8');
    const stored = JSON.parse(await readFile(join(dir, 'fit.json'), 'utf8'));
    assert.equal(stored.route, undefined);
    assert.equal(stored.files, 1);
  });

  test('a byte order mark in fit.json does not break the route', async () => {
    const { spec, dir } = await project();
    await writeFile(join(dir, 'fit.json'), '﻿' + JSON.stringify(baseAnswers, null, 2), 'utf8');
    const route = await specRoute(tempDir, spec);
    assert.equal(route.route, 'light');
  });
});
