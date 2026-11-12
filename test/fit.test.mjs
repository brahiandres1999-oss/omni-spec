import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  classifyFit,
  validateFitAnswers,
  specRoute,
  FIT_QUESTIONS,
  FIT_SCHEMA_VERSION,
  FIT_PRESETS,
  fitQuestionnaire,
  UNCLASSIFIED_MESSAGE,
} from '../src/fit.mjs';
import { auditSpec } from '../src/auditor.mjs';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { runCli } from '../src/cli.mjs';
import { verifySpec, completeSpec } from '../src/verification.mjs';

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

  test('the current routing heuristic escalates from three files upwards', () => {
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
    assert.match(
      validateFitAnswers({ ...baseAnswers, schemaVersion: 3 }).errors.join(' '),
      /schemaVersion must be 1 or 2/,
    );
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

describe('Spec Fit risk-aware opt-in version 2', () => {
  const lowRisk = { ...baseAnswers, schemaVersion: 2, risk: 'low', uncertainty: 'clear', reversibility: 'easy' };

  test('v1 stays the default while v2 requires all risk answers', () => {
    assert.equal(fitQuestionnaire().schemaVersion, 1);
    assert.equal(fitQuestionnaire(2).questions.length, FIT_QUESTIONS.length + 3);
    assert.equal(validateFitAnswers(lowRisk).valid, true);
    for (const field of ['risk', 'uncertainty', 'reversibility'])
      assert.equal(validateFitAnswers({ ...lowRisk, [field]: undefined }).valid, false);
    assert.equal(validateFitAnswers({ ...baseAnswers, risk: 'low' }).valid, false);
    assert.throws(() => fitQuestionnaire(3), /schemaVersion must be 1 or 2/);
  });

  test('a localized low-risk covered bugfix can be light only with v2', () => {
    assert.equal(classifyFit(baseAnswers, { type: 'bugfix' }).route, 'full');
    assert.equal(classifyFit(lowRisk, { type: 'bugfix' }).route, 'light');
    assert.equal(classifyFit({ ...lowRisk, existingTests: false }, { type: 'bugfix' }).route, 'standard');
  });

  test('one-file security or irreversible changes escalate despite their small size', () => {
    for (const risk of ['high', 'critical']) {
      const result = classifyFit({ ...lowRisk, risk }, { type: 'bugfix' });
      assert.equal(result.route, 'full');
      assert.match(result.reasons.join(' '), new RegExp(`consequence is ${risk}`));
    }
    assert.equal(classifyFit({ ...lowRisk, reversibility: 'difficult' }, { type: 'feature' }).route, 'full');
  });

  test('material uncertainty, ambiguity, contract changes and incomplete reasoning remain explicit blockers', () => {
    for (const change of [
      { uncertainty: 'material' },
      { uncertainty: 'blocked' },
      { ambiguity: 'material' },
      { crossesContract: true },
      { reasoning: 'partial' },
    ])
      assert.equal(classifyFit({ ...lowRisk, ...change }, { type: 'feature' }).route, 'full');
    assert.equal(classifyFit({ ...lowRisk, risk: 'critical' }, { type: 'rfc' }).route, 'decision');
  });

  test('AC-07: size alone escalates a clear low-risk change to standard, naming the size', () => {
    for (const [change, pattern] of [
      [{ files: 3 }, /3 affected files .*size escalates to standard/],
      [{ modules: 2 }, /2 modules .*size escalates to standard/],
      [{ files: 9, modules: 4 }, /size escalates to standard/],
    ])
      for (const type of ['feature', 'bugfix', 'debt']) {
        const result = classifyFit({ ...lowRisk, ...change }, { type });
        assert.equal(result.route, 'standard', JSON.stringify(change));
        assert.match(result.reasons.join(' '), pattern);
      }
  });

  test('AC-08: size never lowers a full route, and size reasons stay visible', () => {
    const result = classifyFit({ ...lowRisk, files: 5, crossesContract: true }, { type: 'feature' });
    assert.equal(result.route, 'full');
    assert.match(result.reasons.join(' '), /public contract/);
    assert.match(result.reasons.join(' '), /5 affected files/);
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
    const spec = await createSpec(tempDir, type, 'small change', { full: true });
    const dir = join(tempDir, 'specs', spec.slug);
    await writeFile(join(dir, type === 'debt' ? 'audit.md' : 'spec.md'), lightSpec, 'utf8');
    return { spec, dir };
  }

  test('the light route audits a feature with its generated optional templates still present', async () => {
    const { spec, dir } = await project();
    await writeFile(join(dir, 'fit.json'), JSON.stringify(baseAnswers, null, 2), 'utf8');
    const route = await specRoute(tempDir, spec);
    assert.equal(route.route, 'light');
    const report = await auditSpec(tempDir, spec.id);
    assert.deepEqual(report.errors, []);
    assert.equal(report.valid, true);
    assert.equal(report.tasks.total, 0);
  });

  test('AC-04: without a fit.json audit asks for classification and reports no missing artifact', async () => {
    for (const type of ['feature', 'bugfix', 'debt']) {
      await rm(tempDir, { recursive: true, force: true });
      await mkdir(tempDir, { recursive: true });
      const { spec, dir } = await project(type);
      await rm(join(dir, 'fit.json'));
      for (const name of ['plan.md', 'tasks.md', 'rca.md', 'fix.md', 'migration-plan.md'])
        await rm(join(dir, name), { force: true });
      const report = await auditSpec(tempDir, spec.id);
      assert.equal(report.valid, false);
      assert.deepEqual(report.errors, [UNCLASSIFIED_MESSAGE]);
      assert.match(report.errors[0], /`fit`/);
      assert.match(report.errors[0], /`fit --preset full`/);
    }
  });

  async function unclassified(type) {
    await scaffoldProject(tempDir, { projectName: 'FitApp', profile: 'general' });
    const spec = await createSpec(tempDir, type, `${type} default`);
    return { spec, files: (await readdir(spec.specDir)).sort() };
  }

  test('AC-01: create without a route writes only the primary artifact and no fit.json', async () => {
    for (const [type, primary] of [
      ['feature', 'spec.md'],
      ['bugfix', 'bug.md'],
      ['debt', 'audit.md'],
    ]) {
      await rm(tempDir, { recursive: true, force: true });
      await mkdir(tempDir, { recursive: true });
      const { spec, files } = await unclassified(type);
      assert.equal(spec.route, null);
      assert.deepEqual(files, ['acceptance.json', primary, 'verification.md'].sort(), type);
    }
  });

  test('AC-01: the create command reports the change as unclassified', async () => {
    await scaffoldProject(tempDir, { projectName: 'FitApp', profile: 'general' });
    const lines = [];
    const original = console.log;
    console.log = value => lines.push(value);
    try {
      assert.equal(await runCli(['create', 'bugfix', 'tiny-fix'], tempDir), 0);
      assert.equal(await runCli(['create', 'rfc', 'some-idea'], tempDir), 0);
    } finally {
      console.log = original;
    }
    assert.match(lines[0], /\[Route: UNCLASSIFIED\]/);
    assert.match(lines[0], /Classify the change with fit/);
    assert.doesNotMatch(lines[1], /UNCLASSIFIED/);
  });

  test('AC-02: an explicit route keeps its preset fit.json and route artifacts', async () => {
    await scaffoldProject(tempDir, { projectName: 'FitApp', profile: 'general' });
    const expected = {
      light: ['acceptance.json', 'fit.json', 'spec.md', 'verification.md'],
      standard: ['acceptance.json', 'fit.json', 'plan.md', 'spec.md', 'verification.md'],
      full: ['acceptance.json', 'fit.json', 'plan.md', 'spec.md', 'tasks.md', 'verification.md'],
    };
    for (const [route, files] of Object.entries(expected)) {
      const spec = await createSpec(tempDir, 'feature', `explicit ${route}`, { [route]: true });
      assert.equal(spec.route, route);
      assert.deepEqual((await readdir(spec.specDir)).sort(), files, route);
      assert.deepEqual(JSON.parse(await readFile(join(spec.specDir, 'fit.json'), 'utf8')), FIT_PRESETS[route]);
    }
  });

  test('AC-05: classifying an unclassified spec as full scaffolds missing documents without overwriting', async () => {
    const { spec } = await unclassified('feature');
    const authored = '# [SPEC-001] Authored\n\nKeep me.\n';
    await writeFile(join(spec.specDir, 'spec.md'), authored, 'utf8');
    const original = console.log;
    console.log = () => {};
    try {
      assert.equal(await runCli(['fit', spec.id, '--preset', 'full'], tempDir), 0);
    } finally {
      console.log = original;
    }
    const files = (await readdir(spec.specDir)).sort();
    assert.ok(files.includes('plan.md') && files.includes('tasks.md'), files.join(','));
    assert.equal(await readFile(join(spec.specDir, 'spec.md'), 'utf8'), authored);
  });

  test('BUG-026: fit reading a hand-written fit.json scaffolds the missing route documents', async () => {
    for (const [type, answers, expected] of [
      ['feature', { files: 6, modules: 2 }, ['plan.md']],
      ['feature', { crossesContract: true }, ['plan.md', 'tasks.md']],
      ['bugfix', { risk: 'high' }, ['fix.md', 'rca.md']],
      ['debt', { files: 4 }, ['migration-plan.md']],
    ]) {
      await rm(tempDir, { recursive: true, force: true });
      await mkdir(tempDir, { recursive: true });
      const { spec } = await unclassified(type);
      const primary = join(spec.specDir, type === 'feature' ? 'spec.md' : type === 'bugfix' ? 'bug.md' : 'audit.md');
      await writeFile(primary, 'Authored.\n', 'utf8');
      await writeFile(join(spec.specDir, 'fit.json'), JSON.stringify({ ...FIT_PRESETS.light, ...answers }), 'utf8');
      const lines = [];
      const original = console.log;
      console.log = value => lines.push(value);
      try {
        assert.equal(await runCli(['fit', spec.id, '--json'], tempDir), 0);
      } finally {
        console.log = original;
      }
      const label = `${type} ${JSON.stringify(answers)}`;
      assert.deepEqual(JSON.parse(lines.join('\n')).scaffolded.sort(), expected, label);
      const files = await readdir(spec.specDir);
      for (const name of expected) assert.ok(files.includes(name), `${label}: ${name}`);
      assert.ok(!files.includes('tasks.md') || expected.includes('tasks.md'), label);
      assert.equal(await readFile(primary, 'utf8'), 'Authored.\n', label);
    }
  });

  test('AC-06: a bugfix bug.md carries root cause, minimal fix and regression verification', async () => {
    const { spec } = await unclassified('bugfix');
    const bug = await readFile(join(spec.specDir, 'bug.md'), 'utf8');
    for (const heading of [
      '## Reproduction and environment',
      '## Root cause and minimal fix',
      '## Regression verification',
    ])
      assert.ok(bug.includes(heading), heading);
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
    await writeFile(join(dir, 'fit.json'), JSON.stringify({ ...baseAnswers, crossesContract: true }), 'utf8');
    const report = await auditSpec(tempDir, spec.id);
    assert.equal(report.valid, false);
    assert.match(report.errors.join(' '), /File plan.md still contains/);
    await writeFile(join(dir, 'plan.md'), planArtifact, 'utf8');
    await writeFile(join(dir, 'tasks.md'), tasksArtifact, 'utf8');
    const ready = await auditSpec(tempDir, spec.id);
    assert.deepEqual(ready.errors, []);
  });

  for (const type of ['feature', 'debt']) {
    for (const route of ['light', 'standard']) {
      test(`${type} ${route}: create, fit, verify and complete without deleting optional templates`, async () => {
        const { spec, dir } = await project(type);
        const design = type === 'feature' ? 'plan.md' : 'migration-plan.md';
        const originalTasks = await readFile(join(dir, 'tasks.md'), 'utf8');
        const originalDesign = await readFile(join(dir, design), 'utf8');
        await writeFile(join(dir, 'fit.json'), JSON.stringify({ ...baseAnswers, existingTests: route === 'light' }));
        if (route === 'standard') {
          const draft = await auditSpec(tempDir, spec.id);
          assert.equal(draft.valid, false);
          assert.match(draft.errors.join(' '), new RegExp(`File ${design} still contains`));
          assert.ok(!draft.errors.some(error => error.includes('tasks.md')));
          await writeFile(join(dir, design), planArtifact);
        }
        await writeFile(
          join(dir, 'acceptance.json'),
          JSON.stringify({
            schemaVersion: 1,
            criteria: [
              {
                id: 'AC-01',
                status: 'passed',
                method: 'manual',
                evidence:
                  'Fixture reviewer checked the requested label; no interaction or browser coverage is claimed.',
              },
            ],
          }),
        );
        await writeFile(
          join(dir, 'verification.md'),
          '# Evidence\nAC-01: fixture reviewer checked the requested label; no browser or integration behavior is claimed.\n',
        );
        const record = await verifySpec(tempDir, spec.id, {
          manual: 'A static label change is manually reviewed in this fixture.',
        });
        assert.equal(record.passed, true);
        assert.equal((await completeSpec(tempDir, spec.id)).status, 'COMPLETED');
        assert.equal(await readFile(join(dir, 'tasks.md'), 'utf8'), originalTasks);
        if (route === 'light') assert.equal(await readFile(join(dir, design), 'utf8'), originalDesign);
      });
    }
  }

  test('promoting light to full requires retained templates to be completed without losing authored notes', async () => {
    const { spec, dir } = await project();
    const notes =
      '# Design notes\nThe existing label contract must remain stable.\n[TODO] complete contracts and rollback.\n';
    await writeFile(join(dir, 'plan.md'), notes);
    await writeFile(join(dir, 'fit.json'), JSON.stringify(baseAnswers));
    const light = await auditSpec(tempDir, spec.id);
    assert.equal(light.valid, true);
    assert.match(light.warnings.join(' '), /not audited/);
    await writeFile(join(dir, 'fit.json'), JSON.stringify({ ...baseAnswers, files: 3 }));
    const full = await auditSpec(tempDir, spec.id);
    assert.equal(full.valid, false);
    assert.match(full.errors.join(' '), /File plan.md still contains/);
    assert.match(full.errors.join(' '), /File tasks.md still contains/);
    assert.equal(await readFile(join(dir, 'plan.md'), 'utf8'), notes);
  });

  test('light does not hide unresolved criteria or placeholders in other authored documents', async () => {
    const { spec, dir } = await project();
    await writeFile(join(dir, 'fit.json'), JSON.stringify(baseAnswers));
    await writeFile(join(dir, 'spec.md'), lightSpec + '\n[NEEDS CLARIFICATION] Who can use the label?\n');
    await writeFile(join(dir, 'decision.md'), '# Decision\n[TODO] resolve the required behavior.\n');
    const report = await auditSpec(tempDir, spec.id);
    assert.equal(report.valid, false);
    assert.match(report.errors.join(' '), /File spec.md still contains/);
    assert.match(report.errors.join(' '), /File decision.md still contains/);
  });

  test('the CLI prints the questionnaire when the change is not classified yet', async () => {
    const { spec, dir } = await project();
    await rm(join(dir, 'fit.json'));
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
    assert.equal(report.schemaVersion, 2);
    assert.equal(report.questions.length, 9);
    assert.deepEqual(
      report.questions.slice(-3).map(question => question.id),
      ['risk', 'uncertainty', 'reversibility'],
    );
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

  test('FIT_PRESETS defines canonical light, standard and full configurations', () => {
    assert.equal(FIT_PRESETS.light.risk, 'low');
    assert.equal(FIT_PRESETS.light.files, 1);
    assert.equal(FIT_PRESETS.standard.existingTests, false);
    // Spec 033: the full preset reaches the full route through the contract answer, not through risk.
    assert.equal(FIT_PRESETS.full.risk, 'low');
    assert.equal(FIT_PRESETS.full.crossesContract, true);
    assert.equal(classifyFit(FIT_PRESETS.full, { type: 'feature' }).route, 'full');
  });

  test('a byte order mark in fit.json does not break the route', async () => {
    const { spec, dir } = await project();
    await writeFile(join(dir, 'fit.json'), '﻿' + JSON.stringify(baseAnswers, null, 2), 'utf8');
    const route = await specRoute(tempDir, spec);
    assert.equal(route.route, 'light');
  });

  test('createSpec with options.light creates only primary artifact and seeds light fit.json', async () => {
    await scaffoldProject(tempDir, { projectName: 'LightApp' });
    const spec = await createSpec(tempDir, 'feature', 'quick-fix', { light: true });
    assert.equal(spec.route, 'light');
    const dir = join(tempDir, 'specs', spec.slug);

    // Primary artifact and fit exist
    await access(join(dir, 'spec.md'));
    await access(join(dir, 'fit.json'));
    await access(join(dir, 'acceptance.json'));
    await access(join(dir, 'verification.md'));

    // Plan and tasks do NOT exist
    await assert.rejects(access(join(dir, 'plan.md')));
    await assert.rejects(access(join(dir, 'tasks.md')));

    const route = await specRoute(tempDir, spec);
    assert.equal(route.route, 'light');
    assert.equal(route.artifacts.plan, false);
    assert.equal(route.artifacts.tasks, false);

    // Complete spec.md so audit passes without warnings
    await writeFile(join(dir, 'spec.md'), lightSpec, 'utf8');
    const audit = await auditSpec(tempDir, spec.id);
    assert.equal(audit.valid, true);
    assert.equal(audit.warnings.length, 0);
  });

  test('CLI create with --light flag initializes light route', async () => {
    await scaffoldProject(tempDir, { projectName: 'CliLightApp' });
    const lines = [];
    const original = console.log;
    console.log = value => lines.push(value);
    try {
      const code = await runCli(['create', 'feature', 'fast-change', '--light', '--json'], tempDir);
      assert.equal(code, 0);
    } finally {
      console.log = original;
    }
    const created = JSON.parse(lines.join('\n'));
    assert.equal(created.route, 'light');
    const dir = join(tempDir, 'specs', created.slug);
    await assert.rejects(access(join(dir, 'plan.md')));
    await assert.rejects(access(join(dir, 'tasks.md')));
  });

  test('CLI fit --preset modifies route and scaffolds missing artifacts on escalation', async () => {
    await scaffoldProject(tempDir, { projectName: 'EscalationApp' });
    const spec = await createSpec(tempDir, 'feature', 'escalating-change', { light: true });
    const dir = join(tempDir, 'specs', spec.slug);
    await assert.rejects(access(join(dir, 'plan.md')));
    await assert.rejects(access(join(dir, 'tasks.md')));

    // Reclassify to full using CLI preset
    const lines = [];
    const original = console.log;
    console.log = value => lines.push(value);
    try {
      const code = await runCli(['fit', spec.id, '--preset', 'full', '--json'], tempDir);
      assert.equal(code, 0);
    } finally {
      console.log = original;
    }

    const report = JSON.parse(lines.join('\n'));
    assert.equal(report.route, 'full');
    assert.deepEqual(report.scaffolded.sort(), ['plan.md', 'tasks.md'].sort());

    // Both artifacts are now present on disk
    await access(join(dir, 'plan.md'));
    await access(join(dir, 'tasks.md'));
  });

  test('CLI fit rejects unknown preset with descriptive error', async () => {
    await scaffoldProject(tempDir, { projectName: 'InvalidPresetApp' });
    const spec = await createSpec(tempDir, 'feature', 'invalid-preset', { full: true });
    const errors = [];
    const original = console.error;
    console.error = value => errors.push(value);
    try {
      const code = await runCli(['fit', spec.id, '--preset', 'unknown'], tempDir);
      assert.equal(code, 1);
      assert.ok(errors.some(e => e.includes('--preset must be light, standard or full')));
    } finally {
      console.error = original;
    }
  });

  test('CLI fit --crosses-contract escalates light preset to full route', async () => {
    await scaffoldProject(tempDir, { projectName: 'ContractEscalationApp' });
    const spec = await createSpec(tempDir, 'feature', 'contract-change', { light: true });
    const lines = [];
    const original = console.log;
    console.log = value => lines.push(value);
    try {
      const code = await runCli(['fit', spec.id, '--preset', 'light', '--crosses-contract', '--json'], tempDir);
      assert.equal(code, 0);
    } finally {
      console.log = original;
    }
    const report = JSON.parse(lines.join('\n'));
    assert.equal(report.route, 'full');
    assert.ok(report.reasons.some(r => r.includes('contract')));
  });

  test('CLI fit reports invalid answers with code 1 instead of crashing', async () => {
    await scaffoldProject(tempDir, { projectName: 'InvalidAnswersApp' });
    const spec = await createSpec(tempDir, 'feature', 'bad-answers', { light: true });
    const lines = [];
    const original = console.log;
    console.log = value => lines.push(value);
    try {
      const code = await runCli(['fit', spec.id, '--preset', 'light', '--files', '0', '--json'], tempDir);
      assert.equal(code, 1);
    } finally {
      console.log = original;
    }
    const report = JSON.parse(lines.join('\n'));
    assert.equal(report.route, 'invalid');
    assert.ok(report.errors.some(e => e.includes('"files" is invalid')));
  });
});
