/**
 * Better UI calibration shared by every interactive element (STUDIO-DESIGN-SYSTEM.md §3, DS-08, DS-14).
 *
 * - Press: `scale` 0.96 while active, animated together with colour changes (never `transition` on all).
 *   Tailwind v4 compiles `scale-*` to the CSS `scale` property, hence `transition-[scale,…]`.
 * - Focus: a 2 px accent outline only for keyboard focus.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const pressMotion = 'transition-[scale,background-color,border-color] duration-150 ease-out';

/** Buttons, tabs, switches: `enabled:` so a disabled control does not react to presses. */
export const press = `enabled:active:scale-[0.96] ${pressMotion}`;

/** Interactive cards are not form controls, so they use plain `active:`. */
export const pressCard = `active:scale-[0.96] ${pressMotion}`;

export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** Keyboard focus outline drawn inside the element, for rows that fill a scroll container edge to edge. */
export const focusRingInset = 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent';

/** Data, paths, ids and metadata (DS-07). */
export const mono = 'font-mono tabular-nums';
