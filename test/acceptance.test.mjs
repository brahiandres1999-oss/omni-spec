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
async function change(edit) {
  const path = join(spec.specDir, 'acceptance.json');
  const report = JSON.parse(await readFile(path, 'utf8'));
  edit(report);
  await writeFile(path, JSON.stringify(report));
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
  await assert.rejects(verifySpec(root, spec.id), /unique and match/);
  await change(r => (r.criteria[1].id = 'AC-99'));
  await assert.rejects(verifySpec(root, spec.id), /unique and match/);
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
