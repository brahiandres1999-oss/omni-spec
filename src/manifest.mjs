import { readFile, writeFile, mkdir, unlink, readdir, stat, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { renameWithRetry } from './fs-retry.mjs';

const MANIFEST_FILE = 'manifest.json';
const LOCK_FILE = 'manifest.lock';

export const MANIFEST_SCHEMA_URL = './.omni/runtime/schema/manifest.schema.json';

/**
 * Strips a leading UTF-8 byte order mark so that files saved by Windows
 * editors (PowerShell 5.x, Notepad) never break JSON.parse.
 */
function stripBom(content) {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

export async function getManifestPath(baseDir) {
  return join(baseDir, 'specs', MANIFEST_FILE);
}

const CLAIM_NAME = /^([1-9]\d*)-[0-9a-f-]{36}$/;
const leases = new WeakSet();
const pause = ms => new Promise(done => setTimeout(done, ms));

function isDead(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === 'ESRCH';
  }
}

async function prepareLockDirectory(lockPath) {
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try {
      if ((await stat(lockPath)).isDirectory()) return;
      // Compatibility with the unpublished single-file implementation. Never
      // guess whether an empty legacy file belongs to a living writer.
      const legacy = JSON.parse(stripBom(await readFile(lockPath, 'utf8')));
      if (!Number.isSafeInteger(legacy.pid) || legacy.pid <= 0 || !isDead(legacy.pid)) {
        throw new Error(
          'Legacy manifest.lock has an active or unknown owner. Stop older OmniSpec processes before removing that file.',
        );
      }
      try {
        await unlink(lockPath);
      } catch (removal) {
        // A second cleaner may already have replaced the file with our directory.
        if (!['ENOENT', 'EISDIR', 'EPERM'].includes(removal.code)) throw removal;
      }
      await mkdir(lockPath, { recursive: true });
    } catch (legacyError) {
      if (legacyError.code === 'ENOENT') return mkdir(lockPath, { recursive: true });
      if (legacyError instanceof SyntaxError) {
        throw new Error(
          'Legacy manifest.lock is incomplete. Stop older OmniSpec processes and remove this legacy file before retrying.',
        );
      }
      throw legacyError;
    }
  }
}

async function removeClaim(lockPath, claim) {
  const target = resolve(lockPath, claim);
  if (!CLAIM_NAME.test(claim) || dirname(target) !== resolve(lockPath)) {
    throw new Error('Invalid manifest lock claim.');
  }
  // UUID paths are never reused. Concurrent cleaners cannot delete a successor.
  try {
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch (error) {
    if (!['ENOENT', 'EPERM', 'EBUSY'].includes(error.code)) throw error;
  }
}

async function participants(lockPath) {
  const result = [];
  for (const name of await readdir(lockPath)) {
    const match = CLAIM_NAME.exec(name);
    if (!match) continue;
    if (isDead(Number(match[1]))) {
      try {
        await removeClaim(lockPath, name);
      } catch (error) {
        if (!['ENOENT', 'EPERM', 'EBUSY'].includes(error.code)) throw error;
      }
      continue;
    }
    try {
      const ticket = await readFile(join(lockPath, name, 'ticket'), 'utf8');
      if (!/^[1-9]\d*$/.test(ticket)) throw new Error(`Invalid manifest lock ticket: ${name}`);
      result.push({ name, ticket: BigInt(ticket) });
    } catch (error) {
      if (!['ENOENT', 'EPERM', 'EBUSY'].includes(error.code)) throw error;
      try {
        await stat(join(lockPath, name));
        result.push({ name, ticket: null }); // choosing, not an abandoned empty lock
      } catch (gone) {
        if (!['ENOENT', 'EPERM', 'EBUSY'].includes(gone.code)) throw gone;
      }
    }
  }
  return result;
}

export async function acquireLock(lockPath, maxRetries = 150, delayMs = 50) {
  lockPath = resolve(lockPath);
  await prepareLockDirectory(lockPath);
  const name = `${process.pid}-${randomUUID()}`;
  const claimPath = join(lockPath, name);
  await mkdir(claimPath); // Atomic publication of both identity and choosing state.
  try {
    // Lamport bakery ordering: announce choosing, choose max+1, publish ticket,
    // then wait for choosing peers and all smaller (ticket, UUID) pairs.
    // Local-host filesystem coordination, not a distributed/network lock.
    const peers = await participants(lockPath);
    // biome-ignore lint/complexity/useMathMinMax: tickets are BigInt; Math.max throws on BigInt operands.
    const ticket = peers.reduce((max, peer) => (peer.ticket > max ? peer.ticket : max), 0n) + 1n;
    await writeFile(join(claimPath, 'ticket.tmp'), String(ticket), { flag: 'wx' });
    await renameWithRetry(join(claimPath, 'ticket.tmp'), join(claimPath, 'ticket'));
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const others = await participants(lockPath);
      const blocked = others.some(
        peer =>
          peer.name !== name &&
          (peer.ticket === null || peer.ticket < ticket || (peer.ticket === ticket && peer.name < name)),
      );
      if (!blocked) {
        const lease = Object.freeze({ lockPath, name });
        leases.add(lease);
        return lease;
      }
      await pause(delayMs + Math.floor(Math.random() * 30));
    }
    throw new Error(
      `Lock timeout: another OmniSpec command is updating ${lockLabel(lockPath)}. Retry when it finishes; if no OmniSpec process is running, inspect ${lockPath}.`,
    );
  } catch (error) {
    await removeClaim(lockPath, name);
    throw error;
  }
}

export async function releaseLock(lockPath, lease) {
  if (!lease || !leases.has(lease) || lease.lockPath !== resolve(lockPath)) {
    throw new Error('A matching manifest lock lease is required to release it.');
  }
  await removeClaim(lease.lockPath, lease.name);
  leases.delete(lease);
}

function lockLabel(lockPath) {
  return lockPath.endsWith('verify.lock') ? 'a verification run' : 'the project state';
}

/**
 * Serialize verification runs and completion without blocking other state commands.
 * @param {string} baseDir Project root.
 * @param {Function} action Work performed while the lock is held.
 * @param {{wait?: boolean}} options wait=false fails at once when a verification is running.
 */
export async function withVerificationLock(baseDir, action, options = {}) {
  const directory = join(baseDir, 'specs', '.omni');
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, 'verify.lock');
  let lease;
  try {
    lease = await acquireLock(lockPath, options.wait === false ? 3 : 150);
  } catch (error) {
    if (/^Lock timeout/.test(error.message))
      throw new Error('A verification is already running for this project. Wait for it to finish, then retry.');
    throw error;
  }
  try {
    return await action();
  } finally {
    await releaseLock(lockPath, lease);
  }
}

export async function withManifestLock(baseDir, action) {
  const specsDir = join(baseDir, 'specs');
  await mkdir(specsDir, { recursive: true });
  const lockPath = join(specsDir, LOCK_FILE);
  const lease = await acquireLock(lockPath);
  try {
    return await action();
  } finally {
    await releaseLock(lockPath, lease);
  }
}

export async function loadManifest(baseDir) {
  const filePath = await getManifestPath(baseDir);
  try {
    const raw = await readFile(filePath, 'utf-8');
    const manifest = JSON.parse(stripBom(raw));
    if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.specs))
      throw new Error('Expected a manifest object with a specs array.');
    const ids = new Set(),
      slugs = new Set();
    for (const spec of manifest.specs) {
      if (!spec || !/^\d+-[a-z0-9_-]+$/.test(spec.slug) || typeof spec.id !== 'string')
        throw new Error('Invalid specification ID or folder name.');
      if (ids.has(spec.id) || slugs.has(spec.slug)) throw new Error('Duplicate specification ID or folder name.');
      ids.add(spec.id);
      slugs.add(spec.slug);
    }
    if (manifest.active_spec && !slugs.has(manifest.active_spec))
      throw new Error('Active specification does not exist in specs.');
    return manifest;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw new Error(`Failed to parse ${MANIFEST_FILE}: ${err.message}`);
  }
}

export async function saveManifest(baseDir, manifest) {
  const specsDir = join(baseDir, 'specs');
  await mkdir(specsDir, { recursive: true });
  const targetPath = join(specsDir, MANIFEST_FILE);
  const tempPath = join(
    specsDir,
    `${MANIFEST_FILE}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`,
  );
  const content = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(tempPath, content, 'utf-8');
  await renameWithRetry(tempPath, targetPath);
  return manifest;
}

async function getPackageVersion() {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const raw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw);
    if (!pkg.version) throw new Error('Missing package version');
    return pkg.version;
  } catch (error) {
    throw new Error(`Cannot read installed OmniSpec version: ${error.message}`);
  }
}

export async function _initManifestUnlocked(baseDir, options = {}) {
  const existing = await loadManifest(baseDir);
  const resolvedStack = options.stack || options.techStack;
  const resolvedDoc = options.docStandard || options.documentationStandard;
  const pkgVersion = await getPackageVersion();
  const manifest = {
    ...existing,
    $schema: MANIFEST_SCHEMA_URL,
    schemaVersion: 1,
    project: options.projectName || existing?.project || 'MyProject',
    version: options.version || existing?.version || pkgVersion,
    profile: (options.explicitProfile ? options.profile : null) || existing?.profile || options.profile || 'general',
    stack: (options.explicitStack ? resolvedStack : null) || existing?.stack || resolvedStack || 'Undecided',
    documentationStandard:
      (options.explicitDoc ? resolvedDoc : null) ||
      existing?.documentationStandard ||
      resolvedDoc ||
      'Project conventions',
    qualityGates: options.qualityGates ?? existing?.qualityGates ?? '',
    agent: options.agent || options.ai || existing?.agent || 'antigravity',
    language: options.language || existing?.language || 'en',
    active_spec: existing?.active_spec || null,
    active_archetype: existing?.active_archetype || null,
    specs: existing && Array.isArray(existing.specs) ? existing.specs : [],
  };
  if (options.ui !== undefined) manifest.ui = options.ui;

  return saveManifest(baseDir, manifest);
}

export async function initManifest(baseDir, options = {}) {
  return withManifestLock(baseDir, async () => {
    return _initManifestUnlocked(baseDir, options);
  });
}

export async function addSpec(baseDir, specEntry) {
  return withManifestLock(baseDir, async () => {
    let manifest = await loadManifest(baseDir);
    if (!manifest) {
      manifest = await _initManifestUnlocked(baseDir);
    }

    const entry = {
      status: 'IN_PROGRESS',
      created_at: new Date().toISOString(),
      ...specEntry,
    };

    // Set active spec
    manifest.active_spec = entry.slug;
    manifest.active_archetype = entry.type;

    // Add or update entry in specs array
    const existingIdx = manifest.specs.findIndex(s => s.id === entry.id);
    if (existingIdx >= 0) {
      manifest.specs[existingIdx] = { ...manifest.specs[existingIdx], ...entry };
    } else {
      manifest.specs.push(entry);
    }

    await saveManifest(baseDir, manifest);
    return entry;
  });
}

export async function updateSpecStatus(baseDir, id, newStatus) {
  if (newStatus === 'COMPLETED') {
    const { completeSpec } = await import('./verification.mjs');
    return completeSpec(baseDir, id);
  }
  if (!['IN_PROGRESS', 'CLOSED', 'SUPERSEDED'].includes(newStatus)) throw new Error(`Invalid status: ${newStatus}`);
  return withManifestLock(baseDir, async () => {
    const manifest = await loadManifest(baseDir);
    if (!manifest) {
      throw new Error('No OmniSpec manifest found. Run `omni-spec init` first.');
    }

    const spec = manifest.specs.find(s => s.id === id || s.slug === id);
    if (!spec) {
      throw new Error(`Spec with identifier "${id}" not found in manifest.`);
    }

    spec.status = newStatus;
    spec.updated_at = new Date().toISOString();
    if (newStatus === 'COMPLETED') {
      spec.completed_at = spec.updated_at;
    }

    if (manifest.active_spec === spec.slug && ['COMPLETED', 'CLOSED', 'SUPERSEDED'].includes(newStatus)) {
      manifest.active_spec = null;
      manifest.active_archetype = null;
    }

    await saveManifest(baseDir, manifest);
    return spec;
  });
}

export async function getActiveSpec(baseDir) {
  const manifest = await loadManifest(baseDir);
  if (!manifest?.active_spec) {
    return null;
  }

  return manifest.specs.find(s => s.slug === manifest.active_spec) || null;
}

export async function focusSpec(baseDir, identifier) {
  return withManifestLock(baseDir, async () => {
    const manifest = await loadManifest(baseDir);
    if (!manifest) {
      throw new Error('No OmniSpec manifest found. Run `omni-spec init` first.');
    }

    const exact = manifest.specs.find(s => s.id === identifier || s.slug === identifier);
    const matches = exact ? [exact] : manifest.specs.filter(s => s.slug.includes(identifier));
    if (matches.length > 1) throw new Error(`Ambiguous specification "${identifier}". Use an exact ID or slug.`);
    const spec = matches[0];

    if (!spec) {
      throw new Error(`Specification with identifier "${identifier}" not found in manifest.`);
    }

    manifest.active_spec = spec.slug;
    manifest.active_archetype = spec.type;
    await saveManifest(baseDir, manifest);
    return spec;
  });
}

export async function listSpecs(baseDir) {
  const manifest = await loadManifest(baseDir);
  if (!manifest) {
    return null;
  }
  return {
    project: manifest.project,
    profile: manifest.profile,
    active_spec: manifest.active_spec,
    specs: manifest.specs,
  };
}
