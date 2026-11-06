import { describe, expect, test } from 'vitest';
import { contrastRatio, relativeLuminance } from '@/design/contrast';
import { colors } from '@/design/tokens';
import { heatColor } from '@/views/cartography/heat-scale';

function hue(hex: string): { hue: number; saturation: number } {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (delta === 0) return { hue: 0, saturation };
  let h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  h *= 60;
  return { hue: h < 0 ? h + 360 : h, saturation };
}

const circularDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

describe('VC heat scale', () => {
  test('VC-04 single-hue, luminance-monotonic heat scale with ≥ 3:1 contrast on the canvas', () => {
    const samples: string[] = Array.from({ length: 21 }, (_, index) => heatColor(index / 20));
    for (const color of samples) expect(color).toMatch(/^#[0-9a-f]{6}$/i);

    const luminance: number[] = samples.map(color => relativeLuminance(color));
    const increasing = luminance.every((value, index) => index === 0 || value > (luminance[index - 1] ?? 0));
    const decreasing = luminance.every((value, index) => index === 0 || value < (luminance[index - 1] ?? 0));
    expect(increasing || decreasing, `luminance must be strictly monotonic: ${luminance.join(', ')}`).toBe(true);

    const hues = samples.map(hue).filter(entry => entry.saturation > 0.05);
    expect(hues.length, 'a single-hue scale is still chromatic').toBeGreaterThan(samples.length / 2);
    const reference = hues[0]?.hue ?? 0;
    for (const entry of hues) expect(circularDistance(entry.hue, reference)).toBeLessThanOrEqual(15);

    for (const color of samples) expect(contrastRatio(color, colors.canvas)).toBeGreaterThanOrEqual(3);
  });
});
