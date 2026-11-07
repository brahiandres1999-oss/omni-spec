/**
 * Agent chat (docs/STUDIO-AGENT-COCKPIT.md): the conversation with the agent of one project. The engine streams
 * provider-independent `agent.event`s; `applyAgentEvent` folds them into the transcript shown by ChatView.
 */
import { createStore } from 'zustand/vanilla';
import { type StudioClient, StudioError } from '@/ipc/client';
import { messages } from '@/i18n/messages.es';
import { sameRoot } from './conversations';
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
  | { type: 'result'; id: string; isError: boolean; durationMs: number | null; costUsd: number | null }
  | { type: 'error'; id: string; code: string; message: string }
  | { type: 'notice'; id: string; text: string };

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
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const input = (value: unknown): ToolInput =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${++sequence}`;

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
  setOptions(patch: Partial<AgentOptions>): void;
  setPermission(permission: PermissionLevel): void;
  loadStatus(): Promise<void>;
  /** Shows an earlier conversation; the next message continues it. */
  resume(sessionId: string): Promise<void>;
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
        set({ model: str(event.model) || null, sessionId: nextSession });
        if (isCommands(event.commands) && event.commands.length > 0) {
          set({ commands: event.commands });
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
    const convParam = () => {
      const id = get().conversationId;
      return id !== 'default' ? { conversationId: id } : {};
    };

    return {
      conversationId: 'default',
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
      setPermission(permission) {
        if (isPermissionLevel(permission)) set({ permission });
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
          set({
            status,
            agentState: status.state,
            model: status.model ?? get().model,
            applied: status.model && isOptions(status.options) ? status.options : get().applied,
            sessionId: status.sessionId ?? get().sessionId,
            rateLimits: isRateLimits(status.rateLimits) ? status.rateLimits : get().rateLimits,
          });
        } catch (reason) {
          fail(reason);
        }
      },
      async resume(sessionId) {
        attach();
        if (sessionId === get().sessionId) return;
        const threads = saveCurrentThread(get());
        const live = threads[sessionId];
        if (
          live &&
          (live.agentState === 'busy' ||
            live.agentState === 'starting' ||
            live.items.some(item => item.type === 'permission' && item.status === 'pending'))
        ) {
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
          });
          return;
        }
        try {
          const history = (await client.call('agent.resume', { sessionId })) as ResumedConversation;
          let items: ChatItem[] = [];
          for (const event of history.events ?? []) items = applyAgentEvent(items, event);
          // A tool without a recorded result was cut short; it is not running any more.
          items = items.map(item =>
            item.type === 'tool' && item.status === 'running' ? { ...item, status: 'done' } : item,
          );
          if (history.truncated)
            items.unshift({ type: 'notice', id: nextId('notice'), text: messages.chat.olderHidden });
          const nextConvId = live?.conversationId ?? (busyNow() ? sessionId : get().conversationId);
          set({
            threads,
            conversationId: nextConvId,
            items: live && live.items.length > items.length ? live.items : items,
            sessionId,
            model: live?.model ?? null,
            applied: live?.applied ?? null,
            error: null,
            agentState: live?.agentState ?? 'idle',
            usage: live?.usage ?? {
              ...EMPTY_USAGE,
              contextTokens: history.contextTokens,
              costUsd: history.costUsd ?? 0,
            },
            queue: live?.queue ?? [],
            permission: live?.permission ?? readSettings().defaultPermission,
          });
        } catch (reason) {
          fail(reason);
        }
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
        set({
          items: [...get().items, { type: 'user', id: nextId('user'), text: message }],
          draft: '',
          error: null,
          agentState: 'starting',
        });
        try {
          const { agent, model, effort } = get().options;
          await client.call('agent.prompt', {
            ...convParam(),
            ...(agent && agent !== 'claude' ? { agent: agent as 'codex' } : {}),
            text: message,
            ...(model ? { model } : {}),
            ...(effort ? { effort: effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } : {}),
            permission: get().permission,
          });
          set({ applied: { agent: agent ?? null, model, effort } });
        } catch (reason) {
          set({ agentState: 'idle', draft: message });
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
      async reset() {
        // When a conversation is working, starting a new one keeps it running in the background (Fase 3, vuelta 3).
        if (busyNow()) {
          const threads = saveCurrentThread(get());
          set({
            threads,
            conversationId: nextId('conv'),
            items: [],
            agentState: 'idle',
            model: null,
            applied: null,
            error: null,
            usage: EMPTY_USAGE,
            sessionId: null,
            queue: [],
            draft: '',
            permission: readSettings().defaultPermission,
          });
          return;
        }
        try {
          await client.call('agent.reset', convParam());
          set({
            items: [],
            model: null,
            applied: null,
            error: null,
            usage: EMPTY_USAGE,
            sessionId: null,
            queue: [],
            permission: readSettings().defaultPermission,
          });
        } catch (reason) {
          fail(reason);
        }
      },
    };
  });
}

export type ChatStore = ReturnType<typeof createChatStore>;
