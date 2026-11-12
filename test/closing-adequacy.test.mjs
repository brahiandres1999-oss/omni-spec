import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { auditSpec } from '../src/auditor.mjs';
import { projectStatus, recordContext } from '../src/project-state.mjs';
import { verifySpec } from '../src/verification.mjs';
import { runCli } from '../src/cli.mjs';
import { fillSpec } from '../test-support/fixtures.mjs';
import { FIT_PRESETS } from '../src/fit.mjs';
import { OMNI_SKILLS } from '../src/workflows.mjs';

let root;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omni-closing-'));
  await scaffoldProject(root, { qualityGates: 'node -e "process.exit(0)"' });
  await recordContext(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function automatedSpec(risk, extra = {}) {
  const spec = await createSpec(root, 'feature', `transfers ${risk}`, { full: true });
  await fillSpec(root, spec);
  await writeFile(join(spec.specDir, 'fit.json'), JSON.stringify({ ...FIT_PRESETS.full, risk }));
  await writeFile(
    join(spec.specDir, 'acceptance.json'),
    JSON.stringify({
      schemaVersion: 2,
      criteria: [
        {
          id: 'AC-01',
          kind: 'functional',
          status: 'passed',
          method: 'automated',
          checkIds: ['gate-1'],
          evidence: 'check.cjs asserts the greeting for Ada and the gate runs it.',
          ...extra,
        },
      ],
    }),
  );
  return spec;
}

test('AC-01: a high-risk automated criterion cannot be verified without "exercises"', async () => {
  const spec = await automatedSpec('high');
  await assert.rejects(verifySpec(root, spec.id), /AC-01 is automated in a high-risk change: record in "exercises"/);
});

test('AC-01: a low-risk criterion needs no extra field, and empty fields are rejected', async () => {
  const low = await automatedSpec('low');
  const verified = await verifySpec(root, low.id);
  assert.equal(verified.passed, true);
  await rm(join(root, 'specs', low.slug), { recursive: true });
  const empty = await automatedSpec('low', { limits: '  ' });
  await assert.rejects(verifySpec(root, empty.id), /"limits" of AC-01 must be a non-empty text or be omitted/);
});

test('AC-02: declared limits survive verify and complete and are reported as passed with limits', async () => {
  const spec = await automatedSpec('critical', {
    exercises: 'Two threads call the service against a mocked repository guarded by a ReentrantLock.',
    limits: 'The mock does not prove PostgreSQL row locking.',
  });
  const warning = (await projectStatus(root)).progress.warnings.find(item => item.code === 'CRITERIA_WITH_LIMITS');
  assert.deepEqual(warning.criteria, [{ id: 'AC-01', limits: 'The mock does not prove PostgreSQL row locking.' }]);
  const lines = [];
  const original = console.log;
  console.log = value => lines.push(value);
  try {
    assert.equal(await runCli(['verify', spec.id], root), 0);
    assert.equal(await runCli(['complete', spec.id], root), 0);
  } finally {
    console.log = original;
  }
  const output = lines.join('\n');
  assert.match(output, /AC-01: PASSED WITH LIMITS/);
  assert.match(output, /\[LIMITS\] AC-01: The mock does not prove PostgreSQL row locking\./);
  const manifest = JSON.parse(await readFile(join(root, 'specs/manifest.json'), 'utf8'));
  const closed = manifest.specs.find(item => item.id === spec.id).verification.acceptance.criteria[0];
  assert.equal(closed.limits, 'The mock does not prove PostgreSQL row locking.');
  assert.match(closed.exercises, /ReentrantLock/);
});

test('AC-03: a test planned in the Verification section must appear in tasks.md', async () => {
  const spec = await createSpec(root, 'feature', 'planned tests', { full: true });
  await fillSpec(root, spec);
  await writeFile(join(spec.specDir, 'fit.json'), JSON.stringify(FIT_PRESETS.full));
  await writeFile(
    join(spec.specDir, 'plan.md'),
    '# Plan\n## API Contracts\nThe transfer endpoint keeps its contract.\n## Verification\n- AC-01: `TransferServiceTest.concurrentTransfersPreventOverdraft` and `shouldRollBack`; helper `formatAmount` is not a test.\n## Rollback\nRevert.\n',
  );
  await writeFile(join(spec.specDir, 'tasks.md'), '- [x] AC-01: write shouldRollBack in TransferServiceTest.\n');
  const errors = (await auditSpec(root, spec.id)).errors;
  assert.deepEqual(errors, [
    'TransferServiceTest.concurrentTransfersPreventOverdraft is planned in the Verification section of plan.md but no task in tasks.md writes or runs it.',
  ]);
  await writeFile(
    join(spec.specDir, 'tasks.md'),
    '- [x] AC-01: write shouldRollBack and concurrentTransfersPreventOverdraft in TransferServiceTest.\n',
  );
  assert.deepEqual((await auditSpec(root, spec.id)).errors, []);
});

test('AC-04: audit and converge ask for a fresh session and for exercises and limits', async () => {
  const audit = OMNI_SKILLS.find(skill => skill.name === 'omni-audit').instructions;
  const converge = OMNI_SKILLS.find(skill => skill.name === 'omni-converge').instructions;
  assert.ok(audit.includes('Prefer a fresh session; say if this session wrote the spec.'));
  for (const text of [
    'preferably in a fresh session; say so if this session wrote the code',
    'record in acceptance.json "exercises"',
    'report criteria with limits to the user, never as a plain pass',
  ])
    assert.ok(converge.includes(text), text);
  const guide = await readFile(new URL('../src/resources/evidence.md', import.meta.url), 'utf8');
  assert.match(guide, /`exercises`: qué ejecuta de verdad la prueba/);
});
