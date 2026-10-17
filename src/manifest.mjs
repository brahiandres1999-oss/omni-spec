import { readFile, writeFile, mkdir, unlink, rename, readdir, stat, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const MANIFEST_FILE = 'manifest.json';
const LOCK_FILE = 'manifest.lock';

export async function getManifestPath(baseDir) {
  return join(baseDir, 'specs', MANIFEST_FILE);
}

const CLAIM_NAME = /^([1-9]\d*)-[0-9a-f-]{36}$/;
const leases = new WeakSet();
const pause = ms => new Promise(done => setTimeout(done, ms));

function isDead(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}

async function prepareLockDirectory(lockPath) {
  try { await mkdir(lockPath); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try {
      if ((await stat(lockPath)).isDirectory()) return;
      // Compatibility with the unpublished single-file implementation. Never
      // guess whether an empty legacy file belongs to a living writer.
      const legacy = JSON.parse(await readFile(lockPath, 'utf8'));
      if (!Number.isSafeInteger(legacy.pid) || legacy.pid <= 0 || !isDead(legacy.pid)) {
        throw new Error('Legacy manifest.lock has an active or unknown owner. Stop older OmniSpec processes before removing that file.');
      }
      try { await unlink(lockPath); }
      catch (removal) {
        // A second cleaner may already have replaced the file with our directory.
        if (!['ENOENT', 'EISDIR', 'EPERM'].includes(removal.code)) throw removal;
      }
      await mkdir(lockPath, { recursive: true });
    } catch (legacyError) {
      if (legacyError.code === 'ENOENT') return mkdir(lockPath, { recursive: true });
      if (legacyError instanceof SyntaxError) {
        throw new Error('Legacy manifest.lock is incomplete. Stop older OmniSpec processes and remove this legacy file before retrying.');
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
      if (error.code !== 'ENOENT') throw error;
      try {
        await stat(join(lockPath, name));
        result.push({ name, ticket: null }); // choosing, not an abandoned empty lock
      } catch (gone) { if (gone.code !== 'ENOENT') throw gone; }
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
    const ticket = peers.reduce((max, peer) => peer.ticket > max ? peer.ticket : max, 0n) + 1n;
    await writeFile(join(claimPath, 'ticket.tmp'), String(ticket), { flag: 'wx' });
    await rename(join(claimPath, 'ticket.tmp'), join(claimPath, 'ticket'));
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const others = await participants(lockPath);
      const blocked = others.some(peer => peer.name !== name && (
        peer.ticket === null || peer.ticket < ticket ||
        (peer.ticket === ticket && peer.name < name)
      ));
      if (!blocked) {
        const lease = Object.freeze({ lockPath, name });
        leases.add(lease);
        return lease;
      }
      await pause(delayMs + Math.floor(Math.random() * 30));
    }
    throw new Error('Lock timeout: Another process is updating OmniSpec manifest.');
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
    return JSON.parse(raw);
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
  const tempPath = join(specsDir, `${MANIFEST_FILE}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`);
  const content = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(tempPath, content, 'utf-8');
  await rename(tempPath, targetPath);
  return manifest;
}

async function getPackageVersion() {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const raw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw);
    return pkg.version || '0.4.0';
  } catch {
    return '0.4.0';
  }
}

export async function _initManifestUnlocked(baseDir, options = {}) {
  const existing = await loadManifest(baseDir);
  const resolvedStack = options.stack || options.techStack;
  const resolvedDoc = options.docStandard || options.documentationStandard;
  const pkgVersion = await getPackageVersion();
  const manifest = {
    $schema: 'https://raw.githubusercontent.com/omni-spec/omni-spec/main/schema/manifest.schema.json',
    schemaVersion: 1,
    project: options.projectName || (existing && existing.project) || 'MyProject',
    version: options.version || existing?.version || pkgVersion,
    profile: (options.explicitProfile ? options.profile : null) || (existing && existing.profile) || options.profile || 'general',
    stack: (options.explicitStack ? resolvedStack : null) || (existing && existing.stack) || resolvedStack || 'Node.js',
    documentationStandard: (options.explicitDoc ? resolvedDoc : null) || (existing && existing.documentationStandard) || resolvedDoc || 'JSDoc',
    qualityGates: options.qualityGates || existing?.qualityGates || null,
    active_spec: (existing && existing.active_spec) || null,
    active_archetype: (existing && existing.active_archetype) || null,
    specs: (existing && Array.isArray(existing.specs)) ? existing.specs : []
  };

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
      ...specEntry
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
  if (!manifest || !manifest.active_spec) {
    return null;
  }

  return manifest.specs.find(s => s.slug === manifest.active_spec) || null;
}
