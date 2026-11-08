import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { delimiter, dirname, extname, join } from 'node:path';
import { StudioError } from '../protocol.mjs';
import { clipInput, DEFAULT_PERMISSION, toolTitle } from './claude.mjs';

/**
 * Codex driver (docs/STUDIO-AGENT-COCKPIT.md, Fase 3 vuelta 4). Omni Studio runs the official `codex app-server`
 * over stdio JSON-RPC 2.0; the CLI uses its own ChatGPT or API login and Studio never reads or forwards tokens.
 */

export const CODEX_MODELS = Object.freeze(['gpt-5.3-codex', 'gpt-5.2-codex', 'o4-mini']);
export const CODEX_EFFORTS = Object.freeze(['low', 'medium', 'high']);

/**
 * Studio's permission levels (Fase 3, Q25) mapped to Codex `app-server` approvalPolicy + sandbox pairs.
 * Codex has no read-only planning mode flag, so `plan` is not offered on Codex conversations.
 */
export const CODEX_PERMISSION_MODES = Object.freeze({
  ask: Object.freeze({ approvalPolicy: 'untrusted', sandbox: 'read-only' }),
  default: Object.freeze({ approvalPolicy: 'on-request', sandbox: 'workspace-write' }),
  auto: Object.freeze({ approvalPolicy: 'on-failure', sandbox: 'workspace-write' }),
  bypass: Object.freeze({ approvalPolicy: 'never', sandbox: 'danger-full-access' }),
});

const SHIM_TARGET = /"%~?dp0%?\\?([^"%]+\.(?:exe|[cm]?js))"/i;
const AUTH_HINT = /login|not logged in|unauthorized|authentication|api key/i;
const STDERR_TAIL = 4_096;

async function isFile(path) {
  try {
    await access(path, constants.F_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

const runnable = file => {
  const extension = extname(file).toLowerCase();
  return ['.js', '.mjs', '.cjs'].includes(extension)
    ? { file: process.execPath, prefix: [file], path: file }
    : { file, prefix: [], path: file };
};

/**
 * Finds the official `codex` CLI: `OMNI_STUDIO_CODEX_BIN`, then PATH (`codex.exe` or the npm `codex.cmd` shim on
 * Windows, `codex` elsewhere).
 * @returns {Promise<{file: string, prefix: string[], path: string} | null>}
 */
export async function locateCodex({ env = process.env, platform = process.platform } = {}) {
  if (env.OMNI_STUDIO_CODEX_BIN) return runnable(env.OMNI_STUDIO_CODEX_BIN);
  const pathKey = Object.keys(env).find(name => name.toUpperCase() === 'PATH');
  const directories = (pathKey ? env[pathKey].split(delimiter) : []).filter(Boolean);
  for (const directory of directories) {
    if (platform !== 'win32') {
      if (await isFile(join(directory, 'codex'))) return runnable(join(directory, 'codex'));
      continue;
    }
    if (await isFile(join(directory, 'codex.exe'))) return runnable(join(directory, 'codex.exe'));
    const shim = join(directory, 'codex.cmd');
    if (!(await isFile(shim))) continue;
    const target = SHIM_TARGET.exec(await readFile(shim, 'utf8'))?.[1];
    if (target && (await isFile(join(dirname(shim), target)))) return runnable(join(dirname(shim), target));
  }
  return null;
}

function normalizeRateLimits(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const windows = [];
  for (const [key, label] of [
    ['primary', '5 h'],
    ['fiveHour', '5 h'],
    ['secondary', 'Semanal'],
    ['weekly', 'Semanal'],
  ]) {
    const entry = raw[key];
    if (!entry || typeof entry !== 'object') continue;
    const usedPercent =
      typeof entry.usedPercent === 'number'
        ? entry.usedPercent
        : typeof entry.used_percent === 'number'
          ? entry.used_percent
          : null;
    if (usedPercent === null) continue;
    windows.push({
      window: entry.label || label,
      usedPercent,
      resetsAt: entry.resetsAt ?? entry.resets_at ?? null,
    });
  }
  return windows;
}

/**
 * Maps one `codex app-server` notification to provider-independent `agent.event` payloads.
 */
export function translateCodexNotification(message, state) {
  if (!message || typeof message !== 'object' || typeof message.method !== 'string') return [];
  const params = message.params ?? {};
  switch (message.method) {
    case 'thread/started': {
      const threadId = params.thread?.id ?? params.threadId ?? null;
      const model = params.model ?? params.thread?.model ?? state.model ?? null;
      state.model = model;
      return [
        {
          kind: 'init',
          model,
          sessionId: threadId,
          permissionMode: null,
          tools: null,
          commands: [],
        },
      ];
    }
    case 'item/agentMessage/delta':
      return [
        {
          kind: 'text',
          key: String(params.itemId ?? params.id ?? 'codex-msg'),
          delta: String(params.delta ?? ''),
        },
      ];
    case 'item/started': {
      const item = params.item ?? params;
      if (!item || item.type === 'agentMessage' || item.type === 'userMessage' || item.type === 'reasoning') return [];
      const isEdit = item.type === 'fileChange' || item.type === 'patch';
      const name = isEdit
        ? 'Edit'
        : item.type === 'commandExecution'
          ? 'Bash'
          : String(item.name ?? item.type ?? 'tool');
      const input = isEdit
        ? { file_path: item.path ?? item.file ?? item.changes?.[0]?.path ?? '', content: item.diff ?? item.patch ?? '' }
        : item.command
          ? { command: Array.isArray(item.command) ? item.command.join(' ') : String(item.command) }
          : (item.input ?? {});
      return [
        {
          kind: 'tool',
          id: String(item.id ?? 'tool'),
          name,
          title: toolTitle(name, input),
          input: clipInput(input),
        },
      ];
    }
    case 'item/completed': {
      const item = params.item ?? params;
      if (!item) return [];
      if (item.type === 'agentMessage' && typeof item.text === 'string' && !state.streamed?.has(String(item.id))) {
        return [{ kind: 'text', key: `${item.id ?? 'msg'}:full`, delta: item.text }];
      }
      if (item.type === 'commandExecution' || item.type === 'fileChange' || item.type === 'mcpToolCall') {
        return [
          {
            kind: 'tool_result',
            toolUseId: String(item.id ?? 'tool'),
            isError: item.status === 'failed' || Boolean(item.error),
            output: String(item.output ?? item.aggregatedOutput ?? item.error ?? ''),
          },
        ];
      }
      return [];
    }
    case 'thread/tokenUsage/updated': {
      const usage = params.tokenUsage ?? params.usage ?? params;
      const total =
        typeof usage.totalTokens === 'number'
          ? usage.totalTokens
          : (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
      if (total > 0) state.contextTokens = total;
      if (typeof usage.modelContextWindow === 'number') state.contextWindow = usage.modelContextWindow;
      return [];
    }
    case 'account/rateLimits/updated': {
      const limits = normalizeRateLimits(params.rateLimits ?? params);
      if (limits.length === 0) return [];
      state.rateLimits = limits;
      return [{ kind: 'rate_limits', windows: limits }];
    }
    case 'turn/completed': {
      const turn = params.turn ?? params;
      const usage = turn.usage ?? turn.tokenUsage ?? params.usage ?? null;
      if (usage && typeof usage === 'object') {
        const total =
          typeof usage.totalTokens === 'number'
            ? usage.totalTokens
            : (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
        if (total > 0) state.contextTokens = total;
        if (typeof usage.modelContextWindow === 'number') state.contextWindow = usage.modelContextWindow;
      }
      const isError = turn.status === 'failed' || Boolean(turn.error);
      const errorText = typeof turn.error?.message === 'string' ? turn.error.message : '';
      const events = [
        {
          kind: 'result',
          isError,
          subtype: turn.status ?? 'completed',
          text: errorText,
          costUsd: null,
          sessionCostUsd: null,
          durationMs: typeof turn.durationMs === 'number' ? turn.durationMs : null,
          numTurns: 1,
          contextTokens: typeof state.contextTokens === 'number' ? state.contextTokens : null,
          contextWindow: typeof state.contextWindow === 'number' ? state.contextWindow : null,
          costBasis: null,
        },
      ];
      if (isError && AUTH_HINT.test(errorText)) {
        events.push({
          kind: 'error',
          code: 'AUTH_REQUIRED',
          message: 'Codex no tiene una sesión iniciada. Abre la terminal y ejecuta `codex login`.',
        });
      }
      return events;
    }
    default:
      return [];
  }
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    // guardian-allow SLOP_SWALLOWED_ERROR: non-JSON lines on stdout are ignored.
    return null;
  }
}

/**
 * One Codex conversation backed by `codex app-server`.
 */
export function createCodexDriver({
  cwd,
  emit,
  env = process.env,
  spawnImpl = spawn,
  locate = () => locateCodex({ env }),
  mcpServer = null,
  developerInstructions = null,
}) {
  let child = null;
  let state = 'idle';
  let session = { model: null, sessionId: null };
  let running = { model: null, effort: null, permission: DEFAULT_PERMISSION };
  let translation = { model: null, streamed: new Set(), contextTokens: null, contextWindow: null, rateLimits: [] };
  let stderr = '';
  let nextRpcId = 1;
  const rpcCallbacks = new Map();
  const pending = new Map();

  const setState = next => {
    state = next;
    emit({ kind: 'status', state });
  };

  const write = payload => {
    if (!child?.stdin?.writable) throw new StudioError('AGENT_NOT_RUNNING', 'Codex no está en ejecución.');
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  };

  const rpc = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextRpcId++;
      rpcCallbacks.set(id, { resolve, reject });
      try {
        write({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        rpcCallbacks.delete(id);
        reject(error);
      }
    });

  const onMessage = message => {
    // Server response to our request
    if (message.id !== undefined && !message.method) {
      const callback = rpcCallbacks.get(message.id);
      if (!callback) return;
      rpcCallbacks.delete(message.id);
      if (message.error) callback.reject(new Error(message.error.message ?? 'Codex RPC error'));
      else callback.resolve(message.result ?? {});
      return;
    }

    // Server-initiated approval request (JSON-RPC request with both id and method)
    if (message.id !== undefined && typeof message.method === 'string') {
      const params = message.params ?? {};
      const isEdit = message.method.includes('fileChange') || message.method.includes('Patch');
      const toolName = isEdit ? 'Edit' : 'Bash';
      const input = isEdit
        ? {
            file_path: params.path ?? params.file ?? params.changes?.[0]?.path ?? '',
            content: params.diff ?? params.patch ?? '',
          }
        : {
            command: Array.isArray(params.command) ? params.command.join(' ') : String(params.command ?? ''),
          };
      const requestId = String(message.id);
      pending.set(requestId, message.id);
      emit({
        kind: 'permission',
        requestId,
        toolName,
        title: toolTitle(toolName, input),
        input: clipInput(input),
        reason: typeof params.reason === 'string' ? params.reason : null,
      });
      return;
    }

    if (message.method === 'item/agentMessage/delta') {
      const itemId = message.params?.itemId ?? message.params?.id;
      if (itemId) translation.streamed.add(String(itemId));
    }

    for (const event of translateCodexNotification(message, translation)) {
      if (event.kind === 'init') {
        session = { model: event.model ?? session.model, sessionId: event.sessionId ?? session.sessionId };
      }
      emit(event);
    }
    if (message.method === 'turn/completed') {
      translation = { ...translation, streamed: new Set() };
      setState('ready');
    }
  };

  const stop = () => {
    const proc = child;
    child = null;
    pending.clear();
    for (const { reject } of rpcCallbacks.values()) reject(new Error('Codex process stopped'));
    rpcCallbacks.clear();
    proc?.stdin?.end();
    proc?.kill();
  };

  async function start(options) {
    setState('starting');
    const location = await locate();
    if (!location) {
      setState('idle');
      throw new StudioError(
        'AGENT_MISSING',
        'No encontré Codex. Instálalo con `npm i -g @openai/codex` y vuelve a intentarlo.',
      );
    }
    const permission = options.permission ?? DEFAULT_PERMISSION;
    running = { model: options.model ?? null, effort: options.effort ?? null, permission };
    stderr = '';
    const args = [...location.prefix, 'app-server'];
    if (mcpServer?.command) {
      args.push(
        '-c',
        `mcp_servers.omni.command=${JSON.stringify(mcpServer.command)}`,
        '-c',
        `mcp_servers.omni.args=${JSON.stringify(mcpServer.args ?? [])}`,
      );
    }
    const proc = spawnImpl(location.file, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child = proc;
    let buffered = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', chunk => {
      buffered += chunk;
      let newline = buffered.indexOf('\n');
      while (newline !== -1) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        const message = line ? parseLine(line) : null;
        if (message) onMessage(message);
        newline = buffered.indexOf('\n');
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });
    proc.stdin.on('error', () => undefined);
    proc.on('error', error => {
      if (child !== proc) return;
      stop();
      emit({ kind: 'error', code: 'AGENT_MISSING', message: `Codex no pudo arrancar: ${error.message}` });
      setState('idle');
    });
    proc.on('exit', code => {
      if (child !== proc) return;
      child = null;
      pending.clear();
      const detail = stderr.trim().split(/\r?\n/).slice(-3).join(' ');
      if (state === 'busy' || state === 'starting' || (code ?? 0) !== 0) {
        emit({
          kind: 'error',
          code: AUTH_HINT.test(detail) ? 'AUTH_REQUIRED' : 'AGENT_EXITED',
          message: AUTH_HINT.test(detail)
            ? 'Codex no tiene una sesión iniciada. Abre la terminal y ejecuta `codex login`.'
            : `Codex terminó (código ${code ?? '?'})${detail ? `: ${detail}` : '.'}`,
        });
      }
      setState('idle');
    });

    await rpc('initialize', { clientInfo: { name: 'omni-studio', version: '0.8.1' } });
    write({ jsonrpc: '2.0', method: 'initialized', params: {} });

    const mode = CODEX_PERMISSION_MODES[permission];
    const threadMethod = session.sessionId ? 'thread/resume' : 'thread/start';
    const threadResult = await rpc(threadMethod, {
      cwd,
      ...(session.sessionId ? { threadId: session.sessionId } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(developerInstructions ? { developerInstructions } : {}),
      approvalPolicy: mode.approvalPolicy,
      sandbox: mode.sandbox,
    });
    const threadId = threadResult?.thread?.id ?? threadResult?.threadId ?? session.sessionId;
    const model = threadResult?.model ?? threadResult?.thread?.model ?? options.model ?? session.model;
    session = { model: model ?? null, sessionId: threadId ?? null };
    translation.model = session.model;
    if (session.sessionId) {
      emit({
        kind: 'init',
        model: session.model,
        sessionId: session.sessionId,
        permissionMode: mode.approvalPolicy,
        tools: null,
        commands: [],
      });
    }
    setState('ready');
  }

  return {
    status: () => ({
      state,
      model: session.model,
      sessionId: session.sessionId,
      options: { ...running },
      pendingPermissions: [...pending.keys()],
      rateLimits: translation.rateLimits,
    }),

    async prompt(text, options = {}) {
      if (state === 'busy')
        throw new StudioError('AGENT_BUSY', 'Codex todavía está trabajando; espera o detén el turno.');
      if (state === 'starting') throw new StudioError('AGENT_BUSY', 'Codex está arrancando.', { retryable: true });
      if (options.effort && !CODEX_EFFORTS.includes(options.effort))
        throw new StudioError('INVALID_EFFORT', `Nivel de esfuerzo desconocido: ${options.effort}.`);
      const permission = options.permission ?? DEFAULT_PERMISSION;
      if (!Object.hasOwn(CODEX_PERMISSION_MODES, permission))
        throw new StudioError('INVALID_PERMISSION', `Nivel de permisos no disponible en Codex: ${permission}.`);
      const wanted = {
        model: options.model ?? null,
        effort: options.effort ?? null,
        permission,
      };
      if (!child) await start(wanted);
      running = wanted;
      const mode = CODEX_PERMISSION_MODES[permission];
      setState('busy');
      await rpc('turn/start', {
        threadId: session.sessionId,
        input: [{ type: 'text', text }],
        ...(wanted.model ? { model: wanted.model } : {}),
        ...(wanted.effort ? { effort: wanted.effort } : {}),
        approvalPolicy: mode.approvalPolicy,
        sandbox: mode.sandbox,
      });
      return { accepted: true };
    },

    cancel() {
      if (!child || state !== 'busy') return { cancelled: false };
      for (const requestId of [...pending.keys()]) this.respond(requestId, 'deny', 'El usuario detuvo el turno.');
      void rpc('turn/interrupt', { threadId: session.sessionId }).catch(() => undefined);
      return { cancelled: true };
    },

    respond(requestId, decision) {
      if (!pending.has(requestId))
        throw new StudioError('PERMISSION_UNKNOWN', 'Ese pedido de permiso ya no está pendiente.');
      const rawId = pending.get(requestId);
      pending.delete(requestId);
      write({
        jsonrpc: '2.0',
        id: rawId,
        result: { decision: decision === 'allow' ? 'accept' : 'decline' },
      });
      emit({ kind: 'permission_resolved', requestId, decision });
      return { requestId, decision };
    },

    resume(sessionId) {
      if (state === 'busy' || state === 'starting')
        throw new StudioError('AGENT_BUSY', 'Codex todavía está trabajando; espera o detén el turno.');
      stop();
      session = { model: null, sessionId };
      translation = { model: null, streamed: new Set(), contextTokens: null, contextWindow: null, rateLimits: [] };
      setState('idle');
      return { sessionId };
    },

    reset() {
      stop();
      session = { model: null, sessionId: null };
      translation = { model: null, streamed: new Set(), contextTokens: null, contextWindow: null, rateLimits: [] };
      setState('idle');
      return { reset: true };
    },

    dispose() {
      stop();
    },
  };
}
