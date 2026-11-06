/**
 * Blast Radius lineage of the selected module (VC-08, D-14): impacted modules ordered by distance, with their
 * score and the barrel they are reached through. Blast Radius warnings may use the governance amber (DS-05).
 */
import type { StudioError } from '@/ipc/client';
import type { HeatPayload } from '@/ipc/types';
import { CircleAlert, Icon, Radar } from '@/components/ui/icon';
import { cn, mono } from '@/components/ui/interaction';
import { formatInt, messages } from '@/i18n/messages.es';

const LEVEL_TONE: Record<string, string> = {
  low: 'text-attested',
  medium: 'text-governance',
  high: 'text-governance',
  critical: 'text-breach',
};

export function BlastRadiusPanel({
  selected,
  status,
  heat,
  error,
}: {
  selected: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  heat: HeatPayload | undefined;
  error: StudioError | undefined;
}) {
  if (!selected) return <p className="px-3 py-2 text-xs text-fg-muted">{messages.cartography.selectHint}</p>;
  const lineage = [...(heat?.nodes ?? [])].sort((a, b) => a.distance - b.distance || b.score - a.score);
  return (
    <div className="flex min-h-0 flex-col gap-2 px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <Icon icon={Radar} className="text-accent" />
        <span className={cn('min-w-0 flex-1 truncate text-fg', mono)}>{selected}</span>
        {heat ? (
          <span className={cn('shrink-0 text-[11px]', LEVEL_TONE[heat.level] ?? 'text-fg-muted')}>
            {messages.cartography.level}: <span className={mono}>{heat.level}</span>
          </span>
        ) : null}
      </div>
      {status === 'loading' ? <p className="text-xs text-fg-muted">{messages.cartography.computing}</p> : null}
      {status === 'error' ? (
        <p className="flex items-center gap-1.5 text-xs text-breach">
          <Icon icon={CircleAlert} />
          {error?.message}
        </p>
      ) : null}
      {status === 'ready' && lineage.length === 0 ? (
        <p className="text-xs text-fg-muted">{messages.cartography.noImpact}</p>
      ) : null}
      <ol
        aria-label={messages.cartography.lineage}
        className="flex min-h-0 flex-col overflow-y-auto overscroll-contain text-xs"
      >
        {lineage.map(node => (
          <li
            key={node.id}
            data-distance={node.distance}
            className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-divider py-1.5"
          >
            <span className={cn('text-fg-muted', mono)} title={messages.cartography.distance}>
              d{node.distance}
            </span>
            <span className="min-w-0">
              <span className={cn('block truncate text-fg', mono)}>{node.path}</span>
              {node.viaBarrel ? (
                <span className={cn('block truncate text-[11px] text-fg-muted', mono)}>
                  {messages.cartography.via} {node.viaBarrel}
                </span>
              ) : null}
            </span>
            <span className={cn(node.score >= 60 ? 'text-governance' : 'text-fg-muted', mono)}>
              {formatInt(node.score)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
