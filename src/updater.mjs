import { readFile } from 'node:fs/promises';
import { loadManifest, saveManifest, withManifestLock, MANIFEST_SCHEMA_URL } from './manifest.mjs';
import { integrationEntries, normalizeAgents } from './integrations.mjs';
import { packageEntries, companionCatalogAvailable, companionEntries, COMPANIONS_PREFIX } from './assets.mjs';
import { syncManagedFiles, checkManagedFiles, loadRegistry, managedSection, safePath } from './managed.mjs';
import { ensureProjectContext, buildConstitutionContent } from './generator.mjs';
import { join } from 'node:path';
import { detectPluginCoexistence } from './plugin-manager.mjs';

const CONSTITUTION_REFERENCE = 'specs/.omni/reference/CONSTITUTION.md';
const RUNTIME = 'specs/.omni/runtime/';
import { compareVersions } from './versions.mjs';

export async function getCliVersion() {
  const pkg = JSON.parse((await readFile(new URL('../package.json', import.meta.url), 'utf8')).replace(/^\uFEFF/, ''));
  if (!pkg.version) throw new Error('Installed package has no version. Reinstall OmniSpec.');
  return pkg.version;
}

/**
 * Read the version of the project's local runtime from specs/.omni/runtime/package.json.
 * Content that is not valid JSON (a leading BOM is ignored) or has no non-empty string version
 * counts as an absent runtime and is flagged unreadable so that callers report it (009-d6, case 5).
 * @param {string} baseDir Project root.
 * @returns {Promise<{version: string|null, unreadable: boolean}>} version is null when the file is
 *   missing (unreadable false) or unreadable (unreadable true).
 * @throws {Error} Unsafe or symlinked path, or any read error other than a missing file.
 */
async function localRuntimeVersion(baseDir) {
  let raw;
  try {
    raw = await readFile(await safePath(baseDir, `${RUNTIME}package.json`), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { version: null, unreadable: false };
    throw error;
  }
  let version;
  try {
    version = JSON.parse(raw.replace(/^\uFEFF/, ''))?.version;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return typeof version === 'string' && version ? { version, unreadable: false } : { version: null, unreadable: true };
}

/**
 * Whether update adds the runtime line to specs/.gitignore: the file is missing, has no managed
 * section, or its section lacks .omni/runtime/ (009-d2; 009-d6, case 1).
 * @param {string} baseDir Project root.
 * @returns {Promise<boolean>}
 * @throws {Error} Unsafe or symlinked path, or any read error other than a missing file.
 */
async function runtimeIgnoreAdded(baseDir) {
  let content;
  try {
    content = await readFile(await safePath(baseDir, 'specs/.gitignore'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
  return !managedSection(content, 'hash')?.split(/\r?\n/).includes('.omni/runtime/');
}

/**
 * Inspect the project's version and managed-file integrity for doctor. Read-only.
 * When every registered runtime file is missing (MISSING), or the runtime's package.json is
 * missing, unreadable or of another version than the manifest (VERSION_MISMATCH), runtime paths
 * are left out of integrity.changed and integrity.missing and, outside plugin mode, runtime
 * summarizes the state with its restore command (009-d3). An incomplete runtime of the manifest's
 * version keeps its paths listed. healthy uses the complete integrity, so it does not change.
 * @param {string} baseDir Project root.
 * @param {{targetDir?: string}} [options] Optional plugin directory for isolated diagnosis.
 * @returns {Promise<object>} isInstalled, cliVersion, projectVersion, isOutdated, healthy and
 *   message; once initialized also project, integrity {tracked, changed, missing} and, when
 *   applicable, runtime {status, version, restore} and pluginCoexistence diagnosis.
 * @throws {Error} Invalid manifest or registry, unsafe or symlinked path, or an unreadable file.
 */
export async function checkProjectVersion(baseDir, options = {}) {
  const manifest = await loadManifest(baseDir);
  const cliVersion = await getCliVersion();
  if (!manifest)
    return {
      isInstalled: false,
      cliVersion,
      projectVersion: null,
      isOutdated: false,
      healthy: false,
      message: 'OmniSpec is not initialized. Run init first.',
    };
  const integrity = await checkManagedFiles(baseDir);
  const isOutdated = manifest.version !== cliVersion;
  const isPlugin = manifest.agent === 'plugin';
  const healthy = !isOutdated && (isPlugin || (integrity.tracked > 0 && !integrity.changed.length));
  const registered = Object.keys((await loadRegistry(baseDir)).files).filter(name => name.startsWith(RUNTIME));
  const absent = new Set(integrity.missing);
  let runtime = null;
  if (registered.length && registered.every(name => absent.has(name))) runtime = { status: 'MISSING', version: null };
  else if (registered.length) {
    const { version } = await localRuntimeVersion(baseDir);
    if (version !== manifest.version) runtime = { status: 'VERSION_MISMATCH', version };
  }
  const reported = name => !runtime || !name.startsWith(RUNTIME);
  const pluginCoexistence = await detectPluginCoexistence(baseDir, options);
  return {
    isInstalled: true,
    project: manifest.project,
    projectVersion: manifest.version,
    cliVersion,
    isOutdated,
    healthy,
    integrity: {
      ...integrity,
      changed: integrity.changed.filter(reported),
      missing: integrity.missing.filter(reported),
    },
    ...(runtime && !isPlugin ? { runtime: { ...runtime, restore: `npx omni-spec@${manifest.version} update` } } : {}),
    ...(pluginCoexistence ? { pluginCoexistence } : {}),
    message: isOutdated
      ? 'Version differs. Review update --dry-run.'
      : healthy
        ? isPlugin
          ? 'Plugin mode active. Workspace is clean and specs are preserved.'
          : 'Managed files match their installed fingerprints. Agent discovery and project tests still require verification.'
        : 'Installation needs review: missing/modified managed files or legacy installation. Run update --dry-run.',
  };
}

/**
 * Update a project's managed files to the running package and record its version.
 * A local runtime whose package.json is missing, unreadable or of another version than the
 * manifest is replaced without conflict or backup (009-d1); an edited runtime of the manifest's
 * version still conflicts, also when upgrading. Runtime registry entries the package no longer
 * ships are pruned (009-d7). Active companions are synchronized and their obsolete unedited
 * files pruned when the running distribution has a catalog; otherwise they are preserved with a notice.
 * OmniSpec never runs Git.
 * Side effects, except with dryRun and under the manifest lock: managed files, backups and the
 * registry; deletion of unedited pruned runtime/companion files; specs/project-context.md when absent;
 * specs/manifest.json.
 * @param {string} baseDir Project root.
 * @param {{dryRun?: boolean, acceptUpdates?: boolean, allowDowngrade?: boolean, agent?: string}} [options]
 *   agent overrides the manifest's adapters.
 * @returns {Promise<object>} constitution, dryRun, downgrade, project, fromVersion, toVersion,
 *   specsCount, specsPreserved, assets {created, updated, conflicts, backups, removed, preserved},
 *   agentIntegrations, notices (messages for the user, also with dryRun) and, once applied, success.
 * @throws {Error} Project not initialized, downgrade without allowDowngrade, local edits without
 *   acceptUpdates, malformed managed section, unsafe or symlinked path, or a read error other than
 *   a missing file on the runtime package.json or specs/.gitignore (nothing is written).
 */
export async function updateProject(baseDir, options = {}) {
  async function update() {
    const manifest = await loadManifest(baseDir);
    if (!manifest) throw new Error('Cannot update: OmniSpec is not initialized. Run init first.');
    const cliVersion = await getCliVersion();
    const downgrade = compareVersions(manifest.version || '0.0.0', cliVersion) > 0;
    if (downgrade && !options.allowDowngrade)
      throw new Error(
        `Refusing downgrade from ${manifest.version} to ${cliVersion}. Use the matching or newer CLI, or explicitly review update --allow-downgrade --dry-run.`,
      );
    const agent = normalizeAgents(options.agent || manifest.agent).join(',');
    const reference = buildConstitutionContent({
      projectName: manifest.project,
      profile: manifest.profile,
      stack: manifest.stack,
      docStandard: manifest.documentationStandard,
      qualityGates: manifest.qualityGates,
    });
    const runtime = await localRuntimeVersion(baseDir);
    const replaceRuntime = runtime.version !== manifest.version;
    const ignoreAdded = await runtimeIgnoreAdded(baseDir);
    const catalogAvailable = await companionCatalogAvailable();
    let companionFiles = [];
    let prune = RUNTIME;
    const companionNotices = [];

    if (catalogAvailable) {
      companionFiles = await companionEntries(manifest.ui?.companion);
      prune = [RUNTIME, COMPANIONS_PREFIX];
    } else {
      if (manifest.ui?.companion && manifest.ui.companion !== 'none') {
        companionNotices.push(
          `Companion catalog is not available in the running OmniSpec distribution; companion files were neither updated nor pruned. Run npx omni-spec@${cliVersion} update to synchronize companions.`,
        );
      }
    }

    const entries = [
      ...(await packageEntries()).map(entry =>
        replaceRuntime && entry.path.startsWith(RUNTIME) ? { ...entry, replace: true } : entry,
      ),
      ...integrationEntries({ ...manifest, version: cliVersion, agent }),
      { path: CONSTITUTION_REFERENCE, content: reference },
      ...companionFiles,
    ];
    const assets = await syncManagedFiles(baseDir, entries, { ...options, prune });
    const notices = [...companionNotices];
    if (ignoreAdded)
      notices.push(
        'update adds .omni/runtime/ to the managed section of specs/.gitignore. Runtime files already committed stay in the Git index: from the project root, the repository owner can run git rm -r --cached specs/.omni/runtime and commit. OmniSpec does not run Git.',
      );
    if (runtime.unreadable)
      notices.push(
        'specs/.omni/runtime/package.json is not valid JSON or has no version: the local runtime is treated as missing and replaced without conflict.',
      );
    for (const name of assets.preserved)
      notices.push(
        options.dryRun
          ? `Would keep ${name}: it is no longer part of OmniSpec ${cliVersion} and has local edits; its managed-file entry would be removed.`
          : `Kept ${name}: it is no longer part of OmniSpec ${cliVersion} and has local edits; its managed-file entry was removed.`,
      );
    let constitution = null;
    try {
      constitution = await readFile(join(baseDir, 'CONSTITUTION.md'), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const result = {
      // CONSTITUTION.md is user-owned and never replaced; the reference shows current guidance.
      constitution:
        constitution === reference
          ? { status: 'CURRENT' }
          : {
              status: 'PRESERVED_REVIEW_RECOMMENDED',
              reference: CONSTITUTION_REFERENCE,
              action: 'Compare CONSTITUTION.md with the reference and adopt relevant guidance manually.',
            },
      dryRun: Boolean(options.dryRun),
      downgrade,
      project: manifest.project,
      fromVersion: manifest.version,
      toVersion: cliVersion,
      specsCount: manifest.specs.length,
      specsPreserved: manifest.specs.length,
      assets,
      agentIntegrations: assets,
      notices,
    };
    if (options.dryRun) return result;
    await ensureProjectContext(baseDir);
    manifest.version = cliVersion;
    manifest.schemaVersion = 1;
    manifest.$schema = MANIFEST_SCHEMA_URL;
    manifest.agent = agent;
    await saveManifest(baseDir, manifest);
    return { ...result, success: true };
  }
  // A preview has no filesystem mutations, including lock directories.
  return options.dryRun ? update() : withManifestLock(baseDir, update);
}
