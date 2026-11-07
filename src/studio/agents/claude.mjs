import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { delimiter, dirname, extname, join } from 'node:path';
import { StudioError } from '../protocol.mjs';

/**
 * Claude Code driver (docs/STUDIO-AGENT-COCKPIT.md). Omni Studio runs the official `claude` CLI in headless
 * stream-json mode; the CLI keeps its own login, and Studio never reads or forwards a credential.
 *
 * Wire format, one JSON object per line on stdin/stdout:
 *  - in:  {type:'user', message:{role:'user', content:[{type:'text', text}]}}
 *  - in:  {type:'control_request', request_id, request:{subtype:'interrupt'}}
 *  - in:  {type:'control_response', response:{subtype:'success', request_id, response:{behavior, ...}}}
 *  - out: system/init, stream_event, assistant, user (tool results), result, control_request (can_use_tool)
 */

export const CLAUDE_BASE_ARGS = Object.freeze([
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--permission-mode',
  'default',
  '--permission-prompt-tool',
  'stdio',
]);

/** Model aliases the CLI resolves to the current model of each family (`claude --help`). */
export const CLAUDE_MODELS = Object.freeze(['fable', 'opus', 'sonnet', 'haiku']);
/** Values of `--effort` accepted by the CLI (`claude --help`). */
export const CLAUDE_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

const MAX_TEXT = 16_000;
const MAX_FIELD = 8_000;
const STDERR_TAIL = 4_096;
const SHIM_TARGET = /"%~?dp0%?\\?([^"%]+\.(?:exe|[cm]?js))"/i;
const AUTH_HINT = /\/login|not logged in|log ?in again|invalid api key|authentication|unauthorized|oauth token/i;

const clip = (text, max = MAX_TEXT) =>
  text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} caracteres más)` : text;

/** Tool input as shown in the UI: long string fields are clipped so a frame stays small. */
export function clipInput(input) {
  if (!input || typeof input !== 'object') return input ?? null;
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (typeof value === 'string') return [key, clip(value, MAX_FIELD)];
      if (value && typeof value === 'object') {
        const json = JSON.stringify(value);
        return [key, json.length > MAX_FIELD ? clip(json, MAX_FIELD) : value];
      }
      return [key, value];
    }),
  );
}

/** One-line label of a tool call: the command, the file or the pattern it works on. */
export function toolTitle(name, input) {
  for (const key of ['command', 'file_path', 'path', 'notebook_path', 'pattern', 'url', 'query', 'description'])
    if (typeof input?.[key] === 'string' && input[key].trim()) return input[key].trim().split('\n')[0];
  return name;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content);
  return content
    .map(block => (block?.type === 'text' ? block.text : block?.type === 'image' ? '[imagen]' : JSON.stringify(block)))
    .join('\n');
}

/**
 * Context occupancy after a turn: tokens of the last assistant message (input, cache and output) against the
 * window `modelUsage` reports for the session model. `costBasis: 'list'` means the cost is the API list price
 * of the tokens, not a charge: with a subscription login the user pays the plan, not per token.
 */
function contextOf(message, state) {
  const models = message.modelUsage && typeof message.modelUsage === 'object' ? message.modelUsage : {};
  const entry =
    (state.model && models[state.model]) || (Object.keys(models).length === 1 ? Object.values(models)[0] : null);
  const contextWindow =
    typeof entry?.contextWindow === 'number' && entry.contextWindow > 0 ? entry.contextWindow : null;
  return {
    contextTokens: typeof state.contextTokens === 'number' ? state.contextTokens : null,
    contextWindow,
    costBasis: typeof entry?.costBasis === 'string' ? entry.costBasis : null,
  };
}

/**
 * Cost of the turn and of the conversation. The CLI reports `total_cost_usd` as the running total of the
 * session, and `--resume` carries it over (checked with Claude Code 2.1.318), so a turn costs the difference
 * with the previous total. A lower total means a process that counted from zero again: the earlier total
 * becomes the base, so the conversation total never goes back.
 */
function costOf(reported, state) {
  if (typeof reported !== 'number') return { costUsd: null, sessionCostUsd: null };
  if (reported < (state.reportedCost ?? 0)) state.costBase = (state.costBase ?? 0) + state.reportedCost;
  state.reportedCost = reported;
  const sessionCostUsd = (state.costBase ?? 0) + reported;
  const costUsd = Math.max(0, sessionCostUsd - (state.sessionCost ?? 0));
  state.sessionCost = sessionCostUsd;
  return { costUsd, sessionCostUsd };
}

/**
 * Maps one stdout message of the CLI to provider-independent `agent.event` payloads. Pure: `state` carries
 * what has to be remembered between messages (the streamed message ids, the model, context and cost).
 * @param {any} message
 * @param {{messageId?: string|null, streamed: Set<string>}} state
 * @returns {object[]}
 */
export function translateClaudeMessage(message, state) {
  if (!message || typeof message !== 'object') return [];
  // Subagent internals stay inside their tool card in this prototype.
  if (message.parent_tool_use_id) return [];
  switch (message.type) {
    case 'system':
      if (message.subtype === 'init') {
        state.model = message.model ?? null;
        return [
          {
            kind: 'init',
            model: message.model ?? null,
            sessionId: message.session_id ?? null,
            permissionMode: message.permissionMode ?? null,
            tools: Array.isArray(message.tools) ? message.tools.length : null,
          },
        ];
      }
      if (message.subtype === 'api_retry')
        return [{ kind: 'notice', text: `El proveedor no responde; reintento ${message.attempt ?? '?'}…` }];
      if (message.subtype === 'api_error')
        return [{ kind: 'error', code: 'PROVIDER_ERROR', message: message.error?.message ?? 'Error del proveedor.' }];
      return [];
    case 'stream_event': {
      const event = message.event ?? {};
      if (event.type === 'message_start') state.messageId = event.message?.id ?? null;
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && state.messageId) {
        state.streamed.add(state.messageId);
        return [{ kind: 'text', key: `${state.messageId}:${event.index ?? 0}`, delta: event.delta.text ?? '' }];
      }
      return [];
    }
    case 'assistant': {
      const id = message.message?.id ?? 'message';
      const usage = message.message?.usage;
      if (usage && typeof usage === 'object')
        state.contextTokens =
          (usage.input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.output_tokens ?? 0);
      const content = Array.isArray(message.message?.content) ? message.message.content : [];
      const events = [];
      content.forEach((block, index) => {
        if (block?.type === 'text' && block.text && !state.streamed.has(id))
          events.push({ kind: 'text', key: `${id}:full:${index}`, delta: block.text });
        if (block?.type === 'tool_use')
          events.push({
            kind: 'tool',
            id: block.id,
            name: block.name,
            title: toolTitle(block.name, block.input),
            input: clipInput(block.input),
          });
      });
      return events;
    }
    case 'user': {
      const content = Array.isArray(message.message?.content) ? message.message.content : [];
      return content
        .filter(block => block?.type === 'tool_result')
        .map(block => ({
          kind: 'tool_result',
          toolUseId: block.tool_use_id,
          isError: Boolean(block.is_error),
          output: clip(textOf(block.content)),
        }));
    }
    case 'result': {
      const text = typeof message.result === 'string' ? message.result : '';
      const events = [
        {
          kind: 'result',
          isError: Boolean(message.is_error),
          subtype: message.subtype ?? null,
          text: clip(text),
          ...costOf(message.total_cost_usd, state),
          durationMs: typeof message.duration_ms === 'number' ? message.duration_ms : null,
          numTurns: typeof message.num_turns === 'number' ? message.num_turns : null,
          ...contextOf(message, state),
        },
      ];
      if (message.is_error && AUTH_HINT.test(text))
        events.push({
          kind: 'error',
          code: 'AUTH_REQUIRED',
          message: 'Claude Code no tiene una sesión iniciada. Abre la terminal, ejecuta `claude` y usa /login.',
        });
      return events;
    }
    default:
      return [];
  }
}

/** One stdout line as JSON; `null` for anything else. */
function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    // guardian-allow SLOP_SWALLOWED_ERROR: the CLI only writes JSON on stdout in this mode; anything else is noise.
    return null;
  }
}

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
 * Finds the official `claude` CLI: `OMNI_STUDIO_CLAUDE_BIN`, then PATH (on Windows `claude.exe`, or the
 * target of the npm `claude.cmd` shim, since a .cmd cannot be spawned without cmd.exe), then the native
 * installer's `~/.local/bin`.
 * @returns {Promise<{file: string, prefix: string[], path: string} | null>}
 */
export async function locateClaude({ env = process.env, platform = process.platform } = {}) {
  if (env.OMNI_STUDIO_CLAUDE_BIN) return runnable(env.OMNI_STUDIO_CLAUDE_BIN);
  const pathKey = Object.keys(env).find(name => name.toUpperCase() === 'PATH');
  const directories = (pathKey ? env[pathKey].split(delimiter) : []).filter(Boolean);
  const home = env.USERPROFILE || env.HOME;
  if (home) directories.push(join(home, '.local', 'bin'));
  for (const directory of directories) {
    if (platform !== 'win32') {
      if (await isFile(join(directory, 'claude'))) return runnable(join(directory, 'claude'));
      continue;
    }
    if (await isFile(join(directory, 'claude.exe'))) return runnable(join(directory, 'claude.exe'));
    const shim = join(directory, 'claude.cmd');
    if (!(await isFile(shim))) continue;
    const target = SHIM_TARGET.exec(await readFile(shim, 'utf8'))?.[1];
    if (target && (await isFile(join(dirname(shim), target)))) return runnable(join(dirname(shim), target));
  }
  return null;
}

/**
 * One Claude Code conversation backed by one CLI process.
 * @param {{
 *   cwd: string,
 *   emit: (event: object) => void,
 *   env?: NodeJS.ProcessEnv,
 *   spawnImpl?: typeof spawn,
 *   locate?: () => Promise<{file: string, prefix: string[]} | null>,
 * }} options
 */
export function createClaudeDriver({
  cwd,
  emit,
  env = process.env,
  spawnImpl = spawn,
  locate = () => locateClaude({ env }),
}) {
  let child = null;
  let state = 'idle'; // idle | starting | ready | busy
  let session = { model: null, sessionId: null };
  let translation = { messageId: null, streamed: new Set() };
  // Model and effort the running process was started with; changing either restarts it with --resume.
  let running = { model: null, effort: null };
  let stderr = '';
  let interrupts = 0;
  const pending = new Map();

  const setState = next => {
    state = next;
    emit({ kind: 'status', state });
  };
  const write = message => {
    if (!child?.stdin?.writable) throw new StudioError('AGENT_NOT_RUNNING', 'Claude Code no está en ejecución.');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const onMessage = message => {
    if (message.type === 'control_request') {
      const request = message.request ?? {};
      if (request.subtype === 'can_use_tool') {
        pending.set(message.request_id, request.input ?? {});
        emit({
          kind: 'permission',
          requestId: message.request_id,
          toolName: request.tool_name ?? 'tool',
          title: toolTitle(request.tool_name, request.input),
          input: clipInput(request.input ?? {}),
          reason: typeof request.decision_reason === 'string' ? request.decision_reason : null,
        });
      } else {
        write({
          type: 'control_response',
          response: { subtype: 'error', request_id: message.request_id, error: 'Unsupported control request' },
        });
      }
      return;
    }
    if (message.type === 'control_response') return;
    for (const event of translateClaudeMessage(message, translation)) {
      if (event.kind === 'init') session = { model: event.model, sessionId: event.sessionId };
      emit(event);
    }
    if (message.type === 'result') {
      // Message ids are per turn; model, context and cost belong to the conversation and survive restarts.
      translation = { ...translation, messageId: null, streamed: new Set() };
      setState('ready');
    }
  };

  /** Stops the current process without ending the conversation (the next start resumes it). */
  const stop = () => {
    const proc = child;
    child = null;
    pending.clear();
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
        'No encontré Claude Code. Instálalo con `npm i -g @anthropic-ai/claude-code` y vuelve a intentarlo.',
      );
    }
    const args = [...location.prefix, ...CLAUDE_BASE_ARGS];
    if (options.model) args.push('--model', options.model);
    if (options.effort) args.push('--effort', options.effort);
    if (session.sessionId) args.push('--resume', session.sessionId);
    running = { model: options.model ?? null, effort: options.effort ?? null };
    stderr = '';
    const proc = spawnImpl(location.file, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
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
      child = null;
      pending.clear();
      emit({ kind: 'error', code: 'AGENT_MISSING', message: `Claude Code no pudo arrancar: ${error.message}` });
      setState('idle');
    });
    proc.on('exit', code => {
      if (child !== proc) return;
      child = null;
      pending.clear();
      const detail = stderr.trim().split(/\r?\n/).slice(-3).join(' ');
      if (state === 'busy' || state === 'starting' || (code ?? 0) !== 0)
        emit({
          kind: 'error',
          code: AUTH_HINT.test(detail) ? 'AUTH_REQUIRED' : 'AGENT_EXITED',
          message: AUTH_HINT.test(detail)
            ? 'Claude Code no tiene una sesión iniciada. Abre la terminal, ejecuta `claude` y usa /login.'
            : `Claude Code terminó (código ${code ?? '?'})${detail ? `: ${detail}` : '.'}`,
        });
      setState('idle');
    });
    setState('ready');
  }

  return {
    status: () => ({
      state,
      model: session.model,
      sessionId: session.sessionId,
      options: { ...running },
      pendingPermissions: [...pending.keys()],
    }),

    /** Sends one user message; the answer arrives as `agent.event`s. */
    async prompt(text, options = {}) {
      if (state === 'busy')
        throw new StudioError('AGENT_BUSY', 'Claude todavía está trabajando; espera o detén el turno.');
      if (state === 'starting')
        throw new StudioError('AGENT_BUSY', 'Claude Code está arrancando.', { retryable: true });
      if (options.effort && !CLAUDE_EFFORTS.includes(options.effort))
        throw new StudioError('INVALID_EFFORT', `Nivel de esfuerzo desconocido: ${options.effort}.`);
      const wanted = { model: options.model ?? null, effort: options.effort ?? null };
      // The CLI fixes model and effort at launch: a change restarts it on the same session.
      if (child && (wanted.model !== running.model || wanted.effort !== running.effort)) stop();
      if (!child) await start(options);
      write({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
      setState('busy');
      return { accepted: true };
    },

    /** Interrupts the running turn; pending permission requests are declined first. */
    cancel() {
      if (!child || state !== 'busy') return { cancelled: false };
      for (const requestId of [...pending.keys()]) this.respond(requestId, 'deny', 'El usuario detuvo el turno.');
      write({
        type: 'control_request',
        request_id: `omni-interrupt-${++interrupts}`,
        request: { subtype: 'interrupt' },
      });
      return { cancelled: true };
    },

    respond(requestId, decision, message) {
      if (!pending.has(requestId))
        throw new StudioError('PERMISSION_UNKNOWN', 'Ese pedido de permiso ya no está pendiente.');
      const input = pending.get(requestId);
      pending.delete(requestId);
      write({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response:
            decision === 'allow'
              ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: message || 'El usuario rechazó esta acción.' },
        },
      });
      emit({ kind: 'permission_resolved', requestId, decision });
      return { requestId, decision };
    },

    /**
     * Continues an earlier conversation: the next prompt starts the CLI with `--resume <sessionId>`.
     * `costUsd` is the session total the CLI recorded; it is the base for the cost of the next turns.
     */
    resume(sessionId, { costUsd = null } = {}) {
      if (state === 'busy' || state === 'starting')
        throw new StudioError('AGENT_BUSY', 'Claude todavía está trabajando; espera o detén el turno.');
      stop();
      session = { model: null, sessionId };
      translation = { messageId: null, streamed: new Set() };
      if (typeof costUsd === 'number') Object.assign(translation, { reportedCost: costUsd, sessionCost: costUsd });
      setState('idle');
      return { sessionId };
    },

    /** Ends the conversation; the next prompt starts a new CLI process and a new session. */
    reset() {
      stop();
      session = { model: null, sessionId: null };
      translation = { messageId: null, streamed: new Set() };
      setState('idle');
      return { reset: true };
    },

    dispose() {
      const proc = child;
      child = null;
      proc?.stdin?.end();
      proc?.kill();
    },
  };
}
