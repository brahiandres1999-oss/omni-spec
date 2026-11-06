/**
 * CartographyView — module graph explorer and Blast Radius heatmap (plan §11.4 VC-01…08, PJ-GRF, D-14).
 *
 * The graph is laid out in a Web Worker (deterministic seed) and drawn on a Canvas 2D with viewport culling.
 * The base layer colours nodes by centrality (in-degree); selecting a module — on the canvas or in the
 * keyboard-accessible "Módulos" listbox — asks the engine for its Blast Radius and paints the lineage.
 */
import { useVirtualizer } from '@tanstack/react-virtual';
import { type KeyboardEvent, type PointerEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useEnsureLoaded, useRefreshOn, useStudio } from '@/app/studio-context';
import { Icon, Network, ScanSearch, Search } from '@/components/ui/icon';
import { cn, focusRing, mono } from '@/components/ui/interaction';
import { ProtectedState } from '@/components/ui/ProtectedState';
import {
  EmptyState,
  ErrorState,
  rowHeightClass,
  SkeletonBar,
  SkeletonRow,
  ViewFrame,
} from '@/components/ui/view-state';
import { canvasInk, colors, fonts, rowHeights } from '@/design/tokens';
import type { GraphPayload } from '@/ipc/types';
import { formatInt, messages } from '@/i18n/messages.es';
import type { GraphStore } from '@/stores/graph';
import { BlastRadiusPanel } from './cartography/BlastRadiusPanel';
import { heatForCentrality, heatForDistance } from './cartography/heat-scale';
import type { LayoutPosition } from './cartography/layout.worker';
import { buildQuadtree, pick, type Viewport } from './cartography/quadtree';
import { drawGraph, EDGE_DASH, type GraphScene, nodeRadius } from './cartography/renderer';

const FRAME = 'grid h-full min-h-0 grid-cols-[minmax(0,1fr)_18rem]';
const LAYOUT_SEED = 42;

export function CartographyView() {
  const { project, dispatch } = useStudio();
  const graph = project.graph;
  const resource = useStore(graph, state => state.resource);
  useEnsureLoaded(resource);
  useRefreshOn(['graph'], resource);
  const status = useStore(resource, state => state.status);
  const data = useStore(resource, state => state.data);
  const error = useStore(resource, state => state.error);
  const frameState = status === 'idle' ? 'loading' : status;

  return (
    <ViewFrame view="cartography" state={frameState} layout="cartography-split" className={FRAME}>
      {frameState === 'loading' ? (
        <>
          <div className="m-4 mb-24 rounded-xl border border-divider bg-surface motion-safe:animate-pulse" />
          <div className="flex flex-col gap-1 border-s border-divider p-3">
            <SkeletonBar className="mb-2 w-24" />
            {Array.from({ length: 10 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows.
              <SkeletonRow key={index} token="list" />
            ))}
          </div>
        </>
      ) : frameState === 'ready' && data ? (
        <Explorer data={data} store={graph} />
      ) : (
        <div className="col-span-2">
          {frameState === 'empty' ? (
            <EmptyState
              icon={Network}
              title={messages.cartography.emptyTitle}
              body={messages.cartography.emptyBody}
              actions={[
                {
                  label: messages.cartography.ctaScan,
                  icon: ScanSearch,
                  primary: true,
                  onSelect: () => dispatch({ type: 'project.scan' }),
                },
              ]}
            />
          ) : frameState === 'protected' ? (
            <ProtectedState reason={error?.detail ?? ''} />
          ) : (
            <ErrorState error={error} onRetry={() => void resource.getState().retry()} />
          )}
        </div>
      )}
    </ViewFrame>
  );
}

/** Deterministic placeholder (a circle) shown until the worker answers. */
function circleLayout(data: GraphPayload): Map<number, { x: number; y: number }> {
  const radius = Math.max(80, data.nodes.length * 4);
  return new Map(
    data.nodes.map((node, index) => {
      const angle = (index / Math.max(1, data.nodes.length)) * Math.PI * 2;
      return [node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }];
    }),
  );
}

function useLayout(data: GraphPayload) {
  const [positions, setPositions] = useState(() => circleLayout(data));
  useEffect(() => {
    setPositions(circleLayout(data));
    const input = {
      nodes: data.nodes.map(node => ({ id: node.id })),
      edges: data.edges.map(edge => ({ s: edge.s, t: edge.t })),
      seed: LAYOUT_SEED,
    };
    const apply = (result: LayoutPosition[]) =>
      setPositions(new Map(result.map(position => [position.id, { x: position.x, y: position.y }])));
    if (typeof Worker === 'undefined') {
      let cancelled = false;
      void import('./cartography/layout.worker').then(module => {
        if (!cancelled) apply(module.computeLayout(input));
      });
      return () => {
        cancelled = true;
      };
    }
    const worker = new Worker(new URL('./cartography/layout.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ seed: number; positions: LayoutPosition[] }>) => {
      if (event.data?.seed === LAYOUT_SEED) apply(event.data.positions);
    };
    worker.postMessage(input);
    return () => worker.terminate();
  }, [data]);
  return positions;
}

function Explorer({ data, store }: { data: GraphPayload; store: GraphStore }) {
  const selected = useStore(store, state => state.selected);
  const heat = useStore(store, state => state.heat);
  const positions = useLayout(data);

  const scene = useMemo<GraphScene>(() => {
    const maxDIn = Math.max(0, ...data.nodes.map(node => node.dIn));
    const lineage = new Map((heat.data?.nodes ?? []).map(node => [node.id, node.distance]));
    const maxDistance = Math.max(1, ...lineage.values());
    const showLineage = selected !== null && heat.status === 'ready';
    return {
      nodes: data.nodes.map(node => {
        const position = positions.get(node.id) ?? { x: 0, y: 0 };
        const distance = lineage.get(node.id);
        const isSelected = node.path === selected;
        return {
          ...node,
          ...position,
          selected: isSelected,
          lineage: showLineage && distance !== undefined,
          heat: showLineage
            ? isSelected
              ? 1
              : distance !== undefined
                ? heatForDistance(distance, maxDistance)
                : undefined
            : heatForCentrality(node.dIn, maxDIn),
        };
      }),
      edges: data.edges,
    };
  }, [data, heat, positions, selected]);

  return (
    <>
      <div className="relative min-h-0 min-w-0">
        <GraphCanvas scene={scene} onPick={path => void store.getState().select(path)} />
        <div className="pointer-events-none absolute start-4 top-3 flex gap-3 text-[11px] text-fg-muted">
          <span>
            <span className={cn('text-fg', mono)}>{formatInt(data.nodes.length)}</span> {messages.cartography.nodes}
          </span>
          <span>
            <span className={cn('text-fg', mono)}>{formatInt(data.edges.length)}</span> {messages.cartography.edges}
          </span>
          <span>
            <span className={cn('text-fg', mono)}>
              {formatInt(data.cycles.length)}
              {data.cyclesTruncated ? '+' : ''}
            </span>{' '}
            {messages.cartography.cycles}
          </span>
        </div>
      </div>
      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_minmax(0,14rem)] border-s border-divider pb-20">
        <Legend />
        <ModuleList data={data} selected={selected} onSelect={path => void store.getState().select(path)} />
        <div className="min-h-0 border-t border-divider">
          <BlastRadiusPanel selected={selected} status={heat.status} heat={heat.data} error={heat.error} />
        </div>
      </div>
    </>
  );
}

function Legend() {
  const edge = (dash: readonly number[]) => (
    <svg aria-hidden="true" width="20" height="8" className="shrink-0 text-fg-muted">
      <line x1="1" x2="19" y1="4" y2="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray={dash.join(' ')} />
    </svg>
  );
  return (
    <ul
      aria-label={messages.cartography.legend}
      className="grid grid-cols-2 gap-x-3 gap-y-1 border-b border-divider p-3 text-[11px] text-fg-muted"
    >
      <li className="flex items-center gap-1.5">
        <svg aria-hidden="true" width="14" height="14" className="shrink-0 text-fg">
          <rect x="1" y="1" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.25" />
          <circle cx="7" cy="7" r="3.5" className="fill-fg-muted" />
        </svg>
        {messages.cartography.contract}
      </li>
      <li className="flex items-center gap-1.5">
        <svg aria-hidden="true" width="14" height="14" className="shrink-0">
          <circle cx="7" cy="7" r="5" className="fill-fg-muted" />
          <rect x="5" y="5" width="4" height="4" className="fill-canvas" />
        </svg>
        {messages.cartography.barrel}
      </li>
      <li className="flex items-center gap-1.5">
        {edge(EDGE_DASH.value)}
        {messages.cartography.edgeValue}
      </li>
      <li className="flex items-center gap-1.5">
        {edge(EDGE_DASH.type_only)}
        {messages.cartography.edgeType}
      </li>
      <li className="col-span-2 flex items-center gap-1.5">
        {edge(EDGE_DASH.synthetic)}
        {messages.cartography.edgeSynthetic}
      </li>
    </ul>
  );
}

function ModuleList({
  data,
  selected,
  onSelect,
}: {
  data: GraphPayload;
  selected: string | null;
  onSelect(path: string): void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const modules = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...data.nodes]
      .filter(node => node.path.toLowerCase().includes(needle))
      .sort((a, b) => b.dIn - a.dIn || a.path.localeCompare(b.path));
  }, [data.nodes, query]);
  const virtualizer = useVirtualizer({
    count: modules.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeights.list,
    overscan: 8,
    initialRect: { width: 0, height: 480 },
  });
  const optionId = (index: number) => `${listId}-option-${modules[index]?.id ?? index}`;
  const activeIndex = Math.min(active, Math.max(0, modules.length - 1));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = (next: number) => {
      const clamped = Math.max(0, Math.min(modules.length - 1, next));
      setActive(clamped);
      virtualizer.scrollToIndex(clamped, { align: 'auto' });
      event.preventDefault();
    };
    if (event.key === 'ArrowDown') move(activeIndex + 1);
    else if (event.key === 'ArrowUp') move(activeIndex - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(modules.length - 1);
    else if (event.key === 'Enter' || event.key === ' ') {
      const module = modules[activeIndex];
      if (module) onSelect(module.path);
      event.preventDefault();
    }
  };

  return (
    <div className="flex min-h-0 flex-col">
      <label className="flex items-center gap-2 border-b border-divider px-3 py-2">
        <Icon icon={Search} className="text-fg-muted" />
        <span className="sr-only">{messages.cartography.filter}</span>
        <input
          type="search"
          value={query}
          placeholder={messages.cartography.filter}
          onChange={event => {
            setQuery(event.target.value);
            setActive(0);
          }}
          className={cn(
            'h-7 min-w-0 flex-1 rounded-md bg-transparent px-1 text-xs text-fg placeholder:text-fg-muted',
            focusRing,
          )}
        />
      </label>
      <h3 className="px-3 pt-2 pb-1 text-[11px] font-semibold text-fg-muted">{messages.cartography.modules}</h3>
      <div
        ref={scroller}
        role="listbox"
        aria-label={messages.cartography.modules}
        aria-activedescendant={modules.length > 0 ? optionId(activeIndex) : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-scroll-region="modules"
        className={cn(
          'relative min-h-0 flex-1 overflow-y-auto overscroll-contain',
          focusRing,
          'focus-visible:-outline-offset-2',
        )}
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map(item => {
            const module = modules[item.index];
            if (!module) return null;
            const isSelected = module.path === selected;
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled by the listbox (aria-activedescendant).
              // biome-ignore lint/a11y/useFocusableInteractive: listbox options are reached through aria-activedescendant
              <div
                key={module.id}
                id={optionId(item.index)}
                role="option"
                aria-selected={isSelected}
                aria-label={module.path}
                data-row-height="list"
                onClick={() => {
                  setActive(item.index);
                  onSelect(module.path);
                }}
                className={cn(
                  rowHeightClass('list'),
                  'absolute inset-x-0 top-0 flex cursor-default items-center gap-2 px-3 text-xs',
                  isSelected ? 'bg-accent/15 text-accent-bright' : 'text-fg hover:bg-divider',
                  item.index === activeIndex && 'outline-1 -outline-offset-1 outline-divider',
                )}
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <span className={cn('min-w-0 flex-1 truncate', mono)}>{module.path}</span>
                {module.contractLevel > 0 ? (
                  <span aria-hidden="true" className="size-2.5 shrink-0 border border-fg" />
                ) : null}
                {module.isBarrel ? <span aria-hidden="true" className="size-1.5 shrink-0 bg-fg-muted" /> : null}
                <span aria-hidden="true" className={cn('w-6 shrink-0 text-end text-fg-muted', mono)}>
                  {module.dIn}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function fitViewport(scene: GraphScene, width: number, height: number): Viewport {
  if (scene.nodes.length === 0 || width === 0 || height === 0)
    return { x: -width / 2, y: -height / 2, zoom: 1, width, height };
  const xs = scene.nodes.map(node => node.x);
  const ys = scene.nodes.map(node => node.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const margin = 48;
  const zoom = Math.min(
    2,
    Math.max(
      0.05,
      Math.min((width - margin * 2) / Math.max(1, maxX - minX), (height - margin * 2) / Math.max(1, maxY - minY)),
    ),
  );
  return {
    x: (minX + maxX) / 2 - width / 2 / zoom,
    y: (minY + maxY) / 2 - height / 2 / zoom,
    zoom,
    width,
    height,
  };
}

function GraphCanvas({ scene, onPick }: { scene: GraphScene; onPick(path: string): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const element = canvas.current?.parentElement;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Fit the whole graph whenever the layout changes (not on every heat update).
  const layoutKey = scene.nodes.map(node => `${node.x.toFixed(1)},${node.y.toFixed(1)}`).join(';');
  // biome-ignore lint/correctness/useExhaustiveDependencies: refit only when positions or size change.
  useEffect(() => {
    setViewport(fitViewport(scene, size.width, size.height));
  }, [layoutKey, size.width, size.height]);

  const tree = useMemo(
    () => buildQuadtree(scene.nodes.map(node => ({ id: node.id, x: node.x, y: node.y, r: nodeRadius(node) }))),
    [scene.nodes],
  );

  useEffect(() => {
    const element = canvas.current;
    if (!element || !viewport) return;
    const frame = requestAnimationFrame(() => {
      const ctx = element.getContext('2d');
      if (!ctx) return;
      const ratio = globalThis.devicePixelRatio || 1;
      element.width = Math.round(size.width * ratio);
      element.height = Math.round(size.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = colors.canvas;
      ctx.fillRect(0, 0, size.width, size.height);
      drawGraph(ctx, scene, { ...viewport, width: size.width, height: size.height });
      const focus = scene.nodes.find(node => node.selected);
      if (focus) {
        ctx.font = `11px ${fonts.mono}`;
        ctx.fillStyle = canvasInk.label;
        ctx.fillText(
          focus.path,
          (focus.x - viewport.x) * viewport.zoom + 12,
          (focus.y - viewport.y) * viewport.zoom - 10,
        );
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [scene, size, viewport]);

  // Wheel zoom around the pointer (non-passive so the page does not scroll).
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setViewport(current => {
        if (!current) return current;
        const factor = Math.exp(-event.deltaY * 0.0015);
        const zoom = Math.min(8, Math.max(0.02, current.zoom * factor));
        const rect = element.getBoundingClientRect();
        const sx = event.clientX - rect.left;
        const sy = event.clientY - rect.top;
        const wx = sx / current.zoom + current.x;
        const wy = sy / current.zoom + current.y;
        return { ...current, zoom, x: wx - sx / zoom, y: wy - sy / zoom };
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const start = drag.current;
    if (!start || !viewport) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 3) return;
    start.moved = true;
    drag.current = { x: event.clientX, y: event.clientY, moved: true };
    setViewport({ ...viewport, x: viewport.x - dx / viewport.zoom, y: viewport.y - dy / viewport.zoom });
  };
  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const start = drag.current;
    drag.current = null;
    if (!start || start.moved || !viewport) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const id = pick(tree, { x: event.clientX - rect.left, y: event.clientY - rect.top }, viewport);
    const node = id === null ? undefined : scene.nodes.find(candidate => candidate.id === id);
    if (node) onPick(node.path);
  };

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={messages.cartography.canvas}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="absolute inset-0 size-full touch-none"
    />
  );
}
