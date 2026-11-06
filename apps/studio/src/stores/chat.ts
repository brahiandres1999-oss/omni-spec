/**
 * Agent chat (docs/STUDIO-AGENT-COCKPIT.md): the conversation with the agent of one project. The engine streams
 * provider-independent `agent.event`s; `applyAgentEvent` folds them into the transcript shown by ChatView.
 */
import { createStore } from 'zustand/vanilla';
import { type StudioClient, StudioError } from '@/ipc/client';

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

export interface AgentStatus {
  workspace: { mode: 'project' | 'studio'; dir: string };
  active: string;
  agents: Array<{ id: string; label: string; available: boolean; path: string | null }>;
  state: AgentState;
  model: string | null;
  sessionId: string | null;
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
    default:
      return [...items];
  }
}

export interface ChatState {
  items: ChatItem[];
  agentState: AgentState;
  model: string | null;
  status: AgentStatus | null;
  draft: string;
  error: StudioError | null;
  loadStatus(): Promise<void>;
  setDraft(draft: string): void;
  send(text?: string): Promise<void>;
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
    const onEvent = (payload: unknown) => {
      const event = payload as unknown as AgentEvent;
      if (event.root && projectId !== 'default' && event.root !== projectId) return;
      if (event.kind === 'status') {
        const state = str(event.state) as AgentState;
        set({ agentState: state });
        return;
      }
      if (event.kind === 'init') set({ model: str(event.model) || null });
      set({ items: applyAgentEvent(get().items, event) });
    };

    const fail = (reason: unknown) => set({ error: StudioError.from(reason) });

    return {
      items: [],
      agentState: 'idle',
      model: null,
      status: null,
      draft: '',
      error: null,
      async loadStatus() {
        attach();
        try {
          const status = (await client.call('agent.status', {})) as AgentStatus;
          set({ status, agentState: status.state, model: status.model ?? get().model });
        } catch (reason) {
          fail(reason);
        }
      },
      setDraft: draft => set({ draft }),
      async send(text = get().draft) {
        attach();
        const message = text.trim();
        if (!message || get().agentState === 'busy' || get().agentState === 'starting') return;
        set({
          items: [...get().items, { type: 'user', id: nextId('user'), text: message }],
          draft: '',
          error: null,
          agentState: 'starting',
        });
        try {
          await client.call('agent.prompt', { text: message });
        } catch (reason) {
          set({ agentState: 'idle', draft: message });
          fail(reason);
        }
      },
      async cancel() {
        try {
          await client.call('agent.cancel', {});
        } catch (reason) {
          fail(reason);
        }
      },
      async decide(requestId, decision) {
        try {
          await client.call('agent.permission', { requestId, decision });
        } catch (reason) {
          fail(reason);
        }
      },
      async reset() {
        try {
          await client.call('agent.reset', {});
          set({ items: [], model: null, error: null });
        } catch (reason) {
          fail(reason);
        }
      },
    };
  });
}

export type ChatStore = ReturnType<typeof createChatStore>;
