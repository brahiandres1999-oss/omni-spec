import { spawn } from 'node:child_process';
import { access, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StudioError } from '../protocol.mjs';
import { claudeSessionsDir } from './claude-sessions.mjs';
import { codexSessionPath } from './codex-sessions.mjs';

/**
 * The files an agent CLI keeps on this computer for one conversation, so «Eliminar» can remove the
 * conversation from the agent too and not only from Omni Studio. Only paths built from a session id inside each
 * agent's own folders are ever returned; OpenCode and Cline keep every conversation in one shared database, so
 * nothing of theirs is touched (`shared: true`).
 */

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Agents whose history lives in a database shared by all their conversations. */
export const SHARED_HISTORY = Object.freeze(['opencode', 'cline']);

async function present(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

const homeOf = env => env.USERPROFILE || env.HOME || homedir();

/**
 * @param {{agent: string, root: string, sessionId: string, env?: NodeJS.ProcessEnv}} options
 * @returns {Promise<{paths: string[], shared: boolean}>} Existing paths of that conversation.
 */
export async function sessionFiles({ agent, root, sessionId, env = process.env }) {
  if (!SESSION_ID.test(sessionId ?? '')) return { paths: [], shared: false };
  if (SHARED_HISTORY.includes(agent)) return { paths: [], shared: true };
  const candidates = [];
  if (agent === 'claude') {
    const dir = claudeSessionsDir(root, env);
    candidates.push(join(dir, `${sessionId}.jsonl`), join(dir, sessionId));
  } else if (agent === 'codex') {
    const path = await codexSessionPath({ root, sessionId, env });
    if (path) candidates.push(path);
  } else if (agent === 'antigravity') {
    for (const app of ['antigravity-cli', 'antigravity']) {
      const base = join(homeOf(env), '.gemini', app);
      const db = join(base, 'conversations', `${sessionId}.db`);
      candidates.push(
        join(base, 'brain', sessionId),
        db,
        `${db}-wal`,
        `${db}-shm`,
        join(base, 'annotations', `${sessionId}.pbtxt`),
      );
    }
  }
  const paths = [];
  for (const path of candidates) if (await present(path)) paths.push(path);
  return { paths, shared: false };
}

/** Windows: to the Recycle Bin, so a deletion can still be undone from there. */
const RECYCLE = `
Add-Type -AssemblyName Microsoft.VisualBasic
$paths = $env:OMNI_RECYCLE | ConvertFrom-Json
foreach ($p in $paths) {
  if (Test-Path -LiteralPath $p -PathType Container) {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
  } elseif (Test-Path -LiteralPath $p) {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
  }
}`;

/**
 * Moves `paths` to the Recycle Bin (Windows) or deletes them (elsewhere).
 * @throws {StudioError} SESSION_FILES_LOCKED when something could not be removed (the agent may hold it open).
 */
export async function discardFiles(paths, { platform = process.platform, spawnImpl = spawn, env = process.env } = {}) {
  if (paths.length === 0) return;
  if (platform !== 'win32') {
    for (const path of paths) await rm(path, { recursive: true, force: true });
    return;
  }
  const code = await new Promise(resolve => {
    const child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', RECYCLE], {
      env: { ...env, OMNI_RECYCLE: JSON.stringify(paths) },
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('error', () => resolve(-1));
    child.on('exit', resolve);
  });
  const left = [];
  for (const path of paths) if (await present(path)) left.push(path);
  if (code !== 0 || left.length > 0)
    throw new StudioError(
      'SESSION_FILES_LOCKED',
      `No pude borrar el historial del agente (${left.length || paths.length} archivo(s)); puede que el agente lo tenga abierto. Ciérralo y vuelve a intentarlo.`,
      { retryable: true },
    );
}
