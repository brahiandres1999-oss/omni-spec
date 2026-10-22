import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import {
  recordContext,
  contextFreshness,
  recordDecision,
  recordSession,
  projectStatus,
} from '../src/project-state.mjs';
import { verifySpec, completeSpec } from '../src/verification.mjs';
import { fillSpec } from '../test-support/fixtures.mjs';
import { runCli } from '../src/cli.mjs';

let root;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omni-state-'));
  await scaffoldProject(root, { qualityGates: 'node -e "process.exit(0)"' });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('context input additions, changes and removals require reconciliation and retain the old baseline', async () => {
  await recordContext(root);
  assert.equal((await contextFreshness(root)).status, 'CURRENT');
  await writeFile(join(root, 'package.json'), '{"scripts":{"test":"node test.cjs"}}');
  assert.deepEqual((await contextFreshness(root)).changed, ['package.json']);
  await recordContext(root);
  assert.equal((await readdir(join(root, 'specs/.omni/context-history'))).length, 1);
  await writeFile(join(root, 'package.json'), '{"scripts":{"test":"node different.cjs"}}');
  assert.equal((await contextFreshness(root)).status, 'STALE');
  await recordContext(root);
  await rm(join(root, 'package.json'));
  assert.deepEqual((await contextFreshness(root)).changed, ['package.json']);
});

test('stale context blocks verification without silently replacing its claims', async () => {
  const spec = await createSpec(root, 'feature', 'greeting');
  await fillSpec(root, spec);
  await recordContext(root);
  await writeFile(join(root, 'main.mjs'), 'export const value = 2;');
  await assert.rejects(verifySpec(root, spec.id), /Context is stale/);
  assert.equal((await projectStatus(root)).progress.blockers[0].code, 'STALE_CONTEXT');
  await recordContext(root);
  await verifySpec(root, spec.id);
  await completeSpec(root, spec.id);
});

test('status predicts closure with the same validation and exposes log tampering as a blocker', async () => {
  const spec = await createSpec(root, 'feature', 'greeting');
  await fillSpec(root, spec);
  assert.equal((await projectStatus(root)).progress.delivery, 'VERIFICATION_PENDING');
  const record = await verifySpec(root, spec.id);
  assert.equal((await projectStatus(root)).progress.delivery, 'READY_TO_COMPLETE');
  await writeFile(join(root, record.results[0].outputLog), 'altered');
  const state = await projectStatus(root);
  assert.notEqual(state.progress.delivery, 'READY_TO_COMPLETE');
  assert.match(state.progress.blockers[0].message, /output log changed/);
});

test('required unanswered decisions block closure; answers and revisions retain their provenance', async () => {
  const spec = await createSpec(root, 'feature', 'greeting');
  await fillSpec(root, spec);
  await recordDecision(root, { id: 'scope', topic: 'scope', status: 'pending', required: true });
  await assert.rejects(verifySpec(root, spec.id), /Required decisions remain/);
  await recordDecision(root, {
    id: 'scope',
    expectedRevision: 1,
    topic: 'scope',
    status: 'approved',
    value: 'local-only',
    basis: 'User explicitly confirmed local-only delivery.',
  });
  await assert.rejects(
    recordDecision(root, {
      id: 'scope',
      expectedRevision: 1,
      status: 'approved',
      basis: 'A stale answer must never overwrite a new one.',
    }),
    /revision changed/,
  );
  assert.equal((await readdir(join(root, 'specs/.omni/decision-history'))).length, 1);
  assert.equal((await verifySpec(root, spec.id)).passed, true);
});

test('technology selections require dated official sources while missing host tools stay unknown', async () => {
  await assert.rejects(
    recordDecision(root, {
      id: 'stack',
      topic: 'technology',
      status: 'delegated',
      value: 'a version from memory',
      basis: 'User delegated the scoped stack decision.',
    }),
    /official-source/,
  );
  await recordDecision(root, {
    id: 'stack',
    topic: 'technology',
    status: 'delegated',
    value: 'Inspected supported runtime, selected for this fixture only',
    basis: 'User delegated the scoped stack decision.',
    sources: [
      {
        url: 'https://nodejs.org/en/about/previous-releases',
        consultedAt: new Date().toISOString(),
        appliesTo: 'Node LTS support policy, semantic review still required',
        authority: 'official',
      },
    ],
  });
  await recordSession(root, {
    host: 'fixture-host',
    capabilities: { questions: { status: 'unavailable', source: 'Noninteractive terminal; chat fallback required' } },
  });
  const status = await projectStatus(root);
  assert.equal(status.progress.capabilities.questions.status, 'unavailable');
  assert.equal(status.progress.capabilities.render.status, 'unknown');
});

test('CLI context recording and status use the shared state without application execution', async () => {
  const lines = [],
    previous = console.log;
  console.log = line => lines.push(line);
  try {
    assert.equal(await runCli(['context-record', '--json'], root), 0);
    assert.equal(await runCli(['status', '--json'], root), 0);
  } finally {
    console.log = previous;
  }
  assert.equal(JSON.parse(lines[1]).progress.context.status, 'CURRENT');
  assert.equal(JSON.parse(lines[1]).progress.publication, 'NOT_AUTHORIZED_BY_STATUS');
  assert.ok((await readFile(join(root, 'specs/project-state.json'), 'utf8')).includes('BYTE_BASELINE'));
});

test('scoped unanswered decisions do not block unrelated work and terminal focus stays terminal', async () => {
  const spec = await createSpec(root, 'feature', 'local-fix');
  await fillSpec(root, spec);
  await recordDecision(root, {
    id: 'future-service',
    status: 'pending',
    topic: 'scope',
    appliesTo: ['999'],
    required: true,
  });
  assert.equal((await verifySpec(root, spec.id)).passed, true);
  await completeSpec(root, spec.id);
  const { focusSpec } = await import('../src/manifest.mjs');
  await focusSpec(root, spec.id);
  const status = await projectStatus(root);
  assert.equal(status.progress.delivery, 'COMPLETED');
  assert.notEqual(status.progress.nextAction, `complete ${spec.id}`);
});

test('partial acceptance remains visible and cannot be represented as completed', async () => {
  const spec = await createSpec(root, 'feature', 'partial-journey');
  await fillSpec(root, spec);
  const path = join(spec.specDir, 'acceptance.json');
  const report = JSON.parse(await readFile(path, 'utf8'));
  report.criteria[0].status = 'blocked';
  await writeFile(path, JSON.stringify(report));
  const status = await projectStatus(root);
  assert.equal(status.progress.delivery, 'ACCEPTANCE_PENDING');
  assert.equal(status.progress.blockers[0].criteria[0].id, 'AC-01');
  await assert.rejects(verifySpec(root, spec.id), /remains blocked/);
});

test('invalid decision IDs cannot poison future state reads', async () => {
  await recordDecision(root, { id: 'valid', status: 'pending', topic: 'scope' });
  const before = await readFile(join(root, 'specs/project-state.json'), 'utf8');
  await assert.rejects(recordDecision(root, { id: 123, status: 'pending' }), /Invalid or duplicate/);
  await assert.rejects(recordDecision(root, { id: '   ', status: 'pending' }), /nonempty/);
  assert.equal(await readFile(join(root, 'specs/project-state.json'), 'utf8'), before);
  assert.equal((await projectStatus(root)).progress.decisions[0].id, 'valid');
});
