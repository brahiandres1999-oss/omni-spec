/**
 * Left rail (SH-04, SH-05, RP): `+ Nueva Spec`, recent projects with the active project's specs nested,
 * and `Ajustes`. Selecting a spec focuses its card on the board; selecting another project reopens the
 * engine on that root and resets every view to Loading.
 */
import { useStore } from 'zustand';
import { useEnsureLoaded, useStudio } from '@/app/studio-context';
import { Button } from '@/components/ui/button';
import { Folder, FolderOpen, Icon, Plus, Settings } from '@/components/ui/icon';
import { cn, focusRing, mono, press } from '@/components/ui/interaction';
import type { RecentProject } from '@/ipc/types';
import { messages } from '@/i18n/messages.es';
import { projectName } from './TitleBar';

const samePath = (a: string, b: string) =>
  a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase();

export function Rail() {
  const { snapshot, recent, dispatch } = useStudio();
  useEnsureLoaded(snapshot);
  useEnsureLoaded(recent);
  const current = useStore(snapshot, state => state.data);
  const recentList = useStore(recent, state => state.data);

  const projects: RecentProject[] = [...(recentList ?? [])];
  if (current && !projects.some(entry => samePath(entry.path, current.root)))
    projects.unshift({ path: current.root, name: projectName(current.root), missing: false });

  return (
    <nav
      aria-label={messages.shell.projects}
      data-surface="panel"
      className="flex min-h-0 flex-col gap-3 border-e border-divider bg-surface px-2 pt-3 pb-2"
    >
      <Button variant="primary" icon={Plus} onClick={() => dispatch({ type: 'spec.new' })} className="w-full">
        {messages.shell.newSpec}
      </Button>
      <h2 className="px-2 text-[11px] font-semibold tracking-wide text-fg-muted uppercase">
        {messages.shell.projects}
      </h2>
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain">
        {projects.map(entry => {
          const active = current ? samePath(entry.path, current.root) : false;
          return (
            <li key={entry.path} data-project={entry.path}>
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                disabled={entry.missing}
                title={entry.path}
                onClick={() => {
                  if (!active) dispatch({ type: 'project.open', path: entry.path });
                }}
                className={cn(
                  'flex h-7 w-full items-center gap-2 rounded-md ps-2.5 pe-3.5 text-start text-xs',
                  active ? 'bg-floating text-fg' : 'text-fg-muted hover:bg-divider hover:text-fg',
                  'disabled:opacity-45',
                  press,
                  focusRing,
                )}
              >
                <Icon icon={active ? FolderOpen : Folder} className={active ? 'text-accent' : undefined} />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {entry.missing ? <span className="text-[10px]">{messages.shell.missing}</span> : null}
              </button>
              {active && current ? (
                <ul className="ms-4 mt-0.5 flex flex-col gap-0.5 border-s border-divider ps-2">
                  {current.specs.map(spec => (
                    <li key={spec.id}>
                      <button
                        type="button"
                        title={spec.title}
                        onClick={() => dispatch({ type: 'spec.focus', id: spec.id })}
                        className={cn(
                          'flex h-6 w-full items-center rounded-md px-2 text-start text-[11px] text-fg-muted hover:bg-divider hover:text-fg',
                          press,
                          focusRing,
                        )}
                      >
                        <span className={cn('truncate', mono)}>{spec.slug}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Button
        variant="ghost"
        icon={Settings}
        onClick={() => dispatch({ type: 'settings.open' })}
        className="w-full justify-start"
      >
        {messages.shell.settings}
      </Button>
    </nav>
  );
}
