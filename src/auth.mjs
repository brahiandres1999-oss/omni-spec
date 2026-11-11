import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { acquireLock, releaseLock } from './manifest.mjs';
import {
  defaultBackend,
  omnispecHome,
  powershellPath,
  purgeSecret,
  readSecret,
  SecureStoreError,
  writeSecret,
} from './secure-store.mjs';

/**
 * Auth broker (blueprint section 4.8).
 *  - Credentials at rest: DPAPI-protected %LOCALAPPDATA%\OmniSpec\auth.dat with application entropy;
 *    NTE_BAD_KEY_STATE purges the store and asks for a clean login instead of crashing.
 *  - One refresh at a time across processes: a named Windows mutex (Global\OmniSpec_Auth_Mutex,
 *    falling back to Local\) or a lockfile elsewhere, plus a re-read after acquiring it, so refresh
 *    token rotation never sees a reused token.
 *  - Delegated CLI passthrough: claude, gh and gcloud keep their own sessions; OmniSpec only asks them.
 */

const STORE_ENTROPY = Buffer.from('OmniSpec.auth-store.v1', 'utf8');
const STORE_PAYLOAD_VERSION = 1;
export const AUTH_MUTEX_NAME = 'Global\\OmniSpec_Auth_Mutex';
export const REFRESH_MARGIN_MS = 300_000;
const MUTEX_NAME = /^(Global|Local)\\[A-Za-z0-9_.-]{1,200}$/;
const SAFE_ARGUMENT = /^[A-Za-z0-9._:=/@-]{1,200}$/;
const NPM_SHIM_TARGET = /"%~?dp0%?\\?([^"%]+\.[cm]?js)"/i;
const SECRET_PATTERNS = [
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bya29\.[A-Za-z0-9_.-]+/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

export class AuthError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'AuthError';
    this.code = code;
  }
}

/** Replaces token-shaped substrings so provider output can be shown safely. */
export function redactSecrets(text) {
  return SECRET_PATTERNS.reduce((result, pattern) => result.replace(pattern, '[REDACTED]'), String(text));
}

export function authStorePath(env = process.env) {
  return join(omnispecHome(env), 'auth.dat');
}

/**
 * Encrypted credential store: { providers: {name: tokens}, apiKeys: {name: {key}} }.
 * @param {{path?: string, backend?: object}} [options]
 */
export function createAuthStore({ path = authStorePath(), backend = defaultBackend() } = {}) {
  return {
    path,
    /**
     * @returns {Promise<{status: 'ok', data: object} | {status: 'empty', data: null} | {status: 'relogin-required', data: null, reason: string}>}
     */
    async read() {
      let secret;
      try {
        secret = await readSecret(path, { backend, entropy: STORE_ENTROPY });
      } catch (error) {
        if (!(error instanceof SecureStoreError) || error.code !== 'DPAPI_BAD_KEY_STATE') throw error;
        await purgeSecret(path);
        return { status: 'relogin-required', data: null, reason: error.message };
      }
      if (!secret) return { status: 'empty', data: null };
      let data;
      try {
        data = JSON.parse(secret.toString('utf8'));
      } catch (error) {
        throw new SecureStoreError(
          'STORE_CORRUPT',
          `${path} does not contain a credential document (${error.message}).`,
        );
      }
      if (data?.version !== STORE_PAYLOAD_VERSION)
        throw new AuthError(
          'AUTH_STORE_VERSION',
          `${path} holds credential format ${data?.version}; upgrade OmniSpec.`,
        );
      return { status: 'ok', data: { providers: data.providers ?? {}, apiKeys: data.apiKeys ?? {} } };
    },
    async write(data) {
      const payload = { version: STORE_PAYLOAD_VERSION, providers: data.providers ?? {}, apiKeys: data.apiKeys ?? {} };
      await writeSecret(path, Buffer.from(JSON.stringify(payload), 'utf8'), { backend, entropy: STORE_ENTROPY });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Interprocess lock
// ---------------------------------------------------------------------------------------------

function mutexScript(name, timeoutMs) {
  return `
$ErrorActionPreference = 'Stop'
try { $mutex = New-Object System.Threading.Mutex($false, '${name}') }
catch {
  $failure = $_.Exception; if ($failure.InnerException) { $failure = $failure.InnerException }
  if ($failure -is [System.UnauthorizedAccessException]) { [Console]::Out.WriteLine('DENIED'); exit 3 }
  [Console]::Out.WriteLine('ERROR ' + $failure.Message); exit 4
}
$state = 'ACQUIRED'
try { if (-not $mutex.WaitOne(${timeoutMs})) { [Console]::Out.WriteLine('TIMEOUT'); exit 2 } }
catch {
  $failure = $_.Exception; if ($failure.InnerException) { $failure = $failure.InnerException }
  if ($failure -is [System.Threading.AbandonedMutexException]) { $state = 'ABANDONED' } else { throw }
}
[Console]::Out.WriteLine($state)
[void][Console]::In.ReadToEnd()
$mutex.ReleaseMutex()
`;
}

/**
 * Holds a named Windows mutex in a helper process that owns it until its stdin closes. If this
 * process dies, stdin closes and the mutex is released (or abandoned, which the next owner accepts).
 * @returns {Promise<{outcome: 'ACQUIRED'|'ABANDONED'|'TIMEOUT'|'DENIED', release?: () => Promise<void>}>}
 */
export function acquireWindowsMutex(name, timeoutMs) {
  if (!MUTEX_NAME.test(name)) throw new TypeError(`Invalid mutex name ${name}.`);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0)
    throw new TypeError('timeoutMs must be a non-negative integer.');
  const encoded = Buffer.from(mutexScript(name, timeoutMs), 'utf16le').toString('base64');
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      powershellPath(),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '';
    let settled = false;
    const closed = new Promise(done => child.once('close', done));
    const guard = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolvePromise({ outcome: 'TIMEOUT' });
    }, timeoutMs + 20000);
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      reject(new AuthError('AUTH_LOCK_UNAVAILABLE', `Cannot start the mutex helper: ${error.message}`));
    });
    child.stdout.on('data', chunk => {
      output += chunk;
      const line = output.split(/\r?\n/)[0];
      if (settled || !output.includes('\n')) return;
      settled = true;
      clearTimeout(guard);
      if (line === 'ACQUIRED' || line === 'ABANDONED')
        resolvePromise({
          outcome: line,
          release: async () => {
            child.stdin.end();
            await closed;
          },
        });
      else if (line === 'TIMEOUT' || line === 'DENIED') resolvePromise({ outcome: line });
      else reject(new AuthError('AUTH_LOCK_UNAVAILABLE', `Mutex helper failed: ${line}`));
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      reject(new AuthError('AUTH_LOCK_UNAVAILABLE', `Mutex helper exited ${code} before acquiring the lock.`));
    });
  });
}

/**
 * Runs `action` while holding the auth lock.
 * @template T
 * @param {() => Promise<T>} action
 * @param {{name?: string, timeoutMs?: number, platform?: string, acquire?: Function, lockPath?: string,
 *   onWarning?: (message: string) => void, onEvent?: (event: string) => void}} [options]
 * @returns {Promise<T>}
 */
export async function withAuthLock(action, options = {}) {
  const {
    name = AUTH_MUTEX_NAME,
    timeoutMs = 30000,
    platform = process.platform,
    acquire = acquireWindowsMutex,
    onWarning = () => {},
    onEvent = () => {},
  } = options;
  if (platform !== 'win32') {
    const lockPath = options.lockPath ?? join(omnispecHome(), 'auth.lock');
    const lease = await acquireLock(lockPath, Math.max(1, Math.ceil(timeoutMs / 50)), 50).catch(error => {
      throw new AuthError('AUTH_LOCK_TIMEOUT', error.message);
    });
    try {
      return await action();
    } finally {
      await releaseLock(lockPath, lease);
    }
  }
  let handle = await acquire(name, timeoutMs);
  if (handle.outcome === 'DENIED' && name.startsWith('Global\\')) {
    const local = `Local\\${name.slice('Global\\'.length)}`;
    onWarning(`The ${name} mutex is not available to this account; coordinating through ${local} (this session only).`);
    handle = await acquire(local, timeoutMs);
  }
  if (handle.outcome === 'TIMEOUT')
    throw new AuthError(
      'AUTH_LOCK_TIMEOUT',
      `Another OmniSpec process held the auth lock for more than ${timeoutMs} ms.`,
    );
  if (handle.outcome === 'DENIED') throw new AuthError('AUTH_LOCK_DENIED', `Access to the ${name} mutex was denied.`);
  // An abandoned mutex means its owner died mid-refresh; the broker re-reads the store anyway.
  onEvent(handle.outcome);
  try {
    return await action();
  } finally {
    await handle.release();
  }
}

// ---------------------------------------------------------------------------------------------
// Broker
// ---------------------------------------------------------------------------------------------

export class AuthBroker {
  /**
   * @param {{store: ReturnType<typeof createAuthStore>, refresh: (refreshToken: string) => Promise<{accessToken: string, refreshToken?: string, expiresIn: number}>,
   *   lock?: (action: Function) => Promise<unknown>, now?: () => number, refreshMarginMs?: number}} options
   */
  constructor({
    store,
    refresh,
    lock = action => withAuthLock(action),
    now = Date.now,
    refreshMarginMs = REFRESH_MARGIN_MS,
  }) {
    this.store = store;
    this.refresh = refresh;
    this.lock = lock;
    this.now = now;
    this.refreshMarginMs = refreshMarginMs;
    this.inflight = new Map();
  }

  async data() {
    const read = await this.store.read();
    if (read.status === 'relogin-required')
      throw new AuthError(
        'AUTH_RELOGIN_REQUIRED',
        `Stored credentials can no longer be decrypted (${read.reason}). Log in again.`,
      );
    return read.data ?? { providers: {}, apiKeys: {} };
  }

  fresh(tokens) {
    return Boolean(tokens?.accessToken) && tokens.expiresAt - this.now() > this.refreshMarginMs;
  }

  /**
   * A valid access token, refreshed when it expires within five minutes. Concurrent callers in this
   * process share one refresh; other processes are serialized by the lock and see the new token.
   */
  async getToken(provider) {
    const current = (await this.data()).providers[provider];
    if (!current) throw new AuthError('AUTH_LOGIN_REQUIRED', `No credentials for ${provider}. Run omni-spec login.`);
    if (this.fresh(current)) return current.accessToken;
    if (!this.inflight.has(provider))
      this.inflight.set(
        provider,
        this.lock(() => this.refreshLocked(provider)).finally(() => this.inflight.delete(provider)),
      );
    return this.inflight.get(provider);
  }

  async refreshLocked(provider) {
    const data = await this.data();
    const tokens = data.providers[provider];
    if (!tokens) throw new AuthError('AUTH_LOGIN_REQUIRED', `No credentials for ${provider}. Run omni-spec login.`);
    if (this.fresh(tokens)) return tokens.accessToken;
    let result;
    try {
      result = await this.refresh(tokens.refreshToken);
    } catch (error) {
      if (error?.oauthError !== 'invalid_grant') throw error;
      delete data.providers[provider];
      await this.store.write(data);
      throw new AuthError(
        'AUTH_RELOGIN_REQUIRED',
        `${provider} revoked the session (invalid_grant). Stored tokens were removed; log in again.`,
      );
    }
    data.providers[provider] = {
      ...tokens,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken ?? tokens.refreshToken,
      expiresAt: this.now() + result.expiresIn * 1000,
    };
    await this.store.write(data);
    return result.accessToken;
  }
}

// ---------------------------------------------------------------------------------------------
// Delegated CLI passthrough
// ---------------------------------------------------------------------------------------------

export const PASSTHROUGH_PROVIDERS = Object.freeze({
  claude: { binary: 'claude', version: ['--version'], login: 'claude (then follow its login prompt)' },
  gh: {
    binary: 'gh',
    version: ['--version'],
    status: ['auth', 'status'],
    token: ['auth', 'token'],
    login: 'gh auth login',
  },
  gcloud: {
    binary: 'gcloud',
    version: ['--version'],
    status: ['config', 'get-value', 'account'],
    token: ['auth', 'print-access-token'],
    login: 'gcloud auth login',
  },
});

async function isFile(path, mode = constants.F_OK) {
  try {
    await access(path, mode);
    return (await stat(path)).isFile();
  } catch (error) {
    if (['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code)) return false;
    throw error;
  }
}

function pathOf(env) {
  const key = Object.keys(env).find(name => name.toUpperCase() === 'PATH');
  return key ? env[key].split(delimiter).filter(Boolean) : [];
}

/**
 * @param {{env?: NodeJS.ProcessEnv, platform?: string, timeoutMs?: number, spawnImpl?: typeof spawn}} [options]
 */
export function createPassthrough({
  env = process.env,
  platform = process.platform,
  timeoutMs = 15000,
  spawnImpl = spawn,
} = {}) {
  const childEnv = { ...process.env };
  if (pathOf(env).length)
    for (const key of Object.keys(childEnv)) if (key.toUpperCase() === 'PATH') delete childEnv[key];
  Object.assign(childEnv, env);

  async function locate(binary) {
    for (const directory of pathOf(env)) {
      if (platform !== 'win32') {
        if (await isFile(join(directory, binary), constants.X_OK)) return { file: join(directory, binary), prefix: [] };
        continue;
      }
      for (const extension of ['.exe', '.com'])
        if (await isFile(join(directory, binary + extension)))
          return { file: join(directory, binary + extension), prefix: [] };
      for (const extension of ['.cmd', '.bat']) {
        const shim = join(directory, binary + extension);
        if (!(await isFile(shim))) continue;
        const target = NPM_SHIM_TARGET.exec(await readFile(shim, 'utf8'))?.[1];
        if (target) return { file: process.execPath, prefix: [join(dirname(shim), target)] };
        // A batch file needs cmd.exe; argv is restricted to SAFE_ARGUMENT constants below.
        return {
          file: join(env.SystemRoot || process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'),
          batch: shim,
        };
      }
    }
    return null;
  }

  async function run(provider, args, { check = false } = {}) {
    const definition = PASSTHROUGH_PROVIDERS[provider];
    if (!definition) throw new AuthError('AUTH_PROVIDER_UNKNOWN', `Unknown provider ${provider}.`);
    for (const arg of args)
      if (!SAFE_ARGUMENT.test(arg))
        throw new AuthError('AUTH_ARGUMENT_REJECTED', `Argument "${arg}" is not allowed for a delegated CLI.`);
    const location = await locate(definition.binary);
    if (!location)
      throw new AuthError('AUTH_PROVIDER_MISSING', `${definition.binary} is not installed or not on PATH.`);
    const argv = location.batch
      ? ['/d', '/s', '/c', `"${location.batch}" ${args.join(' ')}`]
      : [...location.prefix, ...args];
    return new Promise((resolvePromise, reject) => {
      const child = spawnImpl(location.file, argv, {
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: Boolean(location.batch),
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        if (platform === 'win32' && child.pid)
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else child.kill('SIGKILL');
      }, timeoutMs);
      child.stdout.on('data', chunk => {
        stdout += chunk;
      });
      child.stderr.on('data', chunk => {
        stderr += chunk;
      });
      child.on('error', error => {
        clearTimeout(timer);
        reject(new AuthError('AUTH_PROVIDER_MISSING', `${definition.binary} could not start: ${error.message}`));
      });
      child.on('close', code => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new AuthError('AUTH_PROVIDER_TIMEOUT', `${definition.binary} did not answer within ${timeoutMs} ms.`));
          return;
        }
        if (check && code !== 0) {
          const detail = redactSecrets(stderr.trim().split(/\r?\n/).slice(0, 3).join(' '));
          reject(new AuthError('AUTH_PROVIDER_FAILED', `${definition.binary} exited ${code}: ${detail}`));
          return;
        }
        resolvePromise({ code, stdout, stderr: redactSecrets(stderr) });
      });
    });
  }

  return {
    run,
    async detect() {
      const found = [];
      for (const [provider, definition] of Object.entries(PASSTHROUGH_PROVIDERS)) {
        if (!(await locate(definition.binary))) {
          found.push({ provider, available: false });
          continue;
        }
        const result = await run(provider, definition.version);
        found.push({ provider, available: result.code === 0, version: result.stdout.trim().split(/\r?\n/)[0] });
      }
      return found;
    },
    /** @returns {Promise<{provider: string, authenticated: boolean|null, delegated?: boolean, login: string}>} */
    async status(provider) {
      const definition = PASSTHROUGH_PROVIDERS[provider];
      if (!definition?.status) return { provider, authenticated: null, delegated: true, login: definition?.login };
      const result = await run(provider, definition.status);
      const authenticated = result.code === 0 && (provider !== 'gcloud' || Boolean(result.stdout.trim()));
      return { provider, authenticated, login: definition.login };
    },
    /** A short-lived token from the provider's own CLI; it is never written to auth.dat. */
    async token(provider) {
      const definition = PASSTHROUGH_PROVIDERS[provider];
      if (!definition?.token) throw new AuthError('AUTH_PROVIDER_UNSUPPORTED', `${provider} does not hand out tokens.`);
      return (await run(provider, definition.token, { check: true })).stdout.trim();
    },
  };
}

async function probeLocalOllama() {
  try {
    const response = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Credential precedence: delegated CLI or subscription session, then a BYOK key in the encrypted
 * store, then a local Ollama server.
 * @returns {Promise<{source: 'passthrough'|'byok'|'local'|null, provider?: string, url?: string}>}
 */
export async function selectCredentialSource({
  passthrough = createPassthrough(),
  store = createAuthStore(),
  probeOllama = probeLocalOllama,
} = {}) {
  for (const item of await passthrough.detect()) {
    if (!item.available) continue;
    const status = await passthrough.status(item.provider);
    if (status.authenticated === true || status.delegated) return { source: 'passthrough', provider: item.provider };
  }
  const read = await store.read();
  const keys = Object.entries(read.data?.apiKeys ?? {}).filter(([, value]) => value?.key);
  if (keys.length) return { source: 'byok', provider: keys[0][0] };
  if (await probeOllama()) return { source: 'local', provider: 'ollama', url: 'http://localhost:11434' };
  return { source: null };
}
