/**
 * Inspector › Terminal: ConPTY sessions rendered with xterm.js (VT, ST-07). The panel stays mounted while the
 * Inspector shows other tabs, so switching tabs never kills a shell; sessions close only explicitly.
 */
import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { useStudio } from '@/app/studio-context';
import { Button } from '@/components/ui/button';
import { Icon, Plus, SquareTerminal, X } from '@/components/ui/icon';
import { cn, focusRing, mono, press } from '@/components/ui/interaction';
import { messages } from '@/i18n/messages.es';
import type { TerminalSession } from '@/stores/terminal';
import { attachXterm } from '@/terminal/xterm-adapter';

export function TerminalPanel() {
  const { terminal } = useStudio();
  const sessions = useStore(terminal, state => state.sessions);
  const activeId = useStore(terminal, state => state.activeId);
  const opening = useStore(terminal, state => state.opening);
  const list = Object.values(sessions);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-divider px-2">
        {/* biome-ignore lint/a11y/useSemanticElements: a set of session tabs, not a form fieldset */}
        <div
          role="group"
          aria-label={messages.terminal.sessions}
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          {list.map(session => (
            <span
              key={session.id}
              className={cn(
                'inline-flex h-6 shrink-0 items-center rounded-md border',
                session.id === activeId ? 'border-floating-border bg-floating' : 'border-transparent',
              )}
            >
              <button
                type="button"
                aria-pressed={session.id === activeId}
                onClick={() => terminal.getState().setActive(session.id)}
                className={cn(
                  'h-full rounded-s-md ps-2 pe-1 text-[11px]',
                  session.status === 'exited' ? 'text-fg-muted line-through' : 'text-fg',
                  mono,
                  press,
                  focusRing,
                )}
              >
                {session.id}
              </button>
              <button
                type="button"
                aria-label={messages.terminal.close(session.id)}
                onClick={() => void terminal.getState().close(session.id)}
                className={cn(
                  'grid h-full w-5 place-items-center rounded-e-md text-fg-muted hover:text-fg',
                  press,
                  focusRing,
                )}
              >
                <Icon icon={X} className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={Plus}
          disabled={opening}
          onClick={() =>
            void terminal
              .getState()
              .open()
              .catch(() => undefined)
          }
        >
          {messages.terminal.new}
        </Button>
      </div>
      <div
        data-scroll-region="terminal"
        data-testid="terminal"
        className="relative min-h-0 flex-1 overflow-hidden overscroll-contain bg-canvas"
      >
        {list.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Icon icon={SquareTerminal} size={18} className="text-fg-muted" />
            <p className="max-w-[36ch] text-pretty text-xs text-fg-muted">{messages.terminal.empty}</p>
          </div>
        ) : (
          list.map(session => <SessionHost key={session.id} session={session} active={session.id === activeId} />)
        )}
      </div>
    </div>
  );
}

function SessionHost({ session, active }: { session: TerminalSession; active: boolean }) {
  const { client, terminalFactory } = useStudio();
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<ReturnType<typeof attachXterm> | null>(null);

  useEffect(() => {
    const element = container.current;
    const parts = terminalFactory?.();
    if (!element || !parts) return;
    // The store owns the PTY lifetime (close button, exit); the bridge only renders it.
    const bridge = attachXterm({ client, sessionId: session.id, container: element, closeOnDispose: false, ...parts });
    handle.current = bridge;
    return () => {
      handle.current = null;
      void bridge.dispose();
    };
  }, [client, session.id, terminalFactory]);

  useEffect(() => {
    if (active) handle.current?.fit();
  }, [active]);

  return (
    <div className={cn('absolute inset-0 p-2', !active && 'hidden')}>
      <div ref={container} className="size-full" />
      {session.status === 'exited' ? (
        <p className="absolute inset-x-2 bottom-2 rounded-md border border-divider bg-floating px-2 py-1 text-[11px] text-fg-muted">
          {messages.terminal.exited(session.exitCode)}
        </p>
      ) : null}
    </div>
  );
}
