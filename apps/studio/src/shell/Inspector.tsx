/**
 * Inspector (SH-03, SH-11, SH-12): Terminal, Overview (breaker, WAL, Git tree OID, tasks — all mono, no
 * subagents and no dollar cost, D-20), live FinOps meter and the project file tree.
 */
import { useVirtualizer } from '@tanstack/react-virtual';
import { type KeyboardEvent, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useEnsureLoaded, useRefreshOn, useStudio } from '@/app/studio-context';
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, Icon } from '@/components/ui/icon';
import { InspectorDrawer } from '@/components/ui/inspector-drawer';
import { cn, focusRingInset, mono } from '@/components/ui/interaction';
import { BreakerPill } from '@/components/ui/status-pill';
import { ErrorState, rowHeightClass, SkeletonRow } from '@/components/ui/view-state';
import { rowHeights } from '@/design/tokens';
import { formatBytes, formatInt, messages } from '@/i18n/messages.es';
import { worstBreaker } from '@/stores/app';
import { flattenTree } from '@/stores/files';
import { useLiveFinops, credentialLabel, Sparkline } from '@/views/FinopsView';
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
        {
          value: 'terminal',
          label: labels.terminal,
          content: <TerminalPanel visible={tab === 'terminal' && !collapsed} />,
          keepMounted: true,
        },
        { value: 'overview', label: labels.overview, content: <OverviewPanel /> },
        { value: 'finops', label: labels.finops, content: <FinopsPanel /> },
        { value: 'files', label: labels.files, content: <FilesPanel /> },
      ]}
    />
  );
}

function OverviewPanel() {
  const { snapshot, project } = useStudio();
  useEnsureLoaded(snapshot);
  const data = useStore(snapshot, state => state.data);
  const board = useStore(
    useStore(project.board, state => state.resource),
    state => state.data,
  );
  if (!data)
    return (
      <div className="space-y-2 p-3">
        {[0, 1, 2, 3].map(key => (
          <SkeletonRow key={key} token="list" />
        ))}
      </div>
    );
  const activeId = data.activeSpec?.id;
  const card = board?.lanes.flatMap(lane => lane.cards).find(entry => entry.id === activeId);
  const tasks = data.activeSpec?.tasks ?? card?.tasks ?? undefined;
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 p-4 text-xs">
      <dt className="text-fg-muted">{messages.overview.breaker}</dt>
      <dd className="justify-self-end">
        <BreakerPill state={worstBreaker(data)} />
      </dd>
      <dt className="text-fg-muted">{messages.overview.wal}</dt>
      <dd className={cn('justify-self-end text-fg', mono)}>{formatBytes(data.memory.walBytes)}</dd>
      <dt className="text-fg-muted">{messages.overview.tree}</dt>
      <dd className={cn('justify-self-end text-fg', mono)} title={data.memory.specsTreeOid}>
        {data.memory.specsTreeOid.slice(0, 7)}
      </dd>
      <dt className="min-w-0 truncate text-fg-muted">
        {messages.overview.tasks}
        {data.activeSpec ? <span className={cn('ms-1', mono)}>{data.activeSpec.slug}</span> : null}
      </dt>
      <dd className={cn('justify-self-end text-fg', mono)}>
        {tasks ? `${tasks.done}/${tasks.total}` : messages.overview.noSpec}
      </dd>
    </dl>
  );
}

function FinopsPanel() {
  const { project } = useStudio();
  const resource = useLiveFinops(project.finops);
  const data = useStore(resource, state => state.data);
  const samples = useStore(project.finops, state => state.history);
  if (!data)
    return (
      <div className="space-y-2 p-3">
        {[0, 1, 2].map(key => (
          <SkeletonRow key={key} token="list" />
        ))}
      </div>
    );
  const worst = data.tasks.find(task => task.state === 'OPEN') ?? data.tasks[0];
  const source = credentialLabel(data.credentialSource);
  return (
    <div className="flex flex-col gap-3 p-4 text-xs">
      <span className={cn('text-2xl font-semibold text-fg', mono)}>{`${formatInt(data.tokensPerSecond)} t/s`}</span>
      <Sparkline samples={samples} />
      <span className="text-fg-muted">
        {messages.finops.session}: <span className={cn('text-fg', mono)}>{formatInt(data.session.tokens)}</span> /{' '}
        <span className={mono}>{formatInt(data.limits.tokenBudget)}</span>
      </span>
      {worst ? (
        <span className="flex items-center gap-2 text-fg-muted">
          {messages.overview.breaker} <BreakerPill state={worst.state} />
        </span>
      ) : null}
      {source ? <span className="text-fg-muted">{source}</span> : null}
    </div>
  );
}

function FilesPanel() {
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
