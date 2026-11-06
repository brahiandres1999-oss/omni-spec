/**
 * status-pill (STUDIO-DESIGN-SYSTEM.md §4): compact monospaced badges for breaker states, memory and the
 * Git tree OID. The value element itself carries the mono font (SH-11 reads it as a leaf).
 */
import type { ReactNode } from 'react';
import type { BreakerState } from '@/ipc/types';
import { cn, mono } from './interaction';

const BREAKER_TONE: Record<BreakerState, { dot: string; text: string }> = {
  CLOSED: { dot: 'bg-attested', text: 'text-attested' },
  HALF_OPEN: { dot: 'bg-accent', text: 'text-accent-bright' },
  OPEN: { dot: 'bg-breach', text: 'text-breach' },
  DEAD_LETTER: { dot: 'bg-breach', text: 'text-fg-muted line-through decoration-breach' },
};

export function BreakerPill({ state, className }: { state: BreakerState; className?: string }) {
  const tone = BREAKER_TONE[state] ?? BREAKER_TONE.CLOSED;
  return (
    <span
      data-breaker-state={state}
      className={cn(
        'inline-flex h-5 items-center gap-1.5 rounded-full border border-floating-border px-2 text-[11px]',
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', tone.dot)} />
      <span className={cn(mono, tone.text)}>{state}</span>
    </span>
  );
}

export function StatusPill({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1.5 rounded-full border border-floating-border px-2 text-[11px] text-fg-muted',
        className,
      )}
    >
      <span>{label}</span>
      <span className={cn('text-fg', mono)}>{children}</span>
    </span>
  );
}
