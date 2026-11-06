/**
 * diff-viewer (STUDIO-DESIGN-SYSTEM.md §4, plan VD-01…09) — Obsidian side-by-side / unified reviewer.
 *
 * D-6 outcome: `@git-diff-view/react` renders every row (no virtualization) and its stylesheet carries
 * unguarded `:hover` rules and shadows (DS-02, DS-10), so the viewer renders the engine's hunks itself and
 * virtualizes rows with `@tanstack/react-virtual`. Fixed row heights keep the DOM bounded (≤ 200 rows) and
 * the scroll container survives mode switches, so the scroll position is kept (VD-02).
 */
import { useVirtualizer } from '@tanstack/react-virtual';
import { type KeyboardEvent, type RefObject, useImperativeHandle, useMemo, useRef } from 'react';
import { rowHeights } from '@/design/tokens';
import type { DiffFile, DiffHunk } from '@/ipc/types';
import { messages } from '@/i18n/messages.es';
import type { DecisionEntry } from '@/stores/review';
import { Button } from './button';
import { Check, Icon, MessageSquarePlus, X } from './icon';
import { cn, focusRing, focusRingInset, mono, press } from './interaction';

export type DiffMode = 'unified' | 'split';
export type HunkDecisionState = 'undecided' | 'pending' | 'approve' | 'reject' | 'stale';

type LineKind = 'context' | 'add' | 'del';

export interface DiffLine {
  kind: LineKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

type Row =
  | { type: 'file'; key: string; file: DiffFile }
  | { type: 'hunk'; key: string; file: DiffFile; hunk: DiffHunk }
  | { type: 'line'; key: string; file: DiffFile; line: DiffLine }
  | { type: 'pair'; key: string; file: DiffFile; left: DiffLine | null; right: DiffLine | null }
  | { type: 'paged'; key: string; file: DiffFile };

const HEADER_HEIGHT = 32;

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Hunk body (`' '`, `'-'`, `'+'` prefixed lines, without the `@@` line) → numbered lines. CR is kept off-screen. */
export function parseHunk(hunk: DiffHunk): DiffLine[] {
  const match = HUNK_HEADER.exec(hunk.header);
  let oldNo = Number(match?.[1] ?? 1);
  let newNo = Number(match?.[2] ?? 1);
  const lines: DiffLine[] = [];
  for (const raw of hunk.text.split('\n')) {
    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
    const sign = raw[0];
    const text = raw.slice(1).replace(/\r$/, '');
    if (sign === '+') lines.push({ kind: 'add', oldNo: null, newNo: newNo++, text });
    else if (sign === '-') lines.push({ kind: 'del', oldNo: oldNo++, newNo: null, text });
    else if (sign === ' ' || raw === '') {
      if (raw === '' && lines.length > 0 && hunk.text.endsWith('\n')) continue;
      lines.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text });
    }
  }
  return lines;
}

/** Side-by-side pairing: runs of deletions face the following run of additions. */
function pairLines(lines: DiffLine[]): Array<{ left: DiffLine | null; right: DiffLine | null }> {
  const pairs: Array<{ left: DiffLine | null; right: DiffLine | null }> = [];
  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    if (!line) break;
    if (line.kind === 'context') {
      pairs.push({ left: line, right: line });
      index++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (lines[index]?.kind === 'del') dels.push(lines[index++] as DiffLine);
    while (lines[index]?.kind === 'add') adds.push(lines[index++] as DiffLine);
    for (let row = 0; row < Math.max(dels.length, adds.length); row++)
      pairs.push({ left: dels[row] ?? null, right: adds[row] ?? null });
  }
  return pairs;
}

function buildRows(files: DiffFile[], mode: DiffMode): Row[] {
  const rows: Row[] = [];
  for (const file of files) {
    rows.push({ type: 'file', key: `f:${file.path}`, file });
    if (file.binary) continue;
    if (file.hunks === null) {
      rows.push({ type: 'paged', key: `p:${file.path}`, file });
      continue;
    }
    for (const hunk of file.hunks) {
      rows.push({ type: 'hunk', key: `h:${hunk.id}`, file, hunk });
      const lines = parseHunk(hunk);
      if (mode === 'unified')
        lines.forEach((line, index) => {
          rows.push({ type: 'line', key: `l:${hunk.id}:${index}`, file, line });
        });
      else
        pairLines(lines).forEach((pair, index) => {
          rows.push({ type: 'pair', key: `s:${hunk.id}:${index}`, file, ...pair });
        });
    }
  }
  return rows;
}

const rowHeight = (row: Row | undefined) =>
  row?.type === 'line' || row?.type === 'pair' ? rowHeights.diffLine : HEADER_HEIGHT;

export interface RemarkTarget {
  file: string;
  line: number;
  side: 'old' | 'new';
}

export interface DiffViewerHandle {
  scrollToFile(path: string): void;
}

export interface DiffViewerProps {
  files: DiffFile[];
  mode: DiffMode;
  decisions: Record<string, DecisionEntry>;
  remarkTarget: RemarkTarget | null;
  onDecide(hunkId: string, decision: 'approve' | 'reject'): void;
  onComment(target: RemarkTarget): void;
  onLoadFile(path: string): void;
  handle?: RefObject<DiffViewerHandle | null>;
}

export function decisionState(entry: DecisionEntry | undefined): HunkDecisionState {
  if (!entry) return 'undecided';
  if (entry.status === 'pending') return 'pending';
  if (entry.status === 'stale') return 'stale';
  return entry.decision;
}

export function DiffViewer({
  files,
  mode,
  decisions,
  remarkTarget,
  onDecide,
  onComment,
  onLoadFile,
  handle,
}: DiffViewerProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => buildRows(files, mode), [files, mode]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: index => rowHeight(rows[index]),
    overscan: 20,
    initialRect: { width: 0, height: 720 },
    getItemKey: index => rows[index]?.key ?? index,
  });

  useImperativeHandle(
    handle,
    () => ({
      scrollToFile(path: string) {
        const index = rows.findIndex(row => row.type === 'file' && row.file.path === path);
        if (index >= 0) virtualizer.scrollToIndex(index, { align: 'start' });
      },
    }),
    [rows, virtualizer],
  );

  const commentButton = (file: DiffFile, line: DiffLine, side: 'old' | 'new') => {
    const number = side === 'new' ? line.newNo : line.oldNo;
    if (number === null) return <span className="w-5 shrink-0" />;
    const selected = remarkTarget?.file === file.path && remarkTarget.line === number && remarkTarget.side === side;
    return (
      <button
        type="button"
        aria-label={messages.diff.comment(side, number)}
        aria-pressed={selected}
        onClick={() => onComment({ file: file.path, line: number, side })}
        className={cn(
          'grid h-[18px] w-5 shrink-0 place-items-center rounded text-accent',
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          press,
          focusRing,
        )}
      >
        <Icon icon={MessageSquarePlus} className="size-3.5" />
      </button>
    );
  };

  const lineTone = (kind: LineKind | undefined) =>
    kind === 'add' ? 'bg-attested/10' : kind === 'del' ? 'bg-breach/10' : '';
  const sign = (kind: LineKind) => (kind === 'add' ? '+' : kind === 'del' ? '-' : ' ');

  const renderRow = (row: Row) => {
    switch (row.type) {
      case 'file':
        return (
          <div
            data-diff-file={row.file.path}
            className="flex h-full items-center gap-2 border-y border-divider bg-surface px-3 text-xs"
          >
            <span className={cn('min-w-0 truncate text-fg', mono)}>
              {row.file.oldPath && row.file.oldPath !== row.file.path ? `${row.file.oldPath} → ` : ''}
              {row.file.path}
            </span>
            <span className="text-fg-muted">{messages.diff.status[row.file.status] ?? row.file.status}</span>
            {row.file.binary ? (
              <span className="rounded border border-divider px-1.5 text-[11px] text-fg-muted">
                {messages.diff.binary}
              </span>
            ) : null}
            <span className="flex-1" />
            <span className={cn('text-attested', mono)}>+{row.file.additions}</span>
            <span className={cn('text-breach', mono)}>-{row.file.deletions}</span>
          </div>
        );
      case 'paged':
        return (
          <div className="flex h-full items-center px-3">
            <Button size="sm" variant="ghost" onClick={() => onLoadFile(row.file.path)}>
              {row.file.path}
            </Button>
          </div>
        );
      case 'hunk': {
        const state = decisionState(decisions[row.hunk.id]);
        const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.key === 'a' || event.key === 'r') {
            event.preventDefault();
            onDecide(row.hunk.id, event.key === 'a' ? 'approve' : 'reject');
          }
        };
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: focusable hunk header with a/r shortcuts (VD-03).
          // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the label names the hunk and its decision for screen readers
          <div
            data-hunk-id={row.hunk.id}
            data-decision={state}
            data-testid="hunk"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable hunk header carries the a/r shortcuts (VD-03)
            tabIndex={0}
            aria-label={`${row.file.path} ${row.hunk.header} · ${messages.diff.decision[state]}`}
            onKeyDown={onKeyDown}
            className={cn(
              'flex h-full items-center gap-2 bg-floating px-3 text-xs',
              state === 'stale' && 'bg-breach/10',
              focusRingInset,
            )}
          >
            <span className={cn('min-w-0 truncate text-accent', mono)}>{row.hunk.header}</span>
            <span
              className={cn(
                'text-[11px]',
                state === 'approve'
                  ? 'text-attested'
                  : state === 'reject' || state === 'stale'
                    ? 'text-breach'
                    : 'text-fg-muted',
              )}
            >
              {messages.diff.decision[state]}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              aria-label={messages.diff.approveHunk}
              aria-pressed={state === 'approve'}
              onClick={() => onDecide(row.hunk.id, 'approve')}
              className={cn(
                'grid size-6 place-items-center rounded-md border',
                state === 'approve'
                  ? 'border-attested/60 bg-attested/15 text-attested'
                  : 'border-floating-border text-fg-muted hover:text-attested',
                press,
                focusRing,
              )}
            >
              <Icon icon={Check} />
            </button>
            <button
              type="button"
              aria-label={messages.diff.rejectHunk}
              aria-pressed={state === 'reject'}
              onClick={() => onDecide(row.hunk.id, 'reject')}
              className={cn(
                'grid size-6 place-items-center rounded-md border',
                state === 'reject'
                  ? 'border-breach/60 bg-breach/15 text-breach'
                  : 'border-floating-border text-fg-muted hover:text-breach',
                press,
                focusRing,
              )}
            >
              <Icon icon={X} />
            </button>
          </div>
        );
      }
      case 'line':
        return (
          <div
            data-diff-line=""
            data-testid="diff-row"
            data-row-height="diff-line"
            className={cn('group flex h-full items-center text-xs', lineTone(row.line.kind))}
          >
            {commentButton(row.file, row.line, row.line.kind === 'del' ? 'old' : 'new')}
            <span className={cn('w-12 shrink-0 pe-2 text-end text-fg-muted', mono)}>{row.line.oldNo ?? ''}</span>
            <span className={cn('w-12 shrink-0 pe-2 text-end text-fg-muted', mono)}>{row.line.newNo ?? ''}</span>
            <span className={cn('w-4 shrink-0 text-fg-muted', mono)}>{sign(row.line.kind)}</span>
            <span className={cn('min-w-0 whitespace-pre text-fg', mono)}>{row.line.text}</span>
          </div>
        );
      case 'pair':
        return (
          <div
            data-diff-line=""
            data-testid="diff-row"
            data-row-height="diff-line"
            className="grid h-full grid-cols-2 text-xs"
          >
            {(['old', 'new'] as const).map(side => {
              const line = side === 'old' ? row.left : row.right;
              return (
                <div
                  key={side}
                  className={cn(
                    'group flex min-w-0 items-center',
                    side === 'new' && 'border-s border-divider',
                    line ? lineTone(line.kind) : 'bg-surface',
                  )}
                >
                  {line ? commentButton(row.file, line, side) : <span className="w-5 shrink-0" />}
                  <span className={cn('w-12 shrink-0 pe-2 text-end text-fg-muted', mono)}>
                    {(side === 'old' ? line?.oldNo : line?.newNo) ?? ''}
                  </span>
                  <span className={cn('min-w-0 overflow-hidden whitespace-pre text-fg', mono)}>{line?.text ?? ''}</span>
                </div>
              );
            })}
          </div>
        );
    }
  };

  return (
    <div
      ref={scroller}
      data-scroll-region="diff"
      data-testid="diff-scroll"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the scroll region must be keyboard scrollable.
      tabIndex={0}
      className={cn('relative min-h-0 flex-1 overflow-auto overscroll-contain', focusRingInset)}
    >
      <div className="relative w-full min-w-[40rem]" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(item => {
          const row = rows[item.index];
          if (!row) return null;
          return (
            <div
              key={item.key}
              className="absolute inset-x-0 top-0"
              style={{ height: item.size, transform: `translateY(${item.start}px)` }}
            >
              {renderRow(row)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Skeleton rows of the viewer: the same line height token as the ready rows (CLS = 0). */
export const DIFF_LINE_TOKEN = 'diff-line' as const;
