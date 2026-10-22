import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { auditSpec } from './auditor.mjs';
import { loadManifest, saveManifest, withManifestLock } from './manifest.mjs';
import { safePath } from './managed.mjs';
import { reviewAcceptance, bindAcceptance } from './acceptance.mjs';

const excluded = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  'dist',
  'build',
  'target',
  'coverage',
  '.next',
  '.nuxt',
  '.omni',
]);
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

// Bind evidence to source and spec contents in non-Git as well as Git projects.
// Build/dependency caches are excluded explicitly; nothing invokes Git or edits it.
export async function projectFingerprint(root, spec, gates) {
  const digest = createHash('sha256');
  let count = 0,
    bytes = 0;
  async function addFile(path, name) {
    count += 1;
    bytes += (await stat(path)).size;
    if (count > 20000 || bytes > 256 * 1024 * 1024)
      throw new Error('Verification snapshot exceeds 20,000 files / 256 MiB. Narrow the project root.');
    digest
      .update(name + '\0')
      .update(await readFile(path))
      .update('\0');
  }
  async function walk(directory, relative = '', specFiles = false) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!specFiles && excluded.has(entry.name)) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (!specFiles && name === 'specs') continue;
      if (specFiles && name === `specs/${spec.slug}/verification.json`) continue;
      if (entry.isSymbolicLink())
        throw new Error(`Verification cannot attest symlinked source: ${name}. Use a regular-file project copy.`);
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path, name, specFiles);
      else if (entry.isFile()) await addFile(path, name);
    }
  }
  await walk(root);
  const specPath = `specs/${spec.slug}`;
  await walk(await safePath(root, specPath), specPath, true);
  try {
    await addFile(await safePath(root, 'specs/project-context.md'), 'specs/project-context.md');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  digest.update(JSON.stringify({ type: spec.type, gates }));
  return digest.digest('hex');
}

function runCommand(command, root, timeout) {
  return new Promise(resolve => {
    const startedAt = new Date().toISOString();
    let output = '',
      timedOut = false,
      cleanupTimer,
      killer,
      settled = false;
    const child = spawn(command, {
      cwd: root,
      shell: true,
      windowsHide: true,
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const append = data => {
      output = (output + data.toString()).slice(-16000);
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
        cwd: root,
        processId: child.pid ?? null,
        startedAt,
        finishedAt: new Date().toISOString(),
        output,
        timedOut,
        ...result,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
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
            'Timeout cleanup could not confirm process-tree termination; inspect remaining processes before retrying.',
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
    }, timeout);
    child.on('error', error => {
      finish({ exitCode: null, error: error.message });
    });
    child.on('close', (code, signal) => {
      finish({ exitCode: code, signal });
    });
  });
}

export async function verifySpec(root, identifier, options = {}) {
  return withManifestLock(root, async () => {
    const { manifest, spec } = await getSpec(root, identifier);
    const initial = await ready(root, spec);
    const gates = (manifest.qualityGates || '')
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('#'));
    const mode = spec.type === 'rfc' ? 'decision' : gates.length ? 'automated' : 'manual';
    bindAcceptance(initial.acceptance, gates);
    if (mode === 'manual' && (!options.manual || options.manual.trim().length < 20))
      throw new Error(
        'No quality gates configured. Use configure --gates or --manual with a specific reason (at least 20 characters) and verification.md evidence.',
      );
    if (gates.length && options.manual && spec.type !== 'rfc')
      throw new Error('Manual verification cannot bypass configured quality gates.');
    const before = await projectFingerprint(root, spec, manifest.qualityGates);
    const results = [];
    if (mode === 'automated')
      for (const command of gates) {
        const result = await runCommand(command, root, options.timeout || 120000);
        results.push(result);
        if (result.exitCode !== 0 || result.timedOut) break;
      }
    const after = await projectFingerprint(root, spec, manifest.qualityGates);
    const acceptance = bindAcceptance(await reviewAcceptance(root, spec), gates, results);
    const passed =
      before === after &&
      acceptance.automatedChecksPassed &&
      results.every(r => r.exitCode === 0 && !r.timedOut && !r.error) &&
      (mode !== 'automated' || results.length === gates.length);
    const record = {
      version: 2,
      id: spec.id,
      mode,
      passed,
      verifiedAt: new Date().toISOString(),
      fingerprint: after,
      sourceChangedDuringVerification: before !== after,
      reason: options.manual || null,
      acceptance,
      results,
    };
    const path = await safePath(root, `specs/${spec.slug}/verification.json`);
    await writeFile(path, JSON.stringify(record, null, 2) + '\n');
    return record;
  });
}

export async function completeSpec(root, identifier) {
  return withManifestLock(root, async () => {
    const { manifest, spec } = await getSpec(root, identifier);
    const initial = await ready(root, spec);
    let record;
    try {
      record = JSON.parse(await readFile(join(root, 'specs', spec.slug, 'verification.json'), 'utf8'));
    } catch {
      throw new Error('No valid verification record. Run verify before complete.');
    }
    if (
      record.version !== 2 ||
      record.id !== spec.id ||
      record.passed !== true ||
      !['automated', 'manual', 'decision'].includes(record.mode)
    )
      throw new Error('Verification did not pass. Run verify again.');
    if (record.fingerprint !== (await projectFingerprint(root, spec, manifest.qualityGates)))
      throw new Error('Source, specification or gates changed after verification. Run verify again.');
    const gates = (manifest.qualityGates || '')
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('#'));
    const expectedMode = spec.type === 'rfc' ? 'decision' : gates.length ? 'automated' : 'manual';
    if (record.mode !== expectedMode) throw new Error('Verification mode changed. Run verify again.');
    if (!Array.isArray(record.results) || record.results.some(result => !result || typeof result !== 'object'))
      throw new Error('Invalid verification results. Run verify again.');
    const acceptance = bindAcceptance(initial.acceptance, gates, record.results);
    if (
      !acceptance.automatedChecksPassed ||
      (record.mode === 'automated' &&
        (record.results.length !== gates.length ||
          gates.some((command, index) => {
            const result = record.results[index];
            return result.command !== command || result.exitCode !== 0 || result.timedOut || result.error;
          })))
    )
      throw new Error('Verification checks did not pass. Run verify again.');
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
