import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalPayload, getAttestationKey, signaturesMatch, verifyRecord } from './attestation.mjs';
import { specRoute } from './fit.mjs';
import { writeFileAtomic } from './fs-retry.mjs';
import { safePath } from './managed.mjs';
import { loadManifest, withManifestLock } from './manifest.mjs';

/**
 * Human-in-the-Loop gates of the architectural (full) route (blueprint section 2.4):
 *   Gate 1 approves the plan (design, acceptance, tasks, fit, blast radius) before verification.
 *   Gate 2 approves the attested evidence before completion.
 * Each approval names its actor, is bound to a fingerprint of what was approved and is signed with
 * the attestation key, so editing approvals.json by hand or changing the approved inputs voids it.
 * Gates apply when specs/manifest.json sets governance.humanGates to "full".
 */

const APPROVALS_FILE = 'approvals.json';
const DESIGN_INPUTS = {
  feature: ['plan.md'],
  bugfix: ['rca.md', 'fix.md'],
  debt: ['migration-plan.md'],
  rfc: ['rfc.md'],
};
const PLAN_INPUTS = ['acceptance.json', 'fit.json', 'tasks.json', 'tasks.md', 'blast-radius.json'];
const GATE_DOMAIN = 'omnispec-gate-v1';

export class GateError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'GateError';
    this.code = code;
  }
}

const sha256 = value => createHash('sha256').update(value).digest('hex');

async function findSpec(root, identifier) {
  const manifest = await loadManifest(root);
  const spec = manifest?.specs.find(item => item.id === identifier || item.slug === identifier);
  if (!spec) throw new Error('Specification not found. Use list and an exact ID.');
  return { manifest, spec };
}

/** @returns {Promise<boolean>} Whether this spec must pass gates 1 and 2. */
export async function gatesRequired(root, spec, manifest) {
  if (manifest?.governance?.humanGates !== 'full' || spec.type === 'rfc') return false;
  return (await specRoute(root, spec))?.route === 'full';
}

async function readText(root, spec, name) {
  try {
    return (await readFile(await safePath(root, join('specs', spec.slug, name)), 'utf8'))
      .replace(/^\ufeff/, '')
      .replace(/\r\n?/g, '\n');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Fingerprint of the plan inputs gate 1 approves. Line endings and a BOM do not count. */
export async function planFingerprint(root, spec) {
  const names = [...(DESIGN_INPUTS[spec.type] ?? []), ...PLAN_INPUTS].sort();
  const parts = [];
  for (const name of names) {
    const text = await readText(root, spec, name);
    parts.push(`${name}\0${text === null ? '-' : sha256(text)}`);
  }
  return sha256(parts.join('\n'));
}

async function readVerification(root, spec) {
  const text = await readText(root, spec, 'verification.json');
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/** Fingerprint of the attested verification gate 2 approves. */
export function evidenceFingerprint(record) {
  return sha256(
    canonicalPayload('omnispec-gate-evidence-v1', [
      ['id', record.id],
      ['fingerprint', record.fingerprint],
      ['recordSignature', record.recordSignature],
    ]),
  );
}

function sign(key, spec, approval) {
  return createHmac('sha256', key)
    .update(
      canonicalPayload(GATE_DOMAIN, [
        ['specId', spec.id],
        ['gate', approval.gate],
        ['actor', approval.actor],
        ['approvedAt', approval.approvedAt],
        ['fingerprint', approval.fingerprint],
      ]),
    )
    .digest('hex');
}

async function readApprovals(root, spec) {
  const text = await readText(root, spec, APPROVALS_FILE);
  if (text === null) return { schemaVersion: 1, gates: {} };
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new GateError('GATE_APPROVAL_INVALID', `specs/${spec.slug}/${APPROVALS_FILE} is not valid JSON.`);
  }
  if (data?.schemaVersion !== 1 || !data.gates || typeof data.gates !== 'object')
    throw new GateError('GATE_APPROVAL_INVALID', `specs/${spec.slug}/${APPROVALS_FILE} has an unknown format.`);
  return data;
}

async function currentFingerprint(root, spec, gate) {
  if (gate === 1) return planFingerprint(root, spec);
  const record = await readVerification(root, spec);
  return record?.recordSignature ? evidenceFingerprint(record) : null;
}

async function evaluate(root, spec, gate, approvals) {
  const approval = approvals.gates[String(gate)];
  if (!approval) return 'missing';
  if (approval.gate !== gate || !signaturesMatch(sign(await getAttestationKey(), spec, approval), approval.signature))
    return 'invalid';
  return approval.fingerprint === (await currentFingerprint(root, spec, gate)) ? 'approved' : 'stale';
}

/**
 * @returns {Promise<{required: boolean, gates: {1: string, 2: string}}>} Each gate is approved,
 *   stale, invalid or missing.
 */
export async function gateStatus(root, identifier) {
  const { manifest, spec } = await findSpec(root, identifier);
  const approvals = await readApprovals(root, spec);
  return {
    required: await gatesRequired(root, spec, manifest),
    gates: { 1: await evaluate(root, spec, 1, approvals), 2: await evaluate(root, spec, 2, approvals) },
  };
}

/**
 * Throws unless the gate is approved for the current inputs (no-op when gates do not apply).
 * @throws {GateError} GATE_n_REQUIRED, GATE_n_STALE or GATE_APPROVAL_INVALID.
 */
export async function assertGate(root, spec, manifest, gate) {
  if (!(await gatesRequired(root, spec, manifest))) return;
  const state = await evaluate(root, spec, gate, await readApprovals(root, spec));
  const what = gate === 1 ? 'the plan (design, acceptance, tasks)' : 'the verification evidence and diff';
  if (state === 'missing')
    throw new GateError(
      `GATE_${gate}_REQUIRED`,
      `${spec.id} is on the full route: a person must approve ${what} with \`omni-spec approve ${spec.id} --gate ${gate} --actor <name>\`.`,
    );
  if (state === 'invalid')
    throw new GateError(
      'GATE_APPROVAL_INVALID',
      `The gate ${gate} approval of ${spec.id} was not issued by OmniSpec or was edited.`,
    );
  if (state === 'stale')
    throw new GateError(
      `GATE_${gate}_STALE`,
      `${what} of ${spec.id} changed after gate ${gate} was approved; approve it again.`,
    );
}

/**
 * Records a human approval of gate 1 or 2.
 * @param {string} root
 * @param {string} identifier Spec id or slug.
 * @param {1|2} gate
 * @param {{actor: string}} options
 */
export async function approveGate(root, identifier, gate, { actor } = {}) {
  if (gate !== 1 && gate !== 2) throw new TypeError('gate must be 1 or 2.');
  if (typeof actor !== 'string' || !actor.trim()) throw new TypeError('actor must name the person approving.');
  return withManifestLock(root, async () => {
    const { manifest, spec } = await findSpec(root, identifier);
    if (gate === 2) {
      await assertGate(root, spec, manifest, 1);
      const record = await readVerification(root, spec);
      if (!record?.passed)
        throw new GateError('GATE_EVIDENCE_MISSING', 'No valid verification record. Run verify first.');
      verifyRecord(await getAttestationKey(), record);
    }
    const approval = {
      gate,
      actor: actor.trim(),
      approvedAt: new Date().toISOString(),
      fingerprint: await currentFingerprint(root, spec, gate),
    };
    approval.signature = sign(await getAttestationKey(), spec, approval);
    const approvals = await readApprovals(root, spec);
    approvals.gates[String(gate)] = approval;
    await writeFileAtomic(
      await safePath(root, join('specs', spec.slug, APPROVALS_FILE)),
      `${JSON.stringify(approvals, null, 2)}\n`,
    );
    return approval;
  });
}
