import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Where Omni keeps its state for one project opened in Omni Studio (docs/STUDIO-AGENT-COCKPIT.md).
 *  - `project` mode: OmniSpec is installed in the repository (specs/manifest.json); state stays in specs/.
 *  - `studio` mode: it is not; state lives under %LOCALAPPDATA%\OmniStudio\workspaces\<id>\ and nothing is
 *    written to the repository.
 */

/** Root of Omni Studio's per-user data. `OMNI_STUDIO_HOME` overrides it (tests, portable installs). */
export function studioHome(env = process.env) {
  if (env.OMNI_STUDIO_HOME) return resolve(env.OMNI_STUDIO_HOME);
  const local = env.LOCALAPPDATA || join(homedir(), process.platform === 'win32' ? 'AppData/Local' : '.local/share');
  return join(local, 'OmniStudio');
}

/** Stable id of a project folder: Windows paths compare case-insensitively and with either slash. */
export function workspaceId(root, platform = process.platform) {
  let key = resolve(root).replaceAll('\\', '/').replace(/\/+$/, '');
  if (platform === 'win32') key = key.toLowerCase();
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where the memory of `root` is, without creating anything: for reading another project's state (the
 * conversation list of the rail) from the engine of the open one.
 */
export async function memoryPathOf(root, { env = process.env } = {}) {
  const absolute = resolve(root);
  return (await exists(join(absolute, 'specs', 'manifest.json')))
    ? join(absolute, 'specs', '.omni', 'memory.db')
    : join(studioHome(env), 'workspaces', workspaceId(absolute), 'memory.db');
}

/** Same folder, compared as `workspaceId` does (case and slashes do not matter on Windows). */
export const sameRoot = (a, b) => workspaceId(a) === workspaceId(b);

/**
 * @param {string} root Project folder.
 * @param {{env?: NodeJS.ProcessEnv}} [options]
 * @returns {Promise<{mode: 'project'|'studio', root: string, dir: string, memoryPath: string}>}
 */
export async function resolveWorkspace(root, { env = process.env } = {}) {
  const absolute = resolve(root);
  if (await exists(join(absolute, 'specs', 'manifest.json'))) {
    const dir = join(absolute, 'specs', '.omni');
    return { mode: 'project', root: absolute, dir, memoryPath: join(dir, 'memory.db') };
  }
  const dir = join(studioHome(env), 'workspaces', workspaceId(absolute));
  await mkdir(dir, { recursive: true });
  const marker = join(dir, 'workspace.json');
  if (!(await exists(marker)))
    await writeFile(marker, `${JSON.stringify({ root: absolute, createdAt: new Date().toISOString() }, null, 2)}\n`);
  return { mode: 'studio', root: absolute, dir, memoryPath: join(dir, 'memory.db') };
}
