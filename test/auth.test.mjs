import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  AuthBroker,
  AuthError,
  authStorePath,
  createAuthStore,
  createPassthrough,
  redactSecrets,
  selectCredentialSource,
  withAuthLock,
} from '../src/auth.mjs';
import { SecureStoreError, dpapiBackend, fileBackend, omnispecHome, writeSecret } from '../src/secure-store.mjs';

const isWindows = process.platform === 'win32';
const cli = fileURLToPath(new URL('../bin/omni-spec.mjs', import.meta.url));
const worker = fileURLToPath(new URL('../test-support/auth-worker.mjs', import.meta.url));

let home;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'omni-auth-home-'));
  process.env.OMNISPEC_HOME = home;
});
after(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A backend that behaves like DPAPI but keeps data reversible for unit tests. */
function fakeBackend({ failUnprotect } = {}) {
  return {
    scheme: 'dpapi',
    protect: async data => Buffer.from(data).reverse(),
    unprotect: async blob => {
      if (failUnprotect) throw failUnprotect;
      return Buffer.from(blob).reverse();
    },
  };
}

const tokens = (overrides = {}) => ({
  accessToken: 'access-old',
  refreshToken: 'refresh-1',
  expiresAt: 1_000_000,
  ...overrides,
});

/** Strict refresh-token-rotation server: a refresh token works once; reuse revokes the chain. */
function rtrServer() {
  let valid = 'refresh-1';
  const state = { refreshes: 0, revoked: false };
  const refresh = async refreshToken => {
    await new Promise(resolve => setTimeout(resolve, 30));
    if (state.revoked || refreshToken !== valid) {
      state.revoked = true;
      const error = new Error('invalid_grant');
      error.oauthError = 'invalid_grant';
      throw error;
    }
    state.refreshes++;
    valid = `refresh-${state.refreshes + 1}`;
    return { accessToken: `access-${state.refreshes}`, refreshToken: valid, expiresIn: 3600 };
  };
  return { state, refresh };
}

async function fakeCli(directory, name, source) {
  await mkdir(directory, { recursive: true });
  if (isWindows) {
    await writeFile(join(directory, `${name}.js`), source);
    await writeFile(join(directory, `${name}.cmd`), `@ECHO off\r\n"%_prog%"  "%dp0%\\${name}.js" %*\r\n`);
  } else {
    await writeFile(join(directory, name), `#!/usr/bin/env node\n${source}`);
    await chmod(join(directory, name), 0o755);
  }
}

const pathEnv = directory => ({ PATH: `${directory}${delimiter}${dirname(process.execPath)}` });

describe('DPAPI credential store (C-08 / T-04)', () => {
  test('AUTH-01 a 16 KB token bundle round-trips through real DPAPI', { skip: !isWindows }, async () => {
    const store = createAuthStore({ path: join(home, 'auth-01.dat'), backend: dpapiBackend() });
    const bundle = { accessToken: 'a'.repeat(6000), refreshToken: 'r'.repeat(6000), idToken: 'i'.repeat(4000) };
    await store.write({ providers: { copilot: bundle } });
    const read = await store.read();
    assert.equal(read.status, 'ok');
    assert.deepEqual(read.data.providers.copilot, bundle);
  });

  test('AUTH-02 the store lives at %LOCALAPPDATA%\\OmniSpec\\auth.dat', () => {
    assert.equal(
      omnispecHome({ LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local' }, 'win32'),
      join('C:\\Users\\dev\\AppData\\Local', 'OmniSpec'),
    );
    assert.equal(authStorePath({ OMNISPEC_HOME: home }), join(home, 'auth.dat'));
    assert.equal(omnispecHome({ XDG_STATE_HOME: '/state' }, 'linux'), join('/state', 'omnispec'));
  });

  test('AUTH-03 another entropy cannot unprotect the blob', { skip: !isWindows }, async () => {
    const backend = dpapiBackend();
    const blob = await backend.protect(Buffer.from('secret'), Buffer.from('OmniSpec.auth-store.v1'));
    await assert.rejects(
      backend.unprotect(blob, Buffer.from('another-program')),
      error => error instanceof SecureStoreError && error.code === 'DPAPI_FAILED',
    );
  });

  test('AUTH-04 secrets never travel on the helper command line', async () => {
    const calls = [];
    const spawnImpl = (file, args, options) => {
      calls.push({ file, args, options });
      return spawn(
        process.execPath,
        [
          '-e',
          'process.stdin.resume();process.stdin.on("end",()=>process.stdout.write(JSON.stringify({ok:true,data:"AA=="})))',
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
    };
    await dpapiBackend({ spawnImpl }).protect(Buffer.from('top-secret-value'), Buffer.from('entropy'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.shell, false);
    assert.match(calls[0].file, /System32[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i);
    const commandLine = calls[0].args.join(' ');
    for (const secret of ['top-secret-value', Buffer.from('top-secret-value').toString('base64')])
      assert.ok(!commandLine.includes(secret));
  });

  test('AUTH-05 auth.dat on disk holds no clear-text secret', { skip: !isWindows }, async () => {
    const path = join(home, 'auth-05.dat');
    await createAuthStore({ path, backend: dpapiBackend() }).write({
      providers: { x: { accessToken: 'visible-token-123' } },
    });
    const raw = await readFile(path);
    for (const encoding of ['utf8', 'utf16le', 'base64'])
      assert.ok(!raw.includes(Buffer.from('visible-token-123', encoding === 'base64' ? 'utf8' : encoding)));
    assert.ok(!raw.toString('utf8').includes(Buffer.from('visible-token-123').toString('base64')));
  });

  test('AUTH-06 writes are atomic: a failed write keeps the previous store', async () => {
    const path = join(home, 'auth-06.dat');
    const store = createAuthStore({ path, backend: fakeBackend() });
    await store.write({ providers: { a: { accessToken: 'one' } } });
    const broken = createAuthStore({
      path,
      backend: { ...fakeBackend(), protect: async () => Promise.reject(new Error('disk full')) },
    });
    await assert.rejects(broken.write({ providers: { a: { accessToken: 'two' } } }), /disk full/);
    assert.equal((await store.read()).data.providers.a.accessToken, 'one');
  });

  test('AUTH-07 NTE_BAD_KEY_STATE purges the store and asks for a clean login', async () => {
    const path = join(home, 'auth-07.dat');
    await createAuthStore({ path, backend: fakeBackend() }).write({ providers: { a: tokens() } });
    const failure = new SecureStoreError('DPAPI_BAD_KEY_STATE', 'NTE_BAD_KEY_STATE', 0x8009000b);
    const result = await createAuthStore({ path, backend: fakeBackend({ failUnprotect: failure }) }).read();
    assert.equal(result.status, 'relogin-required');
    assert.match(result.reason, /0x8009000b|NTE_BAD_KEY_STATE/i);
    assert.ok(!existsSync(path));
  });

  test('AUTH-08 other DPAPI failures and corrupt files are typed errors and keep the file', async () => {
    const path = join(home, 'auth-08.dat');
    await createAuthStore({ path, backend: fakeBackend() }).write({ providers: {} });
    const failure = new SecureStoreError('DPAPI_FAILED', 'NTE_BAD_DATA', 0x8009000d);
    await assert.rejects(
      createAuthStore({ path, backend: fakeBackend({ failUnprotect: failure }) }).read(),
      error => error.code === 'DPAPI_FAILED',
    );
    assert.ok(existsSync(path));
    await writeFile(path, 'not json');
    await assert.rejects(
      createAuthStore({ path, backend: fakeBackend() }).read(),
      error => error.code === 'STORE_CORRUPT',
    );
    assert.ok(existsSync(path));
  });

  test('AUTH-09 non-Windows stores are 0600 files', { skip: isWindows }, async () => {
    const path = join(home, 'auth-09.dat');
    await createAuthStore({ path, backend: fileBackend() }).write({ providers: {} });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  });

  test('AUTH-10 an unknown store version is a typed error and is never purged', async () => {
    const path = join(home, 'auth-10.dat');
    await writeFile(path, JSON.stringify({ version: 7, scheme: 'dpapi', data: '' }));
    await assert.rejects(
      createAuthStore({ path, backend: fakeBackend() }).read(),
      error => error.code === 'STORE_VERSION_UNSUPPORTED',
    );
    assert.ok(existsSync(path));
    await writeSecret(path, Buffer.from(JSON.stringify({ version: 9, providers: {} })), {
      backend: fakeBackend(),
      entropy: Buffer.from('OmniSpec.auth-store.v1'),
    });
    await assert.rejects(
      createAuthStore({ path, backend: fakeBackend() }).read(),
      error => error.code === 'AUTH_STORE_VERSION',
    );
  });
});

describe('Interprocess auth mutex (C-08)', () => {
  const name = `Local\\OmniSpecTest_${process.pid}`;

  test('AUTH-11 the named mutex is acquired and released', { skip: !isWindows }, async () => {
    assert.equal(await withAuthLock(async () => 'inside', { name }), 'inside');
    assert.equal(await withAuthLock(async () => 'again', { name }), 'again');
  });

  test('AUTH-12 a second process waits while the first holds the mutex', { skip: !isWindows }, async () => {
    const holder = spawn(process.execPath, [worker, 'hold', name, '700'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = new Promise(resolve => holder.once('close', resolve));
    await new Promise(resolve => holder.stdout.once('data', resolve));
    const started = Date.now();
    await withAuthLock(async () => null, { name, timeoutMs: 5000 });
    assert.ok(Date.now() - started >= 400, `acquired after ${Date.now() - started} ms`);
    await closed;
  });

  test('AUTH-13 a mutex abandoned by a killed process can be acquired', { skip: !isWindows }, async () => {
    const holder = spawn(process.execPath, [worker, 'hold', name, '60000'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = new Promise(resolve => holder.once('close', resolve));
    await new Promise(resolve => holder.stdout.once('data', resolve));
    spawnSync('taskkill', ['/pid', String(holder.pid), '/T', '/F'], { windowsHide: true });
    await closed;
    const events = [];
    assert.equal(
      await withAuthLock(async () => 'recovered', { name, timeoutMs: 5000, onEvent: e => events.push(e) }),
      'recovered',
    );
  });

  test('AUTH-14 acquisition times out without running the action', async () => {
    let ran = false;
    const helper = () => ({ outcome: 'TIMEOUT' });
    await assert.rejects(
      withAuthLock(
        async () => {
          ran = true;
        },
        { name, timeoutMs: 50, platform: 'win32', acquire: helper },
      ),
      error => error instanceof AuthError && error.code === 'AUTH_LOCK_TIMEOUT',
    );
    assert.equal(ran, false);
  });

  test('AUTH-15 a denied Global mutex falls back to Local with a warning', async () => {
    const seen = [];
    const warnings = [];
    const acquire = requested => {
      seen.push(requested);
      return requested.startsWith('Global\\')
        ? { outcome: 'DENIED' }
        : { outcome: 'ACQUIRED', release: async () => {} };
    };
    const value = await withAuthLock(async () => 'ok', {
      platform: 'win32',
      acquire,
      onWarning: message => warnings.push(message),
    });
    assert.equal(value, 'ok');
    assert.deepEqual(seen, ['Global\\OmniSpec_Auth_Mutex', 'Local\\OmniSpec_Auth_Mutex']);
    assert.match(warnings[0], /Local/);
  });

  test('AUTH-16 the POSIX fallback lockfile serializes holders', async () => {
    const order = [];
    const lockDir = join(home, 'posix-lock');
    const run = tag =>
      withAuthLock(
        async () => {
          order.push(`${tag}:start`);
          await new Promise(resolve => setTimeout(resolve, 40));
          order.push(`${tag}:end`);
        },
        { platform: 'linux', lockPath: lockDir },
      );
    await Promise.all([run('a'), run('b')]);
    assert.ok(
      JSON.stringify(order) === JSON.stringify(['a:start', 'a:end', 'b:start', 'b:end']) ||
        JSON.stringify(order) === JSON.stringify(['b:start', 'b:end', 'a:start', 'a:end']),
      order.join(','),
    );
  });
});

describe('Single auth broker and refresh-token rotation (C-08 / T-04)', () => {
  const inMemoryLock = () => {
    let chain = Promise.resolve();
    return action => {
      const next = chain.then(action);
      chain = next.catch(() => null);
      return next;
    };
  };

  async function broker({ now = () => 1_000_000 - 200_000, provider = rtrServer(), seed = tokens() } = {}) {
    const store = createAuthStore({ path: join(home, `broker-${Math.random()}.dat`), backend: fakeBackend() });
    await store.write({ providers: { copilot: seed } });
    return {
      store,
      provider,
      instance: new AuthBroker({ store, lock: inMemoryLock(), refresh: provider.refresh, now }),
    };
  }

  test('AUTH-17 ten concurrent requests trigger exactly one refresh and no revocation', async () => {
    const { instance, provider, store } = await broker();
    const results = await Promise.all(Array.from({ length: 10 }, () => instance.getToken('copilot')));
    assert.deepEqual(new Set(results), new Set(['access-1']));
    assert.equal(provider.state.refreshes, 1);
    assert.equal(provider.state.revoked, false);
    assert.equal((await store.read()).data.providers.copilot.refreshToken, 'refresh-2');
  });

  test('AUTH-18 after taking the lock the broker re-reads and skips a refresh someone else did', async () => {
    const { instance, provider, store } = await broker();
    let first = true;
    const racingLock = async action => {
      if (first) {
        first = false;
        const current = (await store.read()).data;
        current.providers.copilot = tokens({ accessToken: 'access-from-other-process', expiresAt: 9_000_000 });
        await store.write(current);
      }
      return action();
    };
    instance.lock = racingLock;
    assert.equal(await instance.getToken('copilot'), 'access-from-other-process');
    assert.equal(provider.state.refreshes, 0);
  });

  test('AUTH-19 tokens refresh proactively five minutes before expiry', async () => {
    let current = 1_000_000 - 301_000;
    const { instance, provider } = await broker({ now: () => current });
    assert.equal(await instance.getToken('copilot'), 'access-old');
    assert.equal(provider.state.refreshes, 0);
    current = 1_000_000 - 300_000;
    assert.equal(await instance.getToken('copilot'), 'access-1');
    assert.equal(provider.state.refreshes, 1);
  });

  test('AUTH-20 a revoked chain (invalid_grant) purges the provider and asks for login', async () => {
    const { instance, store } = await broker({ seed: tokens({ refreshToken: 'stolen-and-reused' }) });
    await assert.rejects(
      instance.getToken('copilot'),
      error => error instanceof AuthError && error.code === 'AUTH_RELOGIN_REQUIRED',
    );
    assert.equal((await store.read()).data.providers.copilot, undefined);
  });

  test('AUTH-21 EARS: two real processes, DPAPI and a strict RTR server share one refresh', {
    skip: !isWindows,
  }, async () => {
    const { state, refresh } = rtrServer();
    const server = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      try {
        const result = await refresh(JSON.parse(body).refreshToken);
        response.end(JSON.stringify(result));
      } catch (error) {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: error.oauthError }));
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/token`;
    const storePath = join(home, 'ears-auth.dat');
    try {
      await createAuthStore({ path: storePath, backend: dpapiBackend() }).write({
        providers: { copilot: tokens({ expiresAt: Date.now() + 60_000 }) },
      });
      const run = () =>
        new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [worker, 'token', storePath, url, `Local\\OmniSpecEars_${process.pid}`],
            {
              stdio: ['ignore', 'pipe', 'pipe'],
            },
          );
          let out = '';
          let err = '';
          child.stdout.on('data', chunk => {
            out += chunk;
          });
          child.stderr.on('data', chunk => {
            err += chunk;
          });
          child.on('close', code => (code === 0 ? resolve(out.trim()) : reject(new Error(err))));
        });
      const [a, b] = await Promise.all([run(), run()]);
      assert.equal(a, 'access-1');
      assert.equal(b, 'access-1');
      assert.equal(state.refreshes, 1);
      assert.equal(state.revoked, false);
    } finally {
      server.close();
    }
  });
});

describe('Delegated CLI passthrough (C-08)', () => {
  let bin;
  before(async () => {
    bin = await mkdtemp(join(tmpdir(), 'omni-fake-cli-'));
    await fakeCli(
      bin,
      'gh',
      `const args = process.argv.slice(2).join(' ');
if (args === '--version') console.log('gh version 2.99.0 (2026-01-01)');
else if (args === 'auth status') { if (process.env.FAKE_GH_LOGGED_IN === '1') console.log('Logged in'); else { console.error('You are not logged into any GitHub hosts. token ghp_${'A'.repeat(36)}'); process.exit(1); } }
else if (args === 'auth token') console.log('gho_fake_token_value');
else process.exit(9);
`,
    );
    await fakeCli(
      bin,
      'gcloud',
      `const args = process.argv.slice(2).join(' ');
if (args === '--version') console.log('Google Cloud SDK 500.0.0');
else if (args === 'config get-value account') console.log('dev@example.invalid');
else if (args === 'auth print-access-token') console.log('ya29.fake-access-token');
else if (args === 'hang') setTimeout(() => {}, 60000);
else process.exit(9);
`,
    );
  });
  after(async () => {
    await rm(bin, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('AUTH-22 detects installed and missing CLIs with their versions', async () => {
    const found = await createPassthrough({ env: pathEnv(bin) }).detect();
    assert.deepEqual(
      found.map(item => [item.provider, item.available]),
      [
        ['claude', false],
        ['gh', true],
        ['gcloud', true],
      ],
    );
    assert.match(found[1].version, /gh version 2\.99\.0/);
  });

  test('AUTH-23 gh auth status maps to authenticated true or false', async () => {
    assert.equal(
      (await createPassthrough({ env: { ...pathEnv(bin), FAKE_GH_LOGGED_IN: '1' } }).status('gh')).authenticated,
      true,
    );
    assert.equal((await createPassthrough({ env: pathEnv(bin) }).status('gh')).authenticated, false);
  });

  test('AUTH-24 gcloud access tokens stay in memory and are never stored', async () => {
    const before = existsSync(authStorePath());
    assert.equal(await createPassthrough({ env: pathEnv(bin) }).token('gcloud'), 'ya29.fake-access-token');
    assert.equal(existsSync(authStorePath()), before);
  });

  test('AUTH-25 providers run with shell: false and a fixed argv', async () => {
    const calls = [];
    const spawnImpl = (file, args, options) => {
      calls.push({ file, args, options });
      return spawn(file, args, options);
    };
    await createPassthrough({ env: pathEnv(bin), spawnImpl }).status('gh');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.shell, false);
    assert.deepEqual(calls[0].args.slice(-2), ['auth', 'status']);
    await assert.rejects(
      createPassthrough({ env: pathEnv(bin) }).run('gh', ['auth', 'status; whoami']),
      /AUTH_ARGUMENT_REJECTED/,
    );
  });

  test('AUTH-26 a hanging provider times out and is killed', async () => {
    const passthrough = createPassthrough({ env: pathEnv(bin), timeoutMs: 300 });
    const started = Date.now();
    await assert.rejects(passthrough.run('gcloud', ['hang']), error => error.code === 'AUTH_PROVIDER_TIMEOUT');
    assert.ok(Date.now() - started < 5000);
  });

  test('AUTH-27 provider stderr is redacted before it reaches error messages', async () => {
    const error = await createPassthrough({ env: pathEnv(bin) })
      .run('gh', ['auth', 'status'], { check: true })
      .then(
        () => assert.fail('expected failure'),
        failure => failure,
      );
    assert.match(error.message, /\[REDACTED\]/);
    assert.ok(!error.message.includes('ghp_A'));
    assert.equal(
      redactSecrets('Bearer eyJabc.def.ghi and sk-ant-0123456789abcdefghij'),
      'Bearer [REDACTED] and [REDACTED]',
    );
  });

  test('AUTH-28 credential cascade: passthrough, then BYOK, then local Ollama', async () => {
    const passthrough = available => ({
      detect: async () => available.map(provider => ({ provider, available: true })),
      status: async provider => ({ provider, authenticated: provider !== 'gh' || available.includes('gh') }),
    });
    const store = data => ({ read: async () => ({ status: 'ok', data }) });
    const offline = { probeOllama: async () => false };
    assert.deepEqual(
      await selectCredentialSource({ passthrough: passthrough(['gh']), store: store({ providers: {} }), ...offline }),
      { source: 'passthrough', provider: 'gh' },
    );
    assert.deepEqual(
      await selectCredentialSource({
        passthrough: passthrough([]),
        store: store({ providers: {}, apiKeys: { anthropic: { key: 'sk-x' } } }),
        ...offline,
      }),
      { source: 'byok', provider: 'anthropic' },
    );
    assert.deepEqual(
      await selectCredentialSource({ passthrough: passthrough([]), store: store(null), probeOllama: async () => true }),
      { source: 'local', provider: 'ollama', url: 'http://localhost:11434' },
    );
    assert.deepEqual(await selectCredentialSource({ passthrough: passthrough([]), store: store(null), ...offline }), {
      source: null,
    });
  });

  test('AUTH-29 omni-spec login --provider gh reports the delegated session', async () => {
    const env = { ...process.env, ...pathEnv(bin), OMNISPEC_HOME: home };
    const out = spawnSync(process.execPath, [cli, 'login', '--provider', 'gh'], {
      env: { ...env, FAKE_GH_LOGGED_IN: '1' },
      encoding: 'utf8',
      cwd: home,
    });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /gh.*authenticated/i);
    const missing = spawnSync(process.execPath, [cli, 'login', '--provider', 'gh'], {
      env,
      encoding: 'utf8',
      cwd: home,
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stdout + missing.stderr, /gh auth login/);
    assert.ok(!(missing.stdout + missing.stderr).includes('ghp_A'));
  });

  test('AUTH-30 omni-spec auth status --json never prints secrets', async () => {
    const path = authStorePath();
    await createAuthStore({ path }).write({
      providers: { copilot: tokens({ accessToken: 'access-secret-xyz' }) },
      apiKeys: { anthropic: { key: 'sk-ant-secret-key-1234567890' } },
    });
    const out = spawnSync(process.execPath, [cli, 'auth', 'status', '--json'], {
      env: { ...process.env, ...pathEnv(bin), OMNISPEC_HOME: home },
      encoding: 'utf8',
      cwd: home,
    });
    assert.equal(out.status, 0, out.stderr);
    const report = JSON.parse(out.stdout);
    assert.deepEqual(report.store.providers, ['copilot']);
    assert.deepEqual(report.store.apiKeys, ['anthropic']);
    for (const secret of ['access-secret-xyz', 'sk-ant-secret-key', 'refresh-1'])
      assert.ok(!out.stdout.includes(secret));
  });
});
