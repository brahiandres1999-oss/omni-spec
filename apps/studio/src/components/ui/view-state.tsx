/**
 * The 4-state contract of every view (blueprint §4.7.3, plan §11.3, STUDIO-DESIGN-SYSTEM.md §5).
 *
 * `ViewFrame` is the view root in every state: same element, same `data-layout` and layout classes, so the
 * skeleton and the ready content share the grid template (CLS = 0). Rows declare their height token in
 * `data-row-height`, identical in the skeleton and in the ready rows.
 */
import type { ReactNode } from 'react';
import type { StudioError } from '@/ipc/client';
import { messages } from '@/i18n/messages.es';
import type { ResourceStatus } from '@/stores/resource';
import { Button } from './button';
import { Icon, type LucideIcon, RefreshCw, CircleAlert } from './icon';
import { cn, mono } from './interaction';

export type ViewName = 'board' | 'cartography' | 'diff' | 'finops' | 'skills';
export type FrameState = Exclude<ResourceStatus, 'idle'>;

export interface ViewFrameProps {
  view: ViewName;
  state: FrameState;
  /** Name of the grid template shared by skeleton and content (e.g. `board-lanes`). */
  layout: string;
  className: string;
  children: ReactNode;
}

export function ViewFrame({ view, state, layout, className, children }: ViewFrameProps) {
  return (
    <div
      data-view={view}
      data-state={state}
      data-layout={layout}
      aria-busy={state === 'loading' ? true : undefined}
      className={className}
    >
      {children}
    </div>
  );
}

export type RowHeightToken = 'board-card' | 'list' | 'diff-line' | 'file' | 'skill' | 'finops-task';

const ROW_HEIGHT_CLASS: Record<RowHeightToken, string> = {
  'board-card': 'h-(--row-board-card)',
  list: 'h-(--row-list)',
  'diff-line': 'h-(--row-diff-line)',
  file: 'h-(--row-file)',
  skill: 'h-(--row-skill)',
  'finops-task': 'h-(--row-finops-task)',
};

export const rowHeightClass = (token: RowHeightToken) => ROW_HEIGHT_CLASS[token];

/** A placeholder row with the exact height of the row it stands for. */
export function SkeletonRow({ token, className }: { token: RowHeightToken; className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-row-height={token}
      className={cn(ROW_HEIGHT_CLASS[token], 'shrink-0 rounded-lg bg-floating motion-safe:animate-pulse', className)}
    />
  );
}

/** A thin text placeholder (titles, counters) inside skeleton chrome. */
export function SkeletonBar({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('h-3 rounded bg-divider motion-safe:animate-pulse', className)} />;
}

export interface EmptyAction {
  label: string;
  icon?: LucideIcon;
  primary?: boolean;
  onSelect(): void;
}

export function EmptyState({
  icon,
  title,
  body,
  actions,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  actions: EmptyAction[];
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 px-6 py-12 text-center', className)}>
      <span className="grid size-12 place-items-center rounded-xl border border-divider text-fg-muted">
        <Icon icon={icon} size={18} />
      </span>
      <div className="max-w-[44ch] space-y-1">
        <h2 className="text-balance text-sm font-semibold text-fg">{title}</h2>
        <p className="text-pretty text-[13px] text-fg-muted">{body}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {actions.map(action => (
          <Button
            key={action.label}
            variant={action.primary ? 'primary' : 'secondary'}
            icon={action.icon}
            onClick={action.onSelect}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Error state: a readable sentence, the technical detail folded away and an atomic retry. */
export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: StudioError | undefined;
  onRetry(): void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 px-6 py-12', className)}>
      <div role="alert" className="flex max-w-[52ch] items-start gap-3 text-start">
        <Icon icon={CircleAlert} size={18} className="mt-0.5 text-breach" />
        <p className="text-pretty text-[13px] text-fg">{error?.message ?? messages.errors.fallback}</p>
      </div>
      {error ? (
        <details className="w-full max-w-[52ch] rounded-lg border border-divider px-3 py-2 text-xs text-fg-muted">
          <summary className="cursor-pointer select-none rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            {messages.states.technicalDetail}
          </summary>
          <p className={cn('mt-2 break-words', mono)}>
            <span className="text-fg">{error.code}</span> · {error.detail}
          </p>
        </details>
      ) : null}
      <Button variant="primary" icon={RefreshCw} onClick={onRetry}>
        {messages.states.retry}
      </Button>
    </div>
  );
}
