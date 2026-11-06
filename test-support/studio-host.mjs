import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI } from './studio-fixtures.mjs';
import { STUDIO_PROTOCOL_VERSION, createFrameDecoder, encodeFrame, handshakeProof } from '../src/studio/protocol.mjs';

export function newPipePath() {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\omnispec-${randomUUID()}`
    : join(tmpdir(), `omnispec-${randomUUID()}.sock`);
}

export const newSecret = () => randomBytes(32).toString('hex');

/**
 * Stand-in for the Rust host: owns the pipe (server side), optionally spawns
 * `omni-spec studio-engine` with the secret on stdin, and runs the mutual handshake:
 *   host -> studio.challenge {protocolVersion, nonce}   (request)
 *   engine -> {protocolVersion, proof, nonce, pid, versions}   (result)
 *   host -> studio.hello {proof}   (notification)
 * Options that break the handshake exist so the engine's refusals can be observed.
 * @param {{
 *   root: string,
 *   secret?: string,
 *   engineSecret?: string,
 *   engineEnv?: Record<string, string>,
 *   protocolVersion?: number,
 *   hostProof?: (nonce: string) => string,
 *   handshake?: boolean,
 *   firstMessage?: object,
 *   engineArgs?: string[],
 *   spawnEngine?: boolean,
 *   pipePath?: string,
 * }} options
 */
export async function startStudioHost(options) {
  const {
    root,
    secret = newSecret(),
    engineSecret = secret,
    protocolVersion = STUDIO_PROTOCOL_VERSION,
    handshake = true,
    spawnEngine = true,
  } = options;
  const pipePath = options.pipePath ?? newPipePath();
  const pending = new Map();
  const notifications = [];
  const socketErrors = [];
  const waiters = [];
  let socket;
  let nextId = 1;
  let stderr = '';
  let connectedResolve;
  const connected = new Promise(resolve => (connectedResolve = resolve));
  let closedResolve;
  const socketClosed = new Promise(resolve => (closedResolve = resolve));

  const server = createServer(connection => {
    socket = connection;
    const decoder = createFrameDecoder();
    connection.on('data', chunk => {
      for (const text of decoder.push(chunk)) {
        const message = JSON.parse(text);
        if (message.id !== undefined && pending.has(message.id)) {
          pending.get(message.id)(message);
          pending.delete(message.id);
        } else if (message.method) {
          notifications.push(message);
          for (const waiter of waiters.splice(0)) waiter();
        }
      }
    });
    connection.on('close', closedResolve);
    // The engine drops the connection on purpose when it refuses a handshake; tests assert on these.
    connection.on('error', error => socketErrors.push(error));
    connectedResolve(connection);
  });
  server.maxConnections = 1;
  await new Promise((resolve, reject) => server.listen(pipePath, resolve).on('error', reject));

  const send = message => socket.write(encodeFrame(message));
  const request = (method, params = {}) =>
    new Promise(resolve => {
      const id = nextId++;
      pending.set(id, resolve);
      send({ jsonrpc: '2.0', id, method, params });
    });
  const notify = (method, params = {}) => send({ jsonrpc: '2.0', method, params });
  const call = async (method, params) => {
    const reply = await request(method, params);
    if (reply.error) throw Object.assign(new Error(reply.error.message), { rpc: reply.error });
    return reply.result;
  };
  const nextNotification = (method, timeoutMs = 5000) =>
    new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`no ${method} within ${timeoutMs} ms`)), timeoutMs);
      const check = () => {
        const index = notifications.findIndex(message => message.method === method);
        if (index === -1) return waiters.push(check);
        clearTimeout(deadline);
        resolve(notifications.splice(index, 1)[0]);
      };
      check();
    });

  let child = null;
  let exit = new Promise(() => {});
  if (spawnEngine) {
    child = spawn(process.execPath, [CLI, 'studio-engine', '--pipe', pipePath, ...(options.engineArgs ?? [])], {
      cwd: root,
      env: { ...process.env, ...options.engineEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stderr.on('data', chunk => (stderr += chunk));
    exit = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
    if (engineSecret !== null) child.stdin.write(engineSecret + '\n');
  }

  const ready = (async () => {
    if (!handshake) return null;
    await Promise.race([connected, exit]);
    if (!socket) return null;
    if (options.firstMessage) send(options.firstMessage);
    const nonce = randomBytes(32).toString('hex');
    const reply = await Promise.race([request('studio.challenge', { protocolVersion, nonce }), exit]);
    if (!reply?.result) return reply;
    const proof = options.hostProof
      ? options.hostProof(reply.result.nonce)
      : handshakeProof(secret, 'host', reply.result.nonce);
    notify('studio.hello', { proof });
    return { ...reply, expectedEngineProof: handshakeProof(secret, 'engine', nonce) };
  })();
  const hello = spawnEngine ? await ready : null;

  return {
    root,
    pipePath,
    secret,
    child,
    exit,
    connected,
    socketClosed,
    ready,
    hello,
    notifications,
    socketErrors,
    request,
    notify,
    call,
    send,
    nextNotification,
    pauseReading: () => socket.pause(),
    resumeReading: () => socket.resume(),
    stderr: () => stderr,
    /** Ends only the pipe; stdin stays open, so the engine must react to the pipe alone. */
    closePipe() {
      socket?.end();
      server.close();
    },
    async close() {
      socket?.end();
      server.close();
      if (child && child.exitCode === null) {
        child.stdin.end();
        const result = await Promise.race([exit, new Promise(resolve => setTimeout(() => resolve('timeout'), 3000))]);
        if (result === 'timeout') child.kill();
      }
    },
  };
}
