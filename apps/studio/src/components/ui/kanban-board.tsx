/**
 * kanban-board (STUDIO-DESIGN-SYSTEM.md §4): high-density lanes for `--light`, `--standard` and `--full`.
 *
 * Read-only by design (D-11): nothing is draggable; a card moves only when the engine re-projects it.
 * Lanes virtualize their cards (VB-07) with a fixed row height shared with the skeleton (CLS = 0).
 * The two human-gate lanes of `--full` carry the governance amber (DS-05 allows it in this file).
 */
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react';
import type { BoardCard, GateStatus } from '@/ipc/types';
import { messages } from '@/i18n/messages.es';
import { BOARD_CARD_GAP, rowHeights } from '@/design/tokens';
import { Button } from './button';
import { Check, Icon, ShieldAlert, ShieldCheck } from './icon';
import { cn, focusRing, mono, pressCard } from './interaction';
import { ProtectedState } from './ProtectedState';
import { rowHeightClass, SkeletonBar, SkeletonRow } from './view-state';

export const LANES_BY_ROUTE = {
  light: ['backlog', 'running', 'verified'],
  standard: ['specification', 'tasks', 'implementation', 'verification'],
  full: ['specification', 'gate-1', 'tasks', 'implementation', 'gate-2', 'closed'],
} as const;

const GATE_LANES = new Set(['gate-1', 'gate-2']);
const ROW = rowHeights.boardCard + BOARD_CARD_GAP;

export const laneTitle = (id: string) => messages.board.lanes[id] ?? id;

/** Grid of lanes; the same classes frame the skeleton and the ready board. */
export const LANES_GRID =
  'grid min-h-0 grid-flow-col auto-cols-[minmax(15rem,1fr)] gap-3 overflow-x-auto overscroll-x-contain px-4 pt-3 pb-24';

const LANE_SURFACE = 'flex min-h-0 min-w-0 flex-col rounded-xl border bg-surface';

function LaneHeader({ id, count }: { id: string; count: ReactNode }) {
  const gate = GATE_LANES.has(id);
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-divider px-3">
      {gate ? <Icon icon={ShieldAlert} className="text-governance" /> : null}
      <h3 className={cn('min-w-0 flex-1 truncate text-xs font-semibold', gate ? 'text-governance' : 'text-fg')}>
        {laneTitle(id)}
      </h3>
      <span className={cn('text-xs text-fg-muted', mono)}>{count}</span>
    </div>
  );
}

export function LaneSkeleton({ id }: { id: string }) {
  return (
    <div className={cn(LANE_SURFACE, GATE_LANES.has(id) ? 'border-governance/30' : 'border-divider')}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-divider px-3">
        <SkeletonBar className="w-28" />
      </div>
      <div className="flex flex-col gap-2 p-2">
        <SkeletonRow token="board-card" />
        <SkeletonRow token="board-card" />
        <SkeletonRow token="board-card" />
      </div>
    </div>
  );
}

const RISK_TONE: Record<string, string> = {
  high: 'bg-breach',
  critical: 'bg-breach',
  medium: 'bg-governance',
  low: 'bg-attested',
};

const GATE_TONE: Record<GateStatus, string> = {
  approved: 'border-attested/50 text-attested',
  stale: 'border-governance/50 text-governance',
  missing: 'border-floating-border text-fg-muted',
};

function GateChip({ gate, status }: { gate: 1 | 2; status: GateStatus }) {
  return (
    <span
      data-gate={gate}
      data-gate-status={status}
      title={`${messages.board.gate} ${gate}: ${messages.board.gateStatus[status] ?? status}`}
      className={cn('inline-flex h-4 items-center gap-0.5 rounded border px-1 text-[10px]', mono, GATE_TONE[status])}
    >
      {status === 'approved' ? <Icon icon={Check} className="size-3" /> : null}G{gate}
    </span>
  );
}

export interface CardSlotProps {
  card: BoardCard;
  tabIndex: number;
  onOpen(card: BoardCard): void;
  onFocusCard(id: string): void;
  /** Inline action row (e.g. "Aprobar Compuerta 1") or inline Protected notice. */
  footer?: ReactNode;
}

export function KanbanCard({ card, tabIndex, onOpen, onFocusCard, footer }: CardSlotProps) {
  const risk = card.risk ?? 'none';
  const lockedByAttestation = card.attestation === 'invalid' || card.protected;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard (arrows, Enter) is handled by the lane list for every card (VB-04)
    // biome-ignore lint/a11y/useSemanticElements: virtualized list item (see the lane list)
    <div
      role="listitem"
      data-card-id={card.id}
      data-surface="card"
      data-risk={risk}
      data-attestation={card.attestation}
      data-row-height="board-card"
      draggable={false}
      tabIndex={tabIndex}
      onFocus={event => {
        if (event.target === event.currentTarget) onFocusCard(card.id);
      }}
      onClick={() => onOpen(card)}
      className={cn(
        rowHeightClass('board-card'),
        'flex cursor-default select-none flex-col gap-1.5 overflow-hidden rounded-lg border border-floating-border bg-floating p-2.5',
        'hover:border-fg-muted/30',
        pressCard,
        focusRing,
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn('text-[11px] text-fg-muted', mono)}>{card.id}</span>
        {card.route ? (
          <span className={cn('rounded border border-divider px-1 text-[10px] text-fg-muted', mono)}>{card.route}</span>
        ) : null}
        <span className="flex-1" />
        {card.risk ? (
          <span
            className="inline-flex items-center gap-1 text-[10px] text-fg-muted"
            title={`${messages.board.risk}: ${card.risk}`}
          >
            <span aria-hidden="true" className={cn('size-1.5 rounded-full', RISK_TONE[card.risk] ?? 'bg-fg-muted')} />
            {card.risk}
          </span>
        ) : null}
        {card.gates.required ? (
          <>
            <GateChip gate={1} status={card.gates[1]} />
            <GateChip gate={2} status={card.gates[2]} />
          </>
        ) : null}
      </div>
      <p className="truncate text-[13px] font-medium text-fg">{card.title}</p>
      {footer ?? (
        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
          {card.tags.map(tag => (
            <span key={tag} className="shrink-0 rounded-full bg-divider px-1.5 text-[10px] text-fg-muted">
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center gap-2 text-[11px] text-fg-muted">
        <span className="min-w-0 truncate">{card.owner ?? messages.board.noOwner}</span>
        <span className="flex-1" />
        {lockedByAttestation ? (
          <Icon icon={ShieldAlert} className="text-breach" label={messages.board.attestation.invalid} />
        ) : card.attestation === 'valid' ? (
          <Icon icon={ShieldCheck} className="text-attested" label={messages.board.attestation.valid} />
        ) : null}
        {card.tasks ? (
          <span className={mono}>{`${card.tasks.done}/${card.tasks.total}`}</span>
        ) : (
          <span>{messages.board.noTasks}</span>
        )}
      </div>
    </div>
  );
}

export interface LaneProps {
  id: string;
  cards: BoardCard[];
  activeCardId: string | null;
  renderFooter(card: BoardCard): ReactNode;
  onOpen(card: BoardCard): void;
  onFocusCard(id: string): void;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
  registerLane(id: string, virtualizer: Virtualizer<HTMLDivElement, Element> | null): void;
  note?: ReactNode;
}

export function KanbanLane({
  id,
  cards,
  activeCardId,
  renderFooter,
  onOpen,
  onFocusCard,
  onKeyDown,
  registerLane,
  note,
}: LaneProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: cards.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    overscan: 4,
    initialRect: { width: 0, height: 720 },
    getItemKey: index => cards[index]?.id ?? index,
  });

  useEffect(() => {
    registerLane(id, virtualizer);
    return () => registerLane(id, null);
  }, [id, registerLane, virtualizer]);

  const fallbackActive = activeCardId === null || !cards.some(card => card.id === activeCardId);
  return (
    <section
      aria-label={laneTitle(id)}
      data-lane={id}
      data-surface="panel"
      className={cn(LANE_SURFACE, GATE_LANES.has(id) ? 'border-governance/30' : 'border-divider')}
    >
      <LaneHeader id={id} count={cards.length} />
      {note}
      {/* biome-ignore lint/a11y/useSemanticElements: virtualized list: absolutely positioned rows inside a <div> scroll container */}
      <div
        ref={scroller}
        role="list"
        data-scroll-region={`lane-${id}`}
        onKeyDown={onKeyDown}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
      >
        {cards.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-fg-muted">{messages.board.emptyLane}</p>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map(item => {
              const card = cards[item.index];
              if (!card) return null;
              const active = card.id === activeCardId || (fallbackActive && item.index === 0);
              return (
                <div
                  key={item.key}
                  className="absolute inset-x-0 top-0"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <KanbanCard
                    card={card}
                    tabIndex={active ? 0 : -1}
                    onOpen={onOpen}
                    onFocusCard={onFocusCard}
                    footer={renderFooter(card)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

/** Inline gate action for a card in the Compuerta 1 lane. */
export function GateAction({ label, pending, onApprove }: { label: string; pending: boolean; onApprove(): void }) {
  return (
    <div className="flex items-center">
      <Button
        size="sm"
        variant="secondary"
        icon={ShieldCheck}
        disabled={pending}
        className="border-governance/40 text-governance enabled:hover:border-governance enabled:hover:bg-governance/10"
        onClick={event => {
          event.stopPropagation();
          onApprove();
        }}
        onKeyDown={event => event.stopPropagation()}
      >
        {label}
      </Button>
    </div>
  );
}

export { ProtectedState as InlineProtected };
