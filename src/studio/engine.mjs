import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { statSync } from 'node:fs';
import { connect } from 'node:net';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { AuthError, selectCredentialSource } from '../auth.mjs';
import { indexRepository, summarizeGraph } from '../cartography/graph.mjs';
import { specRoute } from '../fit.mjs';
import { GateError, approveGate, gateStatus } from '../gates.mjs';
import { getActiveSpec, loadManifest } from '../manifest.mjs';
import {
  openMemory,
  openProjectMemory,
  readSpecsGitState,
  startCheckpointSupervisor,
  syncFromGit,
} from '../memory.mjs';
import { SecureStoreError } from '../secure-store.mjs';
import { createAgentHub } from './agents/index.mjs';
import { collectBoardInputs, projectBoard } from './projections/board.mjs';
import { fileTree } from './projections/files.mjs';
import { projectFinops, pruneTokenEvents } from './projections/finops.mjs';
import { heatFromTarget, projectGraph } from './projections/graph.mjs';
import { listSkills, toggleSkill } from './projections/skills.mjs';
import {
  STUDIO_PROTOCOL_VERSION,
  StudioError,
  createFrameDecoder,
  createRpcDispatcher,
  encodeFrame,
  handshakeProof,
  schemaProblems,
  STUDIO_METHODS,
} from './protocol.mjs';
import { addRemark, approveGate2, decideHunk, getDiff, getDiffFile, stageApproved } from './review.mjs';
import { memorySummary } from './memory-summary.mjs';
import { createConversationIndex, listConversationsAt, updateConversationAt } from './conversations.mjs';
import { resolveWorkspace, sameRoot } from './workspace.mjs';

/**
 * `omni-spec studio-engine`: the Node side of Omni Studio (plan §5). It connects as a client to the
 * named pipe the Rust host created, proves knowledge of the secret it received on stdin, and serves
 * the IPC methods. Exit codes: 0 clean shutdown, 3 handshake refused, 70 unexpected fault (the host
 * supervisor restarts the engine; D-12).
 */

export const EXIT = Object.freeze({ OK: 0, USAGE: 2, HANDSHAKE: 3, FAULT: 70 });
export const PIPE_NAME_WIN32 = /^\\\\\.\\pipe\\omnispec-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SECRET_PATTERN = /^[0-9a-f]{64}$/;
const BUNDLED_SKILLS = fileURLToPath(new URL('../../skills/', import.meta.url));
const AREA_ORDER = ['board', 'graph', 'diff', 'files', 'finops', 'skills'];
const execFileAsync = promisify(execFile);

const proofMatches = (expected, actual) =>
  typeof actual === 'string' &&
  actual.length === expected.length &&
  timingSafeEqual(Buffer.from(expected), Buffer.from(actual));

/** Areas of the UI invalidated by a batch of changed project paths. */
export function areasForPaths(paths) {
  const areas = new Set();
  for (const path of paths) {
    if (path.startsWith('specs/')) areas.add('board');
    else if (path === '.git/HEAD' || path === '.git/index') {
      areas.add('diff');
      areas.add('files');
    } else {
      areas.add('graph');
      areas.add('diff');
      areas.add('files');
    }
  }
  return AREA_ORDER.filter(area => areas.has(area));
}

async function currentBranch(root) {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  return stdout.trim();
}

function walBytes(path) {
  try {
    return statSync(`${path}-wal`).size;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}

function domainGate(error) {
  if (error instanceof GateError) return new StudioError('GATE_LOCKED', error.message);
  return error;
}

const NOT_INSTALLED =
  'OmniSpec no está instalado en este proyecto: Omni Studio trabaja sin escribir en el repositorio, así que esta vista no está disponible.';

/**
 * Studio mode (no specs/manifest.json): views that need specs answer OMNISPEC_NOT_INSTALLED instead of writing
 * to the repository, and any other failure becomes a domain error so a plain folder never crashes the engine.
 */
function studioModeHandlers(handlers) {
  const notInstalled = () => {
    throw new StudioError('OMNISPEC_NOT_INSTALLED', NOT_INSTALLED);
  };
  const soft =
    handler =>
    async (...args) => {
      try {
        return await handler(...args);
      } catch (error) {
        if (error instanceof StudioError) throw error;
        throw new StudioError('STUDIO_VIEW_UNAVAILABLE', error.message, { retryable: true });
      }
    };
  const guarded = { ...handlers };
  for (const name of [
    'board.get',
    'gate.approve',
    'review.decideHunk',
    'review.stageApproved',
    'review.addRemark',
    'skills.toggle',
  ])
    guarded[name] = notInstalled;
  for (const name of ['cartography.graph', 'blastRadius.heat', 'diff.get', 'diff.getFile', 'files.tree', 'skills.list'])
    guarded[name] = soft(handlers[name]);
  return guarded;
}

function createHandlers(root, memory, { version, actor, credentials, notify, workspace, agents, conversations }) {
  const studio = workspace.mode === 'studio';
  const activeSpecId = async spec => {
    if (spec) return spec;
    const active = await getActiveSpec(root);
    if (!active) throw new StudioError('NO_ACTIVE_SPEC', 'There is no active specification; choose one first.');
    return active.id;
  };
  let changes = Promise.resolve();
  const enqueue = work => {
    changes = changes.then(work);
    return changes;
  };

  const handlers = {
    async 'project.snapshot'() {
      if (studio) {
        const indexed = memory.db.prepare('SELECT count(*) AS n FROM modules_graph').get().n > 0;
        return {
          schemaVersion: 1,
          root,
          branch: await currentBranch(root).catch(() => ''),
          versions: { engine: version, node: process.version, protocol: STUDIO_PROTOCOL_VERSION },
          mode: 'studio',
          workspace: workspace.dir,
          activeSpec: null,
          specs: [],
          routes: {},
          gates: {},
          breakers: projectFinops(memory).tasks.map(task => ({ taskId: task.taskId, state: task.state })),
          cartography: { indexed, summary: indexed ? summarizeGraph(memory) : null },
          memory: { walBytes: walBytes(workspace.memoryPath), specsTreeOid: '' },
        };
      }
      const manifest = await loadManifest(root);
      const [branch, gitState, activeSpec] = await Promise.all([
        currentBranch(root),
        readSpecsGitState(root),
        getActiveSpec(root),
      ]);
      const routes = {};
      const gates = {};
      await Promise.all(
        manifest.specs.map(async spec => {
          routes[spec.slug] = (await specRoute(root, spec))?.route ?? null;
          const status = await gateStatus(root, spec.id);
          gates[spec.slug] = { required: status.required, 1: status.gates[1], 2: status.gates[2] };
        }),
      );
      const indexed = memory.db.prepare('SELECT count(*) AS n FROM modules_graph').get().n > 0;
      return {
        schemaVersion: 1,
        root,
        branch,
        versions: { engine: version, node: process.version, protocol: STUDIO_PROTOCOL_VERSION },
        mode: 'project',
        workspace: workspace.dir,
        activeSpec,
        specs: manifest.specs,
        routes,
        gates,
        breakers: projectFinops(memory).tasks.map(task => ({ taskId: task.taskId, state: task.state })),
        cartography: { indexed, summary: indexed ? summarizeGraph(memory) : null },
        memory: { walBytes: walBytes(workspace.memoryPath), specsTreeOid: gitState.treeOid },
      };
    },
    async 'board.get'({ route, filters }) {
      const inputs = await collectBoardInputs(root);
      let effective = route;
      if (!effective) {
        const active = await getActiveSpec(root);
        const activeRoute = active ? (await specRoute(root, active))?.route : null;
        effective = ['light', 'standard', 'full'].includes(activeRoute) ? activeRoute : 'standard';
      }
      return projectBoard(inputs, { route: effective, filters });
    },
    'cartography.graph': () => projectGraph(memory, { root }),
    'blastRadius.heat': params => heatFromTarget(root, memory, { ...params, refreshIndex: true }),
    'diff.get': params => getDiff(root, params),
    'diff.getFile': ({ path }) => getDiffFile(root, path),
    'files.tree': params => fileTree(root, params),
    async 'review.decideHunk'({ spec, hunkId, decision, actor: who }) {
      return decideHunk(root, memory, { spec: await activeSpecId(spec), hunkId, decision, actor: who ?? actor });
    },
    async 'review.stageApproved'({ spec }) {
      return stageApproved(root, memory, { spec: await activeSpecId(spec) });
    },
    async 'review.addRemark'({ spec, ...remark }) {
      return { id: await addRemark(root, memory, { spec: await activeSpecId(spec), ...remark }) };
    },
    async 'gate.approve'({ spec, gate, actor: who }) {
      const id = await activeSpecId(spec);
      if (gate === 2) return approveGate2(root, memory, { spec: id, actor: who ?? actor });
      return approveGate(root, id, 1, { actor: who ?? actor }).catch(error => Promise.reject(domainGate(error)));
    },
    async 'finops.snapshot'() {
      return projectFinops(memory, { credentialSource: await credentials() });
    },
    'skills.list': () => listSkills(root, { bundledDir: BUNDLED_SKILLS }),
    'skills.toggle': ({ name, enabled }) => toggleSkill(root, name, enabled, { bundledDir: BUNDLED_SKILLS }),
    'fs.changed': ({ paths }) =>
      enqueue(async () => {
        const areas = areasForPaths(paths);
        if (areas.includes('board') && !studio) await syncFromGit(memory, root);
        if (areas.includes('graph')) indexRepository(root, memory);
        if (areas.length) await notify('project.changed', { areas });
      }),
    'fs.rescan': () =>
      enqueue(async () => {
        if (!studio) await syncFromGit(memory, root);
        indexRepository(root, memory);
        await notify('project.changed', { areas: AREA_ORDER });
      }),
    'agent.status': params => agents.status(params),
    'agent.prompt': params => agents.prompt(params),
    'agent.cancel': params => agents.cancel(params),
    'agent.permission': params => agents.permission(params),
    'agent.reset': params => agents.reset(params),
    'agent.sessions': () => agents.sessions(),
    'agent.resume': params => agents.resume(params),
    'memory.summary': () => memorySummary(memory.db, workspace),
    // The rail lists every project: the open one from this engine's memory, the others read-only from theirs.
    'conversations.list': async ({ roots = [root], includeArchived = false }) => ({
      projects: await Promise.all(
        roots.map(async other => ({
          root: other,
          conversations: sameRoot(other, root)
            ? conversations.list({ includeArchived })
            : await listConversationsAt(other, { includeArchived }),
        })),
      ),
    }),
    'conversations.rename': async ({ root: other = root, agent, sessionId, title }) => {
      if (sameRoot(other, root)) conversations.rename(agent, sessionId, title);
      else await updateConversationAt(other, { agent, sessionId, title });
      return { renamed: true };
    },
    'conversations.archive': async ({ root: other = root, agent, sessionId, archived }) => {
      if (sameRoot(other, root)) conversations.archive(agent, sessionId, archived);
      else await updateConversationAt(other, { agent, sessionId, archived });
      return { archived };
    },
  };
  return studio ? studioModeHandlers(handlers) : handlers;
}

/** Credential label computed once in the background: probing CLIs and DPAPI takes seconds. */
function lazyCredentials(select) {
  let pending = null;
  return () => {
    pending ??= select().then(
      result => (result.source ? { kind: result.source, provider: result.provider ?? null } : null),
      error => {
        if (error instanceof AuthError || error instanceof SecureStoreError)
          throw new StudioError('CREDENTIALS_UNREADABLE', error.message, { retryable: true });
        throw error;
      },
    );
    return pending;
  };
}

/**
 * Runs one engine session. Resolves with the process exit code instead of exiting, so the CLI and
 * tests share the same code path.
 * @param {{
 *   root: string, pipePath: string, secret: string, version: string,
 *   log?: (line: string) => void,
 *   onSession?: (session: {notify: (method: string, params: object) => Promise<void>}) => void,
 *   handlerOverrides?: Record<string, Function>,
 *   deps?: {
 *     openProjectMemory?: typeof openProjectMemory,
 *     selectCredentialSource?: typeof selectCredentialSource,
 *     resolveWorkspace?: typeof resolveWorkspace,
 *     createAgentHub?: typeof createAgentHub,
 *   },
 *   stdin?: import('node:stream').Readable,
 * }} options
 */
export function runStudioEngine({
  root,
  pipePath,
  secret,
  version,
  log = line => process.stderr.write(`${line}\n`),
  onSession,
  handlerOverrides = {},
  deps = {},
  stdin,
}) {
  return new Promise(resolveExit => {
    const socket = connect(pipePath);
    const decoder = createFrameDecoder();
    const workspaceReady = (deps.resolveWorkspace ?? resolveWorkspace)(root);
    // Studio mode keeps memory outside the repository and has no specs/ tree to sync from Git.
    const memoryReady = workspaceReady.then(workspace =>
      workspace.mode === 'project'
        ? (deps.openProjectMemory ?? openProjectMemory)(root)
        : { memory: openMemory(workspace.memoryPath), quarantined: null, sync: null },
    );
    let agents = null;
    const credentials = lazyCredentials(deps.selectCredentialSource ?? selectCredentialSource);
    let phase = 'challenge';
    let engineNonce = null;
    let exitCode = EXIT.OK;
    let dispatcher = null;
    let memory = null;
    let supervisor = null;
    let finished = false;

    const send = message =>
      new Promise((resolveSend, reject) => {
        if (socket.destroyed) return reject(new Error('the pipe is closed'));
        if (socket.write(encodeFrame(message))) resolveSend();
        else socket.once('drain', resolveSend);
      });
    const notify = (method, params) => send({ jsonrpc: '2.0', method, params });

    const finish = () => {
      if (finished) return;
      finished = true;
      if (supervisor) clearInterval(supervisor);
      agents?.dispose();
      stdin?.off('end', onStdinEnd);
      memoryReady.then(
        result => {
          result.memory.close();
          resolveExit(exitCode);
        },
        error => {
          log(`[studio-engine] project memory could not be opened: ${error.stack}`);
          resolveExit(exitCode === EXIT.OK ? EXIT.FAULT : exitCode);
        },
      );
    };
    const refuse = (code, reason) => {
      exitCode = code;
      log(`[studio-engine] HANDSHAKE_FAILED: ${reason}`);
      socket.destroy();
    };
    const fatal = error => {
      exitCode = EXIT.FAULT;
      log(`[studio-engine] unexpected fault, exiting with ${EXIT.FAULT}:\n${error.stack}`);
    };
    function onStdinEnd() {
      log('[studio-engine] stdin closed (host gone); shutting down.');
      socket.end();
    }
    stdin?.on('end', onStdinEnd);
    stdin?.resume(); // flowing mode, so the host's EOF is observed
    if (stdin?.readableEnded) onStdinEnd();

    const openSession = async () => {
      ({ memory } = await memoryReady);
      const workspace = await workspaceReady;
      supervisor = startCheckpointSupervisor(memory);
      pruneTokenEvents(memory);
      const actor = userInfo().username;
      const conversations = createConversationIndex(memory.db);
      agents = (deps.createAgentHub ?? createAgentHub)({ root, workspace, notify, log, conversations });
      const handlers = {
        ...createHandlers(root, memory, { version, actor, credentials, notify, workspace, agents, conversations }),
        ...handlerOverrides,
      };
      dispatcher = createRpcDispatcher({ direction: 'host->engine', handlers, onFatal: fatal });
      // Warm-up: finops.snapshot awaits the same promise and reports the outcome to the UI.
      credentials().then(null, error => log(`[studio-engine] credential source unavailable: ${error.message}`));
      phase = 'open';
      onSession?.({ notify });
    };

    const handshake = async text => {
      let message;
      try {
        message = JSON.parse(text);
      } catch (error) {
        return refuse(EXIT.HANDSHAKE, `invalid JSON during the handshake: ${error.message}`);
      }
      if (phase === 'challenge') {
        if (message.method !== 'studio.challenge' || message.id === undefined)
          return refuse(EXIT.HANDSHAKE, `received ${message.method ?? 'a reply'} before the handshake`);
        const problems = schemaProblems(STUDIO_METHODS['studio.challenge'].paramsSchema, message.params ?? {});
        if (problems.length) return refuse(EXIT.HANDSHAKE, problems.join('; '));
        if (message.params.protocolVersion !== STUDIO_PROTOCOL_VERSION)
          return refuse(
            EXIT.HANDSHAKE,
            `protocol version mismatch: host ${message.params.protocolVersion}, engine ${STUDIO_PROTOCOL_VERSION}`,
          );
        engineNonce = randomBytes(32).toString('hex');
        phase = 'hello';
        return send({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: STUDIO_PROTOCOL_VERSION,
            proof: handshakeProof(secret, 'engine', message.params.nonce),
            nonce: engineNonce,
            pid: process.pid,
            versions: { engine: version, node: process.version, protocol: STUDIO_PROTOCOL_VERSION },
          },
        });
      }
      if (message.method !== 'studio.hello' || message.id !== undefined)
        return refuse(EXIT.HANDSHAKE, `expected studio.hello, received ${message.method ?? 'a reply'}`);
      if (!proofMatches(handshakeProof(secret, 'host', engineNonce), message.params?.proof))
        return refuse(EXIT.HANDSHAKE, 'the host proof does not match the secret');
      phase = 'opening';
      return openSession();
    };

    let queue = Promise.resolve();
    socket.on('data', chunk => {
      let frames;
      try {
        frames = decoder.push(chunk);
      } catch (error) {
        log(`[studio-engine] protocol error: ${error.message}`);
        exitCode = phase === 'open' ? EXIT.FAULT : EXIT.HANDSHAKE;
        socket.destroy();
        return;
      }
      for (const text of frames) {
        if (phase === 'open') dispatchFrame(text);
        // Handshake frames are handled in order; frames that arrive while the session is opening
        // wait in the same queue and are dispatched (concurrently) once it is open.
        else
          queue = queue
            .then(() => {
              if (finished || socket.destroyed) return undefined;
              if (phase === 'open') return dispatchFrame(text);
              return handshake(text);
            })
            .catch(fatalAndClose);
      }
    });
    function dispatchFrame(text) {
      dispatcher
        .dispatch(text)
        .then(async reply => {
          if (reply) await send(reply);
          if (exitCode === EXIT.FAULT) socket.end();
        })
        .catch(fatalAndClose);
    }
    function fatalAndClose(error) {
      fatal(error);
      socket.destroy();
    }
    let connected = false;
    socket.on('connect', () => {
      connected = true;
    });
    socket.on('error', error => {
      if (!connected) exitCode = EXIT.FAULT;
      if (!finished) log(`[studio-engine] pipe error: ${error.message}`);
    });
    socket.on('close', finish);
  });
}

const POSIX_SOCKET = /^\/.+\/omnispec-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.sock$/;
const USAGE = 'Usage: omni-spec studio-engine --pipe \\.pipeomnispec-{uuid} (the secret is read from stdin)';

/** Reads the first line of `stdin` without consuming the EOF that later signals the host's death. */
function readSecretLine(stdin) {
  return new Promise(resolveLine => {
    let buffered = '';
    const onData = chunk => {
      buffered += chunk;
      const newline = buffered.indexOf('\n');
      if (newline === -1) return;
      cleanup();
      resolveLine(buffered.slice(0, newline).replace(/\r$/, ''));
    };
    const onEnd = () => {
      cleanup();
      resolveLine(buffered.trim() || null);
    };
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      stdin.pause();
    };
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    stdin.on('end', onEnd);
  });
}

/**
 * CLI adapter for `omni-spec studio-engine --pipe <name>`.
 * @param {string[]} args Arguments after the command name.
 * @param {{root: string|null, version: string, stdin?: import('node:stream').Readable,
 *   stderr?: (line: string) => void}} context
 * @returns {Promise<number>} Exit code.
 */
export async function studioEngineCommand(args, { root, cwd = process.cwd(), version, stdin = process.stdin, stderr }) {
  const log = stderr ?? (line => process.stderr.write(`${line}\n`));
  let pipePath = null;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--pipe') pipePath = args[++index] ?? null;
    else if (arg.startsWith('--pipe=')) pipePath = arg.slice('--pipe='.length);
    else {
      log(
        arg === '--secret' || arg.startsWith('--secret=')
          ? 'Unknown option: --secret. The secret is accepted only on stdin, never as an argument.'
          : `Unknown argument: ${arg}. ${USAGE}`,
      );
      return EXIT.USAGE;
    }
  }
  if (!pipePath) {
    log(`Missing --pipe. ${USAGE}`);
    return EXIT.USAGE;
  }
  const validPipe = process.platform === 'win32' ? PIPE_NAME_WIN32.test(pipePath) : POSIX_SOCKET.test(pipePath);
  if (!validPipe) {
    log(`Invalid --pipe ${pipePath}. ${USAGE}`);
    return EXIT.USAGE;
  }
  // Without specs/manifest.json the engine serves the folder it was started in (the host sets the working
  // directory to the project root) in studio mode, keeping Omni's state outside the repository.
  const projectRoot = root ?? cwd;
  const secret = await readSecretLine(stdin);
  if (secret === null) {
    log('Missing secret: write it as the first line of stdin.');
    return EXIT.USAGE;
  }
  if (!SECRET_PATTERN.test(secret)) {
    log('Invalid secret: it must be 64 hex characters (256 bits).');
    return EXIT.USAGE;
  }
  return runStudioEngine({ root: projectRoot, pipePath, secret, version, log, stdin });
}
