/**
 * FinopsView — real-time token telemetry and circuit-breaker budgets (plan §11.4 VF-01…06, PJ-FIN, ST-06).
 *
 * Numbers come from the engine (`limits` echoes BREAKER_DEFAULTS, never hard-coded here). Live ticks are
 * throttled by the store to ≤ 4 Hz; only this view subscribes to them. No dollar cost is shown unless the
 * source is local (D-20): there is no reliable offline price table.
 */
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { useEnsureLoaded, useRefreshOn, useStudio } from '@/app/studio-context';
import { Activity, Gauge, Icon, SquareTerminal } from '@/components/ui/icon';
import { cn, focusRingInset, mono } from '@/components/ui/interaction';
import { ProtectedState } from '@/components/ui/ProtectedState';
import { BreakerPill } from '@/components/ui/status-pill';
import {
  EmptyState,
  ErrorState,
  rowHeightClass,
  SkeletonBar,
  SkeletonRow,
  ViewFrame,
} from '@/components/ui/view-state';
import type { FinopsPayload, FinopsTask } from '@/ipc/types';
import { formatInt, messages } from '@/i18n/messages.es';
import { type FinopsStore, type RateSample, SPARKLINE_WINDOW_MS } from '@/stores/finops';

const FRAME = 'grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]';

export function credentialLabel(source: FinopsPayload['credentialSource']): string | null {
  if (!source) return null;
  if (source.kind === 'local') return messages.finops.local(source.provider);
  return messages.finops.sources[source.kind] ?? source.kind;
}

/** Subscribes the calling view to live FinOps ticks for as long as it is mounted. */
export function useLiveFinops(finops: FinopsStore) {
  const resource = useStore(finops, state => state.resource);
  useEnsureLoaded(resource);
  useRefreshOn(['finops'], resource);
  useEffect(() => finops.getState().live(), [finops]);
  return resource;
}

export function FinopsView() {
  const { project, dispatch } = useStudio();
  const finops = project.finops;
  const resource = useLiveFinops(finops);
  const status = useStore(resource, state => state.status);
  const data = useStore(resource, state => state.data);
  const error = useStore(resource, state => state.error);
  const frameState = status === 'idle' ? 'loading' : status;

  return (
    <ViewFrame view="finops" state={frameState} layout="finops-dashboard" className={FRAME}>
      {frameState === 'loading' ? (
        <>
          <div className="grid h-28 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 border-b border-divider px-5 py-4">
            <SkeletonBar className="h-8 w-40 self-center" />
            <SkeletonBar className="h-8 w-full self-center" />
          </div>
          <div className="flex flex-col gap-2 px-5 py-4">
            <SkeletonRow token="finops-task" />
            <SkeletonRow token="finops-task" />
          </div>
        </>
      ) : frameState === 'ready' && data ? (
        <>
          <RateHeader data={data} history={finops} />
          <TaskList data={data} />
        </>
      ) : (
        <>
          <div className="h-28 border-b border-divider" />
          {frameState === 'empty' ? (
            <EmptyState
              icon={Gauge}
              title={messages.finops.emptyTitle}
              body={messages.finops.emptyBody}
              actions={[
                {
                  label: messages.finops.ctaTerminal,
                  icon: SquareTerminal,
                  primary: true,
                  onSelect: () => dispatch({ type: 'inspector.open', tab: 'terminal' }),
                },
              ]}
            />
          ) : frameState === 'protected' ? (
            <ProtectedState reason={error?.detail ?? ''} />
          ) : (
            <ErrorState error={error} onRetry={() => void resource.getState().retry()} />
          )}
        </>
      )}
    </ViewFrame>
  );
}

function RateHeader({ data, history }: { data: FinopsPayload; history: FinopsStore }) {
  const samples = useStore(history, state => state.history);
  const source = credentialLabel(data.credentialSource);
  return (
    <div className="grid h-28 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-6 border-b border-divider px-5">
      <div className="flex flex-col gap-1" data-stream={data.stream}>
        <span className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Icon icon={Activity} className={data.stream === 'streaming' ? 'text-accent' : undefined} />
          {messages.finops.rate}
        </span>
        <span className={cn('text-3xl font-semibold text-fg', mono)}>{`${formatInt(data.tokensPerSecond)} t/s`}</span>
        <span className="text-xs text-fg-muted">
          {data.stream === 'idle' ? messages.finops.idle : messages.finops.streaming}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <Sparkline samples={samples} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
          <span>
            {messages.finops.session}: <span className={cn('text-fg', mono)}>{formatInt(data.session.tokens)}</span>{' '}
            {messages.skills.tokens}
          </span>
          {source ? (
            <span className="inline-flex items-center gap-1.5">
              <span>{messages.finops.source}:</span>
              <span className="rounded-full border border-floating-border px-2 text-fg">{source}</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const SPARK_W = 240;
const SPARK_H = 40;

export function Sparkline({ samples, className }: { samples: RateSample[]; className?: string }) {
  const now = samples[samples.length - 1]?.at ?? 0;
  const peak = Math.max(1, ...samples.map(sample => sample.value));
  const points = samples
    .map(sample => {
      const x = SPARK_W - ((now - sample.at) / SPARKLINE_WINDOW_MS) * SPARK_W;
      const y = SPARK_H - 2 - (sample.value / peak) * (SPARK_H - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      role="img"
      aria-label={messages.finops.sparkline}
      data-window-seconds={SPARKLINE_WINDOW_MS / 1000}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      className={cn('h-10 w-full text-accent', className)}
    >
      <line x1="0" x2={SPARK_W} y1={SPARK_H - 1} y2={SPARK_H - 1} stroke="currentColor" strokeOpacity="0.2" />
      {samples.length > 1 ? (
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}

function Meter({
  label,
  value,
  max,
  tone,
  valueText,
}: {
  label: string;
  value: number;
  max: number;
  tone: string;
  valueText: string;
}) {
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a native <meter> cannot be styled consistently; ARIA meter with explicit values (VF-02)
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      className="h-1.5 w-full overflow-hidden rounded-full bg-divider"
    >
      <div className={cn('h-full rounded-full', tone)} style={{ width: `${(share * 100).toFixed(2)}%` }} />
    </div>
  );
}

function TaskList({ data }: { data: FinopsPayload }) {
  const { project } = useStudio();
  const rateLimits = useStore(project.chat, state => state.rateLimits);
  const { limits } = data;
  return (
    <section
      aria-label={messages.finops.tasks}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region: keyboard users must be able to scroll it
      tabIndex={0}
      className={cn('min-h-0 overflow-y-auto overscroll-contain px-5 pt-4 pb-24', focusRingInset)}
    >
      {rateLimits.length > 0 ? (
        <div className="mb-6">
          <h2 className="mb-2 text-xs font-semibold text-fg-muted">{messages.finops.rateLimits}</h2>
          <ul className="grid gap-3 rounded-xl border border-divider p-4 sm:grid-cols-2">
            {rateLimits.map(entry => (
              <li key={entry.window} className="grid gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-fg">{entry.window}</span>
                  <span className={cn('text-fg-muted', mono)}>{messages.finops.usedPercent(entry.usedPercent)}</span>
                </div>
                <Meter
                  label={`${messages.finops.rateLimits}: ${entry.window}`}
                  value={entry.usedPercent}
                  max={100}
                  tone={entry.usedPercent >= 90 ? 'bg-breach' : entry.usedPercent >= 75 ? 'bg-heat-high' : 'bg-accent'}
                  valueText={messages.finops.usedPercent(entry.usedPercent)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <h2 className="mb-2 text-xs font-semibold text-fg-muted">{messages.finops.tasks}</h2>
      {data.tasks.length === 0 ? (
        <p className="text-xs text-fg-muted">{messages.finops.idle}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider rounded-xl border border-divider">
          {data.tasks.map(task => (
            <TaskRow key={task.taskId} task={task} limits={limits} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskRow({ task, limits }: { task: FinopsTask; limits: FinopsPayload['limits'] }) {
  const used = limits.tokenBudget - task.remainingBudget;
  const windowUsed = limits.maxTokensPerWindow - task.rateHeadroom;
  const over = task.state === 'OPEN' || task.state === 'DEAD_LETTER';
  return (
    <li
      data-task-id={task.taskId}
      data-row-height="finops-task"
      className={cn(
        rowHeightClass('finops-task'),
        'grid grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-5 px-4',
      )}
    >
      <div className="flex min-w-0 flex-col items-start gap-1">
        <span className={cn('text-[13px] text-fg', mono)}>{task.taskId}</span>
        <BreakerPill state={task.state} />
        {task.state === 'OPEN' && task.reason ? (
          <span data-reason={task.reason} className="truncate text-[11px] text-breach">
            {messages.finops.reasons[task.reason] ?? task.reason}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Meter
          label={messages.finops.budget(task.taskId)}
          value={used}
          max={limits.tokenBudget}
          tone={over ? 'bg-breach' : 'bg-accent'}
          valueText={`${formatInt(used)} / ${formatInt(limits.tokenBudget)}`}
        />
        <span className="text-[11px] text-fg-muted">
          <span className={cn('text-fg', mono)}>{formatInt(used)}</span> {messages.finops.used} ·{' '}
          <span className={cn('text-fg', mono)}>{formatInt(task.remainingBudget)}</span> {messages.finops.remaining}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Meter
          label={messages.finops.window(task.taskId)}
          value={windowUsed}
          max={limits.maxTokensPerWindow}
          tone={task.rateHeadroom <= 0 ? 'bg-breach' : 'bg-accent-bright'}
          valueText={`${formatInt(windowUsed)} / ${formatInt(limits.maxTokensPerWindow)}`}
        />
        <span className="text-[11px] text-fg-muted">
          {messages.finops.headroom} <span className={cn('text-fg', mono)}>{formatInt(task.rateHeadroom)}</span> ·{' '}
          <span className={mono}>
            {formatInt(windowUsed)} / {formatInt(limits.maxTokensPerWindow)} {messages.finops.perMinute}
          </span>
        </span>
      </div>
    </li>
  );
}
