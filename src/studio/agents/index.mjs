import { StudioError } from '../protocol.mjs';
import { CLAUDE_EFFORTS, CLAUDE_MODELS, CLAUDE_PERMISSION_MODES, createClaudeDriver, locateClaude } from './claude.mjs';
import { listClaudeSessions, readClaudeSession } from './claude-sessions.mjs';

/**
 * The agents Omni Studio can drive (docs/STUDIO-AGENT-COCKPIT.md). Every driver emits the same
 * provider-independent `agent.event` payloads, so the UI does not know which CLI is behind the chat.
 * This prototype ships the Claude Code driver; Codex (`app-server`) and ACP drivers plug in here.
 */
export const AGENTS = Object.freeze([
  {
    id: 'claude',
    label: 'Claude Code',
    models: CLAUDE_MODELS,
    efforts: CLAUDE_EFFORTS,
    // Studio's permission levels this agent has (Q25); a level an agent lacks is not offered.
    permissions: Object.freeze(Object.keys(CLAUDE_PERMISSION_MODES)),
  },
]);

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function normalizeFile(root, raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const cleanRoot = root.replaceAll('\\', '/').replace(/\/+$/, '');
  const cleanPath = raw.replaceAll('\\', '/');
  if (cleanPath.toLowerCase().startsWith(`${cleanRoot.toLowerCase()}/`))
    return cleanPath.slice(cleanRoot.length + 1).replace(/^\/+/, '');
  return cleanPath.replace(/^\.\//, '');
}

function editedFile(root, toolName, input) {
  if (!EDIT_TOOLS.has(toolName) || !input || typeof input !== 'object') return null;
  return normalizeFile(root, input.file_path ?? input.path ?? input.notebook_path);
}

const firstLine = text =>
  String(text ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean) ?? '';

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

  /** @type {Map<string, {id: string, sessionId: string|null, title: string, firstPrompt: string|null, files: Set<string>, driver: ReturnType<typeof createClaudeDriver>}>} */
  const slots = new Map();
  const bySession = new Map();
  const requestSlot = new Map();
  const warnedConflicts = new Set();

  const allSlots = () => [...new Set(slots.values())];
  const labelOf = slot => slot.title || slot.sessionId || slot.id;
  const sendFor = (slot, event) =>
    send({
      conversationId: slot.id,
      ...(slot.sessionId ? { sessionId: slot.sessionId } : {}),
      ...event,
    });

  const onSlotEvent = (slot, event) => {
    if (event.kind === 'init' && event.sessionId) {
      slot.sessionId = event.sessionId;
      bySession.set(event.sessionId, slot);
      if (!slot.title && slot.firstPrompt) slot.title = firstLine(slot.firstPrompt);
    }
    if (event.kind === 'permission') {
      if (event.requestId) requestSlot.set(event.requestId, slot);
      const file = editedFile(root, event.toolName, event.input);
      if (file) {
        const other = allSlots().find(candidate => candidate !== slot && candidate.files.has(file));
        if (other) event = { ...event, conflictWith: labelOf(other), conflictFile: file };
      }
    }
    if (event.kind === 'permission_resolved' && event.requestId) requestSlot.delete(event.requestId);

    sendFor(slot, event);

    if (event.kind === 'init' && event.sessionId)
      index('recorded', store =>
        store.record({ agent: 'claude', sessionId: event.sessionId, title: slot.firstPrompt ?? '' }),
      );
    if (event.kind === 'tool') {
      const file = editedFile(root, event.name, event.input);
      if (file) {
        const others = allSlots().filter(candidate => candidate !== slot && candidate.files.has(file));
        slot.files.add(file);
        for (const other of others) {
          const pairKey = `${[slot.id, other.id].sort().join(':')}::${file}`;
          if (warnedConflicts.has(pairKey)) continue;
          warnedConflicts.add(pairKey);
          sendFor(slot, {
            kind: 'notice',
            conflict: { file, otherConversation: labelOf(other) },
            text: `Aviso de choque: «${labelOf(other)}» también modificó ${file} en este árbol de trabajo.`,
          });
          sendFor(other, {
            kind: 'notice',
            conflict: { file, otherConversation: labelOf(slot) },
            text: `Aviso de choque: «${labelOf(slot)}» también modificó ${file} en este árbol de trabajo.`,
          });
        }
      }
    }
    if (event.kind === 'result') {
      const sessionId = slot.driver.status().sessionId ?? slot.sessionId;
      if (sessionId) index('touched', store => store.touch('claude', sessionId));
    }
  };

  const slotFor = (conversationId = 'default') => {
    const existing = slots.get(conversationId) ?? bySession.get(conversationId);
    if (existing) return existing;
    const slot = {
      id: conversationId,
      sessionId: null,
      title: '',
      firstPrompt: null,
      files: new Set(),
      driver: null,
    };
    slot.driver = createDriver({ cwd: root, emit: event => onSlotEvent(slot, event) });
    slots.set(conversationId, slot);
    return slot;
  };

  // Default conversation slot created eagerly so existing single-conversation callers work unchanged.
  slotFor('default');

  return {
    async status({ conversationId = 'default' } = {}) {
      const location = await locate();
      const slot = slotFor(conversationId);
      const live = allSlots()
        .map(entry => {
          const st = entry.driver.status();
          return {
            conversationId: entry.id,
            sessionId: st.sessionId ?? entry.sessionId,
            state: st.state,
            files: [...entry.files],
          };
        })
        .filter(entry => entry.state !== 'idle' || entry.sessionId !== null);
      return {
        workspace: { mode: workspace.mode, dir: workspace.dir },
        active: 'claude',
        agents: AGENTS.map(agent => ({ ...agent, available: Boolean(location), path: location?.path ?? null })),
        ...slot.driver.status(),
        live,
      };
    },
    prompt({ conversationId = 'default', text, model, effort, permission }) {
      if (!text.trim()) throw new StudioError('EMPTY_PROMPT', 'Escribe un mensaje antes de enviarlo.');
      const slot = slotFor(conversationId);
      if (!slot.driver.status().sessionId && !slot.sessionId) {
        slot.firstPrompt = text;
        if (!slot.title) slot.title = firstLine(text);
      }
      return slot.driver.prompt(text, { model, effort, permission });
    },
    cancel: ({ conversationId = 'default' } = {}) => slotFor(conversationId).driver.cancel(),
    permission({ conversationId, requestId, decision, message }) {
      const slot = requestSlot.get(requestId) ?? slotFor(conversationId ?? 'default');
      return slot.driver.respond(requestId, decision, message);
    },
    /** Claude Code sessions of this folder, newest first (the «Retomar sesión de la terminal…» picker). */
    sessions: async () => ({ sessions: await listSessions({ root }) }),
    /** Loads one earlier conversation; the next prompt continues it. A terminal session joins the index. */
    async resume({ conversationId, sessionId }) {
      const history = await readSession({ root, sessionId });
      const defaultSlot = slotFor('default');
      const defaultBusy =
        defaultSlot.driver.status().state === 'busy' || defaultSlot.driver.status().state === 'starting';
      const targetId = conversationId ?? (bySession.has(sessionId) || defaultBusy ? sessionId : 'default');
      const slot = slotFor(targetId);
      slot.sessionId = sessionId;
      slot.title = history.title || slot.title;
      bySession.set(sessionId, slot);
      for (const event of history.events ?? []) {
        if (event.kind === 'tool') {
          const file = editedFile(root, event.name, event.input);
          if (file) slot.files.add(file);
        }
      }
      if (slot.driver.status().state === 'idle' || slot.driver.status().sessionId !== sessionId) {
        slot.driver.resume(sessionId, { costUsd: history.costUsd });
      }
      index('recorded', store =>
        store.record({ agent: 'claude', sessionId, title: history.title, titleSource: history.titleSource }),
      );
      return history;
    },
    reset({ conversationId = 'default' } = {}) {
      const slot = slotFor(conversationId);
      if (slot.sessionId) bySession.delete(slot.sessionId);
      slot.sessionId = null;
      slot.firstPrompt = null;
      slot.title = '';
      slot.files.clear();
      return slot.driver.reset();
    },
    dispose() {
      for (const slot of allSlots()) slot.driver.dispose();
    },
  };
}
