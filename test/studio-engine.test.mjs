import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openProjectMemory } from '../src/memory.mjs';
import { STUDIO_PROTOCOL_VERSION } from '../src/studio/protocol.mjs';
import { runStudioEngine } from '../src/studio/engine.mjs';
import { CLI, makeStudioProject } from '../test-support/studio-fixtures.mjs';
import { newSecret, startStudioHost } from '../test-support/studio-host.mjs';

const PACKAGE_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const win32 = { skip: process.platform !== 'win32' && 'Windows named pipes only' };

let project;
let hosts;
let engines;

beforeEach(() => {
  project = makeStudioProject();
  hosts = [];
  engines = [];
});

afterEach(async () => {
  for (const host of hosts) await host.close();
  // In-process engines close memory.db only after the pipe closes; Windows refuses to delete open files.
  await Promise.all(engines);
  project.cleanup();
});

async function host(options = {}) {
  const started = await startStudioHost({ root: project.root, ...options });
  hosts.push(started);
  return started;
}

/** Engine running in this process, so collaborators can be injected (EN-13, EN-16, EN-17). */
async function inProcessEngine(options = {}) {
  const secret = newSecret();
  const started = await host({ secret, spawnEngine: false });
  const logs = [];
  let session;
  let opened;
  // studio.hello is a notification: the session opens after the host sent it, so wait for onSession.
  const sessionOpened = new Promise(resolve => (opened = resolve));
  const exitCode = runStudioEngine({
    root: project.root,
    pipePath: started.pipePath,
    secret,
    version: PACKAGE_VERSION,
    log: line => logs.push(String(line)),
    onSession: value => {
      session = value;
      opened();
    },
    ...options,
  });
  const hello = await started.ready;
  engines.push(exitCode);
  await Promise.race([sessionOpened, exitCode]);
  return { host: started, hello, exitCode, logs, session: () => session };
}

const exitedWith = async (started, code, timeoutMs = 3000) => {
  const result = await Promise.race([started.exit, delay(timeoutMs, 'timeout')]);
  assert.notEqual(result, 'timeout', `engine did not exit within ${timeoutMs} ms; stderr: ${started.stderr()}`);
  assert.equal(result.code, code, started.stderr());
};

describe('EN handshake', () => {
  test('EN-01 a mutual HMAC handshake opens the session and exchanges versions', async () => {
    const started = await host();
    const { result } = started.hello;
    assert.equal(result.protocolVersion, STUDIO_PROTOCOL_VERSION);
    assert.equal(result.proof, started.hello.expectedEngineProof);
    assert.match(result.nonce, /^[0-9a-f]{64}$/);
    assert.equal(result.pid, started.child.pid);
    assert.deepEqual(result.versions, {
      engine: PACKAGE_VERSION,
      node: process.version,
      protocol: STUDIO_PROTOCOL_VERSION,
    });
    assert.equal(
      (await started.call('project.snapshot')).root.replaceAll('\\', '/'),
      project.root.replaceAll('\\', '/'),
    );
  });

  test('EN-02 a wrong secret on either side ends the engine with HANDSHAKE_FAILED and no project data', async () => {
    const wrongEngine = await host({ engineSecret: newSecret() });
    await exitedWith(wrongEngine, 3);
    assert.match(wrongEngine.stderr(), /HANDSHAKE_FAILED/);
    assert.deepEqual(wrongEngine.notifications, []);

    const wrongHost = await host({ hostProof: () => '0'.repeat(64) });
    await exitedWith(wrongHost, 3);
    assert.match(wrongHost.stderr(), /HANDSHAKE_FAILED/);
    assert.deepEqual(wrongHost.notifications, []);
  });

  test('EN-03 any request before the handshake closes the connection', async () => {
    const started = await host({
      firstMessage: { jsonrpc: '2.0', id: 99, method: 'project.snapshot', params: {} },
    });
    await exitedWith(started, 3);
    await started.socketClosed;
    assert.match(started.stderr(), /before the handshake/i);
  });

  test('EN-04 a protocol version mismatch names both versions', async () => {
    const started = await host({ protocolVersion: 99 });
    await exitedWith(started, 3);
    assert.match(started.stderr(), /99/);
    assert.match(started.stderr(), new RegExp(`\\b${STUDIO_PROTOCOL_VERSION}\\b`));
  });

  test('EN-05 the secret is only accepted on stdin: --secret is refused and the environment is ignored', async () => {
    const flag = await host({ engineArgs: ['--secret', newSecret()], handshake: false });
    await exitedWith(flag, 2);
    assert.match(flag.stderr(), /--secret/);

    const env = await host({ engineSecret: null, engineEnv: { OMNI_STUDIO_SECRET: newSecret() }, handshake: false });
    env.child.stdin.end();
    await exitedWith(env, 2);
  });

  test('EN-06 a malformed or missing secret exits with code 2', async () => {
    const malformed = await host({ engineSecret: 'xyz', handshake: false });
    await exitedWith(malformed, 2);
    assert.match(malformed.stderr(), /64 hex/i);

    const missing = await host({ engineSecret: null, handshake: false });
    missing.child.stdin.end();
    await exitedWith(missing, 2);
  });

  test('EN-07 a pipe name outside \\\\.\\pipe\\omnispec-{uuid} is refused', win32, async () => {
    for (const pipe of ['\\\\.\\pipe\\evil', '\\\\.\\pipe\\omnispec-../x', 'C:\\temp\\omnispec-1.sock']) {
      const child = spawn(process.execPath, [CLI, 'studio-engine', '--pipe', pipe], { cwd: project.root });
      let stderr = '';
      child.stderr.on('data', chunk => (stderr += chunk));
      child.stdin.end(newSecret() + '\n');
      const code = await new Promise(resolve => child.on('exit', resolve));
      assert.equal(code, 2, `${pipe}: ${stderr}`);
    }
  });
});

describe('EN lifecycle', () => {
  test('EN-08 closing the pipe checkpoints the WAL and exits 0 within 1 s', async () => {
    const started = await host();
    await started.call('project.snapshot');
    const closedAt = Date.now();
    started.closePipe();
    const result = await started.exit;
    assert.equal(result.code, 0, started.stderr());
    assert.ok(Date.now() - closedAt < 1000 + 500, 'exit latency');
    const wal = join(project.root, 'specs', '.omni', 'memory.db-wal');
    assert.ok(!existsSync(wal) || statSync(wal).size === 0, 'wal_checkpoint(TRUNCATE) on exit');
  });

  test('EN-09 EOF on stdin (parent gone) ends the engine cleanly', async () => {
    const started = await host();
    started.child.stdin.end();
    await exitedWith(started, 0, 2000);
  });

  test('EN-16 project memory is opened once per session and closed on exit', async () => {
    const opened = [];
    const closed = [];
    const engine = await inProcessEngine({
      deps: {
        openProjectMemory: async root => {
          const result = await openProjectMemory(root);
          opened.push(root);
          const close = result.memory.close.bind(result.memory);
          result.memory.close = () => {
            closed.push(root);
            close();
          };
          return result;
        },
      },
    });
    for (const method of ['project.snapshot', 'board.get', 'cartography.graph', 'finops.snapshot', 'skills.list'])
      await engine.host.call(method, {});
    assert.equal(opened.length, 1);
    await engine.host.close();
    assert.equal(await engine.exitCode, 0);
    assert.equal(closed.length, 1);
  });
});

describe('EN requests', () => {
  test('EN-10 project.snapshot returns the full shell state quickly', async () => {
    project.cli('create', 'feature', 'login-flow', '--light');
    const started = await host();
    const startedAt = performance.now();
    const snapshot = await started.call('project.snapshot');
    const elapsed = performance.now() - startedAt;
    for (const key of [
      'schemaVersion',
      'root',
      'branch',
      'versions',
      'activeSpec',
      'specs',
      'routes',
      'gates',
      'breakers',
      'cartography',
      'memory',
    ])
      assert.ok(key in snapshot, key);
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.branch, 'main');
    assert.equal(snapshot.activeSpec.slug, '001-login-flow');
    assert.equal(snapshot.routes['001-login-flow'], 'light');
    assert.equal(snapshot.cartography.indexed, false);
    assert.equal(typeof snapshot.memory.walBytes, 'number');
    assert.match(snapshot.memory.specsTreeOid, /^[0-9a-f]{40}$/);
    assert.ok(elapsed < 150, `snapshot took ${elapsed.toFixed(1)} ms`);
  });

  test('EN-11 concurrent requests correlate by id even when answered out of order', async () => {
    const started = await host();
    const methods = ['project.snapshot', 'board.get', 'finops.snapshot', 'skills.list', 'files.tree'];
    const replies = await Promise.all(
      Array.from({ length: 20 }, (_, index) => started.request(methods[index % methods.length], {})),
    );
    assert.equal(replies.length, 20);
    assert.deepEqual(
      replies.map(reply => reply.id),
      Array.from({ length: 20 }, (_, index) => index + 2),
    );
    assert.ok(replies.every(reply => reply.result && !reply.error));
  });

  test('EN-12 domain errors are typed, carry no stack and keep the engine serving', async () => {
    const started = await host();
    const reply = await started.request('blastRadius.heat', { target: '../../outside.ts' });
    assert.equal(reply.error.data.code, 'PATH_OUTSIDE_ROOT');
    assert.equal(typeof reply.error.data.retryable, 'boolean');
    assert.doesNotMatch(JSON.stringify(reply.error), /\n\s+at /);
    assert.ok(await started.call('project.snapshot'));
  });

  test('EN-13 an unexpected error is logged with its stack and ends the engine with code 70', async () => {
    const engine = await inProcessEngine({
      handlerOverrides: {
        'project.snapshot': () => {
          throw new TypeError('studio engine bug');
        },
      },
    });
    const reply = await engine.host.request('project.snapshot', {});
    assert.equal(reply.error.code, -32603);
    assert.equal(await engine.exitCode, 70);
    assert.ok(engine.logs.some(line => /TypeError: studio engine bug/.test(line) && /\n\s+at /.test(line)));
  });

  test('EN-14 a batch of fs.changed reindexes once and emits a single project.changed', async () => {
    project.write('src/b.mjs', 'export const b = 1;\n');
    project.write('src/a.mjs', "import { b } from './b.mjs';\nexport const a = b;\n");
    const started = await host();
    started.notify('fs.changed', { paths: ['src/a.mjs', 'src/b.mjs'] });
    const changed = await started.nextNotification('project.changed');
    assert.ok(
      changed.params.areas.includes('graph') && changed.params.areas.includes('diff'),
      changed.params.areas.join(),
    );
    await delay(300);
    assert.equal(started.notifications.filter(message => message.method === 'project.changed').length, 0);
    const graph = await started.call('cartography.graph', {});
    assert.deepEqual(graph.nodes.map(node => node.path).sort(), ['src/a.mjs', 'src/b.mjs']);
  });

  test('EN-15 a change to specs/*.json rehydrates memory and refreshes the board', async () => {
    project.cli('create', 'feature', 'login-flow', '--light');
    const started = await host();
    const manifest = project.readJson('specs/manifest.json');
    manifest.specs[0].title = 'Renamed Flow';
    project.writeJson('specs/manifest.json', manifest);
    started.notify('fs.changed', { paths: ['specs/manifest.json'] });
    const changed = await started.nextNotification('project.changed');
    assert.deepEqual(changed.params.areas, ['board']);
    const board = await started.call('board.get', { route: 'light' });
    assert.equal(board.lanes.flatMap(lane => lane.cards)[0].title, 'Renamed Flow');
  });

  test('EN-17 notifications wait for drain instead of buffering without bound', async () => {
    const engine = await inProcessEngine();
    engine.host.pauseReading();
    const payload = { blob: 'x'.repeat(1024) };
    let written = 0;
    const loop = (async () => {
      for (let index = 0; index < 10_000; index++) {
        await engine.session().notify('finops.tick', payload);
        written++;
      }
    })();
    await delay(300);
    assert.ok(written < 10_000, `all ${written} notifications were buffered while the reader was paused`);
    assert.ok(written * 1024 < 8 * 1024 * 1024, `${written} KB buffered`);
    engine.host.resumeReading();
    await loop;
    assert.equal(written, 10_000);
  });
});

describe('EN projects installed by Studio outside Git', () => {
  test('EN-30 a folder with a Studio install and no Git repository opens, lists files and never takes the engine down', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { execFileSync } = await import('node:child_process');
    const root = mkdtempSync(join(tmpdir(), 'omni-nogit-'));
    const home = mkdtempSync(join(tmpdir(), 'omni-nogit-home-'));
    const saved = process.env.OMNI_STUDIO_HOME;
    process.env.OMNI_STUDIO_HOME = home;
    try {
      execFileSync(process.execPath, [CLI, 'init', '--yes', '--agent', 'studio'], { cwd: root, stdio: 'ignore' });
      const started = await startStudioHost({ root });
      hosts.push(started);
      await started.ready;
      const snapshot = await started.call('project.snapshot', {});
      assert.equal(snapshot.mode, 'project');
      assert.equal(snapshot.branch, '');
      const tree = await started.call('files.tree', {});
      assert.ok(JSON.stringify(tree).includes('CONSTITUTION.md'), 'the tree is read from disk');
      await assert.rejects(started.call('diff.get', {}), /no es un repositorio Git/);
      // Still answering after the refused view.
      assert.ok(await started.call('conversations.list', { roots: [root] }));
      assert.ok(await started.call('board.get', {}));
    } finally {
      if (saved === undefined) delete process.env.OMNI_STUDIO_HOME;
      else process.env.OMNI_STUDIO_HOME = saved;
      for (const started of hosts.splice(0)) await started.close();
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
