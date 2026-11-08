import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createClaudeDriver, locateClaude, translateClaudeMessage } from '../src/studio/agents/claude.mjs';
import { claudeSessionsDir, listClaudeSessions, readClaudeSession } from '../src/studio/agents/claude-sessions.mjs';
import { createCodexDriver } from '../src/studio/agents/codex.mjs';
import { codexSessionsDir, listCodexSessions, readCodexSession } from '../src/studio/agents/codex-sessions.mjs';
import { createAgentHub, OMNI_SESSION_PROMPT, omniMcpServer } from '../src/studio/agents/index.mjs';
import { createConversationIndex } from '../src/studio/conversations.mjs';
import { memorySummary } from '../src/studio/memory-summary.mjs';
import { openMemory } from '../src/memory.mjs';
import { runMcpServer } from '../src/mcp-server.mjs';
import { resolveWorkspace, workspaceId } from '../src/studio/workspace.mjs';
import { makeStudioProject } from '../test-support/studio-fixtures.mjs';
import { startStudioHost } from '../test-support/studio-host.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('../test-support/fake-claude.mjs', import.meta.url));
const win32 = { skip: process.platform !== 'win32' && 'Windows named pipes only' };

const fresh = () => ({ messageId: null, streamed: new Set() });

describe('AG translate Claude Code stream-json', () => {
  test('AG-01 init, streamed text and tool calls become provider-independent events', () => {
    const state = fresh();
    assert.deepEqual(
      translateClaudeMessage({ type: 'system', subtype: 'init', model: 'm', session_id: 's', tools: [1, 2] }, state),
      [{ kind: 'init', model: 'm', sessionId: 's', permissionMode: null, tools: 2, commands: [] }],
    );
    translateClaudeMessage({ type: 'stream_event', event: { type: 'message_start', message: { id: 'a' } } }, state);
    assert.deepEqual(
      translateClaudeMessage(
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'hi' } },
        },
        state,
      ),
      [{ kind: 'text', key: 'a:1', delta: 'hi' }],
    );
    // The final assistant message repeats the streamed text: only its tool calls are new.
    const events = translateClaudeMessage(
      {
        type: 'assistant',
        message: {
          id: 'a',
          content: [
            { type: 'text', text: 'hi' },
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test\nmore' } },
          ],
        },
      },
      state,
    );
    assert.deepEqual(events, [
      { kind: 'tool', id: 't1', name: 'Bash', title: 'npm test', input: { command: 'npm test\nmore' } },
    ]);
  });

  test('AG-02 unstreamed text, tool results, subagent noise and results', () => {
    const state = fresh();
    assert.deepEqual(
      translateClaudeMessage(
        { type: 'assistant', message: { id: 'b', content: [{ type: 'text', text: 'x' }] } },
        state,
      ),
      [{ kind: 'text', key: 'b:full:0', delta: 'x' }],
    );
    assert.deepEqual(
      translateClaudeMessage(
        {
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'boom' }] },
            ],
          },
        },
        state,
      ),
      [{ kind: 'tool_result', toolUseId: 't1', isError: true, output: 'boom' }],
    );
    assert.deepEqual(
      translateClaudeMessage({ type: 'assistant', parent_tool_use_id: 'x', message: { content: [] } }, state),
      [],
    );
    const [result, auth] = translateClaudeMessage(
      { type: 'result', is_error: true, result: 'Not logged in · Please run /login' },
      state,
    );
    assert.equal(result.kind, 'result');
    assert.equal(result.isError, true);
    assert.equal(auth.code, 'AUTH_REQUIRED');
  });

  test('AG-03 long tool input fields are clipped before they reach the UI', () => {
    const [event] = translateClaudeMessage(
      {
        type: 'assistant',
        message: {
          id: 'c',
          content: [{ type: 'tool_use', id: 't', name: 'Write', input: { content: 'x'.repeat(20_000) } }],
        },
      },
      fresh(),
    );
    assert.ok(event.input.content.length < 9_000);
  });
});

function fakeProcess() {
  const proc = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = () => proc.emit('exit', null);
  const written = [];
  proc.stdin.on('data', chunk =>
    written.push(
      ...String(chunk)
        .trim()
        .split('\n')
        .map(line => JSON.parse(line)),
    ),
  );
  proc.send = message => proc.stdout.write(`${JSON.stringify(message)}\n`);
  proc.written = written;
  return proc;
}

const tick = () => new Promise(resolve => setImmediate(resolve));

describe('AG Claude Code driver', () => {
  let proc;
  let events;
  let driver;
  let spawned;
  beforeEach(() => {
    proc = fakeProcess();
    events = [];
    spawned = [];
    driver = createClaudeDriver({
      cwd: 'C:\\repo',
      emit: event => events.push(event),
      locate: async () => ({ file: 'claude.exe', prefix: [], path: 'claude.exe' }),
      spawnImpl: (file, args, options) => {
        spawned.push({ file, args, options });
        return proc;
      },
    });
  });

  test('AG-04 a prompt starts the official CLI in stream-json mode inside the project', async () => {
    await driver.prompt('hola', { model: 'sonnet' });
    await tick();
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].options.cwd, 'C:\\repo');
    for (const flag of ['-p', '--input-format', '--output-format', '--permission-prompt-tool'])
      assert.ok(spawned[0].args.includes(flag), flag);
    assert.deepEqual(spawned[0].args.slice(-2), ['--model', 'sonnet']);
    assert.deepEqual(proc.written[0], {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'hola' }] },
    });
    assert.equal(driver.status().state, 'busy');
    await assert.rejects(driver.prompt('otra'), { code: 'AGENT_BUSY' });
  });

  test('AG-05 permission requests round-trip and the result ends the turn', async () => {
    await driver.prompt('hola');
    proc.send({
      type: 'control_request',
      request_id: 'r1',
      request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } },
    });
    await tick();
    const permission = events.find(event => event.kind === 'permission');
    assert.deepEqual(permission, {
      kind: 'permission',
      requestId: 'r1',
      toolName: 'Bash',
      title: 'ls',
      input: { command: 'ls' },
      reason: null,
    });
    driver.respond('r1', 'allow');
    await tick();
    assert.deepEqual(proc.written.at(-1), {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'r1',
        response: { behavior: 'allow', updatedInput: { command: 'ls' } },
      },
    });
    assert.throws(() => driver.respond('r1', 'deny'), { code: 'PERMISSION_UNKNOWN' });
    proc.send({ type: 'result', is_error: false, result: 'ok', total_cost_usd: 0.02 });
    await tick();
    assert.equal(driver.status().state, 'ready');
    assert.equal(events.find(event => event.kind === 'result').costUsd, 0.02);
  });

  test('AG-06 cancel declines pending permissions and interrupts the turn', async () => {
    await driver.prompt('hola');
    proc.send({
      type: 'control_request',
      request_id: 'r2',
      request: { subtype: 'can_use_tool', tool_name: 'Write', input: {} },
    });
    await tick();
    assert.deepEqual(driver.cancel(), { cancelled: true });
    await tick();
    const [deny, interrupt] = proc.written.slice(-2);
    assert.equal(deny.response.response.behavior, 'deny');
    assert.equal(interrupt.request.subtype, 'interrupt');
  });

  test('AG-07 unsupported control requests are answered with an error instead of hanging the CLI', async () => {
    await driver.prompt('hola');
    proc.send({ type: 'control_request', request_id: 'r3', request: { subtype: 'mcp_message' } });
    await tick();
    assert.deepEqual(proc.written.at(-1), {
      type: 'control_response',
      response: { subtype: 'error', request_id: 'r3', error: 'Unsupported control request' },
    });
  });

  test('AG-08 a CLI that dies mid-turn reports the error; reset starts a new conversation', async () => {
    await driver.prompt('hola');
    proc.stderr.write('Please run /login\n');
    await tick();
    proc.emit('exit', 1);
    assert.equal(events.find(event => event.kind === 'error').code, 'AUTH_REQUIRED');
    assert.equal(driver.status().state, 'idle');
    assert.deepEqual(driver.reset(), { reset: true });
  });

  test('AG-09 a missing CLI is a domain error with install guidance', async () => {
    const missing = createClaudeDriver({ cwd: '.', emit: () => undefined, locate: async () => null });
    await assert.rejects(missing.prompt('hola'), { code: 'AGENT_MISSING' });
    assert.equal(missing.status().state, 'idle');
  });
});

describe('AG model, effort and context', () => {
  test('AG-13 changing model or effort restarts the CLI on the same session with --resume', async () => {
    const procs = [];
    const spawned = [];
    const driver = createClaudeDriver({
      cwd: '.',
      emit: () => undefined,
      locate: async () => ({ file: 'claude.exe', prefix: [], path: 'claude.exe' }),
      spawnImpl: (_file, args) => {
        spawned.push(args);
        const proc = fakeProcess();
        procs.push(proc);
        return proc;
      },
    });
    await driver.prompt('uno', { model: 'haiku', effort: 'low' });
    procs[0].send({ type: 'system', subtype: 'init', session_id: 'S1', model: 'claude-haiku-5-5' });
    procs[0].send({ type: 'result', is_error: false, result: 'ok' });
    await tick();
    await driver.prompt('dos', { model: 'haiku', effort: 'low' });
    assert.equal(spawned.length, 1, 'same options reuse the process');
    procs[0].send({ type: 'result', is_error: false, result: 'ok' });
    await tick();
    await driver.prompt('tres', { model: 'opus', effort: 'max' });
    assert.equal(spawned.length, 2);
    const args = spawned[1];
    assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', 'opus']);
    assert.deepEqual(args.slice(args.indexOf('--effort'), args.indexOf('--effort') + 2), ['--effort', 'max']);
    assert.deepEqual(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2), ['--resume', 'S1']);
    assert.deepEqual(driver.status().options, { model: 'opus', effort: 'max', permission: 'ask' });
    await assert.rejects(createClaudeDriver({ cwd: '.', emit: () => undefined }).prompt('x', { effort: 'off' }), {
      code: 'INVALID_EFFORT',
    });
  });

  test('AG-14 the result reports context occupancy from the last message and the model window', () => {
    const state = fresh();
    translateClaudeMessage({ type: 'system', subtype: 'init', model: 'claude-haiku-5-5' }, state);
    translateClaudeMessage(
      {
        type: 'assistant',
        message: {
          id: 'a',
          content: [],
          usage: { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 8 },
        },
      },
      state,
    );
    const [result] = translateClaudeMessage(
      {
        type: 'result',
        is_error: false,
        result: 'ok',
        total_cost_usd: 0.004,
        modelUsage: { 'claude-haiku-5-5': { contextWindow: 1_000_000, costBasis: 'list' } },
      },
      state,
    );
    assert.equal(result.contextTokens, 1010);
    assert.equal(result.contextWindow, 1_000_000);
    assert.equal(result.costBasis, 'list');
  });

  test('AG-15 the CLI reports the session total: a turn costs the difference and the total never goes back', () => {
    const state = fresh();
    const turn = total => translateClaudeMessage({ type: 'result', is_error: false, total_cost_usd: total }, state)[0];
    const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
    // Totals seen from Claude Code 2.1.318: two turns, then a third after --resume (the total carries over).
    let result = turn(0.009);
    close(result.costUsd, 0.009);
    close(result.sessionCostUsd, 0.009);
    result = turn(0.0128);
    close(result.costUsd, 0.0038);
    close(result.sessionCostUsd, 0.0128);
    result = turn(0.0137);
    close(result.costUsd, 0.0009);
    // A process that counts from zero again keeps the earlier total as its base.
    result = turn(0.002);
    close(result.costUsd, 0.002);
    close(result.sessionCostUsd, 0.0157);
    assert.deepEqual(
      translateClaudeMessage({ type: 'result', is_error: false }, state)[0].costUsd,
      null,
      'no total, no cost',
    );
  });
});

describe('AG permission levels and commands', () => {
  test('AG-22 each Studio permission level becomes a --permission-mode; a change restarts on the same session', async () => {
    const spawned = [];
    const procs = [];
    const driver = createClaudeDriver({
      cwd: '.',
      emit: () => undefined,
      locate: async () => ({ file: 'claude.exe', prefix: [], path: 'claude.exe' }),
      spawnImpl: (_file, args) => {
        spawned.push(args);
        const proc = fakeProcess();
        procs.push(proc);
        return proc;
      },
    });
    const modeOf = args => args[args.indexOf('--permission-mode') + 1];
    await driver.prompt('uno');
    assert.equal(modeOf(spawned[0]), 'manual', 'Studio starts asking for every edit and command');
    assert.equal(spawned[0].filter(arg => arg === '--permission-mode').length, 1);
    procs[0].send({ type: 'system', subtype: 'init', session_id: 'S1', model: 'claude-haiku-5-5' });
    procs[0].send({ type: 'result', is_error: false, result: 'ok' });
    await tick();
    const expected = { default: 'acceptEdits', auto: 'auto', bypass: 'bypassPermissions', plan: 'plan' };
    for (const [permission, mode] of Object.entries(expected)) {
      await driver.prompt(permission, { permission });
      const args = spawned.at(-1);
      assert.equal(modeOf(args), mode);
      assert.deepEqual(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2), ['--resume', 'S1']);
      procs.at(-1).send({ type: 'result', is_error: false, result: 'ok' });
      await tick();
    }
    assert.equal(spawned.length, 5);
    await driver.prompt('again', { permission: 'plan' });
    assert.equal(spawned.length, 5, 'the same level reuses the process');
    assert.equal(driver.status().options.permission, 'plan');
    await assert.rejects(createClaudeDriver({ cwd: '.', emit: () => undefined }).prompt('x', { permission: 'yolo' }), {
      code: 'INVALID_PERMISSION',
    });
  });

  test('AG-23 init reports the slash commands the CLI accepts here, for the composer «/» list', () => {
    const [init] = translateClaudeMessage(
      {
        type: 'system',
        subtype: 'init',
        session_id: 'S',
        model: 'm',
        slash_commands: ['omni-specify', 'compact', '', 42],
      },
      fresh(),
    );
    assert.deepEqual(init.commands, ['omni-specify', 'compact']);
    assert.deepEqual(translateClaudeMessage({ type: 'system', subtype: 'init' }, fresh())[0].commands, []);
  });

  test('AG-24 parallel conversations run independently and warn both sides when they touch the same file', async () => {
    const events = [];
    const drivers = [];
    const hub = createAgentHub({
      root: 'C:/dev/omni-spec',
      workspace: { mode: 'studio', dir: 'C:/tmp' },
      notify: async (_method, params) => {
        events.push(params);
      },
      locate: async () => ({ file: 'claude.exe', prefix: [], path: 'claude.exe' }),
      createDriver: ({ emit }) => {
        let state = 'idle';
        let sessionId = null;
        const responses = [];
        const instance = {
          emit,
          responses,
          status: () => ({ state, model: 'claude-opus-5-5', sessionId }),
          prompt: async () => {
            state = 'busy';
            emit({ kind: 'status', state: 'busy' });
            return { accepted: true };
          },
          cancel: async () => ({ cancelled: true }),
          respond: (requestId, decision) => {
            responses.push({ requestId, decision });
            emit({ kind: 'permission_resolved', requestId, decision });
            return { requestId, decision };
          },
          resume: id => {
            sessionId = id;
            return { sessionId };
          },
          reset: () => {
            state = 'idle';
            sessionId = null;
            return { reset: true };
          },
          dispose: () => undefined,
          setSession: id => {
            sessionId = id;
          },
        };
        drivers.push(instance);
        return instance;
      },
    });

    await hub.prompt({ conversationId: 'conv-1', text: 'Arregla login\nDetalles' });
    await hub.prompt({ conversationId: 'conv-2', text: 'Refactoriza sesión' });
    const [, first, second] = drivers;
    first.setSession('S-1');
    first.emit({ kind: 'init', sessionId: 'S-1', model: 'claude-opus-5-5' });
    second.setSession('S-2');
    second.emit({ kind: 'init', sessionId: 'S-2', model: 'claude-opus-5-5' });

    first.emit({
      kind: 'tool',
      id: 't1',
      name: 'Edit',
      title: 'src/auth.ts',
      input: { file_path: 'C:/dev/omni-spec/src/auth.ts', old_string: 'a', new_string: 'b' },
    });

    second.emit({
      kind: 'permission',
      requestId: 'req-2',
      toolName: 'Edit',
      title: 'src/auth.ts',
      input: { file_path: 'src/auth.ts', old_string: 'b', new_string: 'c' },
    });

    const perm = events.find(event => event.kind === 'permission' && event.requestId === 'req-2');
    assert.equal(perm.conversationId, 'conv-2');
    assert.equal(perm.conflictWith, 'Arregla login');
    assert.equal(perm.conflictFile, 'src/auth.ts');

    // Answering by requestId routes to conv-2 even without passing conversationId.
    hub.permission({ requestId: 'req-2', decision: 'allow' });
    assert.deepEqual(second.responses, [{ requestId: 'req-2', decision: 'allow' }]);

    second.emit({
      kind: 'tool',
      id: 't2',
      name: 'Edit',
      title: 'src/auth.ts',
      input: { file_path: 'src/auth.ts', old_string: 'b', new_string: 'c' },
    });

    const notices = events.filter(event => event.kind === 'notice' && event.conflict);
    assert.equal(notices.length, 2, 'both conversations are warned once');
    assert.deepEqual(
      notices.map(notice => [notice.conversationId, notice.conflict.file, notice.conflict.otherConversation]),
      [
        ['conv-2', 'src/auth.ts', 'Arregla login'],
        ['conv-1', 'src/auth.ts', 'Refactoriza sesión'],
      ],
    );

    const status = await hub.status({ conversationId: 'conv-2' });
    assert.equal(status.live.length, 2);
  });
});

describe('AG earlier conversations', () => {
  const ROOT = 'C:\\dev\\Mi Proyecto';
  const OLD = '11111111-1111-4111-8111-111111111111';
  const NEW = '22222222-2222-4222-8222-222222222222';
  const EMPTY = '33333333-3333-4333-8333-333333333333';
  let config;
  let env;
  const jsonl = records => `${records.map(record => JSON.stringify(record)).join('\n')}\n`;

  beforeEach(() => {
    config = mkdtempSync(join(tmpdir(), 'omni-claude-config-'));
    env = { CLAUDE_CONFIG_DIR: config };
    const dir = claudeSessionsDir(ROOT, env);
    mkdirSync(dir, { recursive: true });
    // Records as Claude Code 2.1.318 writes them (trimmed to the fields Studio reads).
    writeFileSync(
      join(dir, `${OLD}.jsonl`),
      jsonl([
        { type: 'session-owner', sessionId: OLD },
        {
          type: 'user',
          uuid: 'u1',
          message: {
            role: 'user',
            content: '<command-name>/omni-plan</command-name>\n<command-args>login</command-args>',
          },
        },
        {
          type: 'user',
          uuid: 'u2',
          isMeta: true,
          message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill' }] },
        },
        { type: 'assistant', uuid: 'a1', message: { id: 'm1', content: [{ type: 'text', text: 'Reviso el plan.' }] } },
        {
          type: 'assistant',
          uuid: 'a2',
          message: {
            id: 'm1',
            content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }],
            usage: { input_tokens: 10, cache_read_input_tokens: 990 },
          },
        },
        {
          type: 'user',
          uuid: 'u3',
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.txt' }] },
        },
        {
          type: 'assistant',
          uuid: 'a3',
          isSidechain: true,
          message: { id: 'm2', content: [{ type: 'text', text: 'subagente' }] },
        },
        { type: 'custom-title', customTitle: 'Plan del login', sessionId: OLD },
        { type: 'cost-state', totalCostUSD: 0.42, sessionId: OLD },
      ]),
    );
    writeFileSync(
      join(dir, `${NEW}.jsonl`),
      jsonl([
        { type: 'user', uuid: 'n1', message: { role: 'user', content: [{ type: 'text', text: 'hola\n\nmás texto' }] } },
      ]),
    );
    writeFileSync(join(dir, `${EMPTY}.jsonl`), jsonl([{ type: 'session-owner', sessionId: EMPTY }]));
    writeFileSync(join(dir, 'notes.jsonl'), 'not a session\n');
    utimesSync(join(dir, `${OLD}.jsonl`), new Date('2026-11-01'), new Date('2026-11-01'));
  });
  afterEach(() => rmSync(config, { recursive: true, force: true }));

  test('AG-16 sessions are listed newest first with their title; history comes back as agent events', async () => {
    assert.ok(claudeSessionsDir(ROOT, env).endsWith(join('projects', 'C--dev-Mi-Proyecto')));
    const sessions = await listClaudeSessions({ root: ROOT, env });
    assert.deepEqual(
      sessions.map(({ id, title }) => ({ id, title })),
      [
        { id: NEW, title: 'hola' },
        { id: OLD, title: 'Plan del login' },
      ],
      'no prompt, no entry; files that are not sessions are ignored',
    );
    assert.deepEqual(await listClaudeSessions({ root: 'C:\\otra', env }), []);

    const history = await readClaudeSession({ root: ROOT, sessionId: OLD, env });
    assert.deepEqual(
      history.events.map(event => [event.kind, event.text ?? event.delta ?? event.title ?? event.output]),
      [
        ['user', '/omni-plan login'],
        ['text', 'Reviso el plan.'],
        ['tool', 'ls'],
        ['tool_result', 'a.txt'],
      ],
    );
    assert.equal(history.costUsd, 0.42);
    assert.equal(history.contextTokens, 1000);
    await assert.rejects(readClaudeSession({ root: ROOT, sessionId: '../../secret', env }), {
      code: 'SESSION_UNKNOWN',
    });
    await assert.rejects(readClaudeSession({ root: ROOT, sessionId: EMPTY.replace('3', '4'), env }), {
      code: 'SESSION_UNKNOWN',
    });
  });

  test('AG-17 resuming starts the next prompt with --resume and counts cost from the recorded total', async () => {
    const proc = fakeProcess();
    const spawned = [];
    const events = [];
    const driver = createClaudeDriver({
      cwd: ROOT,
      emit: event => events.push(event),
      locate: async () => ({ file: 'claude.exe', prefix: [], path: 'claude.exe' }),
      spawnImpl: (_file, args) => {
        spawned.push(args);
        return proc;
      },
    });
    assert.deepEqual(driver.resume(OLD, { costUsd: 0.42 }), { sessionId: OLD });
    assert.equal(driver.status().sessionId, OLD);
    await driver.prompt('sigue');
    const args = spawned[0];
    assert.deepEqual(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2), ['--resume', OLD]);
    assert.throws(() => driver.resume(NEW), { code: 'AGENT_BUSY' });
    proc.send({ type: 'result', is_error: false, total_cost_usd: 0.45 });
    await tick();
    const result = events.find(event => event.kind === 'result');
    assert.ok(Math.abs(result.costUsd - 0.03) < 1e-9, `turn cost ${result.costUsd}`);
    assert.equal(result.sessionCostUsd, 0.45);
  });
});

describe('AG locate and workspace', () => {
  test('AG-10 the npm claude.cmd shim resolves to the binary it launches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omni-claude-bin-'));
    try {
      const exe = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      mkdirSync(join(exe, '..'), { recursive: true });
      writeFileSync(exe, '');
      writeFileSync(
        join(dir, 'claude.cmd'),
        '@ECHO off\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n',
      );
      const found = await locateClaude({ env: { PATH: dir }, platform: 'win32' });
      assert.equal(found.file, exe);
      assert.deepEqual(found.prefix, []);
      const script = await locateClaude({ env: { OMNI_STUDIO_CLAUDE_BIN: FAKE_CLAUDE } });
      assert.equal(script.file, process.execPath);
      assert.deepEqual(script.prefix, [FAKE_CLAUDE]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('AG-11 a folder without OmniSpec gets a workspace outside the repository', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'omni-plain-'));
    const home = mkdtempSync(join(tmpdir(), 'omni-studio-home-'));
    try {
      const workspace = await resolveWorkspace(repo, { env: { OMNI_STUDIO_HOME: home } });
      assert.equal(workspace.mode, 'studio');
      assert.ok(workspace.dir.startsWith(home));
      assert.deepEqual(readdirSync(repo), []);
      assert.equal(workspaceId('C:\\Repo\\'), workspaceId('c:/repo'));
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('AG engine in studio mode', () => {
  let project;
  let home;
  let started;
  beforeEach(() => {
    project = makeStudioProject({ prefix: 'omni-studio-plain-', init: false });
    project.write('README.md', '# demo\n');
    project.commit('init');
    home = mkdtempSync(join(tmpdir(), 'omni-studio-home-'));
  });
  afterEach(async () => {
    await started?.close();
    await started?.exit;
    project.cleanup();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  test('AG-12 chat with an agent end to end, without writing a single file to the repository', win32, async () => {
    started = await startStudioHost({
      root: project.root,
      engineEnv: { OMNI_STUDIO_HOME: home, OMNI_STUDIO_CLAUDE_BIN: FAKE_CLAUDE },
    });
    await started.ready;

    const snapshot = await started.call('project.snapshot', {});
    assert.equal(snapshot.mode, 'studio');
    assert.ok(snapshot.workspace.startsWith(home));
    await assert.rejects(started.call('board.get', {}), error => error.rpc.data.code === 'OMNISPEC_NOT_INSTALLED');

    const status = await started.call('agent.status', {});
    assert.equal(status.agents[0].available, true);
    assert.deepEqual(await started.call('agent.prompt', { text: 'escribe notes.txt' }), { accepted: true });

    const seen = [];
    let permission;
    while (!permission) {
      const { params } = await started.nextNotification('agent.event');
      seen.push(params.kind);
      if (params.kind === 'permission') permission = params;
    }
    assert.ok(seen.includes('init'));
    assert.ok(seen.includes('text'));
    assert.ok(seen.includes('tool'));
    assert.equal(permission.toolName, 'Write');

    await started.call('agent.permission', { requestId: permission.requestId, decision: 'deny' });
    let result;
    while (!result) {
      const { params } = await started.nextNotification('agent.event');
      if (params.kind === 'result') result = params;
    }
    assert.equal(result.text, 'decision:deny');

    assert.equal(
      execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: project.root, encoding: 'utf8' }),
      '',
    );
  });
});

describe('AG Codex app-server driver and sessions', () => {
  test('AG-25 Codex app-server handshake, turns, approvals, rate limits and rollout sessions', async () => {
    const proc = fakeProcess();
    const spawned = [];
    const events = [];
    const driver = createCodexDriver({
      cwd: 'C:\\repo',
      emit: event => events.push(event),
      locate: async () => ({ file: 'codex.exe', prefix: [], path: 'codex.exe' }),
      spawnImpl: (_file, args) => {
        spawned.push(args);
        return proc;
      },
    });

    const promptDone = driver.prompt('Revisa src/auth.ts', {
      model: 'gpt-5.3-codex',
      effort: 'high',
      permission: 'ask',
    });
    await tick();
    assert.deepEqual(spawned[0], ['app-server']);
    assert.equal(proc.written[0].method, 'initialize');

    // Respond to initialize → driver sends initialized + thread/start
    proc.send({ id: proc.written[0].id, result: { serverInfo: { name: 'codex' } } });
    await tick();
    assert.equal(proc.written[1].method, 'initialized');
    assert.equal(proc.written[2].method, 'thread/start');
    assert.equal(proc.written[2].params.approvalPolicy, 'untrusted');
    assert.equal(proc.written[2].params.sandbox, 'read-only');

    // Respond to thread/start → driver emits init and sends turn/start
    proc.send({ id: proc.written[2].id, result: { threadId: 'th-codex-1', model: 'gpt-5.3-codex' } });
    await tick();
    assert.equal(proc.written[3].method, 'turn/start');
    assert.equal(proc.written[3].params.threadId, 'th-codex-1');
    assert.equal(proc.written[3].params.model, 'gpt-5.3-codex');
    assert.equal(proc.written[3].params.effort, 'high');
    proc.send({ id: proc.written[3].id, result: { turnId: 'turn-1' } });
    assert.deepEqual(await promptDone, { accepted: true });

    // Stream text delta, command execution and approval request
    proc.send({ method: 'item/agentMessage/delta', params: { itemId: 'msg-1', delta: 'Analizando…' } });
    proc.send({
      method: 'item/started',
      params: { item: { id: 'cmd-1', type: 'commandExecution', command: ['npm', 'test'] } },
    });
    proc.send({
      id: 'srv-1',
      method: 'item/commandExecution/requestApproval',
      params: { command: 'npm test', reason: 'Ejecutar pruebas' },
    });
    proc.send({
      method: 'account/rateLimits/updated',
      params: {
        rateLimits: {
          fiveHour: { usedPercent: 32 },
          weekly: { usedPercent: 14 },
        },
      },
    });
    await tick();

    const perm = events.find(event => event.kind === 'permission');
    assert.equal(perm.toolName, 'Bash');
    assert.equal(perm.title, 'npm test');
    driver.respond(perm.requestId, 'allow');
    await tick();
    assert.deepEqual(proc.written.at(-1), { jsonrpc: '2.0', id: 'srv-1', result: { decision: 'accept' } });

    proc.send({
      method: 'item/completed',
      params: { item: { id: 'cmd-1', type: 'commandExecution', exitCode: 0, aggregatedOutput: 'ok' } },
    });
    proc.send({
      method: 'turn/completed',
      params: { usage: { totalTokens: 4200, modelContextWindow: 200000 }, durationMs: 650 },
    });
    await tick();

    assert.equal(driver.status().state, 'ready');
    assert.equal(driver.status().rateLimits.length, 2);
    const result = events.find(event => event.kind === 'result');
    assert.equal(result.contextTokens, 4200);
    assert.equal(result.contextWindow, 200000);
    driver.dispose();

    // Rollout session listing and reading
    const codexHome = mkdtempSync(join(tmpdir(), 'omni-codex-home-'));
    try {
      const env = { CODEX_HOME: codexHome };
      const dayDir = join(codexSessionsDir(env), '2026', '11', '06');
      mkdirSync(dayDir, { recursive: true });
      const sid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      writeFileSync(
        join(dayDir, `rollout-2026-11-06T12-00-00-${sid}.jsonl`),
        `${[
          JSON.stringify({ type: 'session_meta', payload: { id: sid, cwd: 'C:\\repo' } }),
          JSON.stringify({
            type: 'response_item',
            payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Arregla el bug' }] },
          }),
          JSON.stringify({
            type: 'response_item',
            payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Listo.' }] },
          }),
        ].join('\n')}\n`,
      );
      const list = await listCodexSessions({ root: 'C:\\repo', env });
      assert.deepEqual(
        list.map(entry => ({ id: entry.id, title: entry.title, agent: entry.agent })),
        [{ id: sid, title: 'Arregla el bug', agent: 'codex' }],
      );
      const history = await readCodexSession({ root: 'C:\\repo', sessionId: sid, env });
      assert.equal(history.title, 'Arregla el bug');
      assert.deepEqual(
        history.events.map(event => [event.kind, event.text ?? event.delta]),
        [
          ['user', 'Arregla el bug'],
          ['text', 'Listo.'],
        ],
      );
    } finally {
      rmSync(codexHome, { recursive: true, force: true });
    }
  });
});

describe('AG shared memory MCP across agents and modes', () => {
  test('AG-26 Omni MCP works in Studio mode without repo files, records observations and decisions, reports active work, and is wired into Claude and Codex', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'omni-mcp-studio-repo-'));
    const home = mkdtempSync(join(tmpdir(), 'omni-mcp-studio-home-'));
    const prevHome = process.env.OMNI_STUDIO_HOME;
    process.env.OMNI_STUDIO_HOME = home;
    try {
      const workspace = await resolveWorkspace(repo, { env: { OMNI_STUDIO_HOME: home } });
      assert.equal(workspace.mode, 'studio');
      const memory = openMemory(workspace.memoryPath);
      const conversations = createConversationIndex(memory.db);

      const claudeSpawned = [];
      const codexSpawned = [];
      const claudeProc = fakeProcess();
      const codexProc = fakeProcess();

      const hub = createAgentHub({
        root: repo,
        workspace,
        conversations,
        notify: async () => undefined,
        locate: async () => ({ file: 'claude.exe', prefix: [], path: 'claude.exe' }),
        locateCodexImpl: async () => ({ file: 'codex.exe', prefix: [], path: 'codex.exe' }),
        createDriver: opts =>
          createClaudeDriver({
            ...opts,
            spawnImpl: (_file, args) => {
              claudeSpawned.push(args);
              return claudeProc;
            },
          }),
        createCodex: opts =>
          createCodexDriver({
            ...opts,
            spawnImpl: (_file, args) => {
              codexSpawned.push(args);
              return codexProc;
            },
          }),
      });

      // Start a Claude turn and simulate an edit so active work is recorded in memory.db
      await hub.prompt({ conversationId: 'conv-claude', agent: 'claude', text: 'Edita src/api.ts' });
      await tick();
      const mcpFlagIdx = claudeSpawned[0].indexOf('--mcp-config');
      assert.ok(mcpFlagIdx !== -1, 'Claude receives --mcp-config');
      const parsedMcp = JSON.parse(claudeSpawned[0][mcpFlagIdx + 1]);
      assert.deepEqual(parsedMcp.mcpServers.omni, omniMcpServer());
      const promptFlagIdx = claudeSpawned[0].indexOf('--append-system-prompt');
      assert.equal(claudeSpawned[0][promptFlagIdx + 1], OMNI_SESSION_PROMPT);

      claudeProc.send({ type: 'system', subtype: 'init', model: 'sonnet', session_id: 's-claude-1', tools: [] });
      claudeProc.send({
        type: 'assistant',
        message: {
          id: 'm1',
          content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/api.ts' } }],
        },
      });
      await tick();

      // Start a Codex turn and check -c mcp_servers.omni.* and developerInstructions
      const codexPrompt = hub.prompt({ conversationId: 'conv-codex', agent: 'codex', text: 'Revisa el proyecto' });
      await tick();
      assert.ok(codexSpawned[0].some(arg => arg.startsWith('mcp_servers.omni.command=')));
      codexProc.send({ id: codexProc.written[0].id, result: { serverInfo: { name: 'codex' } } });
      await tick();
      assert.equal(codexProc.written[2].params.developerInstructions, OMNI_SESSION_PROMPT);
      codexProc.send({ id: codexProc.written[2].id, result: { threadId: 'th-codex-9', model: 'gpt-5.3-codex' } });
      await tick();
      codexProc.send({ id: codexProc.written[3].id, result: { turnId: 'turn-9' } });
      await codexPrompt;

      // Run MCP server in Studio mode over in-memory streams
      const mcpIn = new PassThrough();
      const mcpOut = new PassThrough();
      const mcpReplies = [];
      let outBuf = '';
      mcpOut.on('data', chunk => {
        outBuf += String(chunk);
        let nl = outBuf.indexOf('\n');
        while (nl !== -1) {
          const line = outBuf.slice(0, nl).trim();
          outBuf = outBuf.slice(nl + 1);
          if (line) mcpReplies.push(JSON.parse(line));
          nl = outBuf.indexOf('\n');
        }
      });
      const serverPromise = runMcpServer({
        root: repo,
        version: '0.8.1',
        studio: true,
        input: mcpIn,
        output: mcpOut,
      });

      const callTool = async (id, name, args = {}) => {
        mcpIn.write(
          `${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`,
        );
        while (!mcpReplies.some(reply => reply.id === id)) await tick();
        const reply = mcpReplies.find(entry => entry.id === id);
        return JSON.parse(reply.result.content[0].text);
      };

      const obs = await callTool(1, 'omni_record_observation', {
        category: 'gotcha',
        scope: 'src/api.ts',
        summary: 'Los endpoints requieren validación de cabeceras.',
      });
      assert.equal(obs.category, 'gotcha');

      const dec = await callTool(2, 'omni_record_decision', {
        topic: 'shared-memory-wal',
        basis: 'Usar SQLite WAL fuera del repositorio cuando Omni corre en modo Studio.',
      });
      assert.equal(dec.file_path, null);
      assert.deepEqual(readdirSync(repo), [], 'zero files written to the repository in Studio mode');

      const search = await callTool(3, 'omni_search_context', { query: 'cabeceras' });
      assert.equal(search.results.length, 1);
      assert.equal(search.results[0].source_id, obs.id);

      const work = await callTool(4, 'omni_active_work');
      assert.ok(work.live.some(entry => entry.agent === 'claude' && entry.files.includes('src/api.ts')));
      assert.ok(work.live.some(entry => entry.agent === 'codex' && entry.sessionId === 'th-codex-9'));

      mcpIn.end();
      await serverPromise;

      const summary = memorySummary(memory.db, workspace);
      assert.equal(summary.counts.observations, 1);
      assert.equal(summary.counts.decisions, 1);

      hub.dispose();
      memory.close();
    } finally {
      if (prevHome === undefined) delete process.env.OMNI_STUDIO_HOME;
      else process.env.OMNI_STUDIO_HOME = prevHome;
      rmSync(repo, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
