/**
 * «Resumen» panel (docs/STUDIO-AGENT-COCKPIT.md, Fase 3 Q14; SH-03, SH-12, SH-13): Revisión of this
 * conversation (its files with their diff, and Impacto), Archivos (the tree, or «Cambios de git» of the whole
 * repo) and Terminal. It starts closed and never opens by itself: Ctrl+J or the button at the end of the top row.
 */
import { useVirtualizer } from '@tanstack/react-virtual';
import { type KeyboardEvent, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useEnsureLoaded, useRefreshOn, useStudio } from '@/app/studio-context';
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, Icon } from '@/components/ui/icon';
import { InspectorDrawer } from '@/components/ui/inspector-drawer';
import { cn, focusRingInset, mono } from '@/components/ui/interaction';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ErrorState, rowHeightClass, SkeletonRow } from '@/components/ui/view-state';
import { rowHeights } from '@/design/tokens';
import { messages } from '@/i18n/messages.es';
import { flattenTree } from '@/stores/files';
import { ConversationReview } from '@/views/ConversationReview';
import { DiffView } from '@/views/DiffView';
import { TerminalPanel } from './TerminalPanel';

export function Inspector() {
  const { layout } = useStudio();
  const collapsed = useStore(layout, state => state.inspectorCollapsed);
  const tab = useStore(layout, state => state.inspectorTab);
  const labels = messages.shell.inspectorTabs;
  return (
    <InspectorDrawer
      collapsed={collapsed}
      tab={tab}
      onTabChange={value => layout.getState().setInspectorTab(value)}
      panels={[
        { value: 'review', label: labels.review, content: <ConversationReview /> },
        { value: 'files', label: labels.files, content: <FilesPanel /> },
        {
          value: 'terminal',
          label: labels.terminal,
          content: <TerminalPanel visible={tab === 'terminal' && !collapsed} />,
          keepMounted: true,
        },
      ]}
    />
  );
}

/** Archivos: the project tree, or «Cambios de git», the diff of the whole working tree. */
function FilesPanel() {
  const { ui, snapshot } = useStudio();
  const view = useStore(ui, state => state.filesView);
  const spec = useStore(snapshot, state => state.data?.activeSpec?.id ?? '');
  return (
    <Tabs
      value={view}
      onValueChange={value => ui.getState().setFilesView(value as 'tree' | 'git')}
      className="flex h-full min-h-0 flex-col"
    >
      <TabsList aria-label={messages.files.views} className="h-9 shrink-0 border-b border-divider px-2">
        <TabsTrigger value="tree">{messages.files.treeView}</TabsTrigger>
        <TabsTrigger value="git">{messages.files.gitView}</TabsTrigger>
      </TabsList>
      <TabsContent value="tree" className="min-h-0 flex-1">
        <FileTree />
      </TabsContent>
      <TabsContent value="git" className="min-h-0 flex-1">
        <DiffView spec={spec} />
      </TabsContent>
    </Tabs>
  );
}

function FileTree() {
  const { project, dispatch } = useStudio();
  const files = project.files;
  const resource = useStore(files, state => state.resource);
  useEnsureLoaded(resource);
  useRefreshOn(['files'], resource);
  const status = useStore(resource, state => state.status);
  const data = useStore(resource, state => state.data);
  const error = useStore(resource, state => state.error);
  const expanded = useStore(files, state => state.expanded);
  const rows = flattenTree(data, expanded);
  const [active, setActive] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeights.file,
    overscan: 10,
    initialRect: { width: 0, height: 600 },
    getItemKey: index => rows[index]?.node.path ?? index,
  });

  const activate = (index: number) => {
    const row = rows[index];
    if (!row) return;
    if (row.node.kind === 'dir') files.getState().toggle(row.node.path);
    else if (row.node.git) dispatch({ type: 'file.open', path: row.node.path });
  };

  const focusRow = (index: number) => {
    const clamped = Math.max(0, Math.min(rows.length - 1, index));
    setActive(clamped);
    virtualizer.scrollToIndex(clamped, { align: 'auto' });
    requestAnimationFrame(() => scroller.current?.querySelector<HTMLElement>(`[data-index="${clamped}"]`)?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const row = rows[active];
    if (event.key === 'ArrowDown') focusRow(active + 1);
    else if (event.key === 'ArrowUp') focusRow(active - 1);
    else if (event.key === 'Home') focusRow(0);
    else if (event.key === 'End') focusRow(rows.length - 1);
    else if (event.key === 'ArrowRight' && row?.node.kind === 'dir' && !expanded[row.node.path]) activate(active);
    else if (event.key === 'ArrowLeft' && row?.node.kind === 'dir' && expanded[row.node.path]) activate(active);
    else if (event.key === 'Enter') activate(active);
    else return;
    event.preventDefault();
  };

  if (status === 'error' || status === 'protected')
    return <ErrorState error={error} onRetry={() => void resource.getState().load()} />;

  return (
    <div
      ref={scroller}
      role="tree"
      aria-label={messages.files.tree}
      aria-busy={status === 'loading' || undefined}
      data-scroll-region="files"
      onKeyDown={onKeyDown}
      className="relative h-full min-h-0 overflow-y-auto overscroll-contain py-1"
    >
      {status === 'loading' || status === 'idle' ? (
        <div className="space-y-1 px-2">
          {[0, 1, 2, 3, 4].map(key => (
            <SkeletonRow key={key} token="file" />
          ))}
        </div>
      ) : (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map(item => {
            const row = rows[item.index];
            if (!row) return null;
            const { node, depth } = row;
            const open = node.kind === 'dir' && expanded[node.path] === true;
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled by the tree container.
              <div
                key={item.key}
                role="treeitem"
                aria-level={depth}
                aria-expanded={node.kind === 'dir' ? open : undefined}
                aria-selected={item.index === active}
                data-index={item.index}
                data-git={node.git ?? undefined}
                data-row-height="file"
                tabIndex={item.index === active ? 0 : -1}
                onClick={() => {
                  setActive(item.index);
                  activate(item.index);
                }}
                className={cn(
                  rowHeightClass('file'),
                  'absolute inset-x-0 top-0 flex cursor-default items-center gap-1.5 pe-3 text-xs hover:bg-divider',
                  focusRingInset,
                )}
                style={{ transform: `translateY(${item.start}px)`, paddingInlineStart: `${depth * 12}px` }}
              >
                {node.kind === 'dir' ? (
                  <>
                    <Icon icon={open ? ChevronDown : ChevronRight} className="size-3.5 text-fg-muted" />
                    <Icon icon={open ? FolderOpen : Folder} className="text-fg-muted" />
                  </>
                ) : (
                  <>
                    <span className="w-3.5 shrink-0" />
                    <Icon icon={File} className="text-fg-muted" />
                  </>
                )}
                <span className={cn('min-w-0 flex-1 truncate', node.git ? 'text-fg' : 'text-fg-muted')}>
                  {node.name}
                </span>
                {node.git ? (
                  <span
                    className={cn(
                      'w-3 shrink-0 text-center',
                      mono,
                      node.git === 'added' || node.git === 'untracked' ? 'text-attested' : 'text-accent',
                    )}
                    title={messages.diff.status[node.git] ?? node.git}
                  >
                    {messages.files.git[node.git]}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
