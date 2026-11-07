/**
 * «Retomar sesión de la terminal…» (docs/STUDIO-AGENT-COCKPIT.md, Fase 3, Q5): the Claude Code sessions of the
 * open project that are not in Studio yet (started in a terminal or another app). Choosing one loads its
 * history, adds it to Studio's index and the next message continues it.
 */
import { Dialog } from 'radix-ui';
import { useEffect, useState } from 'react';
import { useStudio } from '@/app/studio-context';
import { History, Icon, Search, X } from '@/components/ui/icon';
import { cn, focusRing, press } from '@/components/ui/interaction';
import { formatAgo, messages } from '@/i18n/messages.es';
import type { AgentSession } from '@/stores/chat';

const t = messages.shell;

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function TerminalSessionsDialog({
  open,
  onOpenChange,
  indexed,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Session ids already in Studio: they are in the rail, not here. */
  indexed: ReadonlySet<string>;
}) {
  const { client, project, layout } = useStudio();
  const [sessions, setSessions] = useState<AgentSession[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    client
      .call('agent.sessions', {})
      .then(result => {
        if (alive) setSessions((result as { sessions?: AgentSession[] })?.sessions ?? []);
      })
      .catch(() => {
        if (alive) setSessions([]);
      });
    return () => {
      alive = false;
    };
  }, [client, open]);

  const needle = fold(query.trim());
  const shown = (sessions ?? []).filter(
    session => !indexed.has(session.id) && (!needle || fold(session.title).includes(needle)),
  );

  const choose = (session: AgentSession) => {
    onOpenChange(false);
    layout.getState().setStageTab('chat');
    void project.chat.getState().resume(session.id);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/60" />
        <Dialog.Content className="fixed start-1/2 top-[14vh] z-50 flex max-h-[70vh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-floating-border bg-floating text-fg">
          <div className="flex items-start gap-3 border-b border-divider px-4 py-3">
            <Icon icon={History} size={18} className="mt-0.5 text-fg-muted" />
            <div className="grid min-w-0 flex-1 gap-1">
              <Dialog.Title className="text-sm font-medium">{t.terminalTitle}</Dialog.Title>
              <Dialog.Description className="text-xs text-pretty text-fg-muted">{t.terminalHint}</Dialog.Description>
            </div>
            <Dialog.Close
              aria-label={messages.shell.close}
              className={cn(
                'grid size-7 place-items-center rounded-md text-fg-muted hover:bg-divider',
                press,
                focusRing,
              )}
            >
              <Icon icon={X} />
            </Dialog.Close>
          </div>
          <label className="mx-3 mt-3 flex h-8 items-center gap-2 rounded-lg border border-divider bg-canvas px-2.5 text-xs text-fg-muted focus-within:border-fg-muted/40">
            <Icon icon={Search} />
            <input
              type="search"
              aria-label={t.terminalFilter}
              placeholder={t.terminalFilter}
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-muted"
            />
          </label>
          <div className="min-h-0 overflow-y-auto overscroll-contain p-2">
            {sessions === null ? (
              <p className="px-2 py-6 text-center text-xs text-fg-muted">{t.terminalLoading}</p>
            ) : shown.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-fg-muted">{t.terminalEmpty}</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {shown.map(session => (
                  <li key={session.id}>
                    <button
                      type="button"
                      title={session.title}
                      onClick={() => choose(session)}
                      className={cn(
                        'flex h-8 w-full items-center gap-3 rounded-md px-2.5 text-start text-[13px] text-fg hover:bg-divider',
                        press,
                        focusRing,
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{session.title}</span>
                      <span className="shrink-0 text-[11px] text-fg-muted tabular-nums">
                        {formatAgo(session.updatedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
