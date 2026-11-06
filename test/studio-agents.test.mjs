import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createClaudeDriver, locateClaude, translateClaudeMessage } from '../src/studio/agents/claude.mjs';
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
      [{ kind: 'init', model: 'm', sessionId: 's', permissionMode: null, tools: 2 }],
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
    assert.deepEqual(driver.status().options, { model: 'opus', effort: 'max' });
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
