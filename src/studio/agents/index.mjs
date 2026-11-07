import { StudioError } from '../protocol.mjs';
import { CLAUDE_EFFORTS, CLAUDE_MODELS, createClaudeDriver, locateClaude } from './claude.mjs';
import { listClaudeSessions, readClaudeSession } from './claude-sessions.mjs';

/**
 * The agents Omni Studio can drive (docs/STUDIO-AGENT-COCKPIT.md). Every driver emits the same
 * provider-independent `agent.event` payloads, so the UI does not know which CLI is behind the chat.
 * This prototype ships the Claude Code driver; Codex (`app-server`) and ACP drivers plug in here.
 */
export const AGENTS = Object.freeze([
  { id: 'claude', label: 'Claude Code', models: CLAUDE_MODELS, efforts: CLAUDE_EFFORTS },
]);

/**
 * @param {{
 *   root: string,
 *   workspace: {mode: string, dir: string},
 *   notify: (method: string, params: object) => Promise<void>,
 *   log?: (line: string) => void,
 *   conversations?: ReturnType<typeof import('../conversations.mjs').createConversationIndex> | null,
 *   createDriver?: typeof createClaudeDriver,
 *   locate?: typeof locateClaude,
 *   listSessions?: typeof listClaudeSessions,
 *   readSession?: typeof readClaudeSession,
 * }} options
 */
export function createAgentHub({
  root,
  workspace,
  notify,
  log = () => undefined,
  conversations = null,
  createDriver = createClaudeDriver,
  locate = locateClaude,
  listSessions = listClaudeSessions,
  readSession = readClaudeSession,
}) {
  const send = event =>
    notify('agent.event', { agent: 'claude', root, at: Date.now(), ...event }).catch(error =>
      log(`[studio-engine] agent.event could not be sent: ${error.message}`),
    );
  // The first prompt of a new conversation names it once the CLI reports its session id.
  let firstPrompt = null;
  /** Keeps Studio's conversation index current; a failure there must never break the chat. */
  const index = (change, apply) => {
    if (!conversations) return;
    try {
      apply(conversations);
      send({ kind: 'conversations', change });
    } catch (error) {
      log(`[studio-engine] conversation index not updated (${change}): ${error.message}`);
    }
  };
  const emit = event => {
    send(event);
    if (event.kind === 'init' && event.sessionId)
      index('recorded', store =>
        store.record({ agent: 'claude', sessionId: event.sessionId, title: firstPrompt ?? '' }),
      );
    if (event.kind === 'result') {
      const { sessionId } = driver.status();
      if (sessionId) index('touched', store => store.touch('claude', sessionId));
    }
  };
  const driver = createDriver({ cwd: root, emit });

  return {
    async status() {
      const location = await locate();
      return {
        workspace: { mode: workspace.mode, dir: workspace.dir },
        active: 'claude',
        agents: AGENTS.map(agent => ({ ...agent, available: Boolean(location), path: location?.path ?? null })),
        ...driver.status(),
      };
    },
    prompt({ text, model, effort }) {
      if (!text.trim()) throw new StudioError('EMPTY_PROMPT', 'Escribe un mensaje antes de enviarlo.');
      if (!driver.status().sessionId) firstPrompt = text;
      return driver.prompt(text, { model, effort });
    },
    cancel: () => driver.cancel(),
    permission: ({ requestId, decision, message }) => driver.respond(requestId, decision, message),
    /** Claude Code sessions of this folder, newest first (the «Retomar sesión de la terminal…» picker). */
    sessions: async () => ({ sessions: await listSessions({ root }) }),
    /** Loads one earlier conversation; the next prompt continues it. A terminal session joins the index. */
    async resume({ sessionId }) {
      const history = await readSession({ root, sessionId });
      driver.resume(sessionId, { costUsd: history.costUsd });
      index('recorded', store =>
        store.record({ agent: 'claude', sessionId, title: history.title, titleSource: history.titleSource }),
      );
      return history;
    },
    reset() {
      firstPrompt = null;
      return driver.reset();
    },
    dispose: () => driver.dispose(),
  };
}
