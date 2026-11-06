import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { TitleBar } from '@/shell/TitleBar';
import { renderWithStudio } from '@/test/render';
import { FakeTransport } from '@/test/fake-transport';
import { scriptStudio } from '@/test/fixtures';

/** Caption button rectangles (CSS px) reported to Rust for WM_NCHITTEST (WN-01). */
const RECTS: Record<string, { x: number; y: number; width: number; height: number }> = {
  Minimizar: { x: 1000, y: 0, width: 46, height: 32 },
  Maximizar: { x: 1046, y: 0, width: 46, height: 32 },
  Cerrar: { x: 1092, y: 0, width: 46, height: 32 },
};

let original: PropertyDescriptor | undefined;
beforeEach(() => {
  original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement) {
      const rect = RECTS[this.getAttribute('aria-label') ?? ''] ?? { x: 0, y: 0, width: 0, height: 0 };
      return {
        ...rect,
        top: rect.y,
        left: rect.x,
        right: rect.x + rect.width,
        bottom: rect.y + rect.height,
        toJSON: () => rect,
      };
    },
  });
});
afterEach(() => {
  if (original) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', original);
  else Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect');
});

const rect = (name: string) => expect.objectContaining(RECTS[name] ?? {});

describe('SH title bar', () => {
  test('SH-06 breadcrumb, drag region and caption controls whose rectangles are sent to Rust', async () => {
    const fake = scriptStudio(new FakeTransport());
    renderWithStudio(<TitleBar />, { transport: fake });
    const banner = screen.getByRole('banner');

    expect(await within(banner).findByText('branch: feat/nextgen-phase4-omni-studio')).toBeInTheDocument();
    expect(within(banner).getByText('Omni Studio')).toBeInTheDocument();
    expect(within(banner).getByText('omni-spec')).toBeInTheDocument();
    const breadcrumb = banner.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(breadcrumb).toMatch(/Omni Studio\s*\/\s*omni-spec\s*\/\s*branch: feat\/nextgen-phase4-omni-studio/);

    expect(
      banner.hasAttribute('data-tauri-drag-region') || banner.querySelector('[data-tauri-drag-region]'),
    ).toBeTruthy();
    for (const [name, glyph] of [
      ['Minimizar', '-'],
      ['Maximizar', '□'],
      ['Cerrar', '✕'],
    ] as const) {
      const button = within(banner).getByRole('button', { name });
      expect(button.textContent).toContain(glyph);
      expect(button.hasAttribute('data-tauri-drag-region')).toBe(false);
    }

    await waitFor(() => expect(fake.calls('window.set_caption_layout').length).toBeGreaterThanOrEqual(1));
    expect(fake.lastCall('window.set_caption_layout')).toEqual(
      expect.objectContaining({ minimize: rect('Minimizar'), maximize: rect('Maximizar'), close: rect('Cerrar') }),
    );

    const sent = fake.calls('window.set_caption_layout').length;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    await waitFor(() => expect(fake.calls('window.set_caption_layout').length).toBeGreaterThan(sent));
  });
});
