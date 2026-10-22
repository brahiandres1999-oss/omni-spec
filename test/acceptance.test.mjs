import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { verifySpec, completeSpec } from '../src/verification.mjs';
import { fillSpec } from '../test-support/fixtures.mjs';
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
  assert.equal((await completeSpec(root, spec.id)).status, 'COMPLETED');
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
