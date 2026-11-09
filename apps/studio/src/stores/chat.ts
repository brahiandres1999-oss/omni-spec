/**
 * Agent chat (docs/STUDIO-AGENT-COCKPIT.md): the conversation with the agent of one project. The engine streams
 * provider-independent `agent.event`s; `applyAgentEvent` folds them into the transcript shown by ChatView.
 */
import { createStore } from 'zustand/vanilla';
import { type StudioClient, StudioError } from '@/ipc/client';
import { messages } from '@/i18n/messages.es';
import { rootKey, sameRoot } from './conversations';
import { isPermissionLevel, type PermissionLevel, readSettings } from './settings';
import { readJson, writeJson } from './storage';

export type AgentState = 'idle' | 'starting' | 'ready' | 'busy';

export type ToolInput = Record<string, unknown> | null;

export type ChatItem =
  | { type: 'user'; id: string; text: string }
  | { type: 'text'; id: string; text: string }
  | {
      type: 'tool';
      id: string;
      name: string;
      title: string;
      input: ToolInput;
      status: 'running' | 'done' | 'error';
      output: string | null;
    }
  | {
      type: 'permission';
      id: string;
      toolName: string;
      title: string;
      input: ToolInput;
      reason: string | null;
      conflictWith?: string | null;
      conflictFile?: string | null;
      status: 'pending' | 'allow' | 'deny';
    }
  | {
      type: 'question';
      id: string;
      questions: AgentQuestion[];
      status: 'pending' | 'answered' | 'cancelled';
      answers: QuestionAnswer[] | null;
    }
  | { type: 'result'; id: string; isError: boolean; durationMs: number | null; costUsd: number | null }
  | { type: 'error'; id: string; code: string; message: string }
  | { type: 'notice'; id: string; text: string };

/** One question an agent asks through omni_ask_user (src/mcp-server.mjs), shown as a panel in the chat. */
export interface AgentQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: Array<{ label: string; description: string }>;
}

/** What the person answered: the chosen labels (joined with «, » when several) or their own text. */
export interface QuestionAnswer {
  question: string;
  answer: string;
}

const isQuestions = (value: unknown): value is AgentQuestion[] =>
  Array.isArray(value) &&
  value.every(
    entry =>
      !!entry &&
      typeof entry === 'object' &&
      typeof (entry as AgentQuestion).question === 'string' &&
      Array.isArray((entry as AgentQuestion).options),
  );
const isAnswers = (value: unknown): value is QuestionAnswer[] =>
  Array.isArray(value) && value.every(entry => !!entry && typeof (entry as QuestionAnswer).answer === 'string');

/** Payload of `agent.event` (see src/studio/agents/claude.mjs). */
export interface AgentEvent {
  kind: string;
  root?: string;
  [key: string]: unknown;
}

/** What the user picked for the next turns; `null` keeps the CLI's own default. */
export interface AgentOptions {
  agent?: string | null;
  model: string | null;
  effort: string | null;
}

/** Provider rate-limit window (e.g. Codex 5h and weekly limits). */
export interface RateLimitWindow {
  window: string;
  usedPercent: number;
  resetsAt?: string | null;
}

/** A message waiting for the agent to finish its turn (Q17): visible, editable and cancelable. */
export interface QueuedMessage {
  id: string;
  text: string;
}

/** Context and cost after the last turn, as the CLI reported them. */
export interface AgentUsage {
  contextTokens: number | null;
  contextWindow: number | null;
  /** Cost of the whole conversation; with a subscription it is a list-price estimate, not a charge. */
  costUsd: number;
  costBasis: string | null;
}

const OPTIONS_KEY = 'chat.options';
const isOptions = (value: unknown): value is AgentOptions => {
  const entry = value as Partial<AgentOptions> | null;
  return (
    !!entry &&
    (entry.agent === undefined || entry.agent === null || typeof entry.agent === 'string') &&
    (entry.model === null || typeof entry.model === 'string') &&
    (entry.effort === null || typeof entry.effort === 'string')
  );
};
const isRateLimits = (value: unknown): value is RateLimitWindow[] =>
  Array.isArray(value) &&
  value.every(
    entry =>
      !!entry &&
      typeof entry === 'object' &&
      typeof (entry as RateLimitWindow).window === 'string' &&
      typeof (entry as RateLimitWindow).usedPercent === 'number',
  );
const EMPTY_USAGE: AgentUsage = { contextTokens: null, contextWindow: null, costUsd: 0, costBasis: null };

// The last slash commands the agent reported, so the «/» list works before the first message starts it.
const COMMANDS_KEY = 'chat.commands';
const isCommands = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(entry => typeof entry === 'string');

/** One Claude Code session of the folder, as `agent.sessions` lists it («Retomar sesión de la terminal…»). */
export interface AgentSession {
  id: string;
  title: string;
  updatedAt: string;
}

/** What `agent.resume` returns: the history as agent events, plus the context and cost recorded. */
interface ResumedConversation {
  sessionId: string;
  events: AgentEvent[];
  truncated: boolean;
  contextTokens: number | null;
  costUsd: number | null;
}

export interface AgentStatus {
  workspace: { mode: 'project' | 'studio'; dir: string };
  active: string;
  agents: Array<{
    id: string;
    label: string;
    experimental?: boolean;
    available: boolean;
    path: string | null;
    models: string[];
    efforts: string[];
    /** Studio permission levels this agent has (Q25). */
    permissions?: string[];
  }>;
  state: AgentState;
  model: string | null;
  sessionId: string | null;
  /** Model, effort and permission level the running CLI was started with. */
  options?: AgentOptions & { permission?: string };
  /** Rate-limit windows reported by the agent (e.g. Codex 5h / weekly). */
  rateLimits?: RateLimitWindow[];
  /** OmniSpec workflows Studio runs with any agent (`/omni-specify …`). */
  workflows?: Array<{ name: string; description: string }>;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const input = (value: unknown): ToolInput =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${++sequence}`;

/**
 * Engine slot of a conversation that has no CLI session yet. Unique per window load, so a new conversation
 * never lands in the slot of another one (the engine keeps slots alive across a reload of the window).
 */
const newConversationId = () =>
  `new-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;

const RESUMABLE_AGENTS = ['claude', 'codex', 'antigravity', 'opencode', 'cline'] as const;
type ResumableAgent = (typeof RESUMABLE_AGENTS)[number];
const isResumableAgent = (value: unknown): value is ResumableAgent =>
  typeof value === 'string' && (RESUMABLE_AGENTS as readonly string[]).includes(value);

/** Model, effort and permission level each conversation runs with, so reopening it keeps them. */
const PREFS_KEY = 'chat.conversationPrefs';
interface ConversationPrefs {
  agent: string | null;
  model: string | null;
  effort: string | null;
  permission: PermissionLevel;
}
const isPrefsMap = (value: unknown): value is Record<string, ConversationPrefs> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value).every(entry => !!entry && typeof entry === 'object' && isPermissionLevel(entry.permission));
const MAX_PREFS = 200;

/** The conversation last on screen in each project, so a reload (F5) or a restart reopens it. */
const LAST_KEY = 'chat.last';
const isLastMap = (value: unknown): value is Record<string, string> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value).every(entry => typeof entry === 'string');

/** Folds one engine event into the transcript. Pure, so the reducer is tested without a store. */
export function applyAgentEvent(items: readonly ChatItem[], event: AgentEvent): ChatItem[] {
  switch (event.kind) {
    case 'text': {
      const key = `text:${str(event.key)}`;
      const index = items.findIndex(item => item.id === key);
      if (index === -1) return [...items, { type: 'text', id: key, text: str(event.delta) }];
      const current = items[index] as Extract<ChatItem, { type: 'text' }>;
      const next = [...items];
      next[index] = { ...current, text: current.text + str(event.delta) };
      return next;
    }
    case 'tool':
      return [
        ...items,
        {
          type: 'tool',
          id: `tool:${str(event.id)}`,
          name: str(event.name),
          title: str(event.title) || str(event.name),
          input: input(event.input),
          status: 'running',
          output: null,
        },
      ];
    case 'tool_result':
      return items.map(item =>
        item.type === 'tool' && item.id === `tool:${str(event.toolUseId)}`
          ? { ...item, status: event.isError ? 'error' : 'done', output: str(event.output) }
          : item,
      );
    case 'permission':
      return [
        ...items,
        {
          type: 'permission',
          id: str(event.requestId),
          toolName: str(event.toolName),
          title: str(event.title),
          input: input(event.input),
          reason: str(event.reason) || null,
          conflictWith: str(event.conflictWith) || null,
          conflictFile: str(event.conflictFile) || null,
          status: 'pending',
        },
      ];
    case 'permission_resolved':
      return items.map(item =>
        item.type === 'permission' && item.id === str(event.requestId)
          ? { ...item, status: event.decision === 'allow' ? 'allow' : 'deny' }
          : item,
      );
    case 'question':
      if (!isQuestions(event.questions) || items.some(item => item.id === str(event.requestId))) return [...items];
      return [
        ...items,
        { type: 'question', id: str(event.requestId), questions: event.questions, status: 'pending', answers: null },
      ];
    case 'question_resolved':
      return items.map(item =>
        item.type === 'question' && item.id === str(event.requestId)
          ? {
              ...item,
              status: event.cancelled ? 'cancelled' : 'answered',
              answers: isAnswers(event.answers) ? event.answers : item.answers,
            }
          : item,
      );
    case 'result':
      return [
        ...items.map(item =>
          item.type === 'tool' && item.status === 'running' ? { ...item, status: 'done' as const } : item,
        ),
        {
          type: 'result',
          id: nextId('result'),
          isError: event.isError === true,
          durationMs: num(event.durationMs),
          costUsd: num(event.costUsd),
        },
      ];
    case 'error':
      return [...items, { type: 'error', id: nextId('error'), code: str(event.code), message: str(event.message) }];
    case 'notice':
      return [...items, { type: 'notice', id: nextId('notice'), text: str(event.text) }];
    case 'user':
      // Only in the history of a resumed conversation; live prompts are added by `send`.
      return [...items, { type: 'user', id: nextId('user'), text: str(event.text) }];
    default:
      return [...items];
  }
}

export interface ThreadSnapshot {
  conversationId: string;
  agent: string;
  sessionId: string | null;
  items: ChatItem[];
  agentState: AgentState;
  model: string | null;
  applied: AgentOptions | null;
  usage: AgentUsage;
  permission: PermissionLevel;
  queue: QueuedMessage[];
  draft: string;
}

export interface ChatState {
  /** Engine slot id of the conversation on screen (`'default'` for the first conversation). */
  conversationId: string;
  /** Conversations kept alive in this project while viewing another one. */
  threads: Record<string, ThreadSnapshot>;
  items: ChatItem[];
  agentState: AgentState;
  model: string | null;
  status: AgentStatus | null;
  draft: string;
  error: StudioError | null;
  /** Model and effort for the next message. */
  options: AgentOptions;
  /** Model and effort the conversation runs with; `options` differ from it until the next message. */
  applied: AgentOptions | null;
  usage: AgentUsage;
  /** Rate-limit windows reported by the agent (e.g. Codex 5 h and weekly). */
  rateLimits: RateLimitWindow[];
  /** Id of the CLI session on screen; `null` before the first message of a new conversation. */
  sessionId: string | null;
  /** Permission level of this conversation (Q25); a new conversation starts with the one set in Ajustes. */
  permission: PermissionLevel;
  /** Messages written while the agent works; the first one is sent when the turn ends. */
  queue: QueuedMessage[];
  /** Slash commands and skills the agent accepts, without the slash (the composer's «/» list). */
  commands: string[];
  /** The conversation on screen is being read from disk (the view already switched to it). */
  loading: boolean;
  setOptions(patch: Partial<AgentOptions>): void;
  setPermission(permission: PermissionLevel): void;
  loadStatus(): Promise<void>;
  /** Shows an earlier conversation at once; the next message continues it. `agent` skips guessing the CLI. */
  resume(sessionId: string, agent?: string): Promise<void>;
  /** The conversation was deleted: if it is on screen, a new one takes its place. */
  forget(sessionId: string): void;
  setDraft(draft: string): void;
  /** Sends the message, or queues it while the agent works. */
  send(text?: string): Promise<void>;
  /** Ctrl+Enter: stops the running turn and sends this message first. */
  interrupt(text?: string): Promise<void>;
  /** Drops a queued message. */
  unqueue(id: string): void;
  /** Takes a queued message back into the composer to change it. */
  editQueued(id: string): void;
  cancel(): Promise<void>;
  decide(requestId: string, decision: 'allow' | 'deny'): Promise<void>;
  /** Sends the person's answers to a question the agent asked. */
  answer(requestId: string, answers: QuestionAnswer[]): Promise<void>;
  /** A new, empty conversation (the one on screen keeps running in the background). */
  reset(): Promise<void>;
}

/**
 * @param projectId Root of the project this conversation belongs to: events of another project's engine (a
 *   switch in flight) are ignored.
 */
export function createChatStore(client: StudioClient, { projectId }: { projectId: string }) {
  return createStore<ChatState>()((set, get) => {
    let attached = false;
    // Subscribed on first use, so stores of views that never open the chat hold no listener.
    const attach = () => {
      if (attached) return;
      attached = true;
      client.subscribe('agent.event', onEvent);
    };

    const snapshotOf = (state: ChatState): ThreadSnapshot => ({
      conversationId: state.conversationId,
      agent: state.options.agent ?? state.status?.active ?? 'claude',
      sessionId: state.sessionId,
      items: state.items,
      agentState: state.agentState,
      model: state.model,
      applied: state.applied,
      usage: state.usage,
      permission: state.permission,
      queue: state.queue,
      draft: state.draft,
    });

    const saveCurrentThread = (state: ChatState): Record<string, ThreadSnapshot> => {
      if (!state.sessionId && state.items.length === 0 && state.agentState === 'idle') return state.threads;
      const snap = snapshotOf(state);
      const next = { ...state.threads, [state.conversationId]: snap };
      if (state.sessionId) next[state.sessionId] = snap;
      return next;
    };

    const applyToThread = (thread: ThreadSnapshot, event: AgentEvent): ThreadSnapshot => {
      if (event.kind === 'status') {
        return { ...thread, agentState: str(event.state) as AgentState };
      }
      if (event.kind === 'init') {
        return {
          ...thread,
          model: str(event.model) || thread.model,
          sessionId: str(event.sessionId) || thread.sessionId,
          items: applyAgentEvent(thread.items, event),
        };
      }
      if (event.kind === 'result') {
        const usage = thread.usage;
        return {
          ...thread,
          usage: {
            contextTokens: num(event.contextTokens) ?? usage.contextTokens,
            contextWindow: num(event.contextWindow) ?? usage.contextWindow,
            costUsd: num(event.sessionCostUsd) ?? usage.costUsd + (num(event.costUsd) ?? 0),
            costBasis: str(event.costBasis) || usage.costBasis,
          },
          items: applyAgentEvent(thread.items, event),
        };
      }
      return { ...thread, items: applyAgentEvent(thread.items, event) };
    };

    const onEvent = (payload: unknown) => {
      const event = payload as unknown as AgentEvent;
      if (event.root && projectId !== 'default' && !sameRoot(event.root, projectId)) return;
      if (event.kind === 'conversations') return;

      if (event.kind === 'rate_limits') {
        if (isRateLimits(event.windows)) set({ rateLimits: event.windows });
        return;
      }

      const current = get();
      const eventConv = str(event.conversationId);
      const eventSession = str(event.sessionId);
      const targetsCurrent =
        (!eventConv && !eventSession) ||
        (eventSession && current.sessionId === eventSession) ||
        (eventConv && current.conversationId === eventConv);

      if (!targetsCurrent) {
        const key = eventSession || eventConv;
        const existing = current.threads[key] ?? current.threads[eventConv] ?? current.threads[eventSession];
        if (!existing) return;
        const updated = applyToThread(existing, event);
        const threads = { ...current.threads, [updated.conversationId]: updated };
        if (updated.sessionId) threads[updated.sessionId] = updated;
        set({ threads });
        return;
      }

      if (event.kind === 'status') {
        const state = str(event.state) as AgentState;
        const was = get().agentState;
        set({ agentState: state });
        // The turn ended: the first queued message goes out. A process that died keeps the queue for the user.
        if (was === 'busy' && state === 'ready') sendNext();
        return;
      }
      if (event.kind === 'init') {
        const nextSession = str(event.sessionId) || get().sessionId;
        const currentStatus = get().status;
        const eventAgent = str(event.agent) || currentStatus?.active || 'claude';
        const dynamicModels = isCommands(event.models) ? event.models : null;
        const dynamicEfforts = isCommands(event.efforts) ? event.efforts : null;
        const nextStatus = currentStatus
          ? {
              ...currentStatus,
              active: eventAgent,
              agents:
                dynamicModels || dynamicEfforts
                  ? currentStatus.agents.map(entry =>
                      entry.id === eventAgent
                        ? {
                            ...entry,
                            ...(dynamicModels ? { models: dynamicModels } : {}),
                            ...(dynamicEfforts ? { efforts: dynamicEfforts } : {}),
                          }
                        : entry,
                    )
                  : currentStatus.agents,
            }
          : currentStatus;
        set({ model: str(event.model) || null, sessionId: nextSession, status: nextStatus });
        if (nextSession) {
          rememberLast(nextSession);
          rememberPrefs();
        }
        if (isCommands(event.commands) && event.commands.length > 0) {
          set({ commands: withWorkflows(event.commands) });
          writeJson(COMMANDS_KEY, event.commands);
        }
      }
      if (event.kind === 'result') {
        const usage = get().usage;
        set({
          usage: {
            contextTokens: num(event.contextTokens) ?? usage.contextTokens,
            contextWindow: num(event.contextWindow) ?? usage.contextWindow,
            // The driver sends the conversation total; a driver that only knows the turn cost adds up.
            costUsd: num(event.sessionCostUsd) ?? usage.costUsd + (num(event.costUsd) ?? 0),
            costBasis: str(event.costBasis) || usage.costBasis,
          },
        });
      }
      if (event.kind === 'question') {
        const curSession = get().sessionId;
        if (curSession) {
          rememberLast(curSession);
          rememberPrefs();
        }
      }
      set({ items: applyAgentEvent(get().items, event) });
    };

    const fail = (reason: unknown) => set({ error: StudioError.from(reason) });
    const sendNext = () => {
      const [next, ...rest] = get().queue;
      if (!next) return;
      set({ queue: rest });
      void get().send(next.text);
    };
    const busyNow = () => get().agentState === 'busy' || get().agentState === 'starting';
    const convParam = () => ({ conversationId: get().conversationId });
    // Studio's own `/omni-…` workflows come first in the «/» list, whatever agent is behind the chat.
    let workflows: string[] = [];
    const withWorkflows = (commands: readonly string[]) => [...new Set([...workflows, ...commands])];

    // Every switch takes a ticket; an answer for an older ticket only fills the cache (a fast click elsewhere wins).
    let switchTicket = 0;
    const rememberLast = (sessionId: string | null) => {
      if (projectId === 'default') return;
      const map = readJson<Record<string, string>>(LAST_KEY, {}, isLastMap);
      const key = rootKey(projectId);
      if (sessionId) map[key] = sessionId;
      else delete map[key];
      writeJson(LAST_KEY, map);
    };
    const readPrefs = (sessionId: string): ConversationPrefs | null =>
      readJson<Record<string, ConversationPrefs>>(PREFS_KEY, {}, isPrefsMap)[sessionId] ?? null;
    const rememberPrefs = () => {
      const { sessionId, applied, permission } = get();
      if (!sessionId || !applied) return;
      const map = readJson<Record<string, ConversationPrefs>>(PREFS_KEY, {}, isPrefsMap);
      delete map[sessionId];
      map[sessionId] = { agent: applied.agent ?? null, model: applied.model, effort: applied.effort, permission };
      const keys = Object.keys(map);
      for (const old of keys.slice(0, Math.max(0, keys.length - MAX_PREFS))) delete map[old];
      writeJson(PREFS_KEY, map);
    };
    const readLast = () =>
      projectId === 'default'
        ? null
        : (readJson<Record<string, string>>(LAST_KEY, {}, isLastMap)[rootKey(projectId)] ?? null);
    const blank = () => ({
      items: [] as ChatItem[],
      agentState: 'idle' as AgentState,
      model: null,
      applied: null,
      error: null,
      usage: EMPTY_USAGE,
      queue: [] as QueuedMessage[],
      draft: '',
      loading: false,
      permission: readSettings().defaultPermission,
    });

    return {
      conversationId: newConversationId(),
      threads: {},
      items: [],
      agentState: 'idle',
      model: null,
      status: null,
      draft: '',
      error: null,
      options: readJson<AgentOptions>(OPTIONS_KEY, { agent: null, model: null, effort: null }, isOptions),
      applied: null,
      usage: EMPTY_USAGE,
      rateLimits: [],
      sessionId: null,
      permission: readSettings().defaultPermission,
      queue: [],
      commands: readJson<string[]>(COMMANDS_KEY, [], isCommands),
      loading: false,
      setPermission(permission) {
        if (!isPermissionLevel(permission)) return;
        set({ permission });
        rememberPrefs();
      },
      setOptions(patch) {
        const options = { ...get().options, ...patch };
        set({ options });
        writeJson(OPTIONS_KEY, options);
      },
      async loadStatus() {
        attach();
        try {
          const status = (await client.call('agent.status', convParam())) as AgentStatus;
          if (Array.isArray(status.workflows)) {
            workflows = status.workflows.map(entry => entry.name).filter(name => typeof name === 'string');
            set({ commands: withWorkflows(get().commands) });
          }
          const mine = !status.sessionId || !get().sessionId || status.sessionId === get().sessionId;
          set({
            status,
            ...(mine
              ? {
                  agentState: status.state,
                  model: status.model ?? get().model,
                  applied: status.model && isOptions(status.options) ? status.options : get().applied,
                }
              : {}),
            rateLimits: isRateLimits(status.rateLimits) ? status.rateLimits : get().rateLimits,
          });
          // After a reload (F5) the window starts empty: reopen the conversation that was on screen, unless the
          // person already opened or started another one meanwhile.
          const { sessionId, items, loading } = get();
          const last = readLast();
          const toResume = last || (status.sessionId ? status.sessionId : null);
          if (toResume && !sessionId && items.length === 0 && !loading) void get().resume(toResume);
        } catch (reason) {
          fail(reason);
        }
      },
      async resume(sessionId, agent) {
        attach();
        const now = get();
        if (sessionId === now.sessionId && (now.items.length > 0 || now.loading)) return;
        const ticket = ++switchTicket;
        const threads = saveCurrentThread(now);
        const live = threads[sessionId];
        const agentParam = isResumableAgent(agent) ? { agent } : {};
        rememberLast(sessionId);
        if (live) {
          set({
            threads,
            conversationId: live.conversationId,
            sessionId: live.sessionId ?? sessionId,
            items: live.items,
            agentState: live.agentState,
            model: live.model,
            applied: live.applied,
            usage: live.usage,
            permission: live.permission,
            queue: live.queue,
            draft: live.draft,
            error: null,
            loading: false,
          });
          // Cheap: the engine keeps that slot; asking again re-binds it after an engine restart.
          void client
            .call('agent.resume', { conversationId: live.conversationId, sessionId, ...agentParam })
            .catch(() => undefined);
          return;
        }
        // Switch the view now; the history fills in when the disk read answers.
        const prefs = readPrefs(sessionId);
        set({
          threads,
          ...blank(),
          conversationId: sessionId,
          sessionId,
          loading: true,
          applied: prefs
            ? { agent: prefs.agent ?? agent ?? null, model: prefs.model, effort: prefs.effort }
            : isResumableAgent(agent)
              ? { agent, model: null, effort: null }
              : null,
          ...(prefs ? { permission: prefs.permission } : {}),
        });
        try {
          const history = (await client.call('agent.resume', {
            conversationId: sessionId,
            sessionId,
            ...agentParam,
          })) as ResumedConversation & { agent?: string; conversationId?: string; state?: AgentState };
          let items: ChatItem[] = [];
          for (const event of history.events ?? []) items = applyAgentEvent(items, event);
          const running = history.state === 'busy' || history.state === 'starting';
          // A tool without a recorded result was cut short, unless the turn is still running.
          if (!running)
            items = items.map(item =>
              item.type === 'tool' && item.status === 'running' ? { ...item, status: 'done' } : item,
            );
          if (history.truncated)
            items.unshift({ type: 'notice', id: nextId('notice'), text: messages.chat.olderHidden });
          const resumedAgent = typeof history.agent === 'string' && history.agent ? history.agent : null;
          const thread: ThreadSnapshot = {
            conversationId: history.conversationId || sessionId,
            agent: resumedAgent ?? 'claude',
            sessionId,
            items,
            agentState: history.state ?? 'idle',
            model: null,
            applied: prefs
              ? { agent: resumedAgent ?? prefs.agent, model: prefs.model, effort: prefs.effort }
              : resumedAgent
                ? { agent: resumedAgent, model: null, effort: null }
                : null,
            usage: { ...EMPTY_USAGE, contextTokens: history.contextTokens, costUsd: history.costUsd ?? 0 },
            permission: prefs?.permission ?? readSettings().defaultPermission,
            queue: [],
            draft: '',
          };
          if (ticket !== switchTicket) {
            // The person already moved on: keep it so coming back is instant.
            set({ threads: { ...get().threads, [sessionId]: thread, [thread.conversationId]: thread } });
            return;
          }
          // Output that streamed in while the history was read stays after it.
          const streamed = get().items.filter(item => item.type !== 'user');
          set({
            conversationId: thread.conversationId,
            items: [...items, ...streamed],
            agentState: get().agentState === 'idle' ? thread.agentState : get().agentState,
            applied: thread.applied,
            usage: thread.usage,
            permission: thread.permission,
            loading: false,
          });
        } catch (reason) {
          if (ticket !== switchTicket) return;
          set({ loading: false });
          // A conversation that no longer exists must not reopen on every reload.
          if (readLast() === sessionId) rememberLast(null);
          fail(reason);
        }
      },
      forget(sessionId) {
        const dropped = get().threads[sessionId];
        const threads = Object.fromEntries(
          Object.entries(get().threads).filter(([key, thread]) => key !== sessionId && thread !== dropped),
        );
        set({ threads });
        if (readLast() === sessionId) rememberLast(null);
        if (get().sessionId === sessionId) void get().reset();
      },
      setDraft: draft => set({ draft }),
      async send(text = get().draft) {
        attach();
        const message = text.trim();
        if (!message) return;
        if (busyNow()) {
          set({ queue: [...get().queue, { id: nextId('queued'), text: message }], draft: '' });
          return;
        }
        const beforeState = get();
        const wasLocked = beforeState.sessionId !== null || beforeState.items.length > 0;
        const lockedAgent = wasLocked ? beforeState.applied?.agent : null;
        const activeAgent = lockedAgent ?? beforeState.options.agent ?? null;
        const agentEntry = beforeState.status?.agents.find(a => a.id === (activeAgent ?? 'claude'));
        const rawModel = beforeState.options.model;
        const modelValid =
          !rawModel ||
          !agentEntry?.models ||
          agentEntry.models.length === 0 ||
          agentEntry.models.includes(rawModel) ||
          ((activeAgent ?? 'claude') === 'claude' && ['fable', 'opus', 'sonnet', 'haiku'].includes(rawModel));
        const model = modelValid ? rawModel : null;
        const rawEffort = beforeState.options.effort;
        const effortValid =
          !rawEffort ||
          !agentEntry?.efforts ||
          agentEntry.efforts.length === 0 ||
          agentEntry.efforts.includes(rawEffort);
        const effort = effortValid ? rawEffort : null;
        set({
          items: [...beforeState.items, { type: 'user', id: nextId('user'), text: message }],
          draft: '',
          error: null,
          agentState: 'starting',
        });
        try {
          await client.call('agent.prompt', {
            ...convParam(),
            ...(activeAgent && activeAgent !== 'claude'
              ? { agent: activeAgent as 'codex' | 'antigravity' | 'opencode' | 'cline' }
              : {}),
            text: message,
            ...(model ? { model } : {}),
            ...(effort ? { effort: effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } : {}),
            permission: get().permission,
          });
          set({ applied: { agent: activeAgent, model, effort } });
          rememberPrefs();
        } catch (reason) {
          set({ items: beforeState.items, agentState: 'idle', draft: message });
          fail(reason);
        }
      },
      async interrupt(text = get().draft) {
        const message = text.trim();
        if (!busyNow()) return get().send(message);
        if (message) set({ queue: [{ id: nextId('queued'), text: message }, ...get().queue], draft: '' });
        await get().cancel();
      },
      unqueue: id => set({ queue: get().queue.filter(entry => entry.id !== id) }),
      editQueued(id) {
        const entry = get().queue.find(item => item.id === id);
        if (!entry) return;
        const draft = get().draft.trim();
        set({
          queue: get().queue.filter(item => item.id !== id),
          draft: draft ? `${entry.text}\n${draft}` : entry.text,
        });
      },
      async cancel() {
        try {
          await client.call('agent.cancel', convParam());
        } catch (reason) {
          fail(reason);
        }
      },
      async decide(requestId, decision) {
        try {
          await client.call('agent.permission', { ...convParam(), requestId, decision });
        } catch (reason) {
          fail(reason);
        }
      },
      async answer(requestId, answers) {
        // Shown as answered at once; the engine's question_resolved confirms it.
        set({ items: applyAgentEvent(get().items, { kind: 'question_resolved', requestId, answers }) });
        try {
          await client.call('agent.answer', { requestId, answers });
        } catch (reason) {
          fail(reason);
        }
      },
      async reset() {
        ++switchTicket;
        const threads = saveCurrentThread(get());
        rememberLast(null);
        // A fresh slot: the conversation on screen keeps its own (and keeps running if it is working).
        set({ threads, ...blank(), conversationId: newConversationId(), sessionId: null });
      },
    };
  });
}

export type ChatStore = ReturnType<typeof createChatStore>;
