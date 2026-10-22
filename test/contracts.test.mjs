import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initManifest, addSpec, loadManifest, saveManifest } from '../src/manifest.mjs';
import {
  readContracts,
  readContract,
  listContracts,
  updateContract,
  contractEffectiveSnapshot,
} from '../src/contracts.mjs';

let root;
let source;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omnispec-contracts-'));
  await initManifest(root, { projectName: 'Capability contracts' });
  source = await addSpec(root, {
    id: '001',
    type: 'feature',
    title: 'Example capability',
    slug: '001-example',
    status: 'IN_PROGRESS',
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function proposal(overrides = {}) {
  return {
    capability: 'Read account preferences',
    scope: 'Signed-in account owner sees stored preferences. Does not grant support access.',
    status: 'proposed',
    sourceSpec: source.id,
    decision: 'Propose the owner-only capability for review.',
    evidence: [],
    ...overrides,
  };
}

async function markSourceComplete() {
  const manifest = await loadManifest(root);
  manifest.specs.find(spec => spec.id === source.id).status = 'COMPLETED';
  await saveManifest(root, manifest);
}

test('an absent registry is read without inferring contracts from source or creating a file', async () => {
  await writeFile(join(root, 'app.js'), 'export function insecureAccess() { return true; }');
  assert.deepEqual(await readContracts(root), { schemaVersion: 1, revision: 0, contracts: [] });
  assert.equal(await readContract(root, 'account.preferences'), null);
  await assert.rejects(readFile(join(root, 'specs/contracts.json')), { code: 'ENOENT' });
});

test('pending work can propose a stable capability but cannot silently activate it', async () => {
  const entry = await updateContract(root, 'account.preferences', proposal(), { expectedRevision: 0 });
  assert.equal(entry.current.status, 'proposed');
  assert.equal(contractEffectiveSnapshot(entry), null);
  const bytes = await readFile(join(root, 'specs/contracts.json'), 'utf8');
  await assert.rejects(
    updateContract(
      root,
      entry.id,
      { status: 'active', decision: 'Activate reviewed behavior.', evidence: ['AC-01'] },
      { expectedRevision: 1 },
    ),
    /COMPLETED source specification/,
  );
  assert.equal(await readFile(join(root, 'specs/contracts.json'), 'utf8'), bytes);
  assert.equal((await listContracts(root, { status: 'active' })).length, 0);
});

test('activation and later changes preserve snapshots, explicit decisions and field deltas', async () => {
  const first = await updateContract(root, 'account.preferences', proposal(), { expectedRevision: 0 });
  const originalSnapshot = structuredClone(first.history[0]);
  await markSourceComplete();
  const active = await updateContract(
    root,
    first.id,
    { status: 'active', decision: 'Accept reviewed AC-01.', evidence: ['specs/001-example/verification.json#AC-01'] },
    { expectedRevision: 1 },
  );
  assert.equal(active.revision, 2);
  assert.deepEqual(active.history[0], originalSnapshot);
  assert.deepEqual(active.history[1].delta.status, { from: 'proposed', to: 'active' });
  const retired = await updateContract(
    root,
    first.id,
    { status: 'retired', decision: 'Capability superseded by a reviewed replacement.' },
    { expectedRevision: 2 },
  );
  assert.equal(retired.revision, 3);
  assert.deepEqual(retired.history[1], active.history[1]);
  assert.equal((await readContracts(root)).revision, 3);
  assert.equal((await listContracts(root, { status: 'retired' }))[0].id, first.id);
  assert.equal((await readContract(root, first.id)).history.length, 3);
});

test('stale and missing expected revisions reject without changing the stored registry', async () => {
  await updateContract(root, 'account.preferences', proposal(), { expectedRevision: 0 });
  const bytes = await readFile(join(root, 'specs/contracts.json'), 'utf8');
  await assert.rejects(
    updateContract(root, 'account.preferences', { decision: 'Stale writer.' }, { expectedRevision: 0 }),
    /revision conflict/,
  );
  await assert.rejects(
    updateContract(root, 'account.preferences', { decision: 'No revision.' }),
    /requires expectedRevision/,
  );
  assert.equal(await readFile(join(root, 'specs/contracts.json'), 'utf8'), bytes);
});

test('a pending revision preserves the previously active contract until an explicit completed decision', async () => {
  await markSourceComplete();
  await updateContract(root, 'account.preferences', proposal({ status: 'active', evidence: ['AC-01'] }), {
    expectedRevision: 0,
  });
  const pending = await addSpec(root, {
    id: '002',
    type: 'feature',
    title: 'Proposed revision',
    slug: '002-revision',
    status: 'IN_PROGRESS',
  });
  const revised = await updateContract(
    root,
    'account.preferences',
    {
      status: 'proposed',
      sourceSpec: pending.id,
      scope: 'Proposed support access, pending authorization design.',
      decision: 'Explore expanded access without changing the accepted owner-only scope.',
      evidence: [],
    },
    { expectedRevision: 1 },
  );
  assert.equal(revised.current.status, 'proposed');
  assert.equal(revised.effectiveRevision, 1);
  assert.match(contractEffectiveSnapshot(revised).scope, /Does not grant support access/);
  assert.equal((await listContracts(root, { status: 'active' })).length, 1);
  assert.equal((await listContracts(root, { status: 'proposed' })).length, 1);
  assert.equal((await readContract(root, revised.id)).effectiveRevision, 1);
});

test('concurrent updates to the same revision allow one writer and preserve its history', async () => {
  await updateContract(root, 'account.preferences', proposal(), { expectedRevision: 0 });
  const writes = await Promise.allSettled([
    updateContract(
      root,
      'account.preferences',
      { scope: 'First scope.', decision: 'First reviewed change.' },
      { expectedRevision: 1 },
    ),
    updateContract(
      root,
      'account.preferences',
      { scope: 'Second scope.', decision: 'Second reviewed change.' },
      { expectedRevision: 1 },
    ),
  ]);
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(writes.find(result => result.status === 'rejected').reason.message, /revision conflict/);
  const contract = await readContract(root, 'account.preferences');
  assert.equal(contract.revision, 2);
  assert.equal(contract.history.length, 2);
});

test('invalid IDs, unknown fields, absent sources, unsupported status and missing decisions fail closed', async () => {
  await assert.rejects(
    updateContract(root, '../outside', proposal(), { expectedRevision: 0 }),
    /stable lowercase identifier/,
  );
  await assert.rejects(
    updateContract(root, 'account.preferences', { ...proposal(), compliance: 'PASS' }, { expectedRevision: 0 }),
    /unknown fields/,
  );
  await assert.rejects(
    updateContract(root, 'account.preferences', proposal({ sourceSpec: 'missing' }), { expectedRevision: 0 }),
    /existing specification/,
  );
  await assert.rejects(
    updateContract(root, 'account.preferences', proposal({ status: 'verified' }), { expectedRevision: 0 }),
    /status/,
  );
  await updateContract(root, 'account.preferences', proposal(), { expectedRevision: 0 });
  await assert.rejects(
    updateContract(root, 'account.preferences', { scope: 'Wider scope.' }, { expectedRevision: 1 }),
    /explicit decision/,
  );
  await assert.rejects(listContracts(root, { status: 'verified' }), /status filter/);
});

test('active status needs evidence even when its source specification is completed', async () => {
  await markSourceComplete();
  await assert.rejects(
    updateContract(root, 'account.preferences', proposal({ status: 'active' }), { expectedRevision: 0 }),
    /evidence references/,
  );
  assert.equal((await readContracts(root)).contracts.length, 0);
});

test('tampered history is rejected rather than reset or silently overwritten', async () => {
  await updateContract(root, 'account.preferences', proposal(), { expectedRevision: 0 });
  const registry = await readContracts(root);
  registry.contracts[0].history[0].snapshot.scope = 'Corrupted scope';
  await writeFile(join(root, 'specs/contracts.json'), JSON.stringify(registry));
  const bytes = await readFile(join(root, 'specs/contracts.json'), 'utf8');
  await assert.rejects(readContracts(root), /history delta/);
  await assert.rejects(
    updateContract(root, 'account.preferences', { decision: 'Overwrite corruption.' }, { expectedRevision: 1 }),
    /history delta/,
  );
  assert.equal(await readFile(join(root, 'specs/contracts.json'), 'utf8'), bytes);
});

test('symlinked registry is refused without reading or overwriting its target', async t => {
  const outside = join(root, 'outside.json');
  await writeFile(outside, 'private external content');
  try {
    await symlink(outside, join(root, 'specs/contracts.json'));
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip('Host does not permit symlink creation.');
    throw error;
  }
  await assert.rejects(readContracts(root), /symlink/);
  await assert.rejects(updateContract(root, 'account.preferences', proposal(), { expectedRevision: 0 }), /symlink/);
  assert.equal(await readFile(outside, 'utf8'), 'private external content');
});
