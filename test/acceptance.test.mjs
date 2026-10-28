import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { verifySpec, completeSpec } from '../src/verification.mjs';
import { fillSpec } from '../test-support/fixtures.mjs';
import { runCli } from '../src/cli.mjs';
import { loadManifest } from '../src/manifest.mjs';
let root, spec;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omni-acceptance-'));
  await scaffoldProject(root, { qualityGates: 'node -e "process.exit(0)"' });
  spec = await createSpec(root, 'feature', 'ui');
  await fillSpec(root, spec);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
async function change(edit, target = spec) {
  const path = join(target.specDir, 'acceptance.json');
  const report = JSON.parse(await readFile(path, 'utf8'));
  edit(report);
  await writeFile(path, JSON.stringify(report));
}
async function filledSpec(type) {
  const created = { ...(await createSpec(root, type, `${type}-case`)), type };
  await fillSpec(root, created);
  return created;
}
async function rfcWithCriterion() {
  const rfc = await filledSpec('rfc');
  await appendFile(join(rfc.specDir, 'rfc.md'), '\nAC-01 [decision]: the local greeting stays the default.\n');
  await change(r => {
    r.schemaVersion = 2;
    r.criteria[0].kind = 'decision';
    r.criteria.push({ ...r.criteria[0], id: 'AC-01' });
  }, rfc);
  return rfc;
}

test('automated evidence without an executed-check mapping requires migration', async () => {
  await change(r => {
    r.criteria[0].method = 'automated';
  });
  await assert.rejects(verifySpec(root, spec.id), /requires unique checkCommands/);
});

test('evidence commands cannot introduce an unconfigured executable gate', async () => {
  await change(r => {
    r.criteria[0].method = 'automated';
    r.criteria[0].checkCommands = ['node unapproved.cjs'];
  });
  await assert.rejects(verifySpec(root, spec.id), /unconfigured check/);
});

test('automated criteria bind to current successful results and completion rechecks those results', async () => {
  await change(r => {
    r.criteria[0].method = 'automated';
    r.criteria[0].checkCommands = ['node -e "process.exit(0)"'];
  });
  const record = await verifySpec(root, spec.id);
  assert.equal(record.acceptance.criteria[0].execution, 'PASSED');
  assert.equal(record.results[0].cwd, root);
  assert.ok(record.results[0].startedAt);
  record.results = [];
  await writeFile(join(spec.specDir, 'verification.json'), JSON.stringify(record));
  await assert.rejects(completeSpec(root, spec.id), /checks did not pass/);
});

test('failed checks and skipped later checks never satisfy automated criteria', async () => {
  const manifest = await loadManifest(root);
  manifest.qualityGates = 'node -e "process.exit(2)"\nnode -e "process.exit(0)"';
  await writeFile(join(root, 'specs/manifest.json'), JSON.stringify(manifest));
  await change(r => {
    r.criteria[0].method = 'automated';
    r.criteria[0].checkCommands = manifest.qualityGates.split('\n');
  });
  const record = await verifySpec(root, spec.id);
  assert.equal(record.passed, false);
  assert.deepEqual(
    record.acceptance.criteria[0].checks.map(check => check.status),
    ['FAILED', 'NOT_RUN'],
  );
  await assert.rejects(completeSpec(root, spec.id), /did not pass/);
});

test('old verification records require a fresh run instead of inferred bindings', async () => {
  const record = await verifySpec(root, spec.id);
  record.version = 1;
  await writeFile(join(spec.specDir, 'verification.json'), JSON.stringify(record));
  await assert.rejects(completeSpec(root, spec.id), /Run verify again/);
});
test('passing gates cannot close a pending UI acceptance criterion', async () => {
  await appendFile(join(spec.specDir, 'spec.md'), '\nAC-02: keyboard interaction works for both roles.\n');
  await change(r =>
    r.criteria.push({
      id: 'AC-02',
      status: 'pending',
      method: 'manual',
      evidence: 'No interaction has been exercised yet.',
    }),
  );
  await assert.rejects(verifySpec(root, spec.id), /AC-02 remains pending/);
  await assert.rejects(completeSpec(root, spec.id), /AC-02 remains pending/);
});
test('missing, duplicate and invented acceptance IDs cannot satisfy coverage', async () => {
  await appendFile(join(spec.specDir, 'spec.md'), '\nAC-02: specific second outcome.\n');
  await assert.rejects(verifySpec(root, spec.id), /Missing acceptance evidence for AC-02/);
  await change(r => r.criteria.push({ ...r.criteria[0] }));
  await assert.rejects(verifySpec(root, spec.id), /Acceptance ID AC-01 is duplicated/);
  await change(r => (r.criteria[1].id = 'AC-99'));
  await assert.rejects(verifySpec(root, spec.id), /Acceptance ID AC-99 is not a criterion in spec\.md/);
  await change(r => (r.criteria[1].id = 2));
  await assert.rejects(verifySpec(root, spec.id), /Acceptance row 2 needs a string id from spec\.md/);
});
test('features, bugfixes and debts reject a DECISION row by name', async () => {
  for (const [type, file] of Object.entries({ feature: 'spec.md', bugfix: 'bug.md', debt: 'audit.md' })) {
    const target = await filledSpec(type);
    await change(r => r.criteria.push({ ...r.criteria[0], id: 'DECISION' }), target);
    await assert.rejects(
      verifySpec(root, target.id),
      new RegExp(`Acceptance ID DECISION is not a criterion in ${file}`),
    );
  }
});
test('an RFC with AC-n criteria verifies with or without its passed DECISION row', async () => {
  const rfc = await rfcWithCriterion();
  const record = await verifySpec(root, rfc.id);
  assert.equal(record.passed, true);
  assert.deepEqual(
    record.acceptance.criteria.map(item => item.id),
    ['DECISION', 'AC-01'],
  );
  await change(r => r.criteria.shift(), rfc);
  assert.equal((await verifySpec(root, rfc.id)).passed, true);
});
test('a DECISION row beside AC-n criteria is validated like the other rows', async () => {
  const rfc = await rfcWithCriterion();
  await change(r => (r.criteria[0].status = 'pending'), rfc);
  await assert.rejects(verifySpec(root, rfc.id), /Acceptance criterion DECISION remains pending/);
  await change(r => Object.assign(r.criteria[0], { status: 'passed', method: 'manual' }), rfc);
  await assert.rejects(verifySpec(root, rfc.id), /RFC acceptance evidence must record decision review/);
  await change(r => Object.assign(r.criteria[0], { method: 'decision', evidence: 'Reviewed.' }), rfc);
  await assert.rejects(verifySpec(root, rfc.id), /Record specific evidence and its limits for DECISION/);
});
test('an RFC without AC-n criteria still requires its DECISION row', async () => {
  const rfc = await filledSpec('rfc');
  assert.equal((await verifySpec(root, rfc.id)).passed, true);
  await change(r => (r.criteria = []), rfc);
  await assert.rejects(verifySpec(root, rfc.id), /Missing acceptance evidence for DECISION/);
});
test('accepted manual or inspection evidence stays separate from automated gates', async () => {
  const record = await verifySpec(root, spec.id);
  assert.equal(record.mode, 'automated');
  assert.equal(record.acceptance.criteria[0].method, 'manual');
  assert.equal(record.acceptance.truthOfEvidence, 'AGENT_OR_HUMAN_REVIEW_REQUIRED');
  const completed = await completeSpec(root, spec.id);
  assert.equal(completed.status, 'COMPLETED');
  assert.deepEqual(completed.verification.acceptance, record.acceptance);
  const manifest = await loadManifest(root);
  assert.deepEqual(manifest.specs[0].verification.acceptance, record.acceptance);
});
test('changing acceptance after verification invalidates completion', async () => {
  await verifySpec(root, spec.id);
  await change(r => (r.criteria[0].evidence += ' Additional reviewed scope.'));
  await assert.rejects(completeSpec(root, spec.id), /changed after verification/);
});
test('missing legacy acceptance evidence requires migration instead of invented success', async () => {
  await rm(join(spec.specDir, 'acceptance.json'));
  await assert.rejects(verifySpec(root, spec.id), /migrate their evidence/);
});

test('verify and complete expose declared criterion evidence separately from executed gates', async () => {
  await change(r => {
    r.criteria[0].method = 'automated';
    r.criteria[0].checkCommands = ['node -e "process.exit(0)"'];
  });
  const lines = [];
  const log = console.log;
  console.log = value => lines.push(value);
  try {
    assert.equal(await runCli(['verify', spec.id], root), 0);
    assert.equal(await runCli(['complete', spec.id], root), 0);
    assert.equal(lines.length, 2);
    for (const output of lines) {
      assert.match(output, /gate mode: automated/i);
      assert.match(output, /1 criteria declared passed \(automated: 1\)/);
      assert.match(output, /does not prove the adequacy of assertions or the truth of manual evidence/);
    }
  } finally {
    console.log = log;
  }
});

test('completion JSON carries declared coverage even when a legacy record omits its acceptance summary', async () => {
  await verifySpec(root, spec.id);
  const path = join(spec.specDir, 'verification.json');
  const record = JSON.parse(await readFile(path, 'utf8'));
  delete record.acceptance;
  await writeFile(path, JSON.stringify(record));
  const lines = [];
  const log = console.log;
  console.log = value => lines.push(value);
  try {
    assert.equal(await runCli(['complete', spec.id, '--json'], root), 0);
  } finally {
    console.log = log;
  }
  const completed = JSON.parse(lines.join('\n'));
  assert.equal(completed.verification.acceptance.scope, 'DECLARED_EVIDENCE_WITH_EXECUTED_CHECK_BINDINGS');
  assert.equal(completed.verification.acceptance.truthOfEvidence, 'AGENT_OR_HUMAN_REVIEW_REQUIRED');
  assert.equal(completed.verification.acceptance.criteria[0].method, 'manual');
});
