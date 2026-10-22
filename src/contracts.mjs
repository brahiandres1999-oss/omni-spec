import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { safePath } from './managed.mjs';
import { loadManifest, withManifestLock } from './manifest.mjs';

export const CONTRACTS_SCHEMA_VERSION = 1;
export const CONTRACTS_PATH = 'specs/contracts.json';
const fields = ['capability', 'scope', 'status', 'sourceSpec', 'decision', 'evidence'];
const statuses = ['proposed', 'active', 'retired'];
const idPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const clone = value => JSON.parse(JSON.stringify(value));

function validateSnapshot(snapshot) {
  if (!object(snapshot)) throw new Error('Invalid contract snapshot.');
  if (Object.keys(snapshot).some(key => !fields.includes(key))) throw new Error('Unknown contract field.');
  for (const field of ['capability', 'scope', 'sourceSpec', 'decision'])
    if (!text(snapshot[field])) throw new Error(`Contract ${field} must be a non-empty string.`);
  if (!statuses.includes(snapshot.status)) throw new Error('Contract status must be proposed, active or retired.');
  if (!Array.isArray(snapshot.evidence) || snapshot.evidence.some(item => !text(item)))
    throw new Error('Contract evidence must be an array of non-empty references.');
  if (snapshot.status !== 'proposed' && snapshot.evidence.length === 0)
    throw new Error('An active or retired contract requires explicit evidence references.');
}

function validateId(id) {
  if (typeof id !== 'string' || id.length > 120 || !idPattern.test(id))
    throw new Error('Contract ID must be a stable lowercase identifier separated by dots, hyphens or underscores.');
}

function validateRegistry(registry) {
  if (!object(registry) || registry.schemaVersion !== CONTRACTS_SCHEMA_VERSION || !Array.isArray(registry.contracts))
    throw new Error('Invalid contracts registry.');
  if (!Number.isSafeInteger(registry.revision) || registry.revision < 0)
    throw new Error('Invalid contracts registry revision.');
  const ids = new Set();
  let totalRevisions = 0;
  for (const contract of registry.contracts) {
    if (!object(contract)) throw new Error('Invalid contract entry.');
    validateId(contract.id);
    if (ids.has(contract.id)) throw new Error('Duplicate contract ID.');
    ids.add(contract.id);
    if (!Number.isSafeInteger(contract.revision) || contract.revision < 1)
      throw new Error('Invalid contract revision.');
    if (!Array.isArray(contract.history) || contract.history.length !== contract.revision)
      throw new Error('Contract history must preserve every revision.');
    validateSnapshot(contract.current);
    let previous = null;
    let effectiveRevision = null;
    for (const [index, entry] of contract.history.entries()) {
      if (!object(entry) || entry.revision !== index + 1 || !text(entry.recordedAt) || !object(entry.delta))
        throw new Error('Invalid contract history entry.');
      validateSnapshot(entry.snapshot);
      if (!equal(entry.delta, deltaFor(previous, entry.snapshot))) throw new Error('Invalid contract history delta.');
      previous = entry.snapshot;
      if (entry.snapshot.status !== 'proposed') effectiveRevision = entry.revision;
    }
    if (!equal(contract.current, previous)) throw new Error('Contract current snapshot differs from its history.');
    if (contract.effectiveRevision !== effectiveRevision)
      throw new Error('Contract effective revision differs from its recorded decisions.');
    totalRevisions += contract.revision;
  }
  if (totalRevisions !== registry.revision) throw new Error('Contracts registry revision does not match its history.');
  return registry;
}

function deltaFor(previous, next) {
  return Object.fromEntries(
    fields
      .filter(field => !previous || !equal(previous[field], next[field]))
      .map(field => [field, { from: previous?.[field] ?? null, to: next[field] }]),
  );
}

/**
 * Read the declared capability contracts without inferring implementation or compliance.
 * Missing registries produce an empty revision-zero value; malformed history is rejected.
 * @param {string} root Project root.
 * @returns {Promise<object>} Registry with current snapshots and preserved revision history.
 */
export async function readContracts(root) {
  const path = await safePath(root, CONTRACTS_PATH);
  try {
    return validateRegistry(JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')));
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: CONTRACTS_SCHEMA_VERSION, revision: 0, contracts: [] };
    throw new Error(`Cannot read capability contracts: ${error.message}`);
  }
}

/**
 * List explicitly recorded contracts; an optional status filter never inspects source code.
 * @param {string} root Project root.
 * @param {{status?: 'proposed'|'active'|'retired'}} [options] Optional recorded status filter.
 * @returns {Promise<object[]>} Contract entries, including history and current declarations.
 */
export async function listContracts(root, options = {}) {
  if (options.status !== undefined && !statuses.includes(options.status))
    throw new Error('Invalid contract status filter.');
  return (await readContracts(root)).contracts.filter(contract => {
    if (!options.status) return true;
    if (options.status === 'proposed') return contract.current.status === 'proposed';
    return contractEffectiveSnapshot(contract)?.status === options.status;
  });
}

/**
 * Read the last active/retired decision while a newer proposal remains pending.
 * The result records an explicit decision; it does not infer compliance from source code.
 * @param {object} contract Entry returned by readContract/listContracts.
 * @returns {object|null} Last decided snapshot, or null for an undecided initial proposal.
 */
export function contractEffectiveSnapshot(contract) {
  return contract.effectiveRevision === null ? null : clone(contract.history[contract.effectiveRevision - 1].snapshot);
}

/**
 * Read one stable capability ID. Absence returns null and does not create a registry.
 * @param {string} root Project root.
 * @param {string} id Stable capability contract identifier.
 * @returns {Promise<object|null>} Recorded entry or null.
 */
export async function readContract(root, id) {
  validateId(id);
  return (await readContracts(root)).contracts.find(contract => contract.id === id) ?? null;
}

/**
 * Record an explicit proposal or a reviewed revision. No contract is derived from code.
 * Activation/retirement requires a completed source specification plus decision and evidence
 * references; this records the decision, without asserting those references prove compliance.
 * Writes serialize with the manifest and replace the registry atomically. A revision conflict
 * leaves history untouched, so callers must inspect current state before retrying.
 * @param {string} root Project root.
 * @param {string} id Stable capability ID (new entries use expectedRevision 0).
 * @param {object} change Fields to change: capability, scope, status, sourceSpec, decision, evidence.
 * @param {{expectedRevision: number}} options Expected current revision of this contract.
 * @returns {Promise<object>} Updated contract entry with complete snapshots and field deltas.
 */
export async function updateContract(root, id, change, options = {}) {
  validateId(id);
  if (!object(change) || Object.keys(change).some(field => !fields.includes(field)))
    throw new Error('Contract update contains unknown fields; IDs and history cannot be edited.');
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0)
    throw new Error('Contract update requires expectedRevision (0 for a new contract).');
  await safePath(root, CONTRACTS_PATH);
  await safePath(root, 'specs/manifest.lock');
  await safePath(root, 'specs/manifest.json');
  return withManifestLock(root, async () => {
    const registry = await readContracts(root);
    const existing = registry.contracts.find(contract => contract.id === id);
    if ((existing?.revision ?? 0) !== options.expectedRevision)
      throw new Error(
        `Contract revision conflict: expected ${options.expectedRevision}, current ${existing?.revision ?? 0}. Reload before retrying.`,
      );
    const current = { ...existing?.current, ...change };
    validateSnapshot(current);
    const manifest = await loadManifest(root);
    const source = manifest?.specs.find(spec => spec.id === current.sourceSpec || spec.slug === current.sourceSpec);
    if (!source) throw new Error('Contract sourceSpec must reference an existing specification.');
    if (current.status !== 'proposed' && source.status !== 'COMPLETED')
      throw new Error('Activating or retiring a contract requires a COMPLETED source specification.');
    current.sourceSpec = source.id;
    const delta = deltaFor(existing?.current ?? null, current);
    if (Object.keys(delta).length === 0) throw new Error('Contract update must record a change.');
    if (existing && !Object.hasOwn(change, 'decision'))
      throw new Error('Every contract revision requires an explicit decision for that revision.');
    const revision = (existing?.revision ?? 0) + 1;
    const updated = {
      id,
      revision,
      effectiveRevision: current.status === 'proposed' ? (existing?.effectiveRevision ?? null) : revision,
      current,
      history: [
        ...(existing?.history ?? []),
        { revision, recordedAt: new Date().toISOString(), snapshot: clone(current), delta },
      ],
    };
    if (existing) registry.contracts[registry.contracts.indexOf(existing)] = updated;
    else registry.contracts.push(updated);
    registry.revision++;
    validateRegistry(registry);
    const target = await safePath(root, CONTRACTS_PATH);
    const temporary = await safePath(root, `${CONTRACTS_PATH}.tmp.${process.pid}.${randomUUID()}`);
    try {
      await writeFile(temporary, JSON.stringify(registry, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    return updated;
  });
}
