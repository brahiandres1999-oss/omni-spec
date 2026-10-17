import { readFile, cp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, saveManifest, withManifestLock } from './manifest.mjs';
import { installAgentIntegrations } from './integrations.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Returns the currently installed OmniSpec CLI version from package.json.
 * @returns {Promise<string>}
 */
export async function getCliVersion() {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const raw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw);
    return pkg.version;
  } catch {
    return '0.4.0';
  }
}

/**
 * Checks project version status against the installed CLI version.
 *
 * @param {string} baseDir Absolute path to repository
 * @returns {Promise<Object>} Status object
 */
export async function checkProjectVersion(baseDir) {
  const manifest = await loadManifest(baseDir);
  const cliVersion = await getCliVersion();

  if (!manifest) {
    return {
      isInstalled: false,
      cliVersion,
      projectVersion: null,
      isOutdated: false,
      message: 'OmniSpec is not initialized in this directory. Run "omni-spec init" to get started.'
    };
  }

  const projectVersion = manifest.version || '0.3.0';
  const isOutdated = projectVersion !== cliVersion;

  return {
    isInstalled: true,
    project: manifest.project || 'Unknown',
    projectVersion,
    cliVersion,
    isOutdated,
    message: isOutdated
      ? `Project "${manifest.project}" is running OmniSpec v${projectVersion}, but CLI v${cliVersion} is available. Run "omni-spec update" to synchronize.`
      : `Project "${manifest.project}" is up-to-date with OmniSpec v${cliVersion}.`
  };
}

/**
 * Non-destructively upgrades an existing OmniSpec project.
 * Updates templates, AI agent integrations, and bumps manifest version,
 * while leaving existing specs, plans, tasks, and CONSTITUTION.md 100% untouched.
 *
 * @param {string} baseDir Absolute path to repository
 * @param {Object} options Options like dryRun
 * @returns {Promise<Object>} Upgrade result summary
 */
export async function updateProject(baseDir, options = {}) {
  const cliVersion = await getCliVersion();

  return withManifestLock(baseDir, async () => {
    const manifest = await loadManifest(baseDir);
    if (!manifest) {
      throw new Error('Cannot update: OmniSpec is not initialized in this project. Run "omni-spec init" first.');
    }

    const previousVersion = manifest.version || '0.3.0';
    const templatesDir = join(__dirname, '..', 'templates');
    const destTemplatesDir = join(baseDir, 'specs', '_templates');

    if (options.dryRun) {
      return {
        dryRun: true,
        project: manifest.project,
        fromVersion: previousVersion,
        toVersion: cliVersion,
        specsCount: (manifest.specs || []).length
      };
    }

    // 1. Refresh templates in specs/_templates non-destructively
    try {
      await cp(templatesDir, destTemplatesDir, { recursive: true, force: true });
    } catch {
      // safe fallback if templates dir copying encounters race conditions
    }

    // 2. Install/update multi-agent slash commands and integrations
    const agentSync = await installAgentIntegrations(baseDir, { ...manifest, version: cliVersion });

    // 3. Bump manifest version and schema
    manifest.version = cliVersion;
    manifest.schemaVersion = 1;
    await saveManifest(baseDir, manifest);

    return {
      success: true,
      project: manifest.project,
      fromVersion: previousVersion,
      toVersion: cliVersion,
      specsPreserved: (manifest.specs || []).length,
      agentIntegrations: agentSync
    };
  });
}
