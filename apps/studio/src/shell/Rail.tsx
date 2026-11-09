/**
 * Left rail (docs/STUDIO-AGENT-COCKPIT.md, Fase 3, vuelta 1): `Nueva conversación` (Ctrl+N), a search over
 * the conversations of every project, and the tree Proyectos → Conversaciones, then `Ajustes`.
 *  - Projects are the user's list (recent.json): `+ carpeta` adds one, «Quitar de la lista» drops one.
 *    Clicking another project opens it; the chevron only folds it.
 *  - Conversations are Studio's own index (conversations.list). One click opens one, in its project; a
 *    double click renames it; the ⋮ menu renames or archives. Archived ones show on demand.
 *  - Specs no longer live here: they are in the palette (Ctrl+K) and, from vuelta 2, on their own page.
 */
import { Dialog, DropdownMenu } from 'radix-ui';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { useEnsureLoaded, useStudio } from '@/app/studio-context';
import { Button } from '@/components/ui/button';
import {
  Archive,
  ArchiveRestore,
  Brain,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  Gauge,
  History,
  Icon,
  KanbanSquare,
  type LucideIcon,
  MessageSquarePlus,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from '@/components/ui/icon';
import { cn, focusRing, press } from '@/components/ui/interaction';
import { StudioError } from '@/ipc/client';
import type { RecentProject } from '@/ipc/types';
import { formatAgo, messages } from '@/i18n/messages.es';
import {
  activityKey,
  type ConversationActivity,
  type ConversationSummary,
  rootKey,
  sameRoot,
} from '@/stores/conversations';
import type { StageTab } from '@/stores/layout';
import { readJson, writeJson } from '@/stores/storage';
import { TerminalSessionsDialog } from './TerminalSessionsDialog';
import { projectName } from './TitleBar';

const t = messages.shell;
const heading = 'px-2 text-[11px] font-semibold tracking-wide text-fg-muted uppercase';
/** Conversations shown per project before «Ver N más». */
const FIRST = 6;
const EXPANDED_KEY = 'rail.expanded';
const isFlags = (value: unknown): value is Record<string, boolean> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const menuContent = 'z-50 min-w-48 rounded-xl border border-floating-border bg-floating p-1';
const menuItem = cn(
  'flex min-h-8 cursor-default select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-fg outline-none',
  'data-[highlighted]:bg-divider data-[disabled]:opacity-45',
);
const rowButton = (active: boolean) =>
  cn(
    'flex h-7 w-full min-w-0 items-center gap-2 rounded-md text-start text-xs',
    active ? 'bg-floating text-fg' : 'text-fg-muted hover:bg-divider hover:text-fg',
    'disabled:opacity-45',
    press,
    focusRing,
  );
/** Row actions appear on hover or keyboard focus, and stay while their menu is open. */
const hoverActions = cn(
  'absolute end-1 top-0.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-150',
  'focus-within:opacity-100 has-[[data-state=open]]:opacity-100',
);
const smallIcon = cn(
  'grid size-6 place-items-center rounded-md text-fg-muted hover:bg-divider hover:text-fg data-[state=open]:bg-divider',
  press,
  focusRing,
);

/** Pages of the project, opened in the center (Fase 3, Q11). */
const PAGES: ReadonlyArray<{ tab: StageTab; icon: LucideIcon }> = [
  { tab: 'kanban', icon: KanbanSquare },
  { tab: 'memory', icon: Brain },
  { tab: 'finops', icon: Gauge },
];

function Pages() {
  const { layout } = useStudio();
  const current = useStore(layout, state => state.stageTab);
  return (
    <ul aria-label={t.pages} className="flex flex-col gap-0.5">
      {PAGES.map(page => (
        <li key={page.tab}>
          <button
            type="button"
            aria-current={current === page.tab ? 'page' : undefined}
            onClick={() => layout.getState().setStageTab(page.tab)}
            className={cn(rowButton(current === page.tab), 'ps-2.5 pe-2')}
          >
            <Icon icon={page.icon} className={current === page.tab ? 'text-accent' : undefined} />
            {t.tabs[page.tab]}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Accent- and case-insensitive text for the search. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Opening a conversation or starting one, in its project: another project is opened first. */
function useRailActions() {
  const { project, projectId, layout, ui, dispatch } = useStudio();
  const isOpen = (root: string) => projectId !== null && sameRoot(root, projectId);
  return {
    isOpen,
    open(root: string, sessionId: string, agent?: string) {
      layout.getState().setStageTab('chat');
      if (isOpen(root)) {
        void project.chat.getState().resume(sessionId, agent);
        return;
      }
      ui.getState().setPendingConversation({ root, sessionId, agent });
      dispatch({ type: 'project.open', path: root });
    },
    start(root: string) {
      if (isOpen(root)) {
        dispatch({ type: 'conversation.new' });
        return;
      }
      layout.getState().setStageTab('chat');
      dispatch({ type: 'project.open', path: root });
    },
  };
}

function RenameField({ title, onDone }: { title: string; onDone(next: string | null): void }) {
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: the field appears because the person asked to rename; typing goes there
      autoFocus
      aria-label={t.renameLabel}
      defaultValue={title}
      onFocus={event => event.currentTarget.select()}
      onKeyDown={event => {
        if (event.key === 'Enter') onDone(event.currentTarget.value);
        else if (event.key === 'Escape') onDone(null);
        else return;
        event.preventDefault();
      }}
      onBlur={event => onDone(event.currentTarget.value)}
      className={cn(
        'h-7 w-full rounded-md border border-accent/60 bg-canvas px-2 text-xs text-fg outline-none',
        focusRing,
      )}
    />
  );
}

function ActivityDot({ activity }: { activity: ConversationActivity | undefined }) {
  if (!activity) return null;
  const label = t.activity[activity] ?? activity;
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      data-activity={activity}
      className={cn(
        'size-2 shrink-0 rounded-full',
        activity === 'busy' && 'bg-accent motion-safe:animate-pulse',
        activity === 'permission' && 'bg-breach',
        activity === 'unread' && 'bg-attested',
      )}
    />
  );
}

function ConversationRow({
  root,
  conversation,
  active,
  project,
}: {
  root: string;
  conversation: ConversationSummary;
  active: boolean;
  /** Shown in search results, where conversations of every project mix. */
  project?: string;
}) {
  const { conversations, project: openProject } = useStudio();
  const actions = useRailActions();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const activity = useStore(conversations, state => state.activity[activityKey(root, conversation.sessionId)]);

  if (editing)
    return (
      <li>
        <RenameField
          title={conversation.title}
          onDone={next => {
            setEditing(false);
            if (next !== null) void conversations.getState().rename(root, conversation, next);
          }}
        />
      </li>
    );

  return (
    <li className="group/conversation relative">
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        title={conversation.title}
        onClick={() => actions.open(root, conversation.sessionId, conversation.agent)}
        onDoubleClick={() => setEditing(true)}
        className={cn(rowButton(active), 'ps-2.5 pe-8', conversation.archived && 'opacity-60')}
      >
        <ActivityDot activity={activity} />
        <span className="min-w-0 flex-1 truncate">
          {conversation.title}
          {project ? <span className="ms-1.5 text-[10px] text-fg-muted">· {project}</span> : null}
        </span>
        {conversation.archived ? <span className="shrink-0 text-[10px] text-fg-muted">{t.archived}</span> : null}
        <span className="shrink-0 text-[10px] text-fg-muted tabular-nums group-focus-within/conversation:invisible group-hover/conversation:invisible">
          {formatAgo(conversation.updatedAt)}
        </span>
      </button>
      <div className={cn(hoverActions, 'group-hover/conversation:opacity-100')}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger aria-label={t.conversationOptions(conversation.title)} className={smallIcon}>
            <Icon icon={Ellipsis} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className={menuContent}>
              <DropdownMenu.Item className={menuItem} onSelect={() => setEditing(true)}>
                <Icon icon={Pencil} className="text-fg-muted" />
                {t.rename}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={menuItem}
                onSelect={() => void conversations.getState().setArchived(root, conversation, !conversation.archived)}
              >
                <Icon icon={conversation.archived ? ArchiveRestore : Archive} className="text-fg-muted" />
                {conversation.archived ? t.unarchive : t.archive}
              </DropdownMenu.Item>
              <DropdownMenu.Item className={cn(menuItem, 'text-breach')} onSelect={() => setConfirming(true)}>
                <Icon icon={Trash2} />
                {t.deleteConversation}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <DeleteConversationDialog
        open={confirming}
        conversation={conversation}
        busy={activity === 'busy' || activity === 'permission'}
        onOpenChange={setConfirming}
        onConfirm={async () => {
          await conversations.getState().remove(root, conversation);
          if (actions.isOpen(root)) openProject.chat.getState().forget(conversation.sessionId);
          setConfirming(false);
        }}
      />
    </li>
  );
}

const AGENT_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
  opencode: 'OpenCode',
  cline: 'Cline',
};
/** Agents whose history is one database shared by every conversation: Studio cannot delete just one. */
const SHARED_HISTORY = new Set(['opencode', 'cline']);

function DeleteConversationDialog({
  open,
  conversation,
  busy,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  conversation: ConversationSummary;
  busy: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agent = AGENT_NAMES[conversation.agent] ?? conversation.agent;
  const confirm = async () => {
    setWorking(true);
    setError(null);
    try {
      await onConfirm();
    } catch (reason) {
      setError(StudioError.from(reason).message);
    } finally {
      setWorking(false);
    }
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={next => {
        if (!working) {
          setError(null);
          onOpenChange(next);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/60" />
        <Dialog.Content className="fixed start-1/2 top-[22vh] z-50 grid w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 gap-3 rounded-2xl border border-floating-border bg-floating p-4 text-fg">
          <Dialog.Title className="text-sm font-medium">{t.deleteTitle}</Dialog.Title>
          <Dialog.Description className="text-xs text-pretty text-fg">
            {t.deleteBody(conversation.title, agent)}
          </Dialog.Description>
          <ul className="grid list-disc gap-1 ps-4 text-xs text-pretty text-fg-muted">
            <li>{SHARED_HISTORY.has(conversation.agent) ? t.deleteShared(agent) : t.deleteRecoverable}</li>
            <li>{t.deleteKeepsChanges}</li>
          </ul>
          {busy ? <p className="text-xs text-breach">{t.deleteBusy}</p> : null}
          {error ? (
            <p role="alert" className="text-xs text-breach">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost" disabled={working}>
                {t.cancel}
              </Button>
            </Dialog.Close>
            <Button variant="danger" disabled={busy || working} onClick={() => void confirm()}>
              {working ? t.deleting : t.deleteConfirm}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProjectNode({
  entry,
  expanded,
  onExpanded,
}: {
  entry: RecentProject;
  expanded: boolean;
  onExpanded(expanded: boolean): void;
}) {
  const { conversations, project, client, recent, dispatch } = useStudio();
  const actions = useRailActions();
  const open = actions.isOpen(entry.path);
  const list = useStore(conversations, state => state.byRoot[rootKey(entry.path)]) ?? [];
  const currentSession = useStore(project.chat, state => state.sessionId);
  const [showArchived, setShowArchived] = useState(false);
  const [all, setAll] = useState(false);
  const [terminal, setTerminal] = useState(false);

  const visible = list.filter(conversation => showArchived || !conversation.archived);
  const shown = all ? visible : visible.slice(0, FIRST);

  return (
    <li data-project={entry.path} className="flex flex-col gap-0.5">
      <div className="group/project relative flex items-center">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? t.collapseProject(entry.name) : t.expandProject(entry.name)}
          onClick={() => onExpanded(!expanded)}
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-divider',
            press,
            focusRing,
          )}
        >
          <Icon icon={expanded ? ChevronDown : ChevronRight} />
        </button>
        <button
          type="button"
          aria-current={open ? 'true' : undefined}
          disabled={entry.missing}
          title={entry.path}
          onClick={() => {
            if (open) onExpanded(!expanded);
            else {
              onExpanded(true);
              dispatch({ type: 'project.open', path: entry.path });
            }
          }}
          className={cn(rowButton(false), 'ps-1 pe-14', open && 'text-fg')}
        >
          <Icon icon={open ? FolderOpen : Folder} className={open ? 'text-accent' : undefined} />
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
          {entry.missing ? <span className="text-[10px]">{t.missing}</span> : null}
        </button>
        <div className={cn(hoverActions, 'group-hover/project:opacity-100')}>
          <button
            type="button"
            aria-label={t.newConversationIn(entry.name)}
            title={t.newConversationIn(entry.name)}
            disabled={entry.missing}
            onClick={() => actions.start(entry.path)}
            className={cn(smallIcon, 'disabled:opacity-45')}
          >
            <Icon icon={Plus} />
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger aria-label={t.projectOptions(entry.name)} className={smallIcon}>
              <Icon icon={Ellipsis} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={4} className={menuContent}>
                {open ? (
                  <DropdownMenu.Item className={menuItem} onSelect={() => setTerminal(true)}>
                    <Icon icon={History} className="text-fg-muted" />
                    {t.resumeFromTerminal}
                  </DropdownMenu.Item>
                ) : null}
                <DropdownMenu.Item
                  className={menuItem}
                  onSelect={() => {
                    setShowArchived(value => !value);
                    onExpanded(true);
                  }}
                >
                  <Icon icon={Archive} className="text-fg-muted" />
                  {showArchived ? t.hideArchived : t.showArchived}
                </DropdownMenu.Item>
                {open ? null : (
                  <DropdownMenu.Item
                    className={menuItem}
                    onSelect={() =>
                      void client
                        .call('recent.remove', { path: entry.path })
                        .then(() => recent.getState().refresh())
                        .catch(() => undefined)
                    }
                  >
                    <Icon icon={X} className="text-fg-muted" />
                    {t.removeProject}
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
      {expanded ? (
        <ul className="ms-3.5 flex flex-col gap-0.5 border-s border-divider ps-1.5">
          {shown.length === 0 ? (
            <li className="px-2.5 py-1 text-[11px] text-fg-muted">{t.noConversationsYet}</li>
          ) : null}
          {shown.map(conversation => (
            <ConversationRow
              key={`${conversation.agent}:${conversation.sessionId}`}
              root={entry.path}
              conversation={conversation}
              active={open && conversation.sessionId === currentSession}
            />
          ))}
          {visible.length > FIRST ? (
            <li>
              <button
                type="button"
                onClick={() => setAll(value => !value)}
                className={cn('rounded-md px-2.5 py-0.5 text-[11px] text-fg-muted hover:text-fg', press, focusRing)}
              >
                {all ? t.fewerConversations : t.moreConversations(visible.length - FIRST)}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {terminal ? (
        <TerminalSessionsDialog
          open={terminal}
          onOpenChange={setTerminal}
          indexed={new Set(list.map(conversation => conversation.sessionId))}
        />
      ) : null}
    </li>
  );
}

export function Rail() {
  const { snapshot, recent, dispatch, client, conversations, project, projectId } = useStudio();
  useEnsureLoaded(snapshot);
  useEnsureLoaded(recent);
  const current = useStore(snapshot, state => state.data);
  const recentList = useStore(recent, state => state.data);
  const byRoot = useStore(conversations, state => state.byRoot);
  const currentSession = useStore(project.chat, state => state.sessionId);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(() => readJson<Record<string, boolean>>(EXPANDED_KEY, {}, isFlags));

  const projects: RecentProject[] = [...(recentList ?? [])];
  if (current && !projects.some(entry => sameRoot(entry.path, current.root)))
    projects.unshift({ path: current.root, name: projectName(current.root), missing: false });

  const roots = JSON.stringify(projects.map(entry => entry.path));
  // biome-ignore lint/correctness/useExhaustiveDependencies: projectId is the trigger — a new engine (another project) must be asked again even when the list is the same
  useEffect(() => {
    void conversations.getState().load(JSON.parse(roots) as string[]);
  }, [conversations, roots, projectId]);

  const isExpanded = (path: string) => expanded[rootKey(path)] ?? (projectId !== null && sameRoot(path, projectId));
  const setProjectExpanded = (path: string, value: boolean) => {
    const next = { ...expanded, [rootKey(path)]: value };
    setExpanded(next);
    writeJson(EXPANDED_KEY, next);
  };

  const needle = fold(query.trim());
  const results = needle
    ? projects.flatMap(entry =>
        (byRoot[rootKey(entry.path)] ?? [])
          .filter(conversation => !conversation.archived && fold(conversation.title).includes(needle))
          .map(conversation => ({ entry, conversation })),
      )
    : null;

  const addProject = async () => {
    const path = (await client.call('project.pick', {}).catch(() => null)) as string | null;
    if (path) dispatch({ type: 'project.open', path });
  };

  return (
    <nav
      aria-label={t.rail}
      data-surface="panel"
      className="flex min-h-0 flex-col gap-2.5 border-e border-divider bg-surface px-2 pt-3 pb-2"
    >
      <Button
        variant="primary"
        icon={MessageSquarePlus}
        title={t.newConversationShortcut}
        onClick={() => dispatch({ type: 'conversation.new' })}
        className="w-full"
      >
        {t.newConversation}
      </Button>
      <label className="flex h-8 items-center gap-2 rounded-lg border border-divider bg-canvas px-2.5 text-xs text-fg-muted focus-within:border-fg-muted/40">
        <Icon icon={Search} />
        <input
          type="search"
          aria-label={t.searchConversations}
          placeholder={t.searchConversations}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') setQuery('');
          }}
          className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-muted"
        />
      </label>
      <Pages />
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain">
        {results ? (
          <section aria-label={t.searchConversations}>
            {results.length === 0 ? (
              <p className="px-2 py-2 text-xs text-fg-muted">{t.noSearchResults}</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {results.map(({ entry, conversation }) => (
                  <ConversationRow
                    key={`${entry.path}:${conversation.sessionId}`}
                    root={entry.path}
                    conversation={conversation}
                    project={entry.name}
                    active={
                      projectId !== null && sameRoot(entry.path, projectId) && conversation.sessionId === currentSession
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        ) : (
          <section aria-labelledby="rail-projects" className="flex flex-col gap-1">
            <div className="flex items-center justify-between pe-1">
              <h2 id="rail-projects" className={heading}>
                {t.projects}
              </h2>
              <button
                type="button"
                aria-label={t.addProject}
                title={t.addProject}
                onClick={() => void addProject()}
                className={smallIcon}
              >
                <Icon icon={FolderPlus} />
              </button>
            </div>
            <ul className="flex flex-col gap-1">
              {projects.map(entry => (
                <ProjectNode
                  key={entry.path}
                  entry={entry}
                  expanded={isExpanded(entry.path)}
                  onExpanded={value => setProjectExpanded(entry.path, value)}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
      <Button
        variant="ghost"
        icon={Settings}
        onClick={() => dispatch({ type: 'settings.open' })}
        className="w-full justify-start"
      >
        {t.settings}
      </Button>
    </nav>
  );
}
