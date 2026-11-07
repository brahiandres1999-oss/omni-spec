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
