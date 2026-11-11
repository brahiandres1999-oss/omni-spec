import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function omniHome(env = process.env) {
  if (env.OMNISPEC_HOME) return resolve(env.OMNISPEC_HOME);
  const local = env.LOCALAPPDATA || join(homedir(), process.platform === 'win32' ? 'AppData/Local' : '.local/share');
  return join(local, 'OmniSpec');
}

export function workspaceId(root, platform = process.platform) {
  let key = resolve(root).replaceAll('\\', '/').replace(/\/+$/, '');
  if (platform === 'win32') key = key.toLowerCase();
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
}

export const sameRoot = (a, b) => workspaceId(a) === workspaceId(b);

export function workspaceDir(root, env = process.env) {
  const dir = join(omniHome(env), 'workspaces', workspaceId(root));
  fs.mkdirSync(dir, { recursive: true });
  const marker = join(dir, 'workspace.json');
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(
      marker,
      JSON.stringify({ root: resolve(root), createdAt: new Date().toISOString() }, null, 2) + '\n',
    );
  }
  return dir;
}

export function workspaceMemoryPath(root, env = process.env) {
  return join(workspaceDir(root, env), 'memory.db');
}
