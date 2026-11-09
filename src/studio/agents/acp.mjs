import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, extname, join } from 'node:path';
import { StudioError } from '../protocol.mjs';
import { clipInput, DEFAULT_PERMISSION, toolTitle } from './claude.mjs';

/**
 * Generic Agent Client Protocol (ACP v1, schema 1.29.1) driver for Antigravity (`agy acp`),
 * OpenCode (`opencode acp`), Cline (`cline --acp`) and any ACP-compliant agent over stdio JSON-RPC 2.0.
 */

export const ACP_PERMISSION_MODES = Object.freeze({
  ask: 'default',
  default: 'accept-edits',
  auto: 'accept-edits',
  bypass: 'accept-edits',
  plan: 'plan',
});

/**
 * The `optionId` to answer a `session/request_permission` with. ACP agents name their options freely
 * (Antigravity does not use `allow_once`); what is fixed is each option's `kind`: allow_once, allow_always,
 * reject_once or reject_always. An id the agent did not offer counts as a refusal, so it is always chosen
 * from the offered options; the bare kind is only a last resort for an agent that offered none.
 */
export function permissionOption(options, decision) {
  const offered = Array.isArray(options) ? options.filter(option => typeof option?.optionId === 'string') : [];
  const kinds = decision === 'allow' ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always'];
  for (const kind of kinds) {
    const match = offered.find(option => option.kind === kind);
    if (match) return match.optionId;
  }
  const byName = offered.find(option =>
    decision === 'allow'
      ? /allow|approve|accept|yes/i.test(option.optionId)
      : /reject|deny|decline|no/i.test(option.optionId),
  );
  return byName?.optionId ?? kinds[0];
}

export const ANTIGRAVITY_MODELS = Object.freeze([
  'gemini-4-argon',
  'gemini-3.8-flash',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'gpt-oss-120b-medium',
]);

export const ANTIGRAVITY_EFFORTS = Object.freeze(['low', 'medium', 'high']);

export const OPENCODE_MODELS = Object.freeze([]);

export const CLINE_MODELS = Object.freeze([
  'anthropic/claude-fable-5.1',
  'ibm-granite/granite-4.2-8b',
  'inception/mercury-2.5-preview',
  'qwen/qwen3.8-flash',
]);

const STDERR_TAIL = 4_096;
const SHIM_TARGETS = /"%~?dp0%?\\?([^"%\r\n]+)"/gi;
const AUTH_HINT = /login|not logged in|authentication|unauthorized|unauthenticated|sign in/i;

async function isFile(path) {
  try {
    await access(path, constants.F_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

const runnable = (file, extraArgs = [], platform = process.platform) => {
  const extension = extname(file).toLowerCase();
  const isNodeScript = ['.js', '.mjs', '.cjs'].includes(extension) || (platform === 'win32' && extension !== '.exe');
  return isNodeScript
    ? { file: process.execPath, prefix: [file, ...extraArgs], path: file }
    : { file, prefix: [...extraArgs], path: file };
};

/**
 * Finds an ACP binary (`agy`, `opencode`, `cline`) on PATH or via `OMNI_STUDIO_<ID>_BIN`.
 */
export async function locateAcpBinary(
  binaryName,
  { envVar = null, subcommand = ['acp'], env = process.env, platform = process.platform } = {},
) {
  if (envVar && env[envVar]) return runnable(env[envVar], subcommand, platform);
  const pathKey = Object.keys(env).find(name => name.toUpperCase() === 'PATH');
  const directories = (pathKey ? env[pathKey].split(delimiter) : []).filter(Boolean);
  const home = env.USERPROFILE || env.HOME;
  if (home) directories.push(join(home, '.local', 'bin'));
  for (const directory of directories) {
    if (platform !== 'win32') {
      if (await isFile(join(directory, binaryName))) return runnable(join(directory, binaryName), subcommand, platform);
      continue;
    }
    if (await isFile(join(directory, `${binaryName}.exe`)))
      return runnable(join(directory, `${binaryName}.exe`), subcommand, platform);
    const shim = join(directory, `${binaryName}.cmd`);
    if (!(await isFile(shim))) continue;
    const content = await readFile(shim, 'utf8');
    for (const match of content.matchAll(SHIM_TARGETS)) {
      const target = match[1];
      if (!target || target.toLowerCase() === 'node.exe') continue;
      const candidate = join(dirname(shim), target);
      if (await isFile(candidate)) return runnable(candidate, subcommand, platform);
    }
  }
  return null;
}

export const locateAntigravity = (options = {}) =>
  locateAcpBinary('agy', { envVar: 'OMNI_STUDIO_AGY_BIN', subcommand: ['acp'], ...options });

export const locateOpenCode = (options = {}) =>
  locateAcpBinary('opencode', { envVar: 'OMNI_STUDIO_OPENCODE_BIN', subcommand: ['acp'], ...options });

export const locateCline = (options = {}) =>
  locateAcpBinary('cline', { envVar: 'OMNI_STUDIO_CLINE_BIN', subcommand: ['--acp'], ...options });

/**
 * Extracts models and thought_level options advertised by an ACP `session/new` or `initialize` response.
 */
export function extractAcpConfigOptions(payload) {
  const options = Array.isArray(payload?.configOptions)
    ? payload.configOptions
    : Array.isArray(payload?.options)
      ? payload.options
      : [];
  let models = [];
  let efforts = [];
  for (const opt of options) {
    const category = opt?.category ?? opt?.id ?? '';
    const rawList = Array.isArray(opt?.options) ? opt.options : Array.isArray(opt?.values) ? opt.values : [];
    const values = rawList
      .map(v => (typeof v === 'string' ? v : (v?.value ?? v?.id ?? v?.modelId ?? null)))
      .filter(Boolean);
    if (category === 'model' && values.length > 0) models = values;
    if ((category === 'thought_level' || category === 'effort') && values.length > 0) efforts = values;
  }
  if (models.length === 0 && Array.isArray(payload?.models?.availableModels)) {
    models = payload.models.availableModels
      .map(m => (typeof m === 'string' ? m : (m?.modelId ?? m?.id ?? m?.value ?? null)))
      .filter(Boolean);
  }
  return { models, efforts };
}

/**
 * Translates an ACP notification (`session/update`, `usage_update`, etc.) into Studio's `agent.event` format.
 */
export function translateAcpNotification(message, state) {
  if (!message || typeof message !== 'object' || typeof message.method !== 'string') return [];
  const params = message.params ?? {};
  const update = params.update ?? params;
  const kind = update.sessionUpdate ?? update.type ?? message.method;

  switch (kind) {
    case 'user_message_chunk': {
      const text =
        typeof update.content?.text === 'string'
          ? update.content.text
          : typeof update.text === 'string'
            ? update.text
            : '';
      if (!text) return [];
      return [{ kind: 'user', text }];
    }
    case 'agent_message_chunk':
    case 'session/messageChunk': {
      const delta =
        typeof update.content?.text === 'string'
          ? update.content.text
          : typeof update.delta === 'string'
            ? update.delta
            : typeof update.text === 'string'
              ? update.text
              : '';
      if (!delta) return [];
      const key = String(update.messageId ?? params.sessionId ?? 'acp-msg');
      state.streamed.add(key);
      return [{ kind: 'text', key, delta }];
    }
    case 'tool_call':
    case 'session/toolCall': {
      const toolId = String(update.toolCallId ?? update.id ?? 'acp-tool');
      const rawName = String(update.title ?? update.name ?? update.kind ?? 'tool');
      const isEdit = update.kind === 'edit' || rawName === 'Edit' || rawName === 'Write';
      const name = isEdit ? 'Edit' : update.kind === 'execute' ? 'Bash' : rawName;
      const input =
        update.rawInput && typeof update.rawInput === 'object'
          ? update.rawInput
          : update.locations?.[0]?.path
            ? { file_path: update.locations[0].path }
            : {};
      return [
        {
          kind: 'tool',
          id: toolId,
          name,
          title: toolTitle(name, input),
          input: clipInput(input),
        },
      ];
    }
    case 'tool_call_update':
    case 'session/toolCallUpdate': {
      if (update.status && update.status !== 'completed' && update.status !== 'failed') return [];
      const toolId = String(update.toolCallId ?? update.id ?? 'acp-tool');
      const output =
        typeof update.output === 'string'
          ? update.output
          : Array.isArray(update.content)
            ? update.content.map(c => c?.text ?? '').join('\n')
            : '';
      return [
        {
          kind: 'tool_result',
          toolUseId: toolId,
          isError: update.status === 'failed' || Boolean(update.isError),
          output,
        },
      ];
    }
    case 'usage_update':
    case 'session/usageUpdate': {
      const used = update.contextTokens ?? update.usedTokens ?? update.totalTokens;
      const size = update.contextWindow ?? update.maxTokens;
      if (typeof used === 'number') state.contextTokens = used;
      if (typeof size === 'number') state.contextWindow = size;
      if (typeof update.costUsd === 'number') state.costUsd = update.costUsd;
      return [];
    }
    case 'available_commands_update': {
      const cmds = Array.isArray(update.availableCommands)
        ? update.availableCommands
            .map(c => (typeof c === 'string' ? c : c?.name))
            .filter(name => typeof name === 'string' && name)
        : [];
      if (cmds.length === 0) return [];
      return [
        {
          kind: 'init',
          model: state.model ?? null,
          sessionId: params.sessionId ?? null,
          permissionMode: null,
          tools: null,
          commands: cmds,
        },
      ];
    }
    case 'session_info_update': {
      const title = typeof update.title === 'string' ? update.title.trim() : '';
      if (!title) return [];
      return [{ kind: 'title', title }];
    }
    default:
      return [];
  }
}

/**
 * Antigravity's transcript stores each tool argument as a JSON-encoded string (`"\"ls -la\""`, `"5000"`):
 * decode the ones that parse, keep the rest as they are.
 */
function decodeArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  const decoded = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== 'string') {
      decoded[key] = value;
      continue;
    }
    try {
      decoded[key] = JSON.parse(value);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      decoded[key] = value;
    }
  }
  return decoded;
}

/**
 * Reads an Antigravity conversation directly from its brain transcript on disk in < 1ms,
 * avoiding the heavy overhead of spawning a full CLI subprocess.
 */
export async function readAntigravityBrainSession(sessionId, env = process.env) {
  if (!sessionId || typeof sessionId !== 'string') return null;
  const home = env.USERPROFILE || env.HOME || homedir();
  // transcript_full.jsonl keeps whole messages; transcript.jsonl clips long ones in the middle.
  const candidates = ['antigravity-cli', 'antigravity'].flatMap(app =>
    ['transcript_full.jsonl', 'transcript.jsonl'].map(file =>
      join(home, '.gemini', app, 'brain', sessionId, '.system_generated', 'logs', file),
    ),
  );
  let transcriptFile = null;
  for (const c of candidates) {
    if (await isFile(c)) {
      transcriptFile = c;
      break;
    }
  }
  if (!transcriptFile) return null;

  try {
    const raw = await readFile(transcriptFile, 'utf8');
    const events = [];
    let modelTurn = 0;
    let contextTokens = null;
    let title = '';
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const step = JSON.parse(line);
        if (step.type === 'USER_INPUT') {
          let text = typeof step.content === 'string' ? step.content : '';
          const match = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/.exec(text);
          if (match) text = match[1].trim();
          if (!title && text) title = text.split(/\r?\n/)[0].trim();
          events.push({ kind: 'user', text });
        } else if (step.type === 'PLANNER_RESPONSE') {
          modelTurn += 1;
          if (typeof step.input_tokens === 'number') {
            contextTokens = (step.input_tokens ?? 0) + (step.output_tokens ?? 0);
          }
          if (step.content) {
            events.push({ kind: 'text', key: `acp-msg-${step.step_index ?? modelTurn}`, delta: step.content });
          }
          if (Array.isArray(step.tool_calls)) {
            for (const tc of step.tool_calls) {
              const rawName = tc.tool_name ?? tc.name ?? 'tool';
              const isEdit = ['edit_file', 'write_file', 'patch_file'].includes(rawName);
              const name = isEdit ? 'Edit' : rawName === 'run_command' ? 'Bash' : rawName;
              const input = decodeArgs(tc.args ?? tc.call_parameters ?? tc.input ?? {});
              events.push({
                kind: 'tool',
                id: String(tc.id ?? `tool-${step.step_index}`),
                name,
                title: toolTitle(name, input),
                input: clipInput(input),
              });
            }
          }
        } else if (step.type === 'GENERIC') {
          events.push({
            kind: 'tool_result',
            toolUseId: `tool-${step.step_index - 1}`,
            isError: step.status === 'ERROR',
            output: typeof step.content === 'string' ? step.content.slice(0, 4000) : '',
          });
        }
      } catch {
        // guardian-allow SLOP_EMPTY_CATCH: skip malformed JSONL line in brain transcript
      }
    }
    return {
      id: sessionId,
      title: title || sessionId,
      titleSource: 'prompt',
      events,
      contextTokens,
      costUsd: null,
      truncated: false,
    };
  } catch {
    // guardian-allow SLOP_SWALLOWED_ERROR: transcript missing or unreadable falls back to null
    return null;
  }
}

/**
 * Loads the history of an ACP session: first checks disk brain logs (< 1ms), and falls back
 * to `session/load` over stdio RPC for other ACP agents (OpenCode, Cline).
 */
export async function readAcpSession({
  root,
  sessionId,
  locate = locateAntigravity,
  spawnImpl = spawn,
  env = process.env,
  timeoutMs = 4500,
}) {
  const diskSession = await readAntigravityBrainSession(sessionId, env);
  if (diskSession && diskSession.events.length > 0) return diskSession;

  const location = await locate({ env });
  if (!location) {
    return {
      id: sessionId,
      title: sessionId,
      titleSource: 'prompt',
      events: [],
      contextTokens: null,
      costUsd: null,
      truncated: false,
    };
  }
  return new Promise(resolve => {
    const events = [];
    let title = '';
    let titleSource = 'prompt';
    const state = { model: null, streamed: new Set(), contextTokens: null, contextWindow: null, costUsd: null };
    let turnIndex = 0;
    let loadResolved = false;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        proc.stdin?.end();
        proc.kill();
      } catch {
        // guardian-allow SLOP_EMPTY_CATCH: best-effort process cleanup
      }
      resolve({
        id: sessionId,
        title: title || sessionId,
        titleSource,
        events,
        contextTokens: state.contextTokens,
        costUsd: state.costUsd,
        truncated: false,
      });
    };

    const proc = spawnImpl(location.file, [...location.prefix], {
      cwd: root,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const timer = setTimeout(finish, timeoutMs);
    let buffered = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', chunk => {
      buffered += chunk;
      let newline = buffered.indexOf('\n');
      while (newline !== -1) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        const msg = line ? parseLine(line) : null;
        if (msg) {
          for (const ev of translateAcpNotification(msg, state)) {
            if (ev.kind === 'user') {
              turnIndex += 1;
              if (!title) title = ev.text.split(/\r?\n/)[0] ?? '';
              events.push(ev);
            } else if (ev.kind === 'text') {
              events.push({ ...ev, key: `acp-hist-${turnIndex}` });
            } else if (ev.kind === 'title') {
              title = ev.title;
              titleSource = 'agent';
              if (loadResolved) {
                clearTimeout(timer);
                finish();
              }
            } else if (ev.kind === 'tool' || ev.kind === 'tool_result') {
              events.push(ev);
            }
          }
          if (msg.id === 2) {
            loadResolved = true;
            clearTimeout(timer);
            if (titleSource === 'agent') finish();
            else setTimeout(finish, 250);
          }
        }
        newline = buffered.indexOf('\n');
      }
    });
    proc.on('error', () => {
      clearTimeout(timer);
      finish();
    });
    proc.on('exit', () => {
      clearTimeout(timer);
      finish();
    });
    try {
      proc.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'omni-studio', version: '0.8.1' } },
        })}\n`,
      );
      proc.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'session/load',
          params: { sessionId, cwd: root, mcpServers: [] },
        })}\n`,
      );
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
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
 * One ACP conversation backed by `agy acp`, `opencode acp`, `cline --acp` or any ACP v1 binary.
 */
export function createAcpDriver({
  cwd,
  emit,
  label = 'ACP',
  env = process.env,
  spawnImpl = spawn,
  locate = () => locateAntigravity({ env }),
  mcpServer = null,
  systemPrompt = null,
}) {
  let child = null;
  let state = 'idle';
  let session = { model: null, sessionId: null };
  let running = { model: null, effort: null, permission: DEFAULT_PERMISSION };
  let translation = { model: null, streamed: new Set(), contextTokens: null, contextWindow: null, costUsd: null };
  let stderr = '';
  let nextRpcId = 1;
  const rpcCallbacks = new Map();
  const pending = new Map();

  const setState = next => {
    state = next;
    emit({ kind: 'status', state });
  };

  const write = payload => {
    if (!child?.stdin?.writable) throw new StudioError('AGENT_NOT_RUNNING', `${label} no está en ejecución.`);
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
    if (message.id !== undefined && !message.method) {
      const callback = rpcCallbacks.get(message.id);
      if (!callback) return;
      rpcCallbacks.delete(message.id);
      if (message.error) callback.reject(new Error(message.error.message ?? `${label} ACP error`));
      else callback.resolve(message.result ?? {});
      return;
    }

    // Server-initiated permission request (`session/request_permission`)
    if (message.id !== undefined && typeof message.method === 'string') {
      const params = message.params ?? {};
      const toolCall = params.toolCall ?? params;
      const isEdit = toolCall.kind === 'edit' || toolCall.name === 'Edit' || toolCall.name === 'Write';
      const isExec = toolCall.kind === 'execute' || toolCall.name === 'run_command' || toolCall.name === 'Bash';
      const toolName = isEdit
        ? 'Edit'
        : isExec
          ? label === 'Antigravity'
            ? 'Terminal'
            : 'Bash'
          : toolCall.name || 'Terminal';
      const input =
        toolCall.rawInput && typeof toolCall.rawInput === 'object'
          ? toolCall.rawInput
          : { command: String(toolCall.title ?? toolCall.command ?? '') };
      const requestId = String(message.id);
      pending.set(requestId, { rawId: message.id, options: params.options ?? [] });
      // «Sin restricciones» means edit and run without asking; ACP modes only auto-accept edits, so commands
      // would still ask. Studio answers for the person and only shows the tool running.
      if (running?.permission === 'bypass') {
        const entry = pending.get(requestId);
        pending.delete(requestId);
        write({
          jsonrpc: '2.0',
          id: entry.rawId,
          result: { outcome: { outcome: 'selected', optionId: permissionOption(entry.options, 'allow') } },
        });
        return;
      }
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

    for (const event of translateAcpNotification(message, translation)) {
      // The agent echoes the person's own message (user_message_chunk); Studio already shows it.
      if (event.kind === 'user') continue;
      emit(event);
    }
  };

  const stop = () => {
    const proc = child;
    child = null;
    pending.clear();
    for (const { reject } of rpcCallbacks.values()) reject(new Error(`${label} process stopped`));
    rpcCallbacks.clear();
    proc?.stdin?.end();
    proc?.kill();
  };

  async function start(options) {
    setState('starting');
    const location = await locate();
    if (!location) {
      setState('idle');
      throw new StudioError('AGENT_MISSING', `No encontré ${label} en el PATH.`);
    }
    const permission = options.permission ?? DEFAULT_PERMISSION;
    running = { model: options.model ?? null, effort: options.effort ?? null, permission };
    stderr = '';
    const proc = spawnImpl(location.file, [...location.prefix], {
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
      emit({ kind: 'error', code: 'AGENT_MISSING', message: `${label} no pudo arrancar: ${error.message}` });
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
            ? `${label} no tiene una sesión iniciada en su CLI.`
            : `${label} terminó (código ${code ?? '?'})${detail ? `: ${detail}` : '.'}`,
        });
      }
      setState('idle');
    });

    const initResult = await rpc('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'omni-studio', version: '0.8.1' },
      clientCapabilities: {},
    });
    const sessionMethod = session.sessionId ? 'session/resume' : 'session/new';
    const mcpServers = mcpServer?.command
      ? [
          {
            name: 'omni',
            command: mcpServer.command,
            args: mcpServer.args ?? [],
            env: Object.entries(mcpServer.env ?? {}).map(([name, value]) => ({ name, value: String(value) })),
          },
        ]
      : [];
    const sessionResult = await rpc(sessionMethod, {
      cwd,
      ...(session.sessionId ? { sessionId: session.sessionId } : {}),
      mcpServers,
      ...(systemPrompt ? { systemPrompt } : {}),
    });
    const sessionId = sessionResult?.sessionId ?? session.sessionId ?? 'acp-session';
    const discovered = extractAcpConfigOptions(sessionResult?.configOptions ? sessionResult : initResult);
    const model = options.model ?? sessionResult?.model ?? discovered.models[0] ?? session.model;
    session = { model: model ?? null, sessionId };
    translation.model = session.model;

    if (options.model) {
      await rpc('session/set_config_option', {
        sessionId,
        configId: 'model',
        category: 'model',
        optionId: 'model',
        value: options.model,
      }).catch(() => undefined);
    }
    if (options.effort) {
      await rpc('session/set_config_option', {
        sessionId,
        configId: 'thought_level',
        category: 'thought_level',
        optionId: 'thought_level',
        value: options.effort,
      }).catch(() => undefined);
    }
    const modeValue = ACP_PERMISSION_MODES[permission];
    if (modeValue) {
      await rpc('session/set_config_option', {
        sessionId,
        configId: 'mode',
        category: 'mode',
        optionId: 'mode',
        value: modeValue,
      }).catch(() => undefined);
    }

    emit({
      kind: 'init',
      model: session.model,
      sessionId: session.sessionId,
      permissionMode: modeValue ?? null,
      tools: null,
      commands: [],
      ...(discovered.models.length > 0 ? { models: discovered.models } : {}),
      ...(discovered.efforts.length > 0 ? { efforts: discovered.efforts } : {}),
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

    async prompt(text, options = {}) {
      if (state === 'busy')
        throw new StudioError('AGENT_BUSY', `${label} todavía está trabajando; espera o detén el turno.`);
      if (state === 'starting') throw new StudioError('AGENT_BUSY', `${label} está arrancando.`, { retryable: true });
      const permission = options.permission ?? DEFAULT_PERMISSION;
      const wanted = {
        model: options.model ?? null,
        effort: options.effort ?? null,
        permission,
      };
      if (!child) await start(wanted);
      else {
        if (wanted.model && wanted.model !== running.model) {
          await rpc('session/set_config_option', {
            sessionId: session.sessionId,
            configId: 'model',
            category: 'model',
            optionId: 'model',
            value: wanted.model,
          }).catch(() => undefined);
        }
        if (wanted.effort && wanted.effort !== running.effort) {
          await rpc('session/set_config_option', {
            sessionId: session.sessionId,
            configId: 'thought_level',
            category: 'thought_level',
            optionId: 'thought_level',
            value: wanted.effort,
          }).catch(() => undefined);
        }
        if (wanted.permission !== running.permission) {
          await rpc('session/set_config_option', {
            sessionId: session.sessionId,
            configId: 'mode',
            category: 'mode',
            optionId: 'mode',
            value: ACP_PERMISSION_MODES[wanted.permission] ?? 'default',
          }).catch(() => undefined);
        }
      }
      running = wanted;
      setState('busy');
      const startedAt = Date.now();
      const promptPromise = rpc('session/prompt', {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text }],
      });
      void promptPromise
        .then(promptResult => {
          if (promptResult && typeof promptResult === 'object') {
            const isError = promptResult.stopReason === 'error' || Boolean(promptResult.error);
            emit({
              kind: 'result',
              isError,
              subtype: promptResult.stopReason ?? 'end_turn',
              text: typeof promptResult.text === 'string' ? promptResult.text : '',
              costUsd: translation.costUsd,
              sessionCostUsd: translation.costUsd,
              // ACP does not report the turn's duration (Antigravity sends 0): Studio measures it.
              durationMs:
                typeof promptResult.durationMs === 'number' && promptResult.durationMs > 0
                  ? promptResult.durationMs
                  : Date.now() - startedAt,
              numTurns: 1,
              contextTokens: translation.contextTokens,
              contextWindow: translation.contextWindow,
              costBasis: null,
            });
            translation = { ...translation, streamed: new Set() };
            setState('ready');
          }
        })
        .catch(error => {
          emit({
            kind: 'error',
            code: 'PROMPT_FAILED',
            message: error.message || `${label} falló durante el turno.`,
          });
          setState('ready');
        });
      return { accepted: true };
    },

    cancel() {
      if (!child || state !== 'busy') return { cancelled: false };
      for (const requestId of [...pending.keys()]) this.respond(requestId, 'deny');
      void rpc('session/cancel', { sessionId: session.sessionId }).catch(() => undefined);
      return { cancelled: true };
    },

    respond(requestId, decision) {
      if (!pending.has(requestId))
        throw new StudioError('PERMISSION_UNKNOWN', 'Ese pedido de permiso ya no está pendiente.');
      const entry = pending.get(requestId);
      pending.delete(requestId);
      const optionId = permissionOption(entry.options, decision);
      write({
        jsonrpc: '2.0',
        id: entry.rawId,
        result: { outcome: { outcome: 'selected', optionId } },
      });
      emit({ kind: 'permission_resolved', requestId, decision });
      return { requestId, decision };
    },

    resume(sessionId) {
      if (state === 'busy' || state === 'starting')
        throw new StudioError('AGENT_BUSY', `${label} todavía está trabajando; espera o detén el turno.`);
      stop();
      session = { model: null, sessionId };
      translation = { model: null, streamed: new Set(), contextTokens: null, contextWindow: null, costUsd: null };
      setState('idle');
      return { sessionId };
    },

    reset() {
      stop();
      session = { model: null, sessionId: null };
      translation = { model: null, streamed: new Set(), contextTokens: null, contextWindow: null, costUsd: null };
      setState('idle');
      return { reset: true };
    },

    dispose() {
      stop();
    },
  };
}
