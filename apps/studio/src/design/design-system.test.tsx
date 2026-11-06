/// <reference types="node" />
/**
 * DS — rendered-DOM checks of STUDIO-DESIGN-SYSTEM.md §1 and §3 on every view in its ready state
 * (plus the board's Empty CTAs and the shell chrome).
 */
import { existsSync, globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Check } from 'lucide-react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Icon } from '@/components/ui/icon';
import { AppShell } from '@/shell/AppShell';
import { renderWithStudio } from '@/test/render';
import { BoardView } from '@/views/BoardView';
import { CartographyView } from '@/views/CartographyView';
import { DiffView } from '@/views/DiffView';
import { FinopsView } from '@/views/FinopsView';
import { SkillsView } from '@/views/SkillsView';
import { FakeTransport } from '@/test/fake-transport';
import { board, installLayoutStub, scriptStudio, stubCanvas, stubWorker } from '@/test/fixtures';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));

interface ReadyCase {
  name: string;
  element: () => ReactElement;
  script?: (fake: FakeTransport) => void;
  state: 'ready' | 'empty';
}

const CASES: ReadyCase[] = [
  { name: 'board', element: () => <BoardView />, state: 'ready' },
  {
    name: 'board',
    element: () => <BoardView />,
    script: fake => fake.respond('board.get', board('standard', [])),
    state: 'empty',
  },
  { name: 'cartography', element: () => <CartographyView />, state: 'ready' },
  { name: 'diff', element: () => <DiffView spec="001" />, state: 'ready' },
  { name: 'finops', element: () => <FinopsView />, state: 'ready' },
  { name: 'skills', element: () => <SkillsView />, state: 'ready' },
];

let restoreLayout: () => void = () => undefined;
beforeEach(() => {
  restoreLayout = installLayoutStub();
  stubCanvas();
  stubWorker();
});
afterEach(() => {
  vi.unstubAllGlobals();
  restoreLayout();
});

async function mount(entry: ReadyCase) {
  const fake = scriptStudio(new FakeTransport());
  entry.script?.(fake);
  const view = renderWithStudio(entry.element(), { transport: fake });
  const root = await waitFor(() => {
    const element = document.querySelector<HTMLElement>(`[data-view="${entry.name}"][data-state="${entry.state}"]`);
    if (!element) throw new Error(`${entry.name} never reached ${entry.state}`);
    return element;
  });
  return { fake, view, root };
}

async function mountShell() {
  const fake = scriptStudio(new FakeTransport());
  const view = renderWithStudio(<AppShell />, { transport: fake });
  await waitFor(() => {
    if (!document.querySelector('[data-view="board"][data-state="ready"]')) throw new Error('shell board not ready');
  });
  return { fake, view };
}

const PRESS = ['transition-[scale,background-color,border-color]', 'duration-150', 'ease-out'];
const FOCUS_RING = /^focus-visible:(?:ring|outline)-accent(?:\/\d+)?$/;

function describeElement(element: Element): string {
  const label = element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 40) ?? '';
  return `<${element.tagName.toLowerCase()} role=${element.getAttribute('role') ?? ''}> ${label}`;
}

function assertPress(scope: ParentNode): number {
  let checked = 0;
  for (const element of scope.querySelectorAll<HTMLElement>('button, [role="tab"]')) {
    for (const name of ['enabled:active:scale-[0.96]', ...PRESS])
      expect(element.classList.contains(name), `${describeElement(element)} lacks ${name}`).toBe(true);
    checked++;
  }
  for (const element of scope.querySelectorAll<HTMLElement>('[data-surface="card"][tabindex]')) {
    if (element.tagName === 'BUTTON') continue;
    for (const name of ['active:scale-[0.96]', ...PRESS])
      expect(element.classList.contains(name), `${describeElement(element)} lacks ${name}`).toBe(true);
    checked++;
  }
  return checked;
}

describe('DS design system (rendered views)', () => {
  test('DS-03 no card inside a card and no panel inside a panel in any ready view', async () => {
    for (const entry of CASES.filter(candidate => candidate.state === 'ready')) {
      const { root, view } = await mount(entry);
      expect(root.querySelectorAll('[data-surface="card"] [data-surface="card"]'), entry.name).toHaveLength(0);
      expect(root.querySelectorAll('[data-surface="panel"] [data-surface="panel"]'), entry.name).toHaveLength(0);
      if (entry.name === 'board') expect(root.querySelectorAll('[data-surface="card"]').length).toBeGreaterThan(0);
      view.unmount();
    }
    const { view } = await mountShell();
    expect(document.querySelectorAll('[data-surface="panel"] [data-surface="panel"]')).toHaveLength(0);
    view.unmount();
  });

  test('DS-08 Better UI press calibration on every button, tab and interactive card', async () => {
    let checked = 0;
    for (const entry of CASES) {
      const { root, view } = await mount(entry);
      checked += assertPress(root);
      view.unmount();
    }
    const { view } = await mountShell();
    checked += assertPress(document.body);
    view.unmount();
    expect(checked).toBeGreaterThan(10);
  });

  test('DS-12 lucide-react is confined to components/ui/icon.tsx (strokeWidth 1.75, size 16 | 18)', async () => {
    const sources = globSync('src/**/*.{ts,tsx}', { cwd: APP_ROOT })
      .map(path => path.replaceAll('\\', '/'))
      .filter(path => !/\.test\.tsx?$/.test(path) && !path.startsWith('src/test/'));
    expect(existsSync(`${APP_ROOT}src/components/ui/icon.tsx`)).toBe(true);
    const importers = sources.filter(path =>
      /from\s+['"]lucide-react|import\(\s*['"]lucide-react/.test(readFileSync(`${APP_ROOT}${path}`, 'utf8')),
    );
    expect(importers).toEqual(['src/components/ui/icon.tsx']);
    expect(readFileSync(`${APP_ROOT}src/components/ui/icon.tsx`, 'utf8')).toMatch(/strokeWidth=\{1\.75\}/);

    const { container } = render(
      <>
        <Icon icon={Check} />
        <Icon icon={Check} size={18} />
      </>,
    );
    const [small, large] = [...container.querySelectorAll('svg')];
    expect(small).toHaveAttribute('stroke-width', '1.75');
    expect(small).toHaveAttribute('width', '16');
    expect(large).toHaveAttribute('width', '18');
    expect(typeof sizeIsALiteralType).toBe('function');

    // Buttons with icon + text use the asymmetric padding.
    for (const entry of CASES) {
      const { root, view } = await mount(entry);
      for (const button of root.querySelectorAll<HTMLElement>('button')) {
        const hasIcon = button.querySelector('svg') !== null;
        const hasText = (button.textContent ?? '').trim().length > 0;
        if (hasIcon && hasText) expect(button, describeElement(button)).toHaveClass('ps-2.5', 'pe-3.5');
      }
      view.unmount();
    }
  });

  test('DS-13 overscroll-contain on the diff viewer, the ConPTY terminal and the file tree', async () => {
    const diff = await mount({ name: 'diff', element: () => <DiffView spec="001" />, state: 'ready' });
    expect(diff.root.querySelector('[data-scroll-region="diff"]')).toHaveClass('overscroll-contain');
    diff.view.unmount();

    const user = userEvent.setup();
    const { view } = await mountShell();
    const inspector = screen.getByRole('complementary', { name: 'Inspector' });
    const tab = (name: string) => within(within(inspector).getByRole('tablist')).getByRole('tab', { name });
    await user.click(tab('Terminal'));
    await waitFor(() =>
      expect(inspector.querySelector('[data-scroll-region="terminal"]')).toHaveClass('overscroll-contain'),
    );
    await user.click(tab('Files'));
    await waitFor(() =>
      expect(inspector.querySelector('[data-scroll-region="files"]')).toHaveClass('overscroll-contain'),
    );
    view.unmount();
  });

  test('DS-14 tabbing through every view shows the accent focus ring on each focused element', async () => {
    const user = userEvent.setup();
    for (const entry of CASES.filter(candidate => candidate.state === 'ready')) {
      const { root, view } = await mount(entry);
      const visited = new Set<Element>();
      for (let step = 0; step < 80; step++) {
        await user.tab();
        const active = document.activeElement;
        if (!active || active === document.body || visited.has(active)) break;
        if (!root.contains(active)) break;
        visited.add(active);
        const ring = [...active.classList].some(name => FOCUS_RING.test(name));
        expect(ring, `${entry.name}: ${describeElement(active)} has no accent focus ring`).toBe(true);
      }
      expect(visited.size, `${entry.name} has focusable elements`).toBeGreaterThan(0);
      view.unmount();
    }
  });
});

/** Type-level contract (checked by `tsc --noEmit`): Icon only accepts size 16 or 18. */
function sizeIsALiteralType(): ReactElement {
  // @ts-expect-error size must be the literal 16 or 18
  return <Icon icon={Check} size={20} />;
}
