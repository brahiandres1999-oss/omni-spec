import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { loadChecks, validateChecks } from '../src/checks.mjs';
import { verifySpec, completeSpec, projectFingerprint, VERIFICATION_RECORD_VERSION } from '../src/verification.mjs';
import { loadManifest, saveManifest } from '../src/manifest.mjs';
import { fillSpec } from '../test-support/fixtures.mjs';
import {
  ATTESTED_RESULT_FIELDS,
  attestationKeyPath,
  canonicalPayload,
  getAttestationKey,
  keyId,
  rotateAttestationKey,
  signResult,
  signaturesMatch,
} from '../src/attestation.mjs';
import { fileBackend } from '../src/secure-store.mjs';
import { lex } from '../src/js-lexer.mjs';

const cli = fileURLToPath(new URL('../bin/omni-spec.mjs', import.meta.url));
const verificationSource = fileURLToPath(new URL('../src/verification.mjs', import.meta.url));
let home;
before(() => {
  home = mkdtempSync(join(tmpdir(), 'omni-attest-home-'));
  process.env.OMNISPEC_HOME = home;
});
after(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

let root, spec;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omni-attest-'));
  await scaffoldProject(root, { qualityGates: '' });
  spec = await createSpec(root, 'feature', 'attested', { full: true });
  await fillSpec(root, spec);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const catalogue = checks => writeFile(join(root, 'specs/checks.json'), JSON.stringify({ schemaVersion: 1, checks }));

describe('Guardian inside verification (C-01, C-02 / T-06)', () => {
  test('AT-15 checks.json with chained commands fails validation with a split hint', async () => {
    await assert.rejects(
      validateChecks(root, { schemaVersion: 1, checks: [{ id: 'all', command: 'npm test && npm run lint' }] }),
      error => /GUARDIAN_SHELL_OPERATOR/.test(error.message) && /separate checks/.test(error.message),
    );
    await catalogue([{ id: 'pipe', command: 'node a.cjs | node b.cjs' }]);
    await assert.rejects(loadChecks(root, {}), /GUARDIAN_SHELL_OPERATOR/);
  });

  test('AT-16 a command blocked at run time is recorded as policy and never spawned', async () => {
    const manifest = await loadManifest(root);
    manifest.qualityGates = 'curl https://example.invalid';
    await saveManifest(root, manifest);
    const record = await verifySpec(root, spec.id);
    assert.equal(record.passed, false);
    const [result] = record.results;
    assert.equal(result.errorType, 'policy');
    assert.equal(result.processId, null);
    assert.match(result.error, /GUARDIAN_UNAUTHORIZED_BINARY/);
    assert.match(await readFile(join(root, result.outputLog), 'utf8'), /GUARDIAN_UNAUTHORIZED_BINARY/);
    await assert.rejects(completeSpec(root, spec.id), /blocked by Omni-Guardian/);
  });

  test('AT-17 an approved binary that is not installed is an environment failure', async () => {
    const manifest = await loadManifest(root);
    manifest.guardian = { allowedBinaries: ['omni-missing-tool'] };
    manifest.qualityGates = 'omni-missing-tool --version';
    await saveManifest(root, manifest);
    const record = await verifySpec(root, spec.id);
    assert.equal(record.results[0].errorType, 'environment');
    assert.match(record.results[0].error, /GUARDIAN_BINARY_NOT_FOUND/);
  });

  test('AT-17b quoted operators run unchanged without a shell', async () => {
    await writeFile(join(root, 'echo.cjs'), 'console.log(JSON.stringify(process.argv.slice(2)));');
    await catalogue([{ id: 'quoted', command: 'node echo.cjs "a && b | c > d" \'$HOME\'' }]);
    const record = await verifySpec(root, spec.id);
    assert.equal(record.passed, true, record.results[0]?.error);
    assert.equal(record.results[0].output.trim(), JSON.stringify(['a && b | c > d', '$HOME']));
  });
});

const baseFields = {
  version: 4,
  specId: 'SPEC-001',
  fingerprint: 'f'.repeat(64),
  checkId: 'unit',
  command: 'node check.cjs',
  cwd: '.',
  outputLogHash: 'a'.repeat(64),
  exitCode: 0,
  processId: 4242,
  startedAt: '2026-11-05T10:00:00.000Z',
  timedOut: false,
  errorType: null,
};

async function failingThenForged() {
  await catalogue([{ id: 'unit', command: 'node -e "process.exit(3)"' }]);
  const record = await verifySpec(root, spec.id);
  assert.equal(record.passed, false);
  return record;
}

const writeRecord = record =>
  writeFile(join(root, 'specs', spec.slug, 'verification.json'), `${JSON.stringify(record, null, 2)}\n`);

describe('HMAC attestation primitives (C-05 / T-03)', () => {
  test('AT-01 one 256-bit key per user, protected outside the repo and shared by every process', async () => {
    const path = attestationKeyPath();
    assert.equal(path, join(home, 'keys', 'attestation.key'));
    const key = await getAttestationKey();
    assert.equal(key.length, 32);
    const stored = await readFile(path);
    assert.ok(!stored.includes(key), 'the raw key is not on disk');
    if (process.platform === 'win32') {
      assert.equal(JSON.parse(stored).scheme, 'dpapi');
      assert.ok(!stored.toString('utf8').includes(key.toString('base64')));
    }
    const other = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { getAttestationKey, keyId } from ${JSON.stringify(new URL('../src/attestation.mjs', import.meta.url).href)};
         process.stdout.write(keyId(await getAttestationKey()));`,
      ],
      { encoding: 'utf8', env: { ...process.env, OMNISPEC_HOME: home } },
    );
    assert.equal(other, keyId(key));
  });

  test('AT-02 signatures are deterministic for the same key and payload', () => {
    const key = Buffer.alloc(32, 1);
    assert.equal(signResult(key, baseFields), signResult(key, { ...baseFields }));
    assert.match(signResult(key, baseFields), /^[a-f0-9]{64}$/);
    assert.notEqual(signResult(Buffer.alloc(32, 2), baseFields), signResult(key, baseFields));
  });

  test('AT-03 every attested field changes the signature', () => {
    const key = Buffer.alloc(32, 1);
    const original = signResult(key, baseFields);
    const changes = {
      version: 3,
      specId: 'SPEC-002',
      fingerprint: 'e'.repeat(64),
      checkId: 'lint',
      command: 'node other.cjs',
      cwd: 'packages/a',
      outputLogHash: 'b'.repeat(64),
      exitCode: 1,
      processId: 4243,
      startedAt: '2026-11-05T10:00:00.001Z',
      timedOut: true,
      errorType: 'check-failed',
    };
    assert.deepEqual(Object.keys(changes), [...ATTESTED_RESULT_FIELDS]);
    for (const [field, value] of Object.entries(changes))
      assert.notEqual(signResult(key, { ...baseFields, [field]: value }), original, field);
  });

  test('AT-04 values cannot imitate field separators', () => {
    const key = Buffer.alloc(32, 1);
    const a = signResult(key, { ...baseFields, checkId: 'a|b', fingerprint: 'c' });
    const b = signResult(key, { ...baseFields, checkId: 'a', fingerprint: 'b|c' });
    assert.notEqual(a, b);
    const c = signResult(key, { ...baseFields, checkId: 'x\ncommand=8:"evil"' });
    assert.notEqual(c, signResult(key, { ...baseFields, checkId: 'x', command: 'evil' }));
    assert.match(canonicalPayload('d', [['a', 'x\ny']]), /^d\na=6:"x\\ny"$/);
  });

  test('AT-05 malformed or mismatched signatures compare as false without throwing', () => {
    const good = 'a'.repeat(64);
    assert.equal(signaturesMatch(good, good), true);
    for (const bad of ['', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64), null, 42, 'b'.repeat(64)])
      assert.equal(signaturesMatch(good, bad), false, String(bad));
  });

  test('AT-14 a rotated key invalidates earlier records', async () => {
    const path = join(home, 'rotation', 'attestation.key');
    const backend = fileBackend();
    const first = await getAttestationKey({ path, backend });
    const second = await rotateAttestationKey({ path, backend });
    assert.notEqual(keyId(first), keyId(second));
    assert.equal(keyId(await getAttestationKey({ path, backend })), keyId(second));
  });
});

describe('Attested verification records (C-05 / T-02, T-03)', () => {
  test('AT-06 records are version 4 and every result carries a signature', async () => {
    await catalogue([{ id: 'unit', command: 'node -e "process.exit(0)"' }]);
    const record = await verifySpec(root, spec.id);
    assert.equal(record.version, 4);
    assert.equal(VERIFICATION_RECORD_VERSION, 4);
    assert.equal(record.attestationKeyId, keyId(await getAttestationKey()));
    assert.match(record.recordSignature, /^[a-f0-9]{64}$/);
    for (const result of record.results) assert.match(result.attestationSignature, /^[a-f0-9]{64}$/);
    assert.equal((await completeSpec(root, spec.id)).status, 'COMPLETED');
  });

  test('AT-07 a structurally perfect record with forged signatures is rejected', async () => {
    await catalogue([{ id: 'unit', command: 'node -e "process.exit(0)"' }]);
    const record = await verifySpec(root, spec.id);
    record.results[0].attestationSignature = 'c'.repeat(64);
    await writeRecord(record);
    await assert.rejects(completeSpec(root, spec.id), /ATTESTATION_INVALID/);
    delete record.results[0].attestationSignature;
    await writeRecord(record);
    await assert.rejects(completeSpec(root, spec.id), /ATTESTATION_INVALID/);
  });

  test('AT-08 a valid record replayed onto another specification is rejected', async () => {
    await catalogue([{ id: 'unit', command: 'node -e "process.exit(0)"' }]);
    const other = await createSpec(root, 'feature', 'replay-target', { full: true });
    await fillSpec(root, other);
    const record = await verifySpec(root, spec.id);
    const manifest = await loadManifest(root);
    const target = manifest.specs.find(item => item.id === other.id);
    record.id = other.id;
    record.fingerprint = await projectFingerprint(root, target, {
      qualityGates: manifest.qualityGates,
      checks: await loadChecks(root, manifest),
    });
    await writeFile(join(root, 'specs', target.slug, 'verification.json'), JSON.stringify(record));
    await assert.rejects(completeSpec(root, other.id), /ATTESTATION_INVALID/);
  });

  test('AT-09 a failed check edited to exit 0 is rejected', async () => {
    const record = await failingThenForged();
    Object.assign(record.results[0], { exitCode: 0, errorType: null });
    record.passed = true;
    for (const criterion of record.acceptance.criteria ?? []) criterion.execution = 'PASSED';
    record.acceptance.automatedChecksPassed = true;
    await writeRecord(record);
    await assert.rejects(completeSpec(root, spec.id), /ATTESTATION_INVALID/);
  });

  test('AT-10 an output log edited after verification is rejected', async () => {
    await catalogue([{ id: 'unit', command: 'node -e "console.log(1)"' }]);
    const record = await verifySpec(root, spec.id);
    await writeFile(join(root, record.results[0].outputLog), 'PASS - all 14 tests completed\n');
    await assert.rejects(completeSpec(root, spec.id), /output log changed/);
  });

  test('AT-11 output logs are created exclusively and never overwritten', async () => {
    const tokens = lex(await readFile(verificationSource, 'utf8')).filter(token => token.type !== 'comment');
    const writes = tokens
      .map((token, index) => ({ token, index }))
      .filter(({ token, index }) => token.value === 'writeFile' && tokens[index + 2]?.value === 'logPath');
    assert.equal(writes.length, 1);
    const window = tokens.slice(writes[0].index, writes[0].index + 12).map(token => token.value);
    assert.ok(window.includes('flag') && window.includes("'wx'"), window.join(' '));
  });

  test('AT-12 the key never reaches records, logs, child environments or errors', async () => {
    const key = await getAttestationKey();
    await writeFile(join(root, 'env.cjs'), 'console.log(JSON.stringify(process.env));');
    await catalogue([{ id: 'env', command: 'node env.cjs' }]);
    const record = await verifySpec(root, spec.id);
    const log = await readFile(join(root, record.results[0].outputLog), 'utf8');
    const stored = await readFile(join(root, 'specs', spec.slug, 'verification.json'), 'utf8');
    for (const text of [log, stored])
      for (const form of [key.toString('hex'), key.toString('base64')]) assert.ok(!text.includes(form));
    record.results[0].attestationSignature = 'd'.repeat(64);
    await writeRecord(record);
    const error = await completeSpec(root, spec.id).then(
      () => assert.fail('expected rejection'),
      failure => failure,
    );
    assert.ok(!error.message.includes(key.toString('hex')));
  });

  test('AT-13 version 3 records require a fresh verify', async () => {
    const record = await verifySpec(root, spec.id, { manual: 'Manual review of the deterministic greeting fixture.' });
    record.version = 3;
    await writeRecord(record);
    await assert.rejects(completeSpec(root, spec.id), /earlier OmniSpec version. Run verify again/);
  });

  test('AT-13b manual records are signed too', async () => {
    const record = await verifySpec(root, spec.id, { manual: 'Manual review of the deterministic greeting fixture.' });
    record.reason = 'A different manual justification typed by an agent.';
    await writeRecord(record);
    await assert.rejects(completeSpec(root, spec.id), /ATTESTATION_INVALID/);
  });

  test('AT-14b a record signed with another key asks for a new verify', async () => {
    await catalogue([{ id: 'unit', command: 'node -e "process.exit(0)"' }]);
    const record = await verifySpec(root, spec.id);
    record.attestationKeyId = '0'.repeat(16);
    await writeRecord(record);
    await assert.rejects(completeSpec(root, spec.id), /different attestation key/);
  });

  test('AT-18 verify and complete in separate CLI processes', async () => {
    await catalogue([{ id: 'unit', command: 'node -e "process.exit(0)"' }]);
    const env = { ...process.env, OMNISPEC_HOME: home };
    execFileSync(process.execPath, [cli, 'verify', spec.id], { cwd: root, env, encoding: 'utf8' });
    const output = execFileSync(process.execPath, [cli, 'complete', spec.id], { cwd: root, env, encoding: 'utf8' });
    assert.match(output, /COMPLETED|complete/i);
    assert.equal((await loadManifest(root)).specs.find(item => item.id === spec.id).status, 'COMPLETED');
  });

  test('AT-19 the signed process id is the real child process id', async () => {
    await writeFile(join(root, 'pid.cjs'), 'console.log(process.pid);');
    await catalogue([{ id: 'pid', command: 'node pid.cjs' }]);
    const record = await verifySpec(root, spec.id);
    assert.equal(Number(record.results[0].output.trim()), record.results[0].processId);
  });
});
