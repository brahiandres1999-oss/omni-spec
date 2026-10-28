import { cp, mkdir, rm, rmdir, stat, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadRegistry, saveRegistry, safePath, managedHash, syncManagedFiles } from './managed.mjs';
import { normalizeAgents, integrationEntries } from './integrations.mjs';
import { OMNI_SKILLS } from './workflows.mjs';
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

/**
 * Install the OmniSpec plugin bundle for Antigravity, replacing the directory at the target.
 * Copies the plugin components and the files the bundled CLI reads from its package root, then runs
 * `agy plugin validate --strict --json` when the Antigravity CLI is on PATH. The existing target
 * directory is deleted before copying; errors from that deletion are ignored.
 * @param {{targetDir?: string, projectDir?: string|null}} [options] Plugin destination and project root.
 *   Defaults to getPluginDir() and cwd; null projectDir skips project diagnosis. Diagnosis errors
 *   occur before replacing the plugin. Other CLI flags are ignored.
 * @returns {Promise<{success: true, targetDir: string, version: string, copied: string[], validation: object, pluginCoexistence?: object}>}
 *   `copied` lists every bundle item in copy order; `validation.ran` is false without the Antigravity CLI.
 * @throws {Error} When an item cannot be copied. The incomplete target is removed first and the message says
 *   so; if that removal fails, the message names both failures and the directory to delete. `cause` is the
 *   copy error.
 * @throws {Error} When the Antigravity validator rejects the bundle, which stays at the target for diagnosis.
 */
export async function installPlugin(options = {}) {
  const targetDir = options.targetDir || getPluginDir();
  const projectDir = options.projectDir === undefined ? process.cwd() : options.projectDir;
  const pluginCoexistence = projectDir
    ? await detectPluginCoexistence(projectDir, { targetDir, assumeInstalled: true })
    : null;
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

  // Plugin components plus everything the bundled CLI reads from its package root (packageEntries in assets.mjs).
  const itemsToCopy = [
    'plugin.json',
    'README.md',
    'package.json',
    'rules',
    'skills',
    'agents',
    'assets',
    'bin',
    'src',
    'schema',
    'companions',
    'LICENSE',
  ];

  const copied = [];
  for (const item of itemsToCopy) {
    const srcPath = join(packageRoot, item);
    const destPath = join(targetDir, item);
    try {
      await cp(srcPath, destPath, { recursive: true });
      copied.push(item);
    } catch (error) {
      // A partial bundle would still look installed to plugin status and to the Antigravity validator.
      let next = `Removed the incomplete plugin at ${targetDir}; fix the cause and run plugin install again.`;
      try {
        await rm(targetDir, { recursive: true, force: true });
      } catch (removal) {
        next = `Could not remove the incomplete plugin at ${targetDir} (${removal.message}); delete that directory and run plugin install again.`;
      }
      throw new Error(`Cannot copy ${item} into the Antigravity plugin: ${error.message}. ${next}`, { cause: error });
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
    ...(pluginCoexistence ? { pluginCoexistence } : {}),
  };
}

/** Reinstall the plugin bundle; same options, result and errors as {@link installPlugin}. */
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

/**
 * Detect whether the Antigravity global plugin and local OmniSpec skills coexist in a project.
 * Returns null if no project exists at baseDir, if the project does not declare antigravity or plugin,
 * if the plugin is not installed, or if no registered local OmniSpec skills are present on disk.
 * @param {string} baseDir Project root.
 * @param {{targetDir?: string, assumeInstalled?: boolean}} [options] assumeInstalled is used internally
 *   to inspect project inputs before installing the plugin; normal diagnosis requires presence.
 * @throws {Error} Invalid/unreadable project metadata or unsafe/unreadable skill paths.
 * @returns {Promise<{detected: boolean, pluginDir: string, localSkills: string[], canClean: boolean, actions: string[], message: string}|null>}
 */
export async function detectPluginCoexistence(baseDir, options = {}) {
  if (!baseDir) return null;
  const manifest = await loadManifest(baseDir);
  if (!manifest?.agent) return null;
  const rawAgent = typeof manifest.agent === 'string' ? manifest.agent.trim() : manifest.agent;
  if (!rawAgent) return null;

  const agents = normalizeAgents(rawAgent);
  if (!agents.some(agent => agent === 'antigravity' || agent === 'plugin')) {
    return null;
  }

  const status = await getPluginStatus({ targetDir: options.targetDir });
  if (!status.installed && !options.assumeInstalled) return null;

  const registry = await loadRegistry(baseDir);
  const presentSkills = [];
  for (const skill of OMNI_SKILLS) {
    const skillPath = `.agents/skills/${skill.name}/SKILL.md`;
    if (Object.hasOwn(registry.files, skillPath)) {
      const fullPath = await safePath(baseDir, skillPath);
      try {
        if ((await stat(fullPath)).isFile()) presentSkills.push(skillPath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }

  if (presentSkills.length === 0) return null;

  const canClean = agents.every(agent => PLUGIN_COMPATIBLE.has(agent));
  const actions = canClean ? ['keep-local', 'review-clean'] : ['keep-local'];
  const message = canClean
    ? 'Posible duplicación de comandos en Antigravity. Puedes conservar las skills locales; para migrar a uso exclusivo del plugin, revisa omni-spec clean --dry-run y ejecuta clean por separado.'
    : 'Posible duplicación de comandos en Antigravity. Este proyecto declara adaptadores para otras herramientas; conserva las skills locales para no afectar a los demás agentes.';

  return {
    detected: true,
    pluginDir: status.targetDir,
    localSkills: presentSkills,
    canClean,
    actions,
    message,
  };
}

// Registry keys are versioned data, so a crafted key must never reach outside these trees.
function cleanable(name) {
  if (
    typeof name !== 'string' ||
    name.includes('\\') ||
    name.split('/').some(part => !part || part === '.' || part === '..')
  )
    return false;
  return (
    name.startsWith('specs/.omni/runtime/') ||
    /^\.agents\/skills\/omni-[a-z-]+\/[^/]/.test(name) ||
    name === '.agents/agents/omni-auditor.md'
  );
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
  const pluginEntry = integrationEntries({ version: cliVersion, agent: 'plugin' });
  const handoff = await syncManagedFiles(baseDir, pluginEntry, { dryRun: true });
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
    conflicts: [...conflicts.map(item => item.name), ...handoff.conflicts],
    preserved: 'specs, CONSTITUTION.md, project context, backups, user skills and unregistered files',
    specsCount: manifest.specs?.length || 0,
  };
  if (options.dryRun) return { dryRun: true, ...result };
  if (result.conflicts.length && !options.acceptUpdates)
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
    const pluginHandoff = await syncManagedFiles(baseDir, pluginEntry, { acceptUpdates: options.acceptUpdates });
    backups.push(...pluginHandoff.backups);

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
