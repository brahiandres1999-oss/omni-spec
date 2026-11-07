/**
 * Studio's conversations of every project in the rail (docs/STUDIO-AGENT-COCKPIT.md, Fase 3, vuelta 1). The
 * engine of the open project reads its own memory and, read-only, the memory of the others; the list
 * reloads when the engine says its index changed (`agent.event` of kind `conversations`).
 */
import { createStore } from 'zustand/vanilla';
import type { StudioClient } from '@/ipc/client';

export interface ConversationSummary {
  agent: string;
  sessionId: string;
  title: string;
  titleSource: 'prompt' | 'agent' | 'user';
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

/** Same folder whatever the case or slashes (Windows). */
export const rootKey = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
export const sameRoot = (a: string, b: string) => rootKey(a) === rootKey(b);

export interface ConversationsState {
  /** Conversations by `rootKey`, archived ones included (the rail decides what to show). */
  byRoot: Record<string, ConversationSummary[]>;
  status: 'idle' | 'loading' | 'ready' | 'error';
  load(roots: readonly string[]): Promise<void>;
  rename(root: string, conversation: ConversationSummary, title: string): Promise<void>;
  setArchived(root: string, conversation: ConversationSummary, archived: boolean): Promise<void>;
}

export function createConversationsStore(client: StudioClient) {
  return createStore<ConversationsState>()((set, get) => {
    let roots: readonly string[] = [];
    let subscribed = false;
    const reload = () => get().load(roots);

    return {
      byRoot: {},
      status: 'idle',
      async load(next) {
        roots = next;
        if (!subscribed) {
          subscribed = true;
          client.subscribe('agent.event', payload => {
            if ((payload as { kind?: unknown })?.kind === 'conversations') void reload();
          });
        }
        if (roots.length === 0) return;
        if (get().status === 'idle') set({ status: 'loading' });
        try {
          const result = (await client.call('conversations.list', { roots: [...roots], includeArchived: true })) as {
            projects?: Array<{ root: string; conversations: ConversationSummary[] }>;
          };
          const byRoot: Record<string, ConversationSummary[]> = {};
          for (const project of result?.projects ?? []) byRoot[rootKey(project.root)] = project.conversations ?? [];
          set({ byRoot, status: 'ready' });
        } catch {
          // The engine may be switching project; the rail keeps what it had and reloads on the next change.
          if (get().status !== 'ready') set({ status: 'error' });
        }
      },
      async rename(root, conversation, title) {
        const clean = title.trim();
        if (!clean || clean === conversation.title) return;
        await client.call('conversations.rename', {
          root,
          agent: conversation.agent,
          sessionId: conversation.sessionId,
          title: clean,
        });
        await reload();
      },
      async setArchived(root, conversation, archived) {
        await client.call('conversations.archive', {
          root,
          agent: conversation.agent,
          sessionId: conversation.sessionId,
          archived,
        });
        await reload();
      },
    };
  });
}

export type ConversationsStore = ReturnType<typeof createConversationsStore>;
