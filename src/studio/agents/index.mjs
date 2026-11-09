import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { OMNI_SKILLS } from '../../workflows.mjs';
import { ASK_ENV, CONVERSATION_ENV } from '../ask-channel.mjs';
import { StudioError } from '../protocol.mjs';
import {
  ACP_PERMISSION_MODES,
  ANTIGRAVITY_EFFORTS,
  ANTIGRAVITY_MODELS,
  CLINE_MODELS,
  createAcpDriver,
  locateAntigravity,
  locateCline,
  locateOpenCode,
  OPENCODE_MODELS,
  readAcpSession,
} from './acp.mjs';
import { CLAUDE_EFFORTS, CLAUDE_MODELS, CLAUDE_PERMISSION_MODES, createClaudeDriver, locateClaude } from './claude.mjs';
import { listClaudeSessions, readClaudeSession } from './claude-sessions.mjs';
import { CODEX_EFFORTS, CODEX_MODELS, CODEX_PERMISSION_MODES, createCodexDriver, locateCodex } from './codex.mjs';
import { listCodexSessions, readCodexSession } from './codex-sessions.mjs';

const OMNI_BIN = fileURLToPath(new URL('../../../bin/omni-spec.mjs', import.meta.url));

/** Short per-session instruction telling every agent when to consult and record shared project memory (Q26). */
export const OMNI_SESSION_PROMPT =
  'Memoria compartida de Omni: antes de modificar código, consulta `omni_search_context` y `omni_active_work` (y `omni_check_blast_radius` si cambias contratos o módulos compartidos). Cuando descubras un patrón, trampa, convención o restricción del proyecto, regístralo con `omni_record_observation`; cuando tomes una decisión de arquitectura, regístrala con `omni_record_decision`. Para preguntarle algo a la persona (elegir entre opciones o confirmar), usa siempre la herramienta `omni_ask_user`: Omni Studio la muestra como un panel nativo. No escribas las preguntas como listas en el chat.';

/** The OmniSpec workflows Studio offers to every agent as `/omni-…` commands. */
export const OMNI_WORKFLOWS = Object.freeze(
  OMNI_SKILLS.map(skill => Object.freeze({ name: skill.name, description: skill.description })),
);

/**
 * `/omni-specify texto` → the workflow's full instructions plus what the agent needs to run it from Studio.
 * Studio carries the CLI, templates and workflows, so they work the same with Claude Code, Codex, Antigravity,
 * OpenCode or Cline, and the project only gets its manifest, context and specs. `null` for any other text.
 */
export function expandWorkflow(text, { root, cli = OMNI_BIN } = {}) {
  const match = /^\s*\/(omni-[a-z-]+)(?:\s+([\s\S]*))?$/.exec(String(text ?? ''));
  const skill = match && OMNI_SKILLS.find(entry => entry.name === match[1]);
  if (!skill) return null;
  const installed = Boolean(root) && existsSync(join(root, 'specs', 'manifest.json'));
  const command = `node "${cli}"`;
  const studio = [
    `## Omni Studio: /${skill.name}`,
    `Omni Studio runs this workflow. Its OmniSpec CLI is: ${command} <command>. Use exactly that command wherever the workflow mentions specs/.omni/runtime/bin/omni-spec.mjs, a global plugin CLI or npx; never copy the runtime, templates or skills into the project.`,
    installed
      ? 'OmniSpec is already set up in this project (specs/manifest.json).'
      : `OmniSpec is not set up in this project yet. When the workflow needs it, run ${command} init --yes --agent studio: it writes only specs/manifest.json, specs/project-context.md, specs/README.md, specs/.gitignore and CONSTITUTION.md.`,
    'Shared memory is available through the omni MCP tools in every agent Studio drives; use them as the workflow says.',
    "Whenever the workflow tells you to ask the person (the host's native structured question tool), call the omni MCP tool omni_ask_user: Omni Studio shows it as a native question panel. Never write the questions as numbered lists in the chat.",
  ].join('\n');
  const request = match[2]?.trim();
  return `${studio}\n\n${skill.instructions}\nUser request: ${request || '(none: follow the workflow as written)'}\n`;
}

/**
 * The inverse of `expandWorkflow`, for histories read back from an agent's disk: the person sees `/omni-init`
 * or `/omni-specify texto`, as they typed it, not the whole workflow. Any other text is returned unchanged.
 */
export function collapseWorkflow(text) {
  const value = String(text ?? '').trimStart();
  if (!value.startsWith('## Omni Studio')) return value;
  // The name is on the first line, which survives agents that clip long messages in their logs.
  const name = /^## Omni Studio: \/(omni-[a-z-]+)/.exec(value)?.[1] ?? /\n# \/(omni-[a-z-]+)\n/.exec(value)?.[1];
  if (!name) return value;
  const request = /\nUser request: ([\s\S]*?)\s*$/.exec(value)?.[1]?.trim() ?? '';
  return request && !request.startsWith('(none:') ? `/${name} ${request}` : `/${name}`;
}

export function omniMcpServer() {
  return {
    command: process.execPath,
    args: [OMNI_BIN, 'mcp', '--studio'],
  };
}

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
  {
    id: 'antigravity',
    label: 'Antigravity',
    experimental: true,
    models: ANTIGRAVITY_MODELS,
    efforts: ANTIGRAVITY_EFFORTS,
    permissions: Object.freeze(Object.keys(ACP_PERMISSION_MODES)),
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    models: OPENCODE_MODELS,
    efforts: Object.freeze([]),
    permissions: Object.freeze(Object.keys(ACP_PERMISSION_MODES)),
  },
  {
    id: 'cline',
    label: 'Cline',
    models: CLINE_MODELS,
    efforts: Object.freeze([]),
    permissions: Object.freeze(Object.keys(ACP_PERMISSION_MODES)),
  },
]);

export function agentForModel(model) {
  if (!model) return null;
  if (['fable', 'opus', 'sonnet', 'haiku'].includes(model)) return 'claude';
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
  /** Pipe of the engine's question channel (ask-channel.mjs); without it agents get no omni_ask_user. */
  askChannel = null,
  createDriver = createClaudeDriver,
  createCodex = createCodexDriver,
  createAcp = createAcpDriver,
  locate = locateClaude,
  locateCodexImpl = locateCodex,
  locateAntigravityImpl = locateAntigravity,
  locateOpenCodeImpl = locateOpenCode,
  locateClineImpl = locateCline,
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
  /** Permission requests and questions waiting for an answer, so a reloaded window can still answer them. */
  const pendingAsks = new Map();
  /** Questions from omni_ask_user waiting for the person: how to send the answer back. */
  const waitingQuestions = new Map();
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

  const syncActiveWork = () => {
    if (!conversations || typeof conversations.setActiveWork !== 'function') return;
    try {
      const entries = allSlots()
        .map(entry => {
          const st = entry.driver.status();
          return {
            conversationId: entry.id,
            agent: entry.agent,
            sessionId: st.sessionId ?? entry.sessionId,
            title: labelOf(entry),
            state: st.state,
            files: [...entry.files],
          };
        })
        .filter(entry => entry.state !== 'idle' || entry.sessionId !== null || entry.files.length > 0);
      conversations.setActiveWork(entries);
    } catch (error) {
      log(`[studio-engine] active work not updated: ${error.message}`);
    }
  };

  /** @type {Map<string, {models?: string[], efforts?: string[]}>} */
  const dynamicModels = new Map();

  const baseMcp = omniMcpServer();
  // Each conversation's MCP server knows Studio's question channel and which conversation it belongs to.
  const mcpFor = slot =>
    askChannel ? { ...baseMcp, env: { [ASK_ENV]: askChannel, [CONVERSATION_ENV]: slot.id } } : baseMcp;
  const makeDriver = slot => {
    const mcp = mcpFor(slot);
    if (slot.agent === 'codex') {
      return createCodex({
        cwd: root,
        emit: event => onSlotEvent(slot, event),
        locate: locateCodexImpl,
        mcpServer: mcp,
        developerInstructions: OMNI_SESSION_PROMPT,
      });
    }
    if (slot.agent === 'antigravity' || slot.agent === 'opencode' || slot.agent === 'cline') {
      const label = AGENTS.find(entry => entry.id === slot.agent)?.label ?? slot.agent;
      const locateImpl =
        slot.agent === 'antigravity'
          ? locateAntigravityImpl
          : slot.agent === 'opencode'
            ? locateOpenCodeImpl
            : locateClineImpl;
      return createAcp({
        cwd: root,
        label,
        emit: event => onSlotEvent(slot, event),
        locate: locateImpl,
        mcpServer: mcp,
        systemPrompt: OMNI_SESSION_PROMPT,
      });
    }
    return createDriver({
      cwd: root,
      emit: event => onSlotEvent(slot, event),
      locate,
      mcpConfig: { mcpServers: { omni: mcp } },
      systemPrompt: OMNI_SESSION_PROMPT,
    });
  };

  const onSlotEvent = (slot, event) => {
    if (event.kind === 'title') {
      if (event.title) {
        slot.title = event.title;
        if (slot.sessionId) {
          index('renamed', store =>
            store.record({ agent: slot.agent, sessionId: slot.sessionId, title: event.title, titleSource: 'agent' }),
          );
        }
      }
      return;
    }
    if (event.kind === 'init') {
      if (Array.isArray(event.models) && event.models.length > 0) {
        dynamicModels.set(slot.agent, {
          models: event.models,
          efforts: Array.isArray(event.efforts) && event.efforts.length > 0 ? event.efforts : undefined,
        });
      }
      if (event.sessionId) {
        slot.sessionId = event.sessionId;
        bySession.set(event.sessionId, slot);
        if (!slot.title && slot.firstPrompt) slot.title = firstLine(slot.firstPrompt);
      }
    }
    if (event.kind === 'permission') {
      if (event.requestId) requestSlot.set(event.requestId, slot);
      const file = editedFile(root, event.toolName, event.input);
      if (file) {
        const other = allSlots().find(candidate => candidate !== slot && candidate.files.has(file));
        if (other) event = { ...event, conflictWith: labelOf(other), conflictFile: file };
      }
    }
    if (event.kind === 'permission_resolved' && event.requestId) {
      requestSlot.delete(event.requestId);
      pendingAsks.delete(event.requestId);
    }
    if (event.kind === 'permission' && event.requestId) pendingAsks.set(event.requestId, { slot, event });
    // A turn that ended or a process that stopped has nothing left to approve.
    if (event.kind === 'result' || (event.kind === 'status' && event.state !== 'busy' && event.state !== 'starting'))
      for (const [id, ask] of pendingAsks) if (ask.slot === slot) pendingAsks.delete(id);

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
    if (event.kind === 'status' || event.kind === 'init' || event.kind === 'tool' || event.kind === 'result') {
      syncActiveWork();
    }
  };

  const isIdle = slot => {
    const state = slot.driver.status().state;
    return state !== 'busy' && state !== 'starting';
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
      const [claudeLoc, codexLoc, agyLoc, openCodeLoc, clineLoc] = await Promise.all([
        locate(),
        locateCodexImpl ? locateCodexImpl() : locateCodex(),
        locateAntigravityImpl ? locateAntigravityImpl() : locateAntigravity(),
        locateOpenCodeImpl ? locateOpenCodeImpl() : locateOpenCode(),
        locateClineImpl ? locateClineImpl() : locateCline(),
      ]);
      const locations = {
        claude: claudeLoc,
        codex: codexLoc,
        antigravity: agyLoc,
        opencode: openCodeLoc,
        cline: clineLoc,
      };
      // Asking about a conversation never creates it: a new conversation gets its slot on its first prompt.
      const slot = slots.get(conversationId) ?? bySession.get(conversationId) ?? null;
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
        active: slot?.agent ?? 'claude',
        agents: AGENTS.map(agent => {
          const dyn = dynamicModels.get(agent.id);
          return {
            ...agent,
            ...(dyn?.models ? { models: dyn.models } : {}),
            ...(dyn?.efforts ? { efforts: dyn.efforts } : {}),
            available: Boolean(locations[agent.id]),
            path: locations[agent.id]?.path ?? null,
          };
        }),
        ...(slot ? slot.driver.status() : { state: 'idle', model: null, sessionId: null }),
        workflows: OMNI_WORKFLOWS,
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
      // The person sees what they typed; the agent gets the whole OmniSpec workflow.
      return slot.driver.prompt(expandWorkflow(text, { root }) ?? text, { model, effort, permission });
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
      const recorded = conversations?.list({ includeArchived: true })?.find(entry => entry.sessionId === sessionId);
      let resolvedAgent = agent ?? recorded?.agent ?? null;
      let history;
      if (resolvedAgent === 'codex') {
        history = await readCodex({ root, sessionId });
      } else if (resolvedAgent === 'antigravity' || resolvedAgent === 'opencode' || resolvedAgent === 'cline') {
        const locateImpl =
          resolvedAgent === 'antigravity'
            ? locateAntigravityImpl
            : resolvedAgent === 'opencode'
              ? locateOpenCodeImpl
              : locateClineImpl;
        history = await readAcpSession({ root, sessionId, locate: locateImpl });
        if ((!history.title || history.title === sessionId) && recorded?.title) {
          history = { ...history, title: recorded.title, titleSource: recorded.titleSource };
        }
      } else if (resolvedAgent === 'claude') {
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
            const acpHistory = await readAcpSession({ root, sessionId, locate: locateAntigravityImpl });
            if (acpHistory.events.length > 0) {
              history = acpHistory;
              resolvedAgent = 'antigravity';
            } else {
              throw error;
            }
          }
        }
      }
      // The slot that already holds this session keeps it (no restart, a running turn goes on). Otherwise the
      // conversation gets its own slot: resuming never takes over the slot of another conversation, so the next
      // prompt cannot land in the wrong session.
      let slot = bySession.get(sessionId);
      if (!slot) {
        const wanted = conversationId ?? sessionId;
        const taken = slots.get(wanted);
        const free = !taken || ((!taken.sessionId || taken.sessionId === sessionId) && isIdle(taken));
        slot = slotFor(free ? wanted : sessionId, resolvedAgent);
      }
      if (slot.agent !== resolvedAgent && isIdle(slot)) {
        slot.driver.dispose();
        slot.agent = resolvedAgent;
        slot.driver = makeDriver(slot);
      }
      slot.sessionId = sessionId;
      slot.title = history.title || slot.title;
      bySession.set(sessionId, slot);
      for (const event of history.events ?? []) {
        if (event.kind === 'tool') {
          const file = editedFile(root, event.name, event.input);
          if (file) slot.files.add(file);
        }
      }
      if (isIdle(slot) && slot.driver.status().sessionId !== sessionId) {
        slot.driver.resume(sessionId, { costUsd: history.costUsd });
      }
      index('recorded', store =>
        store.record({
          agent: resolvedAgent,
          sessionId,
          title: collapseWorkflow(history.title),
          titleSource: history.titleSource,
        }),
      );
      syncActiveWork();
      const events = (history.events ?? []).map(event =>
        event.kind === 'user' ? { ...event, text: collapseWorkflow(event.text) } : event,
      );
      // What is still waiting for the person's answer is not in the agent's history on disk.
      for (const [reqId, ask] of pendingAsks.entries()) {
        const matches =
          ask.slot === slot ||
          ask.slot?.id === slot?.id ||
          (sessionId && ask.slot?.sessionId === sessionId) ||
          (conversationId && (ask.slot?.id === conversationId || ask.slot?.sessionId === conversationId));
        if (matches) {
          ask.slot = slot;
          const waiting = waitingQuestions.get(reqId);
          if (waiting) waiting.slot = slot;
          events.push(ask.event);
        }
      }
      return { ...history, events, agent: resolvedAgent, conversationId: slot.id, state: slot.driver.status().state };
    },
    /**
     * An agent asks the person through omni_ask_user (ask-channel.mjs): the chat shows a question panel and
     * `answer` sends the choice back. A closed connection (cancelled turn) withdraws the question.
     */
    ask({ conversationId, questions }, { reply, onClose }) {
      const slot = slots.get(conversationId) ?? bySession.get(conversationId);
      if (!slot) return reply({ error: 'Omni Studio no tiene abierta esa conversación.' });
      const requestId = `ask-${randomUUID()}`;
      const event = { kind: 'question', requestId, questions };
      waitingQuestions.set(requestId, { slot, reply });
      pendingAsks.set(requestId, { slot, event });
      sendFor(slot, event);
      onClose(() => {
        if (!waitingQuestions.has(requestId)) return;
        waitingQuestions.delete(requestId);
        pendingAsks.delete(requestId);
        sendFor(slot, { kind: 'question_resolved', requestId, cancelled: true });
      });
      return undefined;
    },
    /** The person's answer to a question: one entry per question, the chosen labels or their own text. */
    answer({ requestId, answers }) {
      const entry = waitingQuestions.get(requestId);
      if (!entry) throw new StudioError('QUESTION_UNKNOWN', 'Esa pregunta ya no está pendiente.');
      waitingQuestions.delete(requestId);
      pendingAsks.delete(requestId);
      entry.reply({ answers });
      sendFor(entry.slot, { kind: 'question_resolved', requestId, answers });
      return { answered: true };
    },
    /** True while the conversation of `sessionId` is running a turn. */
    isBusy(sessionId) {
      const slot = bySession.get(sessionId);
      return Boolean(slot) && !isIdle(slot);
    },
    /** A conversation deleted from Studio: its CLI process stops and its slot goes away. */
    forget({ sessionId }) {
      const slot = bySession.get(sessionId);
      if (!slot) return { forgotten: false };
      bySession.delete(sessionId);
      for (const [id, entry] of slots) if (entry === slot && id !== 'default') slots.delete(id);
      if (slots.get('default') === slot) {
        slot.sessionId = null;
        slot.firstPrompt = null;
        slot.title = '';
        slot.files.clear();
        slot.driver.reset();
      } else slot.driver.dispose();
      syncActiveWork();
      return { forgotten: true };
    },
    reset({ conversationId = 'default' } = {}) {
      const slot = slotFor(conversationId);
      if (slot.sessionId) bySession.delete(slot.sessionId);
      slot.sessionId = null;
      slot.firstPrompt = null;
      slot.title = '';
      slot.files.clear();
      const res = slot.driver.reset();
      syncActiveWork();
      return res;
    },
    dispose() {
      for (const slot of allSlots()) slot.driver.dispose();
    },
  };
}
