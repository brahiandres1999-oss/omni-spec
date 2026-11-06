/**
 * `renderWithStudio(ui, { transport, onAction })` (plan §11.0): renders inside a fresh StudioProvider wired
 * to a FakeTransport, so every test starts with new stores. happy-dom has no canvas/WebGL, so terminals are
 * headless here (the xterm bridge itself is covered by VT with doubles).
 */
import { type RenderOptions, type RenderResult, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { type StudioAction, StudioProvider } from '@/app/studio-context';
import { createStudioClient } from '@/ipc/client';
import { FakeTransport } from './fake-transport';

export interface StudioRenderOptions extends Omit<RenderOptions, 'wrapper' | 'queries'> {
  transport?: FakeTransport;
  onAction?: (action: StudioAction) => void;
}

export function renderWithStudio(ui: ReactElement, options: StudioRenderOptions = {}): RenderResult {
  const { transport = new FakeTransport(), onAction, ...rest } = options;
  const client = createStudioClient(transport);
  // biome-ignore lint/correctness/noComponentHookFactories: test wrapper closes over the per-render client; it renders no hooks of its own
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <StudioProvider client={client} onAction={onAction} terminalFactory={null}>
      {children}
    </StudioProvider>
  );
  return render(ui, { wrapper: Wrapper, ...rest });
}
