/**
 * Studio's conversations of every project in the rail (docs/STUDIO-AGENT-COCKPIT.md, Fase 3, vuelta 1). The
 * engine of the open project reads its own memory and, read-only, the memory of the others; the list
 * reloads when the engine says its index changed (`agent.event` of kind `conversations`).
 */
import { createStore } from 'zustand/vanilla';
import type { StudioClient } from '@/ipc/client';
import { messages } from '@/i18n/messages.es';
import { readSettings } from './settings';

export type ConversationActivity = 'busy' | 'permission' | 'unread';

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

export const activityKey = (root: string, sessionId: string) => `${rootKey(root)}:${sessionId}`;

const folderName = (root: string) => root.split(/[\\/]/).filter(Boolean).pop() ?? root;

function notifyDesktop(title: string, body: string) {
  const Ctor = (globalThis as { Notification?: typeof Notification }).Notification;
  if (typeof Ctor !== 'function') return;
  try {
    new Ctor(title, { body });
  } catch {
    // guardian-allow G-SLOP-12: desktop notifications are optional when WebView2 or OS blocks them
  }
}

export interface ConversationsState {
  /** Conversations by `rootKey`, archived ones included (the rail decides what to show). */
  byRoot: Record<string, ConversationSummary[]>;
  /** Live state dot per conversation (`rootKey:sessionId`), across every project (Fase 3, vuelta 3). */
  activity: Record<string, ConversationActivity>;
  activeView: { root: string; sessionId: string | null };
  status: 'idle' | 'loading' | 'ready' | 'error';
  load(roots: readonly string[]): Promise<void>;
  setActiveView(root: string, sessionId: string | null): void;
  rename(root: string, conversation: ConversationSummary, title: string): Promise<void>;
  setArchived(root: string, conversation: ConversationSummary, archived: boolean): Promise<void>;
  /** Deletes it from Studio and from the agent's history on this computer; throws when that fails. */
  remove(root: string, conversation: ConversationSummary): Promise<void>;
}

export function createConversationsStore(client: StudioClient) {
  return createStore<ConversationsState>()((set, get) => {
    let roots: readonly string[] = [];
    let subscribed = false;
    const convToSession = new Map<string, string>();
    const reload = () => get().load(roots);

    const ensureSubscribed = () => {
      if (subscribed) return;
      subscribed = true;
      client.subscribe('agent.event', payload => {
        const event = (payload ?? {}) as Record<string, unknown>;
        if (event.kind === 'conversations') {
          void reload();
          return;
        }
        const root = typeof event.root === 'string' && event.root ? event.root : get().activeView.root;
        if (!root) return;
        const convId = typeof event.conversationId === 'string' ? event.conversationId : '';
        const rawSession = typeof event.sessionId === 'string' ? event.sessionId : '';
        if (convId && rawSession) convToSession.set(`${rootKey(root)}:${convId}`, rawSession);
        const sessionId = rawSession || (convId ? (convToSession.get(`${rootKey(root)}:${convId}`) ?? '') : '');
        if (!sessionId) return;

        const key = activityKey(root, sessionId);
        const { activeView } = get();
        const isViewing =
          !document.hidden &&
          Boolean(activeView.root) &&
          sameRoot(activeView.root, root) &&
          activeView.sessionId === sessionId;
        const titleOf = () =>
          (get().byRoot[rootKey(root)] ?? []).find(entry => entry.sessionId === sessionId)?.title ?? sessionId;

        if (event.kind === 'status') {
          const state = String(event.state ?? '');
          if (state === 'busy' || state === 'starting') {
            set({ activity: { ...get().activity, [key]: 'busy' } });
          } else if (state === 'idle' && get().activity[key] !== 'unread') {
            const { [key]: _drop, ...rest } = get().activity;
            set({ activity: rest });
          }
          return;
        }
        if (event.kind === 'permission' || event.kind === 'question') {
          set({ activity: { ...get().activity, [key]: 'permission' } });
          if (!isViewing && readSettings().notifyApproval) {
            const detail = typeof event.title === 'string' && event.title ? `${titleOf()} — ${event.title}` : titleOf();
            notifyDesktop(messages.chat.notifyPermissionTitle(folderName(root)), detail);
          }
          return;
        }
        if (event.kind === 'permission_resolved' || event.kind === 'question_resolved') {
          set({ activity: { ...get().activity, [key]: 'busy' } });
          return;
        }
        if (event.kind === 'result') {
          if (isViewing) {
            const { [key]: _drop, ...rest } = get().activity;
            set({ activity: rest });
          } else {
            set({ activity: { ...get().activity, [key]: 'unread' } });
            if (readSettings().notifyDone) {
              notifyDesktop(messages.chat.notifyDoneTitle(folderName(root)), titleOf());
            }
          }
        }
      });
    };

    return {
      byRoot: {},
      activity: {},
      activeView: { root: '', sessionId: null },
      status: 'idle',
      setActiveView(root, sessionId) {
        ensureSubscribed();
        const nextActivity = { ...get().activity };
        if (root && sessionId) {
          const key = activityKey(root, sessionId);
          if (nextActivity[key] === 'unread') delete nextActivity[key];
        }
        set({ activeView: { root, sessionId }, activity: nextActivity });
      },
      async load(next) {
        roots = next;
        ensureSubscribed();
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
      async remove(root, conversation) {
        // Only once the engine confirms: deleting the agent's history can fail (a file held open), and then the
        // conversation must stay where it was.
        await client.call('conversations.delete', {
          root,
          agent: conversation.agent,
          sessionId: conversation.sessionId,
        });
        const key = rootKey(root);
        const byRoot = { ...get().byRoot };
        byRoot[key] = (byRoot[key] ?? []).filter(entry => entry.sessionId !== conversation.sessionId);
        const { [activityKey(root, conversation.sessionId)]: _gone, ...activity } = get().activity;
        set({ byRoot, activity });
        await reload();
      },
    };
  });
}

export type ConversationsStore = ReturnType<typeof createConversationsStore>;
