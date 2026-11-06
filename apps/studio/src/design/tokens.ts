/**
 * Design tokens for code that cannot use Tailwind classes (canvas drawing, xterm theme, contrast checks).
 * Mirrors `tokens.css` (STUDIO-DESIGN-SYSTEM.md §2.1); DS-04 keeps both in sync.
 */
export const colors = {
  canvas: '#121213',
  surface: '#18181a',
  floating: '#1e1e21',
  floatingBorder: '#2a2a2e',
  divider: '#262628',
  accent: '#06b6d4',
  accentBright: '#22d3ee',
  governance: '#f59e0b',
  attested: '#10b981',
  breach: '#f43f5e',
  fg: '#ededef',
  fgMuted: '#a1a1aa',
  /** Ends of the single-hue cyan heat scale (VC-04): darkest still ≥ 3:1 on the canvas. */
  heatLow: '#0e7490',
  heatHigh: '#a5f3fc',
} as const;

/** Canvas strokes: edges are drawn translucent over the canvas. */
export const canvasInk = {
  edge: '#a1a1aa66',
  edgeLineage: '#22d3eecc',
  nodeOutline: '#121213',
  label: '#ededef',
} as const;

export const fonts = {
  mono: '"Cascadia Mono", Consolas, monospace',
  sans: '"Segoe UI Variable", "Segoe UI", system-ui',
} as const;

/** Row heights in CSS px, identical to the `--row-*` variables in tokens.css (virtualizers need numbers). */
export const rowHeights = {
  boardCard: 108,
  list: 28,
  diffLine: 20,
  file: 26,
  skill: 64,
  finopsTask: 88,
} as const;

/** Gap between board cards (Tailwind `gap-2`). */
export const BOARD_CARD_GAP = 8;

export type ColorToken = keyof typeof colors;
