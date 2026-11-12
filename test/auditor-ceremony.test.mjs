import { test, describe, beforeEach, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { auditSpec } from '../src/auditor.mjs';
import { saveFit, FIT_PRESETS } from '../src/fit.mjs';
import { loadManifest, saveManifest } from '../src/manifest.mjs';
import { verifySpec, completeSpec } from '../src/verification.mjs';
import {
  TASK_ID_PATTERN,
  TASK_STATUSES,
  migrateTasks,
  parseJsonDocument,
  renderTasks,
  tasksFromMarkdown,
  validateTasks,
} from '../src/tasks.mjs';
import { approveGate, gateStatus } from '../src/gates.mjs';
import { fillSpec } from '../test-support/fixtures.mjs';

const schemaDir = fileURLToPath(new URL('../schema/', import.meta.url));
let root;
let home;
before(() => {
  home = mkdtempSync(join(tmpdir(), 'omni-gates-home-'));
  process.env.OMNISPEC_HOME = home;
});
after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omni-ceremony-'));
  await scaffoldProject(root, { qualityGates: '' });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const doc = (...tasks) => ({ schemaVersion: 1, tasks });
const task = (id, status = 'pending', title = `Implement ${id}`) => ({ id, title, status });

async function fullSpec(name = 'typed') {
  const spec = await createSpec(root, 'feature', name, { full: true });
  await fillSpec(root, spec);
  return { spec, dir: join(root, 'specs', spec.slug) };
}

describe('Typed task data (C-07 / T-02)', () => {
  test('AU-01 tasks.json is canonical; tasks.md is ignored when it exists', async () => {
    const { spec, dir } = await fullSpec();
    await writeFile(join(dir, 'tasks.md'), 'nothing here that looks like a checklist\n');
    await writeFile(join(dir, 'tasks.json'), JSON.stringify(doc(task('T-01', 'done'), task('T-02'))));
    const report = await auditSpec(root, spec.id);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.tasks, { total: 2, completed: 1, pending: 1, percentage: 50, source: 'tasks.json' });
  });

  test('AU-02 Markdown style variations do not change the result when tasks.json exists', async () => {
    const { spec, dir } = await fullSpec();
    await writeFile(join(dir, 'tasks.json'), JSON.stringify(doc(task('T-01', 'done'))));
    const results = [];
    for (const style of ['- [x] T-01', '* [X] T-01', '1. [x] T-01', '- [ ] Tarea pendiente en espa\u00f1ol', '']) {
      await writeFile(join(dir, 'tasks.md'), `${style}\n`);
      results.push((await auditSpec(root, spec.id)).tasks);
    }
    assert.ok(results.every(result => JSON.stringify(result) === JSON.stringify(results[0])));
  });

  test('AU-03 invalid task data reports the exact JSON path and code', () => {
    assert.deepEqual(validateTasks(doc(task('T-01'), task('T-01'))), [
      { path: '$.tasks[1].id', code: 'TASK_ID_DUPLICATE', message: 'Task id T-01 is used more than once.' },
    ]);
    assert.deepEqual(
      validateTasks(doc(task('T-01'), task('T-02'), { id: 'T-03', title: 'x', status: 'finished' })).map(issue => [
        issue.path,
        issue.code,
      ]),
      [['$.tasks[2].status', 'TASK_STATUS_INVALID']],
    );
    assert.deepEqual(
      validateTasks(doc({ id: 'T-01', status: 'pending' })).map(issue => [issue.path, issue.code]),
      [['$.tasks[0].title', 'TASK_FIELD_REQUIRED']],
    );
    assert.deepEqual(
      validateTasks({ schemaVersion: 9, tasks: [] }).map(issue => issue.code),
      ['TASKS_SCHEMA_VERSION', 'TASKS_EMPTY'],
    );
    assert.deepEqual(validateTasks(doc(task('T-01'), { ...task('T-02'), extra: 1 }))[0].code, 'TASK_FIELD_UNKNOWN');
  });

  test('AU-03b invalid tasks.json makes the audit fail with the typed issue', async () => {
    const { spec, dir } = await fullSpec();
    await writeFile(join(dir, 'tasks.json'), JSON.stringify(doc({ ...task('T-01'), status: 'finished' })));
    const report = await auditSpec(root, spec.id);
    assert.equal(report.valid, false);
    assert.deepEqual(
      report.issues.map(issue => [issue.path, issue.code]),
      [['tasks.json $.tasks[0].status', 'TASK_STATUS_INVALID']],
    );
  });

  test('AU-04 tasks.md is a deterministic projection that round-trips', () => {
    const data = doc(task('T-01', 'done', 'Write the parser'), task('T-02', 'in_progress', 'Wire it'), task('T-03'));
    const markdown = renderTasks(data);
    assert.equal(renderTasks(data), markdown);
    assert.deepEqual(tasksFromMarkdown(markdown), data);
    assert.equal(renderTasks(tasksFromMarkdown(markdown)), markdown);
    assert.match(markdown, /Generated from tasks\.json/);
  });

  test('AU-04b migrateTasks converts a legacy checklist and writes the projection', async () => {
    const { spec, dir } = await fullSpec();
    await writeFile(join(dir, 'tasks.md'), '# Tasks\n- [x] First step\n- [ ] Second step\n');
    const migrated = await migrateTasks(root, spec.id);
    assert.deepEqual(migrated, doc(task('T-01', 'done', 'First step'), task('T-02', 'pending', 'Second step')));
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'tasks.json'), 'utf8')), migrated);
    assert.equal(await readFile(join(dir, 'tasks.md'), 'utf8'), renderTasks(migrated));
    await assert.rejects(migrateTasks(root, spec.id), /TASKS_ALREADY_MIGRATED/);
  });

  test('AU-05 specs without tasks.json keep the legacy checklist audit', async () => {
    const { spec } = await fullSpec();
    const report = await auditSpec(root, spec.id);
    assert.deepEqual(report.errors, []);
    assert.equal(report.tasks.source, 'tasks.md');
    assert.equal(report.tasks.total, 1);
  });

  test('AU-06 a criterion that names its tests in data is traced without the design heading', async () => {
    const { spec, dir } = await fullSpec();
    await writeFile(join(dir, 'plan.md'), '# Plan\n## API Contracts\nThe greet function.\n## Rollback\nRevert.\n');
    const acceptance = JSON.parse(await readFile(join(dir, 'acceptance.json'), 'utf8'));
    acceptance.criteria[0] = {
      ...acceptance.criteria[0],
      method: 'automated',
      checkIds: ['unit'],
      tests: ['test/greet.test.mjs: greets Ada'],
    };
    await writeFile(join(dir, 'acceptance.json'), JSON.stringify(acceptance));
    assert.deepEqual((await auditSpec(root, spec.id)).errors, []);
  });

  test('AU-07 a Spanish verification heading no longer matters when the binding is data', async () => {
    const { spec, dir } = await fullSpec();
    await writeFile(
      join(dir, 'plan.md'),
      '# Plan\n## Contratos\nLa funci\u00f3n greet.\n## Comprobaci\u00f3n\nVer acceptance.json.\n## Reversi\u00f3n\nRevertir.\n',
    );
    const acceptance = JSON.parse(await readFile(join(dir, 'acceptance.json'), 'utf8'));
    Object.assign(acceptance.criteria[0], { method: 'automated', checkIds: ['unit'], tests: ['test/greet.test.mjs'] });
    await writeFile(join(dir, 'acceptance.json'), JSON.stringify(acceptance));
    assert.deepEqual((await auditSpec(root, spec.id)).errors, []);
  });

  test('AU-08 an automated criterion with no binding at all is a typed ACCEPTANCE_UNBOUND issue', async () => {
    const { spec, dir } = await fullSpec();
    await writeFile(
      join(dir, 'plan.md'),
      '# Plan\n## API Contracts\nx\n## Verification\nNothing.\n## Rollback\nRevert.\n',
    );
    const acceptance = JSON.parse(await readFile(join(dir, 'acceptance.json'), 'utf8'));
    Object.assign(acceptance.criteria[0], { method: 'automated', checkIds: ['unit'] });
    await writeFile(join(dir, 'acceptance.json'), JSON.stringify(acceptance));
    const report = await auditSpec(root, spec.id);
    assert.deepEqual(
      report.issues.map(issue => [issue.path, issue.code]),
      [['acceptance.json $.criteria[0]', 'ACCEPTANCE_UNBOUND']],
    );
    Object.assign(acceptance.criteria[0], { tests: ['', 'x'] });
    await writeFile(join(dir, 'acceptance.json'), JSON.stringify(acceptance));
    assert.deepEqual(
      (await auditSpec(root, spec.id)).issues.map(issue => [issue.path, issue.code]),
      [['acceptance.json $.criteria[0].tests[0]', 'ACCEPTANCE_TESTS_INVALID']],
    );
  });

  test('AU-09 validators and published JSON schemas agree', async () => {
    const tasksSchema = JSON.parse(await readFile(join(schemaDir, 'tasks.schema.json'), 'utf8'));
    const item = tasksSchema.properties.tasks.items;
    assert.deepEqual(item.properties.status.enum, [...TASK_STATUSES]);
    assert.equal(item.properties.id.pattern, TASK_ID_PATTERN.source);
    assert.deepEqual(item.required, ['id', 'title', 'status']);
    assert.equal(item.additionalProperties, false);
    assert.deepEqual(tasksSchema.properties.schemaVersion.enum, [1]);
    const acceptanceSchema = JSON.parse(await readFile(join(schemaDir, 'acceptance.schema.json'), 'utf8'));
    const tests = acceptanceSchema.properties.criteria.items.properties.tests;
    assert.deepEqual(
      { type: tests.type, minItems: tests.minItems, unique: tests.uniqueItems, item: tests.items },
      { type: 'array', minItems: 1, unique: true, item: { type: 'string', minLength: 1 } },
    );
    const corpus = [
      [doc(task('T-01')), true],
      [doc(task('A.b-1', 'done')), true],
      [doc(task('1-bad')), false],
      [doc({ ...task('T-01'), title: '' }), false],
      [{ schemaVersion: 1 }, false],
    ];
    for (const [data, valid] of corpus) assert.equal(validateTasks(data).length === 0, valid, JSON.stringify(data));
  });

  test('AU-10 BOM and CRLF are accepted; comments fail with a line number', () => {
    assert.deepEqual(parseJsonDocument('\ufeff{\r\n  "a": 1\r\n}\r\n', 'tasks.json'), { a: 1 });
    assert.throws(
      () => parseJsonDocument('{\n  "a": 1,\n  // note\n  "b": 2\n}', 'tasks.json'),
      error => error.code === 'JSON_PARSE_ERROR' && error.line === 3 && /tasks\.json:3/.test(error.message),
    );
  });
});

describe('Adaptive ceremony levels (C-07)', () => {
  test('AU-11 create --light writes only the primary artifact, acceptance, fit and evidence', async () => {
    const spec = await createSpec(root, 'feature', 'micro', { light: true });
    const files = (await readdir(join(root, 'specs', spec.slug))).sort();
    assert.deepEqual(files, ['acceptance.json', 'fit.json', 'spec.md', 'verification.md']);
  });

  test('AU-12 the light route audits without plan or tasks', async () => {
    const spec = await createSpec(root, 'feature', 'micro', { light: true });
    await fillSpec(root, spec);
    await rm(join(root, 'specs', spec.slug, 'plan.md'));
    await rm(join(root, 'specs', spec.slug, 'tasks.md'));
    const report = await auditSpec(root, spec.id);
    assert.deepEqual(report.errors, []);
  });

  test('AU-13 the standard route requires a plan but no tasks', async () => {
    const spec = await createSpec(root, 'feature', 'feature', { standard: true });
    await fillSpec(root, spec);
    await rm(join(root, 'specs', spec.slug, 'tasks.md'));
    assert.deepEqual((await auditSpec(root, spec.id)).errors, []);
    await rm(join(root, 'specs', spec.slug, 'plan.md'));
    assert.ok((await auditSpec(root, spec.id)).errors.some(error => /plan\.md/.test(error)));
  });

  test('AU-14 the full route requires a task breakdown (tasks.json or legacy tasks.md)', async () => {
    const { spec, dir } = await fullSpec();
    await rm(join(dir, 'tasks.md'));
    assert.ok((await auditSpec(root, spec.id)).errors.some(error => /tasks/.test(error)));
    await writeFile(join(dir, 'tasks.json'), JSON.stringify(doc(task('T-01', 'done'))));
    assert.deepEqual((await auditSpec(root, spec.id)).errors, []);
  });

  test('AU-15 moving from light to full demands the new artifacts and deletes nothing', async () => {
    const spec = await createSpec(root, 'feature', 'grows', { light: true });
    await fillSpec(root, spec);
    const dir = join(root, 'specs', spec.slug);
    await rm(join(dir, 'plan.md'));
    await rm(join(dir, 'tasks.md'));
    const before = (await readdir(dir)).sort();
    await saveFit(root, spec, FIT_PRESETS.full);
    const errors = (await auditSpec(root, spec.id)).errors;
    assert.ok(errors.some(error => /plan\.md/.test(error)));
    assert.ok(errors.some(error => /tasks/.test(error)));
    assert.deepEqual((await readdir(dir)).sort(), before);
  });
});

describe('Human gates on the full route (C-07 / T-02)', () => {
  async function gated(policy = 'full') {
    const manifest = await loadManifest(root);
    manifest.governance = { humanGates: policy };
    await saveManifest(root, manifest);
    await writeFile(
      join(root, 'specs', 'checks.json'),
      JSON.stringify({ schemaVersion: 1, checks: [{ id: 'unit', command: 'node -e "process.exit(0)"' }] }),
    );
    return fullSpec('gated');
  }

  test('AU-16 verification of a gated full spec needs gate 1', async () => {
    const { spec } = await gated();
    await assert.rejects(verifySpec(root, spec.id), /GATE_1_REQUIRED/);
    assert.deepEqual((await gateStatus(root, spec.id)).gates, { 1: 'missing', 2: 'missing' });
  });

  test('AU-17 gate 1 approval is bound to the plan fingerprint and signed', async () => {
    const { spec, dir } = await gated();
    const approval = await approveGate(root, spec.id, 1, { actor: 'brahian' });
    assert.equal(approval.actor, 'brahian');
    assert.match(approval.fingerprint, /^[a-f0-9]{64}$/);
    assert.match(approval.signature, /^[a-f0-9]{64}$/);
    const stored = JSON.parse(await readFile(join(dir, 'approvals.json'), 'utf8'));
    assert.deepEqual(stored.gates['1'], approval);
    assert.equal((await verifySpec(root, spec.id)).passed, true);
    await assert.rejects(approveGate(root, spec.id, 1, { actor: ' ' }), TypeError);
  });

  test('AU-18 editing the plan after approval makes gate 1 stale', async () => {
    const { spec, dir } = await gated();
    await approveGate(root, spec.id, 1, { actor: 'brahian' });
    await writeFile(join(dir, 'plan.md'), `${await readFile(join(dir, 'plan.md'), 'utf8')}\nScope grew.\n`);
    await assert.rejects(verifySpec(root, spec.id), /GATE_1_STALE/);
    const crlf = (await readFile(join(dir, 'plan.md'), 'utf8')).replace(/\n/g, '\r\n');
    await approveGate(root, spec.id, 1, { actor: 'brahian' });
    await writeFile(join(dir, 'plan.md'), crlf);
    assert.equal((await gateStatus(root, spec.id)).gates[1], 'approved', 'line endings alone do not invalidate');
  });

  test('AU-19 completion of a gated full spec needs gate 2', async () => {
    const { spec } = await gated();
    await approveGate(root, spec.id, 1, { actor: 'brahian' });
    await verifySpec(root, spec.id);
    await assert.rejects(completeSpec(root, spec.id), /GATE_2_REQUIRED/);
    await approveGate(root, spec.id, 2, { actor: 'reviewer' });
    assert.equal((await completeSpec(root, spec.id)).status, 'COMPLETED');
  });

  test('AU-20 gate 2 is bound to the attested verification; a new verify makes it stale', async () => {
    const { spec } = await gated();
    await approveGate(root, spec.id, 1, { actor: 'brahian' });
    await assert.rejects(approveGate(root, spec.id, 2, { actor: 'reviewer' }), /No valid verification record/);
    await verifySpec(root, spec.id);
    await approveGate(root, spec.id, 2, { actor: 'reviewer' });
    await writeFile(join(root, 'source.mjs'), 'export const changed = true;\n');
    await verifySpec(root, spec.id);
    await assert.rejects(completeSpec(root, spec.id), /GATE_2_STALE/);
  });

  test('AU-21 light and standard routes, and projects without the policy, have no gates', async () => {
    const { spec } = await gated('off');
    await verifySpec(root, spec.id);
    assert.equal((await completeSpec(root, spec.id)).status, 'COMPLETED');
    const manifest = await loadManifest(root);
    manifest.governance = { humanGates: 'full' };
    await saveManifest(root, manifest);
    const standard = await createSpec(root, 'feature', 'standard-one', { standard: true });
    await fillSpec(root, standard);
    await verifySpec(root, standard.id);
    assert.equal((await completeSpec(root, standard.id)).status, 'COMPLETED');
  });

  test('AU-22 a hand-edited approval is rejected', async () => {
    const { spec, dir } = await gated();
    await approveGate(root, spec.id, 1, { actor: 'brahian' });
    const stored = JSON.parse(await readFile(join(dir, 'approvals.json'), 'utf8'));
    stored.gates['1'].actor = 'someone-else';
    await writeFile(join(dir, 'approvals.json'), JSON.stringify(stored));
    await assert.rejects(verifySpec(root, spec.id), /GATE_APPROVAL_INVALID/);
    stored.gates['1'] = { ...stored.gates['1'], actor: 'brahian', fingerprint: 'f'.repeat(64) };
    await writeFile(join(dir, 'approvals.json'), JSON.stringify(stored));
    await assert.rejects(verifySpec(root, spec.id), /GATE_APPROVAL_INVALID/);
  });
});
