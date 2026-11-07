/**
 * Title bar (SH-06, WN-01): breadcrumb `Omni Studio / <project> / branch: <branch>`, a drag region and the
 * Windows caption controls. With `decorations: false`, Rust answers WM_NCHITTEST from the caption button
 * rectangles this component reports on mount and on every resize (Snap Layouts on the maximise button).
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { useEnsureLoaded, useStudio } from '@/app/studio-context';
import { GitBranch, Icon, Search } from '@/components/ui/icon';
import { StudioLogo } from '@/components/ui/StudioLogo';
import { cn, focusRing, mono, press } from '@/components/ui/interaction';
import { isTauri } from '@/ipc/transport';
import { messages } from '@/i18n/messages.es';

const CAPTION = [
  { key: 'minimize', label: messages.shell.minimize, glyph: '-' },
  { key: 'maximize', label: messages.shell.maximize, glyph: '□' },
  { key: 'close', label: messages.shell.close, glyph: '✕' },
] as const;

type CaptionKey = (typeof CAPTION)[number]['key'];

const RESIZE_BORDER = 6;

export const projectName = (root: string) => root.split(/[\\/]/).filter(Boolean).pop() ?? root;

function windowAction(key: CaptionKey) {
  if (!isTauri()) return;
  void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
    const current = getCurrentWindow();
    if (key === 'minimize') return current.minimize();
    if (key === 'maximize') return current.toggleMaximize();
    return current.close();
  });
}

export function TitleBar() {
  const { client, snapshot, ui } = useStudio();
  useEnsureLoaded(snapshot);
  const data = useStore(snapshot, state => state.data);
  const header = useRef<HTMLElement>(null);
  const buttons = useRef<Partial<Record<CaptionKey, HTMLButtonElement | null>>>({});

  const report = useCallback(() => {
    const rect = (key: CaptionKey) => {
      const box = buttons.current[key]?.getBoundingClientRect();
      const x = Math.round(box?.x ?? 0);
      const y = Math.round(box?.y ?? 0);
      const width = Math.round(box?.width ?? 0);
      const height = Math.round(box?.height ?? 0);
      return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height };
    };
    void client
      .call('window.set_caption_layout', {
        windowWidth: Math.round(window.innerWidth),
        windowHeight: Math.round(window.innerHeight),
        captionHeight: Math.round(header.current?.getBoundingClientRect().height ?? 0),
        resizeBorder: RESIZE_BORDER,
        minimize: rect('minimize'),
        maximize: rect('maximize'),
        close: rect('close'),
      })
      .catch(() => undefined);
  }, [client]);

  useLayoutEffect(() => {
    report();
  }, [report]);

  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(report);
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, [report]);

  return (
    <header
      ref={header}
      data-tauri-drag-region
      className="flex h-9 shrink-0 select-none items-center border-b border-divider bg-canvas ps-3"
    >
      <nav
        aria-label={messages.shell.location}
        data-tauri-drag-region
        className="flex min-w-0 items-center gap-1.5 text-xs"
      >
        <StudioLogo size={16} className="shrink-0" />
        <span className="font-semibold text-fg">{messages.app.name}</span>
        {/* Project and branch appear together once known: inserting them shifts nothing (CLS = 0). */}
        {data ? (
          <>
            <span aria-hidden="true" className="text-fg-muted">
              /
            </span>
            <span className="truncate text-fg">{projectName(data.root)}</span>
            <span aria-hidden="true" className="text-fg-muted">
              /
            </span>
            <span className="inline-flex min-w-0 items-center gap-1 text-fg-muted">
              <Icon icon={GitBranch} className="size-3.5" />
              <span className={cn('truncate', mono)}>{messages.shell.branch(data.branch)}</span>
            </span>
          </>
        ) : null}
      </nav>
      <div data-tauri-drag-region className="h-full min-w-6 flex-1" />
      <button
        type="button"
        onClick={() => ui.getState().setPaletteOpen(true)}
        className={cn(
          'me-3 flex h-6 items-center gap-2 rounded-md border border-floating-border ps-2.5 pe-3.5 text-[11px] text-fg-muted hover:text-fg',
          press,
          focusRing,
        )}
      >
        <Icon icon={Search} />
        <span>{messages.shell.search}</span>
        <kbd className={cn('text-fg-muted', mono)}>{messages.shell.paletteHint}</kbd>
      </button>
      <div className="flex h-full">
        {CAPTION.map(entry => (
          <button
            key={entry.key}
            ref={element => {
              buttons.current[entry.key] = element;
            }}
            type="button"
            aria-label={entry.label}
            onClick={() => windowAction(entry.key)}
            className={cn(
              'grid h-full w-[46px] place-items-center text-[13px] text-fg-muted',
              entry.key === 'close' ? 'hover:bg-breach hover:text-fg' : 'hover:bg-divider hover:text-fg',
              press,
              focusRing,
              'focus-visible:-outline-offset-2',
            )}
          >
            <span aria-hidden="true">{entry.glyph}</span>
          </button>
        ))}
      </div>
    </header>
  );
}
