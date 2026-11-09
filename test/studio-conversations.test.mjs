import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAgentHub } from '../src/studio/agents/index.mjs';
import {
  createConversationIndex,
  listConversationsAt,
  titleFrom,
  updateConversationAt,
} from '../src/studio/conversations.mjs';
import { memoryPathOf } from '../src/studio/workspace.mjs';

/** A clock that moves one minute per call, so ordering by activity is deterministic. */
function clock(start = Date.parse('2026-11-06T10:00:00Z')) {
  let tick = 0;
  return () => new Date(start + 60_000 * tick++).toISOString();
}

describe('AG Studio conversation index', () => {
  test('AG-18 conversations are recorded once, ordered by activity, renamed and archived', () => {
    const index = createConversationIndex(new DatabaseSync(':memory:'), { now: clock() });
    index.record({ agent: 'claude', sessionId: 'a', title: '\n  arregla el login\nmás detalle' });
    index.record({ agent: 'claude', sessionId: 'b', title: 'Plan del carrusel', titleSource: 'agent' });
    // Opening it again is not activity: the entry keeps its title and its place.
    index.record({ agent: 'claude', sessionId: 'a', title: 'otro título' });
    assert.deepEqual(
      index.list().map(entry => [entry.sessionId, entry.title, entry.titleSource]),
      [
        ['b', 'Plan del carrusel', 'agent'],
        ['a', 'arregla el login', 'prompt'],
      ],
    );
    index.touch('claude', 'a');
    assert.equal(index.list()[0].sessionId, 'a', 'a finished turn moves it up');

    index.rename('claude', 'b', 'Carrusel');
    index.archive('claude', 'a', true);
    assert.deepEqual(
      index.list().map(entry => [entry.sessionId, entry.title, entry.titleSource]),
      [['b', 'Carrusel', 'user']],
    );
    assert.deepEqual(
      index.list({ includeArchived: true }).map(entry => [entry.sessionId, entry.archived]),
      [
        ['a', true],
        ['b', false],
      ],
    );
    index.archive('claude', 'a', false);
    assert.equal(index.list().length, 2);
    assert.throws(() => index.rename('claude', 'zz', 'x'), { code: 'CONVERSATION_UNKNOWN' });
    assert.equal(titleFrom('   '), 'Conversación');
    assert.equal(titleFrom('x'.repeat(100)).length, 80);
  });

  test('AG-19 another project is read without creating its memory, and can be renamed or archived', async () => {
    const home = mkdtempSync(join(tmpdir(), 'omni-studio-home-'));
    const project = mkdtempSync(join(tmpdir(), 'omni-studio-project-'));
    const env = { OMNI_STUDIO_HOME: home };
    try {
      const path = await memoryPathOf(project, { env });
      assert.deepEqual(await listConversationsAt(project, { env }), []);
      assert.equal(existsSync(path), false, 'listing leaves no trace');
      await assert.rejects(updateConversationAt(project, { agent: 'claude', sessionId: 'a', title: 'x' }, { env }), {
        code: 'CONVERSATION_UNKNOWN',
      });

      mkdirSync(join(path, '..'), { recursive: true });
      const db = new DatabaseSync(path);
      createConversationIndex(db).record({ agent: 'claude', sessionId: 'a', title: 'hola' });
      db.close();

      assert.deepEqual(
        (await listConversationsAt(project, { env })).map(entry => entry.title),
        ['hola'],
      );
      await updateConversationAt(project, { agent: 'claude', sessionId: 'a', title: 'Saludo' }, { env });
      await updateConversationAt(project, { agent: 'claude', sessionId: 'a', archived: true }, { env });
      assert.deepEqual(await listConversationsAt(project, { env }), []);
      assert.deepEqual(
        (await listConversationsAt(project, { env, includeArchived: true })).map(entry => [
          entry.title,
          entry.archived,
        ]),
        [['Saludo', true]],
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('AG-20 the hub names a new conversation with its first prompt, touches it per turn and imports resumed ones', async () => {
    const index = createConversationIndex(new DatabaseSync(':memory:'), { now: clock() });
    const sent = [];
    let emit;
    let sessionId = null;
    const hub = createAgentHub({
      root: 'C:\\repo',
      workspace: { mode: 'studio', dir: 'C:\\ws' },
      notify: async (_method, params) => sent.push(params),
      conversations: index,
      locate: async () => null,
      createDriver: options => {
        emit = options.emit;
        return {
          status: () => ({ state: 'ready', model: null, sessionId }),
          prompt: async () => ({ accepted: true }),
          resume: id => {
            sessionId = id;
          },
          reset: () => {
            sessionId = null;
          },
          dispose: () => undefined,
        };
      },
      readSession: async () => ({ title: 'Omni clarify', titleSource: 'agent', events: [], costUsd: null }),
    });

    await hub.prompt({ text: 'arregla el login\ncon detalle' });
    sessionId = 'S1';
    emit({ kind: 'init', sessionId: 'S1', model: 'claude-haiku-5-5' });
    await hub.prompt({ text: 'segundo mensaje' });
    emit({ kind: 'result', isError: false });
    assert.deepEqual(
      index.list().map(entry => [entry.sessionId, entry.title]),
      [['S1', 'arregla el login']],
    );
    assert.ok(
      sent.some(event => event.kind === 'conversations'),
      'the UI hears that the index changed',
    );

    // A terminal session brought in now goes to the top, under the title the CLI gave it.
    await hub.resume({ sessionId: 'S0' });
    assert.deepEqual(
      index.list().map(entry => [entry.sessionId, entry.title, entry.titleSource]),
      [
        ['S0', 'Omni clarify', 'agent'],
        ['S1', 'arregla el login', 'prompt'],
      ],
    );

    // A broken index never breaks the chat.
    const broken = createAgentHub({
      root: 'C:\\repo',
      workspace: { mode: 'studio', dir: 'C:\\ws' },
      notify: async () => undefined,
      conversations: {
        record: () => {
          throw new Error('disk full');
        },
      },
      log: () => undefined,
      locate: async () => null,
      createDriver: options => {
        emit = options.emit;
        return { status: () => ({ sessionId: null }), prompt: async () => ({ accepted: true }) };
      },
    });
    await broken.prompt({ text: 'hola' });
    assert.doesNotThrow(() => emit({ kind: 'init', sessionId: 'S2' }));
  });
});

describe('AG switching between conversations', () => {
  /** A hub whose drivers record which session each one runs and every prompt they get. */
  function fakeHub(index = createConversationIndex(new DatabaseSync(':memory:'), { now: clock() })) {
    const drivers = [];
    const hub = createAgentHub({
      root: 'C:/repo',
      workspace: { mode: 'studio', dir: 'C:/ws' },
      notify: async () => undefined,
      conversations: index,
      locate: async () => null,
      createDriver: options => {
        const driver = {
          sessionId: null,
          state: 'idle',
          prompts: [],
          disposed: false,
          emit: options.emit,
          status: () => ({ state: driver.state, model: null, sessionId: driver.sessionId }),
          prompt: async text => {
            driver.prompts.push(text);
            return { accepted: true };
          },
          resume: id => {
            driver.sessionId = id;
          },
          reset: () => {
            driver.sessionId = null;
          },
          dispose: () => {
            driver.disposed = true;
          },
        };
        drivers.push(driver);
        return driver;
      },
      readSession: async ({ sessionId }) => ({ title: sessionId, titleSource: 'prompt', events: [], costUsd: null }),
    });
    return { hub, drivers, index };
  }

  test('AG-22 resuming a session never takes over the slot of another conversation', async () => {
    const { hub, drivers } = fakeHub();
    // Conversation «new-1» runs session A.
    await hub.prompt({ conversationId: 'new-1', text: 'hola' });
    const first = drivers.at(-1);
    first.sessionId = 'A';
    first.state = 'ready';
    first.emit({ kind: 'init', sessionId: 'A' });

    // The rail opens session B while the UI still sits on «new-1»: B gets its own slot.
    const resumed = await hub.resume({ conversationId: 'new-1', sessionId: 'B' });
    assert.equal(resumed.conversationId, 'B');
    assert.equal(first.sessionId, 'A', 'A keeps its process and its session');

    // Prompts go where they belong.
    await hub.prompt({ conversationId: 'B', text: 'para B' });
    await hub.prompt({ conversationId: 'new-1', text: 'para A' });
    assert.deepEqual(first.prompts, ['hola', 'para A']);
    assert.deepEqual(drivers.find(driver => driver.sessionId === 'B').prompts, ['para B']);

    // Opening A again reuses its slot without restarting the CLI.
    const again = await hub.resume({ conversationId: 'A', sessionId: 'A' });
    assert.equal(again.conversationId, 'new-1');
    assert.equal(again.state, 'ready');
  });

  test('AG-23 a busy conversation can be opened without stopping its turn', async () => {
    const { hub, drivers } = fakeHub();
    await hub.prompt({ conversationId: 'new-1', text: 'trabajo largo' });
    const driver = drivers.at(-1);
    driver.sessionId = 'A';
    driver.state = 'busy';
    driver.resume = () => {
      throw new Error('a busy driver must not be resumed');
    };
    driver.emit({ kind: 'init', sessionId: 'A' });
    const opened = await hub.resume({ conversationId: 'A', sessionId: 'A' });
    assert.equal(opened.state, 'busy');
    assert.equal(opened.conversationId, 'new-1');
  });

  test('AG-24 status never creates a conversation and deleting one stops its process', async () => {
    const { hub, drivers, index } = fakeHub();
    const before = drivers.length;
    const status = await hub.status({ conversationId: 'new-9' });
    assert.equal(status.state, 'idle');
    assert.equal(drivers.length, before, 'no driver was started for a status question');

    await hub.prompt({ conversationId: 'new-1', text: 'borrar esto' });
    const driver = drivers.at(-1);
    driver.sessionId = 'A';
    driver.emit({ kind: 'init', sessionId: 'A' });
    assert.equal(index.list().length, 1);

    assert.deepEqual(hub.forget({ sessionId: 'A' }), { forgotten: true });
    index.remove('claude', 'A');
    assert.equal(driver.disposed, true);
    assert.deepEqual(index.list(), []);
    assert.throws(() => index.remove('claude', 'A'), { code: 'CONVERSATION_UNKNOWN' });
  });
});

describe('AG memory summary', () => {
  test('AG-21 the Memoria page counts what the memory holds, including Studio conversations', async () => {
    const { memorySummary } = await import('../src/studio/memory-summary.mjs');
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE observations (category TEXT, scope TEXT, summary TEXT, created_at TEXT);
      CREATE TABLE decisions (topic TEXT, status TEXT, basis TEXT, recorded_at TEXT);
      INSERT INTO observations VALUES ('gotcha', 'auth', 'El login usa cookies httpOnly', '2026-11-06T10:00:00Z');`);
    createConversationIndex(db).record({ agent: 'claude', sessionId: 'a', title: 'hola' });
    const summary = memorySummary(db, { mode: 'studio', memoryPath: 'C:wsmemory.db' });
    assert.deepEqual(summary.counts, { observations: 1, decisions: 0, conversations: 1, modules: 0, dependencies: 0 });
    assert.equal(summary.observations[0].summary, 'El login usa cookies httpOnly');
    assert.equal(summary.mode, 'studio');
  });
});

describe('AG OmniSpec workflows from Studio', () => {
  test('AG-25 /omni-… reaches any agent as the whole workflow, pointing at the CLI Studio carries', async () => {
    const { expandWorkflow, OMNI_WORKFLOWS } = await import('../src/studio/agents/index.mjs');
    const root = mkdtempSync(join(tmpdir(), 'omni-wf-'));
    try {
      const expanded = expandWorkflow('/omni-specify login con Google', { root, cli: 'C:/Studio/omni-spec.mjs' });
      assert.match(expanded, /node "C:\/Studio\/omni-spec\.mjs" <command>/);
      assert.match(expanded, /init --yes --agent studio/, 'an empty project is told how to set up OmniSpec minimally');
      assert.match(expanded, /# \/omni-specify/);
      assert.match(expanded, /User request: login con Google\n$/);
      assert.equal(expandWorkflow('hola /omni-specify'), null, 'only a leading command is a workflow');
      assert.equal(expandWorkflow('/omni-nada'), null);
      assert.ok(OMNI_WORKFLOWS.some(entry => entry.name === 'omni-init'));

      // Codex (or any other agent) gets the same expansion; the conversation keeps the typed title.
      const index = createConversationIndex(new DatabaseSync(':memory:'), { now: clock() });
      const received = [];
      let emit;
      const fake = options => {
        emit = options.emit;
        return {
          status: () => ({ state: 'idle', model: null, sessionId: null }),
          prompt: async text => received.push(text),
          dispose: () => undefined,
        };
      };
      const hub = createAgentHub({
        root,
        workspace: { mode: 'studio', dir: 'C:/ws' },
        notify: async () => undefined,
        conversations: index,
        locate: async () => null,
        createDriver: fake,
        createCodex: fake,
      });
      await hub.prompt({ conversationId: 'new-1', agent: 'codex', text: '/omni-specify login con Google' });
      assert.match(received[0], /## Omni Studio/);
      emit({ kind: 'init', sessionId: 'C1' });
      assert.equal(index.list()[0].title, '/omni-specify login con Google');
      assert.ok((await hub.status({ conversationId: 'new-1' })).workflows.length > 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('AG-26 a project installed by Studio keeps memory in Studio and only basic files in the repository', async () => {
    const { resolveWorkspace } = await import('../src/studio/workspace.mjs');
    const { memoryPath } = await import('../src/memory.mjs');
    const root = mkdtempSync(join(tmpdir(), 'omni-studio-init-'));
    const home = mkdtempSync(join(tmpdir(), 'omni-studio-home-'));
    const env = { ...process.env, OMNI_STUDIO_HOME: home };
    try {
      const before = await resolveWorkspace(root, { env });
      mkdirSync(join(root, 'specs'), { recursive: true });
      const { writeFileSync } = await import('node:fs');
      writeFileSync(
        join(root, 'specs', 'manifest.json'),
        JSON.stringify({ version: '0.0.0', agent: 'studio', specs: [] }),
      );
      const after = await resolveWorkspace(root, { env });
      assert.equal(after.mode, 'project', 'the views that need specs open');
      assert.equal(after.memoryPath, before.memoryPath, 'conversations and memory survive the install');
      assert.equal(memoryPath(root, env), before.memoryPath, 'the CLI and the MCP read the same memory');
      assert.equal(await memoryPathOf(root, { env }), before.memoryPath);

      writeFileSync(
        join(root, 'specs', 'manifest.json'),
        JSON.stringify({ version: '0.0.0', agent: 'claude', specs: [] }),
      );
      assert.equal(memoryPath(root, env), join(root, 'specs', '.omni', 'memory.db'), 'a classic install is unchanged');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('AG deleting a conversation everywhere', () => {
  const ID = '11111111-2222-4333-8444-555555555555';

  test('AG-27 the agent history files of a conversation are found per agent and removed; shared databases stay', async () => {
    const { sessionFiles, discardFiles } = await import('../src/studio/agents/session-files.mjs');
    const { writeFileSync } = await import('node:fs');
    const home = mkdtempSync(join(tmpdir(), 'omni-del-home-'));
    const env = { USERPROFILE: home, HOME: home };
    const root = 'C:/dev/Proyecto1';
    try {
      const claudeDir = join(home, '.claude', 'projects', 'C--dev-Proyecto1');
      mkdirSync(join(claudeDir, ID), { recursive: true });
      writeFileSync(join(claudeDir, `${ID}.jsonl`), '{}\n');
      writeFileSync(join(claudeDir, 'otra.jsonl'), '{}\n');
      const agy = join(home, '.gemini', 'antigravity-cli');
      mkdirSync(join(agy, 'brain', ID), { recursive: true });
      mkdirSync(join(agy, 'conversations'), { recursive: true });
      writeFileSync(join(agy, 'conversations', `${ID}.db`), '');

      const claude = await sessionFiles({ agent: 'claude', root, sessionId: ID, env });
      assert.deepEqual(claude.paths.sort(), [join(claudeDir, ID), join(claudeDir, `${ID}.jsonl`)].sort());
      const antigravity = await sessionFiles({ agent: 'antigravity', root, sessionId: ID, env });
      assert.equal(antigravity.paths.length, 2);
      assert.deepEqual(await sessionFiles({ agent: 'opencode', root, sessionId: ID, env }), {
        paths: [],
        shared: true,
      });
      assert.deepEqual(await sessionFiles({ agent: 'claude', root, sessionId: '../../x', env }), {
        paths: [],
        shared: false,
      });

      await discardFiles([...claude.paths, ...antigravity.paths], { platform: 'linux' });
      assert.equal(existsSync(join(claudeDir, `${ID}.jsonl`)), false);
      assert.equal(existsSync(join(agy, 'brain', ID)), false);
      assert.equal(existsSync(join(claudeDir, 'otra.jsonl')), true, 'other conversations are untouched');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('AG-28 ACP permission answers use the option the agent offered; workflows read back as typed', async () => {
    const { permissionOption } = await import('../src/studio/agents/acp.mjs');
    const offered = [
      { optionId: 'proceed', kind: 'allow_once', name: 'Allow' },
      { optionId: 'always', kind: 'allow_always', name: 'Always' },
      { optionId: 'stop', kind: 'reject_once', name: 'Deny' },
    ];
    assert.equal(permissionOption(offered, 'allow'), 'proceed');
    assert.equal(permissionOption(offered, 'deny'), 'stop');
    assert.equal(permissionOption([{ optionId: 'allow-run' }], 'allow'), 'allow-run');
    assert.equal(permissionOption([], 'allow'), 'allow_once');

    const { collapseWorkflow, expandWorkflow } = await import('../src/studio/agents/index.mjs');
    const expanded = expandWorkflow('/omni-specify login', { root: tmpdir() });
    assert.equal(collapseWorkflow(expanded), '/omni-specify login');
    assert.equal(collapseWorkflow(`${expanded.slice(0, 80)} ... ${expanded.slice(-40)}`), '/omni-specify login');
    assert.equal(collapseWorkflow(expandWorkflow('/omni-init', { root: tmpdir() })), '/omni-init');
    assert.equal(collapseWorkflow('hola'), 'hola');
  });

  test('AG-29 a working conversation cannot be deleted', async () => {
    const index = createConversationIndex(new DatabaseSync(':memory:'), { now: clock() });
    let state = 'idle';
    let emit;
    const hub = createAgentHub({
      root: 'C:/repo',
      workspace: { mode: 'studio', dir: 'C:/ws' },
      notify: async () => undefined,
      conversations: index,
      locate: async () => null,
      createDriver: options => {
        emit = options.emit;
        return {
          status: () => ({ state, model: null, sessionId: 'A' }),
          prompt: async () => ({ accepted: true }),
          dispose: () => undefined,
        };
      },
    });
    await hub.prompt({ conversationId: 'new-1', text: 'trabajo' });
    emit({ kind: 'init', sessionId: 'A' });
    state = 'busy';
    assert.equal(hub.isBusy('A'), true);
    state = 'ready';
    assert.equal(hub.isBusy('A'), false);
  });
});

describe('AG reloading the window mid-turn', () => {
  test('AG-31 a permission still waiting is handed back with the history, until it is answered', async () => {
    let emit;
    let state = 'idle';
    const hub = createAgentHub({
      root: 'C:/repo',
      workspace: { mode: 'studio', dir: 'C:/ws' },
      notify: async () => undefined,
      conversations: createConversationIndex(new DatabaseSync(':memory:'), { now: clock() }),
      locate: async () => null,
      createDriver: options => {
        emit = options.emit;
        return {
          status: () => ({ state, model: null, sessionId: 'A' }),
          prompt: async () => ({ accepted: true }),
          respond: (requestId, decision) => emit({ kind: 'permission_resolved', requestId, decision }),
          dispose: () => undefined,
        };
      },
      readSession: async () => ({ title: 'x', titleSource: 'prompt', events: [{ kind: 'user', text: 'hola' }] }),
    });
    await hub.prompt({ conversationId: 'new-1', text: 'hola' });
    emit({ kind: 'init', sessionId: 'A' });
    state = 'busy';
    emit({ kind: 'permission', requestId: 'r1', toolName: 'Terminal', title: 'ls', input: { command: 'ls' } });

    // The window reloads: the history from disk does not have the request, the engine adds it.
    const reopened = await hub.resume({ conversationId: 'A', agent: 'claude', sessionId: 'A' });
    assert.deepEqual(
      reopened.events.map(event => event.kind),
      ['user', 'permission'],
    );
    assert.equal(reopened.state, 'busy');

    hub.permission({ requestId: 'r1', decision: 'allow' });
    const after = await hub.resume({ conversationId: 'A', agent: 'claude', sessionId: 'A' });
    assert.deepEqual(
      after.events.map(event => event.kind),
      ['user'],
    );
  });
});

describe('AG native questions for every agent', () => {
  test('AG-32 omni_ask_user travels from the MCP server to the chat and the answer comes back', async () => {
    const { openAskChannel, askThroughChannel, ASK_ENV } = await import('../src/studio/ask-channel.mjs');
    const { cleanQuestions } = await import('../src/mcp-server.mjs');
    const sent = [];
    let emit;
    let hub;
    const channel = await openAskChannel({ onAsk: (request, answer) => hub.ask(request, answer) });
    try {
      const created = [];
      hub = createAgentHub({
        root: 'C:/repo',
        workspace: { mode: 'studio', dir: 'C:/ws' },
        notify: async (_method, params) => sent.push(params),
        askChannel: channel.path,
        locate: async () => null,
        readSession: async () => ({ title: 'x', titleSource: 'prompt', events: [{ kind: 'user', text: 'hola' }] }),
        createDriver: options => {
          emit = options.emit;
          created.push(options);
          return {
            status: () => ({ state: 'busy', model: null, sessionId: 'A' }),
            prompt: async () => ({ accepted: true }),
            dispose: () => undefined,
          };
        },
      });
      await hub.prompt({ conversationId: 'new-1', agent: 'claude', text: 'hola' });
      emit({ kind: 'init', sessionId: 'A' });
      const mcp = created.at(-1).mcpConfig.mcpServers.omni;
      assert.equal(mcp.env[ASK_ENV], channel.path, 'the conversation MCP server knows the channel');
      assert.equal(mcp.env.OMNI_STUDIO_CONVERSATION, 'new-1');

      const questions = cleanQuestions([
        {
          question: '¿Qué tipo de proyecto?',
          header: 'Tipo',
          options: [{ label: 'Web (Recomendado)', description: 'Next.js' }, { label: 'CLI' }],
        },
      ]);
      const pending = askThroughChannel(channel.path, { conversationId: 'new-1', questions });
      let asked;
      for (let tries = 0; tries < 50 && !asked; tries++) {
        await new Promise(resolve => setTimeout(resolve, 10));
        asked = sent.find(event => event.kind === 'question');
      }
      assert.equal(asked.conversationId, 'new-1');
      assert.equal(asked.questions[0].options[0].label, 'Web (Recomendado)');

      const resumed = await hub.resume({ sessionId: 'A' });
      assert.ok(
        resumed.events.some(event => event.kind === 'question' && event.requestId === asked.requestId),
        'the pending question is preserved across resume/reload',
      );

      hub.answer({ requestId: asked.requestId, answers: [{ question: '¿Qué tipo de proyecto?', answer: 'CLI' }] });
      assert.deepEqual(await pending, { answers: [{ question: '¿Qué tipo de proyecto?', answer: 'CLI' }] });
      assert.ok(sent.some(event => event.kind === 'question_resolved' && event.requestId === asked.requestId));
      assert.throws(() => hub.answer({ requestId: asked.requestId, answers: [] }), { code: 'QUESTION_UNKNOWN' });
      assert.throws(() => cleanQuestions([{ question: '¿?', options: [{ label: 'solo una' }] }]), /2 to 4 options/);
    } finally {
      channel.close();
    }
  });

  test('AG-33 omni_ask_user is offered only inside Omni Studio', async () => {
    const { runMcpServer } = await import('../src/mcp-server.mjs');
    const { PassThrough } = await import('node:stream');
    const list = async env => {
      const previous = process.env.OMNI_STUDIO_ASK;
      if (env) process.env.OMNI_STUDIO_ASK = env;
      else delete process.env.OMNI_STUDIO_ASK;
      const root = mkdtempSync(join(tmpdir(), 'omni-mcp-ask-'));
      const home = mkdtempSync(join(tmpdir(), 'omni-mcp-home-'));
      const savedHome = process.env.OMNI_STUDIO_HOME;
      process.env.OMNI_STUDIO_HOME = home;
      try {
        const input = new PassThrough();
        const output = new PassThrough();
        let text = '';
        output.on('data', chunk => {
          text += chunk;
        });
        const done = runMcpServer({ root, version: '0.0.0', studio: true, input, output, log: () => undefined });
        input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);
        await done;
        return JSON.parse(text.trim().split('\n')[0]).result.tools.map(tool => tool.name);
      } finally {
        if (previous === undefined) delete process.env.OMNI_STUDIO_ASK;
        else process.env.OMNI_STUDIO_ASK = previous;
        if (savedHome === undefined) delete process.env.OMNI_STUDIO_HOME;
        else process.env.OMNI_STUDIO_HOME = savedHome;
        rmSync(root, { recursive: true, force: true });
        rmSync(home, { recursive: true, force: true });
      }
    };
    assert.ok((await list('\\.pipeomni-ask-test')).includes('omni_ask_user'));
    assert.ok(!(await list(null)).includes('omni_ask_user'));
  });
});
