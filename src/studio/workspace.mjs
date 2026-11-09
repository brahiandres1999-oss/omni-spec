import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Where Omni keeps its state for one project opened in Omni Studio (docs/STUDIO-AGENT-COCKPIT.md). A project
 * installed by Studio (manifest `agent: "studio"`) is `project` mode with its state still in Studio.
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

/** `specs/manifest.json` of `root`, or `null` when there is none (or it cannot be read). */
async function manifestOf(root) {
  try {
    return JSON.parse(await readFile(join(root, 'specs', 'manifest.json'), 'utf8'));
  } catch (error) {
    // No manifest, or one being rewritten: treated as not installed; anything else is a real failure.
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

const studioDir = (absolute, env) => join(studioHome(env), 'workspaces', workspaceId(absolute));

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
  const manifest = await manifestOf(absolute);
  return manifest && manifest.agent !== 'studio'
    ? join(absolute, 'specs', '.omni', 'memory.db')
    : join(studioDir(absolute, env), 'memory.db');
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
  const manifest = await manifestOf(absolute);
  // Installed by OmniSpec itself: state stays in specs/.omni, as the OmniSpec runtimes expect.
  if (manifest && manifest.agent !== 'studio') {
    const dir = join(absolute, 'specs', '.omni');
    return { mode: 'project', root: absolute, dir, memoryPath: join(dir, 'memory.db') };
  }
  // Plain folder, or installed by Omni Studio (only manifest, context and specs in the repository): Omni's
  // state lives in Studio, shared by every agent, and survives installing OmniSpec later.
  const dir = studioDir(absolute, env);
  await mkdir(dir, { recursive: true });
  const marker = join(dir, 'workspace.json');
  if (!(await exists(marker)))
    await writeFile(
      marker,
      `${JSON.stringify({ root: absolute, createdAt: new Date().toISOString() }, null, 2)}
`,
    );
  return { mode: manifest ? 'project' : 'studio', root: absolute, dir, memoryPath: join(dir, 'memory.db') };
}
