import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { renameWithRetry } from './fs-retry.mjs';

/**
 * Secrets at rest outside the repository.
 *
 * Windows: Win32 DPAPI (CryptProtectData / CryptUnprotectData, CurrentUser scope) with an
 * application entropy so other programs running as the same user cannot unprotect the blob by
 * calling DPAPI without it. No size limit applies, unlike WinCred's 2,560-byte credentials. Node has
 * no FFI without dependencies, so a fixed PowerShell script performs the call; secrets travel on
 * stdin, never on the command line. Other platforms: a 0600 file, which is not kernel encryption.
 */

export const STORE_VERSION = 1;
export const NTE_BAD_KEY_STATE = 0x8009000b;

export class SecureStoreError extends Error {
  /**
   * @param {string} code DPAPI_BAD_KEY_STATE, DPAPI_FAILED, DPAPI_UNAVAILABLE, STORE_CORRUPT,
   *   STORE_VERSION_UNSUPPORTED or STORE_SCHEME_MISMATCH.
   * @param {string} message
   * @param {number|null} [hresult] Win32 HRESULT as an unsigned number.
   */
  constructor(code, message, hresult = null) {
    super(`${code}: ${message}`);
    this.name = 'SecureStoreError';
    this.code = code;
    this.hresult = hresult;
  }
}

/**
 * OmniSpec's per-user state directory: OMNISPEC_HOME, else %LOCALAPPDATA%\OmniSpec on Windows,
 * else $XDG_STATE_HOME/omnispec (default ~/.local/state/omnispec).
 */
export function omnispecHome(env = process.env, platform = process.platform) {
  if (env.OMNISPEC_HOME) return env.OMNISPEC_HOME;
  if (platform === 'win32') {
    if (!env.LOCALAPPDATA) throw new SecureStoreError('DPAPI_UNAVAILABLE', '%LOCALAPPDATA% is not set.');
    return join(env.LOCALAPPDATA, 'OmniSpec');
  }
  return join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'omnispec');
}

const DPAPI_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Security
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $data = [Convert]::FromBase64String($request.data)
  $entropy = [Convert]::FromBase64String($request.entropy)
  $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  if ($request.op -eq 'protect') {
    $result = [System.Security.Cryptography.ProtectedData]::Protect($data, $entropy, $scope)
  } else {
    $result = [System.Security.Cryptography.ProtectedData]::Unprotect($data, $entropy, $scope)
  }
  [Console]::Out.Write((@{ ok = $true; data = [Convert]::ToBase64String($result) } | ConvertTo-Json -Compress))
} catch {
  $failure = $_.Exception
  if ($failure.InnerException) { $failure = $failure.InnerException }
  [Console]::Out.Write((@{ ok = $false; hresult = $failure.HResult; message = $failure.Message } | ConvertTo-Json -Compress))
}
`;

/** Absolute Windows PowerShell path, so a planted powershell.exe on PATH is never used. */
export function powershellPath(env = process.env) {
  return join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * DPAPI backend. `spawnImpl` exists for tests that check what is passed to the helper process.
 * @returns {{scheme: 'dpapi', protect(data: Buffer, entropy: Buffer): Promise<Buffer>, unprotect(blob: Buffer, entropy: Buffer): Promise<Buffer>}}
 */
export function dpapiBackend({ spawnImpl = spawn, executable = powershellPath(), timeoutMs = 30000 } = {}) {
  const encoded = Buffer.from(DPAPI_SCRIPT, 'utf16le').toString('base64');
  const call = (op, data, entropy) =>
    new Promise((resolvePromise, reject) => {
      const child = spawnImpl(
        executable,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      const stdout = [];
      const stderr = [];
      const timer = setTimeout(() => {
        child.kill();
        reject(new SecureStoreError('DPAPI_UNAVAILABLE', `DPAPI helper did not answer within ${timeoutMs} ms.`));
      }, timeoutMs);
      child.stdout.on('data', chunk => stdout.push(chunk));
      child.stderr.on('data', chunk => stderr.push(chunk));
      child.on('error', error => {
        clearTimeout(timer);
        reject(new SecureStoreError('DPAPI_UNAVAILABLE', `Cannot start the DPAPI helper: ${error.message}`));
      });
      child.on('close', code => {
        clearTimeout(timer);
        let answer;
        try {
          answer = JSON.parse(Buffer.concat(stdout).toString('utf8'));
        } catch {
          reject(
            new SecureStoreError(
              'DPAPI_UNAVAILABLE',
              `DPAPI helper exited ${code} without a result: ${Buffer.concat(stderr).toString('utf8').trim().slice(0, 300)}`,
            ),
          );
          return;
        }
        if (answer.ok) {
          resolvePromise(Buffer.from(answer.data, 'base64'));
          return;
        }
        const hresult = Number(answer.hresult) >>> 0;
        const code16 = `0x${hresult.toString(16).padStart(8, '0')}`;
        reject(
          hresult === NTE_BAD_KEY_STATE
            ? new SecureStoreError(
                'DPAPI_BAD_KEY_STATE',
                `Windows reports NTE_BAD_KEY_STATE (${code16}); the DPAPI master key changed (PIN reset or domain password change).`,
                hresult,
              )
            : new SecureStoreError('DPAPI_FAILED', `DPAPI ${op} failed with ${code16}: ${answer.message}`, hresult),
        );
      });
      child.stdin.end(
        JSON.stringify({
          op,
          data: Buffer.from(data).toString('base64'),
          entropy: Buffer.from(entropy).toString('base64'),
        }),
      );
    });
  return {
    scheme: 'dpapi',
    protect: (data, entropy) => call('protect', data, entropy),
    unprotect: (blob, entropy) => call('unprotect', blob, entropy),
  };
}

/** Plain-file backend for non-Windows platforms; confidentiality relies on 0600 permissions. */
export function fileBackend() {
  return {
    scheme: 'posix-file',
    protect: async data => Buffer.from(data),
    unprotect: async blob => Buffer.from(blob),
  };
}

export function defaultBackend(platform = process.platform) {
  return platform === 'win32' ? dpapiBackend() : fileBackend();
}

/**
 * Atomically writes a protected secret envelope ({version, scheme, data}).
 * @param {string} path
 * @param {Buffer} secret
 * @param {{backend: ReturnType<typeof dpapiBackend>, entropy: Buffer}} options
 */
export async function writeSecret(path, secret, { backend, entropy }) {
  const blob = await backend.protect(secret, entropy);
  const envelope = `${JSON.stringify({ version: STORE_VERSION, scheme: backend.scheme, data: blob.toString('base64') })}\n`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, envelope, { flag: 'wx', mode: 0o600 });
  try {
    await renameWithRetry(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(cleanup => {
      error.cleanup = cleanup;
    });
    throw error;
  }
  if (process.platform !== 'win32') await chmod(path, 0o600);
}

/**
 * Reads a secret envelope.
 * @returns {Promise<Buffer|null>} null when the file does not exist.
 * @throws {SecureStoreError} STORE_CORRUPT, STORE_VERSION_UNSUPPORTED, STORE_SCHEME_MISMATCH or a DPAPI error.
 */
export async function readSecret(path, { backend, entropy }) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (error) {
    throw new SecureStoreError('STORE_CORRUPT', `${path} is not a valid secret envelope (${error.message}).`);
  }
  if (envelope?.version !== STORE_VERSION)
    throw new SecureStoreError(
      'STORE_VERSION_UNSUPPORTED',
      `${path} uses store version ${envelope?.version}; this OmniSpec reads version ${STORE_VERSION}.`,
    );
  if (envelope.scheme !== backend.scheme)
    throw new SecureStoreError(
      'STORE_SCHEME_MISMATCH',
      `${path} was written with ${envelope.scheme}, not ${backend.scheme}.`,
    );
  if (typeof envelope.data !== 'string') throw new SecureStoreError('STORE_CORRUPT', `${path} has no data.`);
  return backend.unprotect(Buffer.from(envelope.data, 'base64'), entropy);
}

/** Deletes a secret that can no longer be unprotected (for example after NTE_BAD_KEY_STATE). */
export async function purgeSecret(path) {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
