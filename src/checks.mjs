import { readFile, lstat, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, win32 } from 'node:path';
import { safePath } from './managed.mjs';

export const DEFAULT_CHECK_TIMEOUT = 120000;
const allowedKeys = new Set(['id', 'command', 'cwd', 'timeoutMs', 'kind', 'enabled']);

/** Resolve a check working directory without following symlinks or leaving the project. */
export async function checkDirectory(root, cwd = '.') {
  if (
    typeof cwd !== 'string' ||
    !cwd ||
    cwd.includes('\0') ||
    /^[A-Za-z]:/.test(cwd) ||
    isAbsolute(cwd) ||
    win32.isAbsolute(cwd) ||
    cwd.split(/[\\/]/).some(part => part === '..')
  )
    throw new Error(`Unsafe check cwd: ${cwd}`);
  const base = resolve(root);
  if ((await lstat(base)).isSymbolicLink()) throw new Error('Refusing symlinked check root.');
  const portable = cwd.replace(/\\/g, '/');
  const path = resolve(base, portable) === base ? base : await safePath(base, portable);
  if (!(await stat(path)).isDirectory()) throw new Error(`Check cwd is not a directory: ${cwd}`);
  return path;
}

/**
 * Load approved checks without running commands. Legacy qualityGates retain gate-N IDs.
 * A catalogue entry wins an exact legacy duplicate (same command, cwd and timeout).
 * @returns {Promise<Array<{id:string,command:string,cwd:string,timeoutMs:number,kind:string}>>}
 */
export async function validateChecks(root, catalogue) {
  const checks = [],
    ids = new Set();
  if (
    catalogue?.schemaVersion !== 1 ||
    !Array.isArray(catalogue.checks) ||
    catalogue.checks.length > 100 ||
    Object.keys(catalogue).some(key => !['schemaVersion', 'checks'].includes(key))
  )
    throw new Error('Invalid checks.json: expected schemaVersion 1 and at most 100 checks.');
  for (const item of catalogue.checks) {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      Object.keys(item).some(key => !allowedKeys.has(key)) ||
      typeof item.id !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(item.id) ||
      /^gate-\d+$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.command !== 'string' ||
      !item.command.trim() ||
      item.command.length > 16384 ||
      item.command.includes('\0') ||
      (item.enabled !== undefined && typeof item.enabled !== 'boolean') ||
      (item.kind !== undefined && !['automated', 'ui'].includes(item.kind))
    )
      throw new Error(
        'Invalid checks.json entry: unique non-reserved ID, approved command and supported fields required.',
      );
    ids.add(item.id);
    const timeoutMs = item.timeoutMs ?? DEFAULT_CHECK_TIMEOUT;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 3600000)
      throw new Error(`Invalid timeoutMs for check ${item.id}; use 100 through 3600000.`);
    const directory = await checkDirectory(root, item.cwd ?? '.');
    const cwd = relative(resolve(root), directory).replace(/\\/g, '/') || '.';
    const normalized = { id: item.id, command: item.command.trim(), cwd, timeoutMs, kind: item.kind ?? 'automated' };
    if (item.enabled !== false) checks.push(normalized);
  }
  return checks;
}

/** Load the catalogue plus compatible legacy gates, without running either. */
export async function loadChecks(root, manifest) {
  let catalogue;
  try {
    catalogue = JSON.parse((await readFile(await safePath(root, 'specs/checks.json'), 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Invalid checks.json: ${error.message}`);
  }
  const checks = catalogue === undefined ? [] : await validateChecks(root, catalogue);
  const commands = (manifest.qualityGates || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  for (const [index, command] of commands.entries()) {
    if (
      checks.some(
        check =>
          check.command === command &&
          check.cwd === '.' &&
          check.timeoutMs === DEFAULT_CHECK_TIMEOUT &&
          check.kind === 'automated',
      )
    )
      continue;
    checks.push({ id: `gate-${index + 1}`, command, cwd: '.', timeoutMs: DEFAULT_CHECK_TIMEOUT, kind: 'automated' });
  }
  if (checks.length) await checkDirectory(root);
  return checks;
}
