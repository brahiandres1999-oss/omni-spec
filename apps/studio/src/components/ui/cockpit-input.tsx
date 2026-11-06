/**
 * cockpit-input — the floating "Omni Cockpit Dock" (STUDIO-DESIGN-SYSTEM.md §1–§2, SH-08, SH-09, D-19).
 *
 * Three columns, Antigravity style: mode selector (`/omni-*` skills from the catalog) · instruction ·
 * send. Floats over the stage with the floating surface and a 1 px border, no shadow. There is no agent
 * runner in this phase: Enter writes `/omni-<mode> <instruction>\r` to the active ConPTY session, where the
 * user's own agent CLI runs. Without an active terminal the dock is Protected and offers to open one.
 */
import { useEffect, useId, useRef } from 'react';
import { Button } from './button';
import { ChevronDown, Icon, SendHorizontal, ShieldAlert, SquareTerminal, Zap } from './icon';
import { cn, focusRing, mono } from './interaction';

export const FALLBACK_MODES = ['omni-specify', 'omni-audit', 'omni-converge'] as const;

export interface CockpitInputProps {
  /** Session id the dock writes to, or `null` (Protected). */
  target: string | null;
  modes: readonly string[];
  mode: string;
  draft: string;
  focusNonce: number;
  labels: {
    region: string;
    mode: string;
    input: string;
    placeholder: string;
    send: string;
    protected: string;
    openTerminal: string;
    target(id: string): string;
  };
  onModeChange(mode: string): void;
  onDraftChange(draft: string): void;
  onSend(command: string): void;
  onOpenTerminal(): void;
}

/** `/omni-<mode> <instruction>\r`: one line, as an interactive agent CLI expects it. */
export function composeCommand(mode: string, draft: string): string | null {
  const text = draft
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ');
  if (!text) return null;
  return `/${mode} ${text}\r`;
}

export function CockpitInput({
  target,
  modes,
  mode,
  draft,
  focusNonce,
  labels,
  onModeChange,
  onDraftChange,
  onSend,
  onOpenTerminal,
}: CockpitInputProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();

  useEffect(() => {
    if (focusNonce > 0) input.current?.focus();
  }, [focusNonce]);

  const send = () => {
    const command = composeCommand(mode, draft);
    if (!command || !target) return;
    onSend(command);
  };

  return (
    <section
      aria-label={labels.region}
      data-state={target ? 'ready' : 'protected'}
      className="absolute inset-x-0 bottom-4 z-20 mx-auto w-[min(48rem,calc(100%-2rem))] rounded-2xl border border-floating-border bg-floating p-1.5"
    >
      {target ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-1.5">
          <label className="relative flex h-9 items-center">
            <span className="sr-only">{labels.mode}</span>
            <Icon icon={Zap} className="pointer-events-none absolute start-2.5 text-accent" />
            <select
              aria-label={labels.mode}
              value={mode}
              onChange={event => onModeChange(event.target.value)}
              className={cn(
                'h-9 appearance-none rounded-[10px] border border-floating-border bg-surface ps-8 pe-7 text-xs text-fg',
                'hover:border-fg-muted/40',
                mono,
                focusRing,
              )}
            >
              {modes.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <Icon icon={ChevronDown} className="pointer-events-none absolute end-2 text-fg-muted" />
          </label>
          <div className="flex min-w-0 flex-col">
            <textarea
              ref={input}
              aria-label={labels.input}
              aria-describedby={hintId}
              rows={1}
              value={draft}
              placeholder={labels.placeholder}
              onChange={event => onDraftChange(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                send();
              }}
              className={cn(
                'field-sizing-content max-h-40 min-h-9 w-full resize-none rounded-[10px] bg-transparent px-2.5 py-2 text-[13px] text-fg placeholder:text-fg-muted',
                focusRing,
              )}
            />
            <span id={hintId} className={cn('sr-only')}>
              {labels.target(target)}
            </span>
          </div>
          <Button
            variant="primary"
            size="icon"
            aria-label={labels.send}
            disabled={composeCommand(mode, draft) === null}
            onClick={send}
            className="size-9 rounded-[10px]"
          >
            <Icon icon={SendHorizontal} />
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 ps-3">
          <Icon icon={ShieldAlert} size={18} className="text-fg-muted" />
          <p className="text-pretty text-[13px] text-fg-muted">{labels.protected}</p>
          <Button variant="secondary" icon={SquareTerminal} onClick={onOpenTerminal} className="h-9 rounded-[10px]">
            {labels.openTerminal}
          </Button>
        </div>
      )}
    </section>
  );
}
