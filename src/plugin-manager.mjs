import { cp, mkdir, rm, stat, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadManifest, saveManifest, withManifestLock, MANIFEST_SCHEMA_URL } from './manifest.mjs';
import { getCliVersion } from './updater.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

export function getPluginDir() {
  return join(homedir(), '.gemini', 'config', 'plugins', 'omni-spec');
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

  return {
    success: true,
    targetDir,
    version: cliVersion,
    copied,
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

export async function cleanProject(baseDir, options = {}) {
  const manifest = await loadManifest(baseDir);
  if (!manifest) {
    throw new Error('Cannot clean: OmniSpec is not initialized. Run init first.');
  }

  const cliVersion = await getCliVersion();
  const candidates = [
    join(baseDir, '.agents', 'skills'),
    join(baseDir, 'specs', '.omni', 'runtime'),
    join(baseDir, 'specs', '.omni', 'managed.json'),
    join(baseDir, 'specs', '.omni', 'backups'),
  ];

  const toRemove = [];
  for (const fullPath of candidates) {
    try {
      await stat(fullPath);
      toRemove.push(fullPath);
    } catch {}
  }

  if (options.dryRun) {
    return {
      dryRun: true,
      project: manifest.project,
      fromAgent: manifest.agent,
      toAgent: 'plugin',
      fromVersion: manifest.version,
      toVersion: cliVersion,
      toRemove: toRemove.map(p => resolve(p)),
      specsCount: manifest.specs?.length || 0,
    };
  }

  return withManifestLock(baseDir, async () => {
    const removed = [];
    for (const fullPath of toRemove) {
      try {
        await rm(fullPath, { recursive: true, force: true });
        removed.push(fullPath);
      } catch {}
    }

    // Safely cleanup parent directories if empty
    try {
      const agentsDir = join(baseDir, '.agents');
      const files = await readdir(agentsDir);
      if (files.length === 0) {
        await rm(agentsDir, { recursive: true, force: true });
        removed.push(agentsDir);
      }
    } catch {}

    try {
      const dotOmniDir = join(baseDir, 'specs', '.omni');
      const files = await readdir(dotOmniDir);
      if (files.length === 0) {
        await rm(dotOmniDir, { recursive: true, force: true });
        removed.push(dotOmniDir);
      }
    } catch {}

    // Update manifest to plugin mode
    manifest.agent = 'plugin';
    manifest.version = cliVersion;
    manifest.schemaVersion = 1;
    manifest.$schema = MANIFEST_SCHEMA_URL;
    await saveManifest(baseDir, manifest);

    // Update constitution CLI references if present
    try {
      const constitutionPath = join(baseDir, 'CONSTITUTION.md');
      let constitution = await readFile(constitutionPath, 'utf8');
      if (constitution.includes('specs/.omni/runtime/bin/omni-spec.mjs')) {
        constitution = constitution.replaceAll('node specs/.omni/runtime/bin/omni-spec.mjs', 'omni-spec');
        await writeFile(constitutionPath, constitution, 'utf8');
      }
    } catch {}

    return {
      success: true,
      project: manifest.project,
      agent: 'plugin',
      version: cliVersion,
      removed: removed.map(p => resolve(p)),
      specsCount: manifest.specs?.length || 0,
    };
  });
}
