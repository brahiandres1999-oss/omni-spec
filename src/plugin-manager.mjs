import { cp, mkdir, rm, rmdir, stat, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadRegistry, saveRegistry, safePath, managedHash } from './managed.mjs';
import { normalizeAgents } from './integrations.mjs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadManifest, saveManifest, withManifestLock, MANIFEST_SCHEMA_URL } from './manifest.mjs';
import { getCliVersion } from './updater.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

export function getPluginDir() {
  return join(homedir(), '.gemini', 'config', 'plugins', 'omni-spec');
}

// Antigravity ships a plugin validator in its CLI. It is optional: an absent CLI is a
// reported fact, not a failure, but a validator that runs and rejects the bundle is fatal.
function validatePluginBundle(targetDir) {
  const result = spawnSync('agy', ['plugin', 'validate', '--strict', '--json'], {
    cwd: targetDir,
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });
  if (result.error) return { ran: false, ok: null, reason: 'Antigravity CLI not available' };
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    report = null;
  }
  return {
    ran: true,
    ok: result.status === 0,
    exitCode: result.status,
    report,
    stderr: result.stderr ? result.stderr.trim() : null,
  };
}

export async function installPlugin(options = {}) {
  const targetDir = options.targetDir || getPluginDir();
  const pluginsParent = join(targetDir, '..');
  const cliVersion = await getCliVersion();

  await mkdir(pluginsParent, { recursive: true });

  try {
    const existing = await stat(targetDir);
    if (existing) {
      await rm(targetDir, { recursive: true, force: true });
    }
  } catch {}

  await mkdir(targetDir, { recursive: true });

  // Clean items required for full Antigravity Plugin and lightweight CLI execution
  const itemsToCopy = ['plugin.json', 'README.md', 'package.json', 'rules', 'skills', 'agents', 'assets', 'bin', 'src'];

  const copied = [];
  for (const item of itemsToCopy) {
    const srcPath = join(packageRoot, item);
    const destPath = join(targetDir, item);
    try {
      await cp(srcPath, destPath, { recursive: true });
      copied.push(item);
    } catch (_e) {
      // Ignore optional missing asset
    }
  }

  const validation = validatePluginBundle(targetDir);
  if (validation.ran && !validation.ok)
    throw new Error(
      `Antigravity plugin validation failed (exit ${validation.exitCode}). ${validation.stderr || 'Run `agy plugin validate` in the plugin directory for details.'}`,
    );

  return {
    success: true,
    targetDir,
    version: cliVersion,
    copied,
    validation,
  };
}

export async function updatePlugin(options = {}) {
  return installPlugin(options);
}

export async function getPluginStatus(options = {}) {
  const targetDir = options.targetDir || getPluginDir();
  const cliVersion = await getCliVersion();

  try {
    await stat(join(targetDir, 'plugin.json'));
    let pluginVersion = 'unknown';
    try {
      const pkg = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8'));
      pluginVersion = pkg.version || pluginVersion;
    } catch {}

    const isOutdated = pluginVersion !== cliVersion;
    return {
      installed: true,
      targetDir,
      version: pluginVersion,
      currentCliVersion: cliVersion,
      isOutdated,
    };
  } catch {
    return {
      installed: false,
      targetDir,
      version: null,
      currentCliVersion: cliVersion,
      isOutdated: false,
    };
  }
}

const PLUGIN_COMPATIBLE = new Set(['antigravity', 'plugin']);

// Registry keys are versioned data, so a crafted key must never reach outside these trees.
function cleanable(name) {
  if (
    typeof name !== 'string' ||
    name.includes('\\') ||
    name.split('/').some(part => !part || part === '.' || part === '..')
  )
    return false;
  return name.startsWith('specs/.omni/runtime/') || /^\.agents\/skills\/omni-[a-z-]+\/[^/]/.test(name);
}

async function removeEmptyParents(root, name, stop) {
  let current = dirname(join(root, name));
  const boundary = resolve(root, stop);
  while (resolve(current).startsWith(boundary) && resolve(current) !== resolve(root)) {
    try {
      if ((await readdir(current)).length) return;
      await rmdir(current);
    } catch (error) {
      if (['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) return;
      throw error;
    }
    if (resolve(current) === boundary) return;
    current = dirname(current);
  }
}

/**
 * Migrate an Antigravity project to plugin mode by removing only OmniSpec-managed copies:
 * the local runtime and omni-* skills whose content still matches the managed registry.
 * User skills, unregistered files, backups and specifications are preserved. Locally
 * modified managed files block the migration unless acceptUpdates backs them up first.
 */
export async function cleanProject(baseDir, options = {}) {
  const manifest = await loadManifest(baseDir);
  if (!manifest) {
    throw new Error('Cannot clean: OmniSpec is not initialized. Run init first.');
  }
  const agents = normalizeAgents(manifest.agent || 'antigravity');
  const unsupported = agents.filter(agent => !PLUGIN_COMPATIBLE.has(agent));
  if (unsupported.length)
    throw new Error(
      `Plugin mode serves Antigravity only; adapters for ${unsupported.join(', ')} use the local runtime. Run setup-agent antigravity and remove those adapters before clean. No changes made.`,
    );
  const cliVersion = await getCliVersion();
  const registry = await loadRegistry(baseDir);
  const remove = [],
    conflicts = [];
  for (const [name, entry] of Object.entries(registry.files)) {
    if (!cleanable(name)) continue;
    let content;
    try {
      content = await readFile(await safePath(baseDir, name));
    } catch (error) {
      if (error.code === 'ENOENT') {
        remove.push({ name, missing: true });
        continue;
      }
      throw error;
    }
    if (managedHash(content) === (entry.hash || entry)) remove.push({ name, content });
    else conflicts.push({ name, content });
  }
  const result = {
    project: manifest.project,
    fromAgent: manifest.agent,
    toAgent: 'plugin',
    fromVersion: manifest.version,
    toVersion: cliVersion,
    toRemove: [...remove, ...(options.acceptUpdates ? conflicts : [])]
      .filter(item => !item.missing)
      .map(item => item.name),
    conflicts: conflicts.map(item => item.name),
    preserved: 'specs, CONSTITUTION.md, project context, backups, user skills and unregistered files',
    specsCount: manifest.specs?.length || 0,
  };
  if (options.dryRun) return { dryRun: true, ...result };
  if (conflicts.length && !options.acceptUpdates)
    throw new Error(
      `Locally modified OmniSpec files block clean: ${result.conflicts.join(', ')}. Review clean --dry-run, then use --accept-updates to back them up and continue. No changes made.`,
    );

  return withManifestLock(baseDir, async () => {
    const backups = [];
    const backupId = `${Date.now()}-${randomUUID()}`;
    for (const item of conflicts) {
      const backup = `specs/.omni/backups/${backupId}/${item.name}`;
      const path = await safePath(baseDir, backup);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, item.content, { flag: 'wx' });
      backups.push(backup);
    }
    const removed = [];
    for (const item of [...remove, ...conflicts]) {
      if (!item.missing) {
        await rm(await safePath(baseDir, item.name), { force: true });
        removed.push(item.name);
      }
      delete registry.files[item.name];
      await removeEmptyParents(
        baseDir,
        item.name,
        item.name.startsWith('.agents/') ? '.agents' : 'specs/.omni/runtime',
      );
    }
    await saveRegistry(baseDir, registry);

    manifest.agent = 'plugin';
    manifest.version = cliVersion;
    manifest.schemaVersion = 1;
    manifest.$schema = MANIFEST_SCHEMA_URL;
    await saveManifest(baseDir, manifest);

    try {
      const constitutionPath = join(baseDir, 'CONSTITUTION.md');
      const constitution = await readFile(constitutionPath, 'utf8');
      if (constitution.includes('node specs/.omni/runtime/bin/omni-spec.mjs'))
        await writeFile(
          constitutionPath,
          constitution.replaceAll('node specs/.omni/runtime/bin/omni-spec.mjs', 'omni-spec'),
          'utf8',
        );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    return { success: true, ...result, agent: 'plugin', version: cliVersion, removed, backups };
  });
}
