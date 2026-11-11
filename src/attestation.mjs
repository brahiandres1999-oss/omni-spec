import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import {
  defaultBackend,
  omnispecHome,
  purgeSecret,
  readSecret,
  SecureStoreError,
  writeSecret,
} from './secure-store.mjs';

/**
 * HMAC-SHA256 attestation of verification evidence (cryptographic barrier 2).
 *
 * The key is 256 random bits kept outside the repository at <OmniSpec home>/keys/attestation.key
 * (%LOCALAPPDATA%\OmniSpec\keys\attestation.key on Windows), protected with DPAPI. `verify` and
 * `complete` run as separate processes, so both read the same key. An agent that can only write
 * files cannot produce a valid signature; an agent that can run code as the same OS user can still
 * call DPAPI, so this defends against forged files, not against arbitrary code execution.
 */

const KEY_ENTROPY = Buffer.from('OmniSpec.attestation-key.v1', 'utf8');
const RESULT_DOMAIN = 'omnispec-attestation-result-v1';
const RECORD_DOMAIN = 'omnispec-attestation-record-v1';
const SIGNATURE = /^[a-f0-9]{64}$/;

/** Fields of each check result bound by its signature, in signing order. */
export const ATTESTED_RESULT_FIELDS = Object.freeze([
  'version',
  'specId',
  'fingerprint',
  'checkId',
  'command',
  'cwd',
  'outputLogHash',
  'exitCode',
  'processId',
  'startedAt',
  'timedOut',
  'errorType',
]);

export class AttestationError extends Error {
  constructor(message) {
    super(`ATTESTATION_INVALID: ${message}`);
    this.name = 'AttestationError';
    this.code = 'ATTESTATION_INVALID';
  }
}

export function attestationKeyPath(env = process.env) {
  return join(omnispecHome(env), 'keys', 'attestation.key');
}

const keys = new Map();

async function loadOrCreate(path, backend) {
  let key;
  try {
    key = await readSecret(path, { backend, entropy: KEY_ENTROPY });
  } catch (error) {
    // A key Windows can no longer unprotect cannot verify anything; replace it and re-verify.
    if (!(error instanceof SecureStoreError) || error.code !== 'DPAPI_BAD_KEY_STATE') throw error;
    await purgeSecret(path);
  }
  if (key?.length === 32) return key;
  if (key) throw new SecureStoreError('STORE_CORRUPT', `${path} does not hold a 256-bit key.`);
  await writeSecret(path, randomBytes(32), { backend, entropy: KEY_ENTROPY });
  return readSecret(path, { backend, entropy: KEY_ENTROPY });
}

/**
 * The attestation key, created on first use. Cached per path for the life of the process.
 * @param {{path?: string, backend?: object}} [options]
 * @returns {Promise<Buffer>}
 */
export function getAttestationKey({ path = attestationKeyPath(), backend = defaultBackend() } = {}) {
  if (!keys.has(path))
    keys.set(
      path,
      loadOrCreate(path, backend).catch(error => {
        keys.delete(path);
        throw error;
      }),
    );
  return keys.get(path);
}

/** Replaces the key; every record signed before becomes invalid and needs a new verify. */
export async function rotateAttestationKey({ path = attestationKeyPath(), backend = defaultBackend() } = {}) {
  await writeSecret(path, randomBytes(32), { backend, entropy: KEY_ENTROPY });
  keys.delete(path);
  return getAttestationKey({ path, backend });
}

/** @returns {string} Public identifier of a key (first 64 bits of its SHA-256). */
export function keyId(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * Length-prefixed canonical encoding: no field value can imitate a separator.
 * @param {string} domain
 * @param {[string, unknown][]} entries
 */
export function canonicalPayload(domain, entries) {
  const parts = [domain];
  for (const [name, value] of entries) {
    const encoded = JSON.stringify(value === undefined ? null : value);
    parts.push(`${name}=${Buffer.byteLength(encoded, 'utf8')}:${encoded}`);
  }
  return parts.join('\n');
}

const hmac = (key, payload) => createHmac('sha256', key).update(payload, 'utf8').digest('hex');

/**
 * Signs one check result.
 * @param {Buffer} key
 * @param {Record<string, unknown>} fields Values for ATTESTED_RESULT_FIELDS.
 */
export function signResult(key, fields) {
  return hmac(
    key,
    canonicalPayload(
      RESULT_DOMAIN,
      ATTESTED_RESULT_FIELDS.map(name => [name, fields[name]]),
    ),
  );
}

/** Constant-time comparison that treats malformed signatures as a mismatch. */
export function signaturesMatch(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  if (!SIGNATURE.test(expected) || !SIGNATURE.test(actual)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

function resultFields(record, result) {
  return {
    version: record.version,
    specId: record.id,
    fingerprint: record.fingerprint,
    checkId: result.checkId,
    command: result.command,
    cwd: result.checkCwd ?? null,
    outputLogHash: result.outputLogHash ?? null,
    exitCode: result.exitCode ?? null,
    processId: result.processId ?? null,
    startedAt: result.startedAt ?? null,
    timedOut: result.timedOut ?? false,
    errorType: result.errorType ?? null,
  };
}

function recordPayload(record) {
  return canonicalPayload(RECORD_DOMAIN, [
    ['version', record.version],
    ['id', record.id],
    ['mode', record.mode],
    ['passed', record.passed],
    ['fingerprint', record.fingerprint],
    ['verifiedAt', record.verifiedAt],
    ['reason', record.reason],
    ['timeoutOverride', record.timeoutOverride],
    ['checks', record.checks],
    ['hollowTests', record.hollowTests ?? []],
    ['results', (record.results ?? []).map(result => result.attestationSignature)],
    ['keyId', record.attestationKeyId],
  ]);
}

/**
 * Adds a signature to every result plus a record signature. Mutates and returns `record`.
 * @param {Buffer} key
 * @param {object} record verification.json content before it is written.
 */
export function signRecord(key, record) {
  record.attestationKeyId = keyId(key);
  for (const result of record.results) result.attestationSignature = signResult(key, resultFields(record, result));
  record.recordSignature = hmac(key, recordPayload(record));
  return record;
}

/**
 * @param {Buffer} key
 * @param {object} record Parsed verification.json.
 * @throws {AttestationError} When any signature is missing, malformed or does not match.
 */
export function verifyRecord(key, record) {
  if (record.attestationKeyId !== keyId(key))
    throw new AttestationError(
      'the record was signed with a different attestation key (rotated or another machine). Run verify again.',
    );
  if (!Array.isArray(record.results)) throw new AttestationError('the record has no results. Run verify again.');
  record.results.forEach((result, index) => {
    if (!signaturesMatch(signResult(key, resultFields(record, result)), result.attestationSignature))
      throw new AttestationError(
        `check result ${index + 1} (${result.checkId}) does not match its signature; it was not produced by this engine. Run verify again.`,
      );
  });
  if (!signaturesMatch(hmac(key, recordPayload(record)), record.recordSignature))
    throw new AttestationError('the record summary does not match its signature. Run verify again.');
}
