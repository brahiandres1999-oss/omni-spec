import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { auditSpec } from './auditor.mjs';
import { loadManifest, saveManifest, withManifestLock, withVerificationLock } from './manifest.mjs';
import { safePath } from './managed.mjs';
import { writeFileAtomic } from './fs-retry.mjs';
import { hashProjectFiles, hashTree, digestFiles, changedFiles, newBudget } from './snapshot.mjs';
import { reviewAcceptance, bindAcceptance } from './acceptance.mjs';
import { loadChecks, checkDirectory } from './checks.mjs';
import { assertContextFresh } from './project-state.mjs';

const placeholders = /\[TODO\]|\[NEEDS CLARIFICATION\]|\b(?:SPEC|BUG|DEBT|RFC)-XXX\b/i;

async function getSpec(root, identifier) {
  const manifest = await loadManifest(root);
  const spec = manifest?.specs.find(s =>
    identifier ? s.id === identifier || s.slug === identifier : s.slug === manifest.active_spec,
  );
  if (!spec) throw new Error('Specification not found. Use list and an exact ID.');
  await safePath(root, `specs/${spec.slug}`);
  return { manifest, spec };
}

async function ready(root, spec) {
  await assertContextFresh(root, spec);
  const audit = await auditSpec(root, spec.id);
  if (!audit.valid) throw new Error(`Cannot verify/complete: ${audit.errors.join('; ')}`);
  if (audit.tasks.pending) throw new Error(`Cannot verify/complete: ${audit.tasks.pending} tasks remain pending.`);
  let evidence;
  try {
    evidence = (await readFile(await safePath(root, `specs/${spec.slug}/verification.md`), 'utf8'))
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^#+.*$/gm, '')
      .trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(
      'Create verification.md in the specification folder with criterion-to-evidence mapping and actual results.',
    );
  }
  if (evidence.length < 40 || placeholders.test(evidence))
    throw new Error('Complete verification.md with actual criterion-to-evidence mapping and results.');
  if (spec.type === 'rfc') {
    const rfc = (await readFile(join(root, 'specs', spec.slug, 'rfc.md'), 'utf8')).replace(/<!--[\s\S]*?-->/g, '');
    const decisions = [...rfc.matchAll(/^Decision:\s*(\S+)\s*$/gm)];
    if (decisions.length !== 1 || !['ACCEPTED', 'REJECTED', 'DEFERRED'].includes(decisions[0][1]))
      throw new Error(
        'RFC requires exactly one Decision: ACCEPTED, REJECTED or DEFERRED and a reasoned verification.md.',
      );
  }
  const acceptance = await reviewAcceptance(root, spec);
  return { ...audit, acceptance };
}

const STATE_FILES = ['project-context.md', 'checks.json', 'contracts.json'];

/**
 * Snapshot source and specification inputs bound by verification. Git and .omnispecignore
 * rules exclude generated outputs; unrelated specs and OmniSpec metadata are outside it.
 * Session observations in project-state.json do not change the snapshot; decisions and the
 * context baseline do. Nothing invokes Git or edits the project.
 * @returns {Promise<{fingerprint:string, files:Map<string,string>}>}
 */
export async function projectSnapshot(root, spec, gates) {
  const budget = newBudget();
  const label = 'Verification snapshot';
  const files = await hashProjectFiles(root, { skipTop: new Set(['specs']), label, budget });
  const specPath = `specs/${spec.slug}`;
  await safePath(root, specPath);
  for (const [name, digest] of await hashTree(root, specPath, {
    exclude: new Set([`${specPath}/verification.json`]),
    label,
    budget,
  }))
    files.set(name, digest);
  for (const name of STATE_FILES) {
    try {
      files.set(
        `specs/${name}`,
        createHash('sha256')
          .update(await readFile(await safePath(root, `specs/${name}`)))
          .digest('hex'),
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  let state = { decisions: [], context: null };
  try {
    state = JSON.parse(
      (await readFile(await safePath(root, 'specs/project-state.json'), 'utf8')).replace(/^\uFEFF/, ''),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  files.set(
    'specs/project-state.json#decisions-context',
    createHash('sha256')
      .update(JSON.stringify({ decisions: state.decisions ?? [], context: state.context ?? null }))
      .digest('hex'),
  );
  const configuration = JSON.stringify({ type: spec.type, gates });
  files.set('#configuration', createHash('sha256').update(configuration).digest('hex'));
  return { fingerprint: digestFiles(files, 'omnispec-snapshot-v3'), files };
}

/** @returns {Promise<string>} Fingerprint of the current verification snapshot. */
export async function projectFingerprint(root, spec, gates) {
  return (await projectSnapshot(root, spec, gates)).fingerprint;
}

async function runCommand(check, root, timeoutOverride) {
  const { command, id: checkId } = check;
  const cwd = await checkDirectory(root, check.cwd);
  const timeout = timeoutOverride ?? check.timeoutMs;
  const logName = `specs/.omni/verification-logs/${randomUUID()}.log`;
  const logPath = await safePath(root, logName);
  await mkdir(await safePath(root, 'specs/.omni/verification-logs'), { recursive: true });
  const result = await new Promise(resolve => {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const chunks = [];
    const outputLimit = 8 * 1024 * 1024;
    let outputBytes = 0,
      outputTotalBytes = 0,
      outputLimitExceeded = false;
    let output = '',
      timedOut = false,
      cleanupTimer,
      killer,
      settled = false;
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const append = data => {
      outputTotalBytes += data.length;
      const remaining = Math.max(0, outputLimit - outputBytes);
      const kept = data.subarray(0, remaining);
      if (kept.length) chunks.push(kept);
      outputBytes += kept.length;
      output = (output + data.toString()).slice(-16000);
      if (outputTotalBytes > outputLimit && !outputLimitExceeded) {
        outputLimitExceeded = true;
        terminate();
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      if (killer) killer.unref();
      resolve({
        command,
        checkId,
        cwd,
        checkCwd: check.cwd,
        kind: check.kind,
        timeoutMs: timeout,
        processId: child.pid ?? null,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        output,
        outputTruncated: outputTotalBytes > Buffer.byteLength(output),
        outputBytes,
        outputTotalBytes,
        outputLimitExceeded,
        outputLimitBytes: outputLimit,
        outputLog: logName,
        logData: Buffer.concat(chunks),
        timedOut,
        ...result,
        errorType: timedOut
          ? 'timeout'
          : outputLimitExceeded
            ? 'output-limit'
            : (result.errorType ?? (result.exitCode === 0 ? null : 'check-failed')),
        ...(outputLimitExceeded
          ? { error: `Check output exceeded ${outputLimit} bytes; process stopped and log is incomplete.` }
          : {}),
      });
    };
    const terminate = () => {
      if (cleanupTimer) return;
      // A failed tree kill or inherited pipe must never keep verification locked forever.
      cleanupTimer = setTimeout(() => {
        child.kill('SIGKILL');
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        if (killer) killer.kill();
        finish({
          exitCode: null,
          error:
            'Process cleanup could not confirm process-tree termination; inspect remaining processes before retrying.',
        });
      }, 2000);
      if (process.platform === 'win32' && child.pid) {
        killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
        killer.on('exit', code => {
          if (code !== 0) child.kill();
        });
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeout);
    child.on('error', error => {
      finish({ exitCode: null, error: error.message, errorType: 'environment' });
    });
    child.on('close', (code, signal) => {
      finish({ exitCode: code, signal });
    });
  });
  const { logData, ...record } = result;
  try {
    await writeFile(logPath, logData, { flag: 'wx' });
    record.outputLogHash = createHash('sha256').update(logData).digest('hex');
  } catch (error) {
    record.error = `Cannot persist check output: ${error.message}`;
    record.errorType = 'environment';
  }
  // Shells report a missing executable as an exit status rather than spawn errors.
  if (record.errorType === 'check-failed' && [126, 127, 9009].includes(record.exitCode))
    record.errorType = 'environment';
  return record;
}

export const VERIFICATION_RECORD_VERSION = 3;

/**
 * Run approved checks and bind the result to a snapshot. The manifest lock is held only to
 * prepare and record; checks run under a separate verification lock so other commands stay
 * responsive. Any snapshot change while checks run is reported by path and fails the record.
 */
export async function verifySpec(root, identifier, options = {}) {
  if (
    options.timeout !== undefined &&
    (!Number.isInteger(options.timeout) || options.timeout < 100 || options.timeout > 3600000)
  )
    throw new Error('Verification timeout must be an integer from 100 to 3600000 milliseconds.');
  return withVerificationLock(root, async () => {
    const prepared = await withManifestLock(root, async () => {
      const { manifest, spec } = await getSpec(root, identifier);
      const initial = await ready(root, spec);
      const checks = await loadChecks(root, manifest);
      const mode = spec.type === 'rfc' ? 'decision' : checks.length ? 'automated' : 'manual';
      bindAcceptance(initial.acceptance, checks);
      if (mode === 'manual' && (!options.manual || options.manual.trim().length < 20))
        throw new Error(
          'No quality gates configured. Use checks --from/configure --gates, or --manual with a specific reason (at least 20 characters) and verification.md evidence.',
        );
      if (checks.length && options.manual && spec.type !== 'rfc')
        throw new Error('Manual verification cannot bypass configured quality gates.');
      const configuration = { qualityGates: manifest.qualityGates, checks };
      const before = await projectSnapshot(root, spec, configuration);
      return { spec, checks, mode, before };
    });
    const { spec, checks, mode, before } = prepared;
    const results = [];
    if (mode === 'automated')
      for (const check of checks) {
        const result = await runCommand(check, root, options.timeout);
        results.push(result);
        if (result.exitCode !== 0 || result.timedOut || result.error) break;
      }
    return withManifestLock(root, async () => {
      const manifest = await loadManifest(root);
      const current = manifest?.specs.find(item => item.id === spec.id);
      if (!current || current.slug !== spec.slug)
        throw new Error('Specification changed during verification. Run verify again.');
      const after = await projectSnapshot(root, spec, {
        qualityGates: manifest.qualityGates,
        checks: await loadChecks(root, manifest),
      });
      const changed = changedFiles(before.files, after.files);
      let acceptance;
      let acceptanceError = null;
      try {
        acceptance = bindAcceptance(await reviewAcceptance(root, spec), checks, results);
      } catch (error) {
        acceptanceError = error.message;
        acceptance = { criteria: [], automatedChecksPassed: false, error: error.message };
      }
      const passed =
        !changed.length &&
        !acceptanceError &&
        acceptance.automatedChecksPassed &&
        results.every(r => r.exitCode === 0 && !r.timedOut && !r.error) &&
        (mode !== 'automated' || results.length === checks.length);
      const record = {
        version: VERIFICATION_RECORD_VERSION,
        id: spec.id,
        mode,
        passed,
        verifiedAt: new Date().toISOString(),
        fingerprint: after.fingerprint,
        // Visible count of attested project files (excluding specs/ and OmniSpec state) so an
        // ignore rule that hides source is noticed.
        attestedFiles: [...after.files.keys()].filter(name => !name.startsWith('specs/') && !name.startsWith('#'))
          .length,
        sourceChangedDuringVerification: changed.length > 0,
        changedDuringVerification: changed.slice(0, 50),
        changedDuringVerificationCount: changed.length,
        reason: options.manual || null,
        checks,
        timeoutOverride: options.timeout ?? null,
        acceptance,
        results,
      };
      await writeFileAtomic(
        await safePath(root, `specs/${spec.slug}/verification.json`),
        JSON.stringify(record, null, 2) + '\n',
      );
      return record;
    });
  });
}

/** @returns {string} One-line reason a stored verification record failed. */
export function describeFailure(record) {
  if (record.sourceChangedDuringVerification)
    return `files changed while checks ran (${(record.changedDuringVerification || []).slice(0, 5).join(', ') || 'see record'}${record.changedDuringVerificationCount > 5 ? ', ...' : ''}). Exclude generated outputs in .gitignore or .omnispecignore, or stop concurrent edits.`;
  if (record.acceptance?.error) return `acceptance review failed after checks: ${record.acceptance.error}`;
  const failed = (record.results || []).find(result => result.exitCode !== 0 || result.timedOut || result.error);
  if (failed)
    return `check ${failed.checkId || failed.command} ${failed.timedOut ? 'timed out' : failed.errorType === 'environment' ? 'could not run (environment)' : `exited ${failed.exitCode}`}.`;
  if (record.acceptance && !record.acceptance.automatedChecksPassed)
    return 'an automated criterion is not bound to a passing executed check.';
  return 'see verification.json.';
}

/** Read-only validation of current audit, criterion bindings, check identities and stored output. */
export async function inspectVerification(root, spec, manifest) {
  const initial = await ready(root, spec);
  let record;
  try {
    record = JSON.parse(await readFile(join(root, 'specs', spec.slug, 'verification.json'), 'utf8'));
  } catch {
    throw new Error('No valid verification record. Run verify before complete.');
  }
  if (record?.version !== VERIFICATION_RECORD_VERSION)
    throw new Error('Verification record was produced by an earlier OmniSpec version. Run verify again.');
  if (record.id !== spec.id || !['automated', 'manual', 'decision'].includes(record.mode))
    throw new Error('Verification record does not belong to this specification. Run verify again.');
  if (record.passed !== true)
    throw new Error(`Verification did not pass: ${describeFailure(record)} Run verify again.`);
  const checks = await loadChecks(root, manifest);
  if (!Array.isArray(record.checks) || JSON.stringify(record.checks) !== JSON.stringify(checks))
    throw new Error(
      'Verification check identity/configuration changed after verification or is missing. Run verify again.',
    );
  const snapshot = await projectSnapshot(root, spec, { qualityGates: manifest.qualityGates, checks });
  if (record.fingerprint !== snapshot.fingerprint)
    throw new Error('Source, specification or gates changed after verification. Run verify again.');
  const expectedMode = spec.type === 'rfc' ? 'decision' : checks.length ? 'automated' : 'manual';
  if (record.mode !== expectedMode) throw new Error('Verification mode changed. Run verify again.');
  if (!Array.isArray(record.results) || record.results.some(result => !result || typeof result !== 'object'))
    throw new Error('Invalid verification results. Run verify again.');
  const acceptance = bindAcceptance(initial.acceptance, checks, record.results);
  if (
    !acceptance.automatedChecksPassed ||
    (record.mode === 'automated' &&
      (record.results.length !== checks.length ||
        checks.some((check, index) => {
          const result = record.results[index];
          return (
            result.checkId !== check.id ||
            result.command !== check.command ||
            (result.checkCwd ?? null) !== check.cwd ||
            result.kind !== check.kind ||
            result.timeoutMs !== (record.timeoutOverride ?? check.timeoutMs) ||
            result.exitCode !== 0 ||
            result.timedOut ||
            result.error ||
            result.errorType ||
            result.outputLimitExceeded
          );
        })))
  )
    throw new Error('Verification checks did not pass. Run verify again.');
  for (const result of record.results) {
    if (
      typeof result.outputLog !== 'string' ||
      !/^specs\/\.omni\/verification-logs\/[a-f0-9-]+\.log$/.test(result.outputLog)
    )
      throw new Error('Invalid verification output log. Run verify again.');
    let output;
    try {
      const path = await safePath(root, result.outputLog);
      if ((await stat(path)).size > 8 * 1024 * 1024) throw new Error('Output log exceeds verification limit.');
      output = await readFile(path);
    } catch {
      throw new Error('Verification output log is missing. Run verify again.');
    }
    if (
      output.length !== result.outputBytes ||
      createHash('sha256').update(output).digest('hex') !== result.outputLogHash
    )
      throw new Error('Verification output log changed. Run verify again.');
  }
  return { record, acceptance };
}

export async function completeSpec(root, identifier) {
  return withVerificationLock(root, () => completeUnlocked(root, identifier), { wait: false });
}

async function completeUnlocked(root, identifier) {
  return withManifestLock(root, async () => {
    const { manifest, spec } = await getSpec(root, identifier);
    const { record, acceptance } = await inspectVerification(root, spec, manifest);
    spec.status = 'COMPLETED';
    spec.completed_at = spec.updated_at = new Date().toISOString();
    spec.verification = {
      mode: record.mode,
      verifiedAt: record.verifiedAt,
      fingerprint: record.fingerprint,
      acceptance,
    };
    if (manifest.active_spec === spec.slug) {
      manifest.active_spec = null;
      manifest.active_archetype = null;
    }
    await saveManifest(root, manifest);
    return spec;
  });
}
