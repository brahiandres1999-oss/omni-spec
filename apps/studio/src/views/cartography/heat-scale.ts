/**
 * Single-hue cyan heat scale (VC-04): luminance grows strictly with heat, the hue stays within a few degrees
 * (no rainbow), and even the coolest step keeps ≥ 3:1 contrast on the Obsidian canvas.
 */
import { colors } from '@/design/tokens';

function channelsOf(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const LOW = channelsOf(colors.heatLow);
const HIGH = channelsOf(colors.heatHigh);

const toHex = (channel: number) => Math.round(channel).toString(16).padStart(2, '0');

/** `t` in [0, 1] (clamped) → `#rrggbb`. Every channel rises monotonically from heatLow to heatHigh. */
export function heatColor(t: number): string {
  const amount = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const mix = LOW.map((low, index) => low + ((HIGH[index] ?? low) - low) * amount);
  return `#${mix.map(toHex).join('')}`;
}

/** Heat of a node by Blast Radius distance: the closest dependants are the hottest. */
export function heatForDistance(distance: number, maxDistance: number): number {
  if (maxDistance <= 1) return 1;
  return 1 - (Math.max(1, distance) - 1) / (maxDistance - 1);
}

/** Base layer (D-14): centrality by in-degree, at no cost. */
export function heatForCentrality(dIn: number, maxDIn: number): number {
  return maxDIn <= 0 ? 0 : Math.sqrt(dIn / maxDIn);
}
