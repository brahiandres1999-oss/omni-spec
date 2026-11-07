import { StudioError } from '../protocol.mjs';
import { CLAUDE_EFFORTS, CLAUDE_MODELS, CLAUDE_PERMISSION_MODES, createClaudeDriver, locateClaude } from './claude.mjs';
import { listClaudeSessions, readClaudeSession } from './claude-sessions.mjs';
import { CODEX_EFFORTS, CODEX_MODELS, CODEX_PERMISSION_MODES, createCodexDriver, locateCodex } from './codex.mjs';
import { listCodexSessions, readCodexSession } from './codex-sessions.mjs';

/**
 * The agents Omni Studio can drive (docs/STUDIO-AGENT-COCKPIT.md). Every driver emits the same
 * provider-independent `agent.event` payloads, so the UI does not know which CLI is behind the chat.
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
  {
    id: 'codex',
    label: 'Codex',
    models: CODEX_MODELS,
    efforts: CODEX_EFFORTS,
    permissions: Object.freeze(Object.keys(CODEX_PERMISSION_MODES)),
  },
]);

export function agentForModel(model) {
  if (!model) return null;
  for (const agent of AGENTS) {
    if (agent.models.includes(model)) return agent.id;
  }
  return null;
}

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
  createCodex = createCodexDriver,
  locate = locateClaude,
  locateCodexImpl = locateCodex,
  listSessions = listClaudeSessions,
  readSession = readClaudeSession,
  listCodex = listCodexSessions,
  readCodex = readCodexSession,
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

  /** @type {Map<string, {id: string, agent: string, sessionId: string|null, title: string, firstPrompt: string|null, files: Set<string>, driver: any}>} */
  const slots = new Map();
  const bySession = new Map();
  const requestSlot = new Map();
  const warnedConflicts = new Set();

  const allSlots = () => [...new Set(slots.values())];
  const labelOf = slot => slot.title || slot.sessionId || slot.id;
  const sendFor = (slot, event) =>
    send({
      agent: slot.agent,
      conversationId: slot.id,
      ...(slot.sessionId ? { sessionId: slot.sessionId } : {}),
      ...event,
    });

  const makeDriver = slot =>
    slot.agent === 'codex'
      ? createCodex({ cwd: root, emit: event => onSlotEvent(slot, event), locate: locateCodexImpl })
      : createDriver({ cwd: root, emit: event => onSlotEvent(slot, event), locate });

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
        store.record({ agent: slot.agent, sessionId: event.sessionId, title: slot.firstPrompt ?? '' }),
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
      if (sessionId) index('touched', store => store.touch(slot.agent, sessionId));
    }
  };

  const slotFor = (conversationId = 'default', agent = 'claude') => {
    const existing = slots.get(conversationId) ?? bySession.get(conversationId);
    if (existing) {
      if (agent && existing.agent !== agent && !existing.sessionId && existing.driver.status().state === 'idle') {
        existing.driver.dispose();
        existing.agent = agent;
        existing.driver = makeDriver(existing);
      }
      return existing;
    }
    const slot = {
      id: conversationId,
      agent: agent || 'claude',
      sessionId: null,
      title: '',
      firstPrompt: null,
      files: new Set(),
      driver: null,
    };
    slot.driver = makeDriver(slot);
    slots.set(conversationId, slot);
    return slot;
  };

  // Default conversation slot created eagerly so existing single-conversation callers work unchanged.
  slotFor('default', 'claude');

  return {
    async status({ conversationId = 'default' } = {}) {
      const [claudeLoc, codexLoc] = await Promise.all([locate(), locateCodexImpl ? locateCodexImpl() : locateCodex()]);
      const locations = { claude: claudeLoc, codex: codexLoc };
      const slot = slotFor(conversationId);
      const live = allSlots()
        .map(entry => {
          const st = entry.driver.status();
          return {
            conversationId: entry.id,
            agent: entry.agent,
            sessionId: st.sessionId ?? entry.sessionId,
            state: st.state,
            files: [...entry.files],
          };
        })
        .filter(entry => entry.state !== 'idle' || entry.sessionId !== null);
      return {
        workspace: { mode: workspace.mode, dir: workspace.dir },
        active: slot.agent,
        agents: AGENTS.map(agent => ({
          ...agent,
          available: Boolean(locations[agent.id]),
          path: locations[agent.id]?.path ?? null,
        })),
        ...slot.driver.status(),
        live,
      };
    },
    prompt({ conversationId = 'default', agent, text, model, effort, permission }) {
      if (!text.trim()) throw new StudioError('EMPTY_PROMPT', 'Escribe un mensaje antes de enviarlo.');
      const chosenAgent = agent ?? agentForModel(model) ?? undefined;
      const slot = slotFor(conversationId, chosenAgent);
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
    /** Earlier sessions of this folder across Claude Code and Codex, newest first. */
    async sessions({ agent } = {}) {
      if (agent === 'claude') return { sessions: await listSessions({ root }) };
      if (agent === 'codex') return { sessions: await listCodex({ root }) };
      const [claudeList, codexList] = await Promise.all([listSessions({ root }), listCodex({ root }).catch(() => [])]);
      const combined = [...claudeList, ...codexList].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { sessions: combined };
    },
    /** Loads one earlier conversation; the next prompt continues it. A terminal session joins the index. */
    async resume({ conversationId, agent, sessionId }) {
      let resolvedAgent = agent ?? 'claude';
      let history;
      if (agent === 'codex') {
        history = await readCodex({ root, sessionId });
      } else if (agent === 'claude') {
        history = await readSession({ root, sessionId });
      } else {
        try {
          history = await readSession({ root, sessionId });
          resolvedAgent = 'claude';
        } catch (error) {
          try {
            history = await readCodex({ root, sessionId });
            resolvedAgent = 'codex';
          } catch {
            throw error;
          }
        }
      }
      const defaultSlot = slotFor('default');
      const defaultBusy =
        defaultSlot.driver.status().state === 'busy' || defaultSlot.driver.status().state === 'starting';
      const targetId = conversationId ?? (bySession.has(sessionId) || defaultBusy ? sessionId : 'default');
      const slot = slotFor(targetId, resolvedAgent);
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
        store.record({ agent: resolvedAgent, sessionId, title: history.title, titleSource: history.titleSource }),
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
