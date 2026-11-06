/**
 * BoardView — adaptive ceremony Kanban (plan §11.4 VB-01…07, PJ-BRD).
 *
 * The board is a read-only projection (D-11): lanes come from the route (`--light` 3, `--standard` 4,
 * `--full` 6), filters combine with AND on the engine side, and the only transitions are explicit actions
 * such as "Aprobar Compuerta 1", validated by the engine.
 */
import type { Virtualizer } from '@tanstack/react-virtual';
import { Dialog } from 'radix-ui';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useEnsureLoaded, useRefreshOn, useStudio } from '@/app/studio-context';
import { Button } from '@/components/ui/button';
import { FilePlus, Hammer, Icon, KanbanSquare, ScanSearch, X } from '@/components/ui/icon';
import { cn, focusRing, mono, press } from '@/components/ui/interaction';
import {
  GateAction,
  InlineProtected,
  KanbanLane,
  LANES_BY_ROUTE,
  LANES_GRID,
  LaneSkeleton,
  laneTitle,
} from '@/components/ui/kanban-board';
import { EmptyState, ErrorState, SkeletonBar, ViewFrame } from '@/components/ui/view-state';
import { ProtectedState } from '@/components/ui/ProtectedState';
import type { BoardCard, BoardFilters, BoardPayload, BoardRoute } from '@/ipc/types';
import { messages } from '@/i18n/messages.es';
import { hasActiveFilters } from '@/stores/board';

const FRAME = 'grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]';
const ROUTES: BoardRoute[] = ['light', 'standard', 'full'];

const FILTER_GROUPS: Array<{ key: keyof BoardFilters; label: string }> = [
  { key: 'tags', label: messages.board.tag },
  { key: 'risk', label: messages.board.risk },
  { key: 'owner', label: messages.board.owner },
];

export function BoardView({ route }: { route?: BoardRoute }) {
  const { project, dispatch } = useStudio();
  const board = project.board;
  const resource = useStore(board, state => state.resource);

  useEffect(() => {
    if (route) board.getState().setRoute(route);
  }, [board, route]);
  useEnsureLoaded(resource);
  useRefreshOn(['board'], resource);

  const status = useStore(resource, state => state.status);
  const data = useStore(resource, state => state.data);
  const error = useStore(resource, state => state.error);
  const chosenRoute = useStore(board, state => state.route);
  const currentRoute = chosenRoute ?? data?.route ?? 'standard';

  const frameState = status === 'idle' ? 'loading' : status;

  return (
    <ViewFrame view="board" state={frameState} layout="board-lanes" className={FRAME}>
      {frameState === 'loading' ? (
        <>
          <div className="flex h-12 items-center gap-3 border-b border-divider px-4">
            <SkeletonBar className="w-48" />
            <SkeletonBar className="ms-auto w-40" />
          </div>
          <div className={LANES_GRID}>
            {LANES_BY_ROUTE[currentRoute].map(id => (
              <LaneSkeleton key={id} id={id} />
            ))}
          </div>
        </>
      ) : (
        <>
          <BoardToolbar counts={data?.counts} shownRoute={data?.route ?? null} />
          {frameState === 'ready' && data ? (
            <Lanes data={data} />
          ) : frameState === 'empty' ? (
            <EmptyState
              icon={KanbanSquare}
              title={messages.board.emptyTitle}
              body={messages.board.emptyBody}
              actions={[
                { label: messages.board.ctaHotfix, icon: Hammer, onSelect: () => dispatch({ type: 'spec.hotfix' }) },
                {
                  label: messages.board.ctaNew,
                  icon: FilePlus,
                  primary: true,
                  onSelect: () => dispatch({ type: 'spec.new' }),
                },
                { label: messages.board.ctaScan, icon: ScanSearch, onSelect: () => dispatch({ type: 'project.scan' }) },
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

function BoardToolbar({
  counts,
  shownRoute,
}: {
  counts: BoardPayload['counts'] | undefined;
  shownRoute: BoardRoute | null;
}) {
  const { project } = useStudio();
  const board = project.board;
  const filters = useStore(board, state => state.filters);
  const options = useStore(board, state => state.options);
  const route = useStore(board, state => state.route) ?? shownRoute;

  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b border-divider px-4 py-2">
      <div role="toolbar" aria-label={messages.board.filters} className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {FILTER_GROUPS.map(group => (
          // biome-ignore lint/a11y/useSemanticElements: a filter group inside a toolbar, not a form fieldset (VB-03)
          <div key={group.key} role="group" aria-label={group.label} className="flex items-center gap-1">
            <span className="me-1 text-[11px] font-medium text-fg-muted">{group.label}</span>
            {options[group.key].length === 0 ? <span className="text-[11px] text-fg-muted">—</span> : null}
            {options[group.key].map(value => {
              const pressed = filters[group.key].includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => board.getState().toggleFilter(group.key, value)}
                  className={cn(
                    'h-6 rounded-full border px-2 text-[11px]',
                    pressed
                      ? 'border-accent/60 bg-accent/15 text-accent-bright'
                      : 'border-floating-border text-fg-muted hover:border-fg-muted/40 hover:text-fg',
                    press,
                    focusRing,
                  )}
                >
                  {value}
                </button>
              );
            })}
          </div>
        ))}
        {hasActiveFilters(filters) ? (
          <Button size="sm" variant="ghost" icon={X} onClick={() => board.getState().clearFilters()}>
            {messages.board.clearFilters}
          </Button>
        ) : null}
      </div>
      <div
        role="radiogroup"
        aria-label={messages.board.route}
        className="ms-auto flex items-center rounded-lg border border-floating-border p-0.5"
      >
        {ROUTES.map(option => (
          // biome-ignore lint/a11y/useSemanticElements: segmented control styled as buttons with radio semantics
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={route === option}
            onClick={() => board.getState().setRoute(option)}
            className={cn(
              'flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px]',
              route === option ? 'bg-divider text-fg' : 'text-fg-muted hover:text-fg',
              press,
              focusRing,
            )}
          >
            <span className={mono}>{messages.board.routes[option]}</span>
            {counts ? <span className={cn('text-fg-muted', mono)}>{counts[option]}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

interface Position {
  lane: number;
  index: number;
}

function Lanes({ data }: { data: BoardPayload }) {
  const { project } = useStudio();
  const board = project.board;
  const gateAttempts = useStore(board, state => state.gateAttempts);
  const focusRequest = useStore(board, state => state.focusRequest);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [openCard, setOpenCard] = useState<BoardCard | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const lanes = useRef(new Map<string, Virtualizer<HTMLDivElement, Element>>());

  const columns = useMemo(() => {
    const result = data.lanes.map(lane => ({ id: lane.id, cards: lane.cards }));
    if (data.unrouted.length > 0) result.push({ id: 'unrouted', cards: data.unrouted });
    return result;
  }, [data]);

  const registerLane = useCallback((id: string, virtualizer: Virtualizer<HTMLDivElement, Element> | null) => {
    if (virtualizer) lanes.current.set(id, virtualizer);
    else lanes.current.delete(id);
  }, []);

  const locate = useCallback(
    (id: string): Position | null => {
      for (let lane = 0; lane < columns.length; lane++) {
        const index = columns[lane]?.cards.findIndex(card => card.id === id) ?? -1;
        if (index >= 0) return { lane, index };
      }
      return null;
    },
    [columns],
  );

  /** Focuses a card, scrolling its lane first when the card is virtualized out of the DOM. */
  const focusCard = useCallback(
    (lane: number, index: number) => {
      const column = columns[lane];
      const card = column?.cards[index];
      if (!column || !card) return;
      setActiveCardId(card.id);
      const find = () => container.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(card.id)}"]`);
      const element = find();
      if (element) {
        element.focus();
        return;
      }
      lanes.current.get(column.id)?.scrollToIndex(index, { align: 'auto' });
      requestAnimationFrame(() => find()?.focus());
    },
    [columns],
  );

  // Rail → "focus this spec" (SH-04).
  useEffect(() => {
    if (!focusRequest) return;
    const position = locate(focusRequest.id);
    board.setState({ focusRequest: null });
    if (position) focusCard(position.lane, position.index);
  }, [board, focusCard, focusRequest, locate]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const id = target.dataset.cardId;
    if (!id) return;
    const position = locate(id);
    if (!position) return;
    const column = columns[position.lane];
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        const next = position.index + (event.key === 'ArrowDown' ? 1 : -1);
        if (column && next >= 0 && next < column.cards.length) focusCard(position.lane, next);
        event.preventDefault();
        break;
      }
      case 'ArrowRight':
      case 'ArrowLeft': {
        const step = event.key === 'ArrowRight' ? 1 : -1;
        for (let lane = position.lane + step; lane >= 0 && lane < columns.length; lane += step) {
          const length = columns[lane]?.cards.length ?? 0;
          if (length > 0) {
            focusCard(lane, Math.min(position.index, length - 1));
            break;
          }
        }
        event.preventDefault();
        break;
      }
      case 'Home':
        focusCard(position.lane, 0);
        event.preventDefault();
        break;
      case 'End':
        focusCard(position.lane, (column?.cards.length ?? 1) - 1);
        event.preventDefault();
        break;
      case 'Enter':
      case ' ': {
        const card = column?.cards[position.index];
        if (card) setOpenCard(card);
        event.preventDefault();
        break;
      }
    }
  };

  const firstCard = columns.find(column => column.cards.length > 0)?.cards[0]?.id ?? null;
  const active = activeCardId && locate(activeCardId) ? activeCardId : firstCard;

  const renderFooter = (card: BoardCard) => {
    const attempt = gateAttempts[card.id];
    if (attempt?.status === 'locked') return <InlineProtected variant="inline" reason={attempt.error?.detail ?? ''} />;
    if (card.attestation === 'invalid' || card.protected)
      return <InlineProtected variant="inline" reason={messages.board.attestation.invalid ?? ''} />;
    if (card.lane === 'gate-1' && card.gates[1] !== 'approved')
      return (
        <GateAction
          label={messages.board.approveGate1}
          pending={attempt?.status === 'pending'}
          onApprove={() => void board.getState().approveGate(card.id, 1)}
        />
      );
    if (card.suggestedAction)
      return (
        <p className={cn('truncate text-[11px] text-accent', mono)}>
          {messages.board.suggestFit} {card.suggestedAction.spec}
        </p>
      );
    return undefined;
  };

  return (
    <div ref={container} className={LANES_GRID}>
      {columns.map(column => (
        <KanbanLane
          key={column.id}
          id={column.id}
          cards={column.cards}
          activeCardId={active}
          renderFooter={renderFooter}
          onOpen={setOpenCard}
          onFocusCard={setActiveCardId}
          onKeyDown={onKeyDown}
          registerLane={registerLane}
        />
      ))}
      <CardDetail card={openCard} onClose={() => setOpenCard(null)} />
    </div>
  );
}

function CardDetail({ card, onClose }: { card: BoardCard | null; onClose(): void }) {
  return (
    <Dialog.Root open={card !== null} onOpenChange={open => (open ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/70" />
        <Dialog.Content
          aria-modal="true"
          className="fixed start-1/2 top-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-floating-border bg-floating p-5 text-fg"
        >
          {card ? (
            <>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="truncate text-base font-semibold">
                    <span className={cn('me-2 text-fg-muted', mono)}>{card.id}</span>
                    {card.title}
                  </Dialog.Title>
                  <Dialog.Description className={cn('mt-0.5 truncate text-xs text-fg-muted', mono)}>
                    {card.slug}
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <Button size="icon-sm" variant="ghost" aria-label={messages.board.close}>
                    <Icon icon={X} />
                  </Button>
                </Dialog.Close>
              </div>
              <dl className="mt-4 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
                <dt className="text-fg-muted">{messages.board.routeLabel}</dt>
                <dd className={mono}>{card.route ?? laneTitle('unrouted')}</dd>
                <dt className="text-fg-muted">{messages.board.riskLabel}</dt>
                <dd>{card.risk ?? '—'}</dd>
                <dt className="text-fg-muted">{messages.board.ownerLabel}</dt>
                <dd>{card.owner ?? messages.board.noOwner}</dd>
                <dt className="text-fg-muted">{messages.board.tasksLabel}</dt>
                <dd className={mono}>{card.tasks ? `${card.tasks.done}/${card.tasks.total}` : '—'}</dd>
                <dt className="text-fg-muted">{messages.board.tagsLabel}</dt>
                <dd>{card.tags.length > 0 ? card.tags.join(', ') : '—'}</dd>
                <dt className="text-fg-muted">{messages.board.gate} 1 · 2</dt>
                <dd className={mono}>
                  {messages.board.gateStatus[card.gates[1]]} · {messages.board.gateStatus[card.gates[2]]}
                </dd>
                <dt className="text-fg-muted">HMAC</dt>
                <dd>{messages.board.attestation[card.attestation] ?? card.attestation}</dd>
              </dl>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
