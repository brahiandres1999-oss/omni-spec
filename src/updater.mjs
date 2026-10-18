import { readFile } from 'node:fs/promises';
import { loadManifest, saveManifest, withManifestLock, MANIFEST_SCHEMA_URL } from './manifest.mjs';
import { integrationEntries, normalizeAgents } from './integrations.mjs';
import { packageEntries } from './assets.mjs';
import { syncManagedFiles, checkManagedFiles } from './managed.mjs';
import { ensureProjectContext } from './generator.mjs';
import { compareVersions } from './versions.mjs';

export async function getCliVersion() {
  const pkg = JSON.parse((await readFile(new URL('../package.json', import.meta.url), 'utf8')).replace(/^\uFEFF/, ''));
  if (!pkg.version) throw new Error('Installed package has no version. Reinstall OmniSpec.');
  return pkg.version;
}

export async function checkProjectVersion(baseDir) {
  const manifest = await loadManifest(baseDir);
  const cliVersion = await getCliVersion();
  if (!manifest) return { isInstalled: false, cliVersion, projectVersion: null, isOutdated: false, healthy: false, message: 'OmniSpec is not initialized. Run init first.' };
  const integrity = await checkManagedFiles(baseDir);
  const isOutdated = manifest.version !== cliVersion;
  const healthy = !isOutdated && integrity.tracked > 0 && !integrity.changed.length;
  return { isInstalled: true, project: manifest.project, projectVersion: manifest.version, cliVersion, isOutdated, healthy, integrity,
    message: isOutdated ? 'Version differs. Review update --dry-run.' : healthy ? 'Managed files match their installed fingerprints. Agent discovery and project tests still require verification.' : 'Installation needs review: missing/modified managed files or legacy installation. Run update --dry-run.' };
}

export async function updateProject(baseDir, options = {}) {
  async function update() {
    const manifest = await loadManifest(baseDir);
    if (!manifest) throw new Error('Cannot update: OmniSpec is not initialized. Run init first.');
    const cliVersion = await getCliVersion();
    const downgrade = compareVersions(manifest.version || '0.0.0', cliVersion) > 0;
    if (downgrade && !options.allowDowngrade) throw new Error(`Refusing downgrade from ${manifest.version} to ${cliVersion}. Use the matching or newer CLI, or explicitly review update --allow-downgrade --dry-run.`);
    const agent = normalizeAgents(options.agent || manifest.agent).join(',');
    const entries = [...await packageEntries(), ...integrationEntries({ ...manifest, version: cliVersion, agent })];
    const assets = await syncManagedFiles(baseDir, entries, options);
    const result = { dryRun: Boolean(options.dryRun), downgrade, project: manifest.project, fromVersion: manifest.version, toVersion: cliVersion, specsCount: manifest.specs.length, specsPreserved: manifest.specs.length, assets, agentIntegrations: assets };
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
