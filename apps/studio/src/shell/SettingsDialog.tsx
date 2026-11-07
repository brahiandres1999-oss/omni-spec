/**
 * Ajustes (docs/STUDIO-AGENT-COCKPIT.md, Fase 3 Q11): a modal with General (permisos por defecto, cola), Agentes
 * (instalados, cómo iniciar sesión), Apariencia, Atajos, Notificaciones, Personalizaciones (las skills, que
 * dejaron de ser una página) y Proyectos. Opened from the bottom of the rail or Ctrl+K.
 */
import { Dialog, Tabs as RadixTabs } from 'radix-ui';
import { type ReactNode, useEffect } from 'react';
import { useStore } from 'zustand';
import { useEnsureLoaded, useStudio } from '@/app/studio-context';
import { Button } from '@/components/ui/button';
import { Icon, X } from '@/components/ui/icon';
import { cn, focusRing, mono } from '@/components/ui/interaction';
import { messages } from '@/i18n/messages.es';
import { PERMISSION_LEVELS, type PermissionLevel } from '@/stores/settings';
import { SkillsView } from '@/views/SkillsView';

const t = messages.settings;
const SECTIONS = ['general', 'agents', 'appearance', 'shortcuts', 'notifications', 'skills', 'projects'] as const;

function Field({ legend, hint, children }: { legend: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-[13px] font-medium text-fg">{legend}</legend>
      {children}
      {hint ? <p className="text-xs text-pretty text-fg-muted">{hint}</p> : null}
    </fieldset>
  );
}

function Choice({
  name,
  checked,
  label,
  hint,
  danger,
  onSelect,
}: {
  name: string;
  checked: boolean;
  label: string;
  hint?: string;
  danger?: boolean;
  onSelect(): void;
}) {
  return (
    <label className="flex cursor-default items-start gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-divider">
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="mt-0.5 accent-accent" />
      <span className="grid">
        <span className={danger ? 'text-breach' : 'text-fg'}>{label}</span>
        {hint ? <span className="text-xs text-fg-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

function General() {
  const { settings, snapshot } = useStudio();
  const permission = useStore(settings, state => state.defaultPermission);
  const enter = useStore(settings, state => state.enterWhileBusy);
  const data = useStore(snapshot, state => state.data);
  const chat = messages.chat;
  return (
    <div className="grid gap-6">
      <Field legend={t.defaultPermission} hint={t.defaultPermissionHint}>
        {PERMISSION_LEVELS.map(level => (
          <Choice
            key={level}
            name="default-permission"
            checked={permission === level}
            label={chat.permissions[level] ?? level}
            hint={chat.permissionHints[level]}
            danger={level === 'bypass'}
            onSelect={() => settings.getState().update({ defaultPermission: level as PermissionLevel })}
          />
        ))}
      </Field>
      <Field legend={t.enterWhileBusy} hint={t.enterHint}>
        <Choice
          name="enter-busy"
          checked={enter === 'queue'}
          label={t.enterQueue}
          onSelect={() => settings.getState().update({ enterWhileBusy: 'queue' })}
        />
        <Choice
          name="enter-busy"
          checked={enter === 'interrupt'}
          label={t.enterInterrupt}
          onSelect={() => settings.getState().update({ enterWhileBusy: 'interrupt' })}
        />
      </Field>
      {data ? (
        <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
          <dt className="text-fg-muted">{messages.shell.root}</dt>
          <dd className={cn('break-all', mono)}>{data.root}</dd>
          <dt className="text-fg-muted">{messages.shell.versions}</dt>
          <dd className={mono}>
            engine {data.versions.engine} · node {data.versions.node} · ipc v{data.versions.protocol}
          </dd>
        </dl>
      ) : null}
    </div>
  );
}

function Agents() {
  const { project } = useStudio();
  const status = useStore(project.chat, state => state.status);
  useEffect(() => {
    if (!project.chat.getState().status) void project.chat.getState().loadStatus();
  }, [project.chat]);
  return (
    <div className="grid gap-4">
      <ul className="grid gap-2">
        {(status?.agents ?? []).map(agent => (
          <li key={agent.id} className="grid gap-1.5 rounded-xl border border-divider p-3 text-[13px]">
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn('size-2 rounded-full', agent.available ? 'bg-attested' : 'bg-breach')}
              />
              <span className="font-medium text-fg">{agent.label}</span>
              <span className="text-xs text-fg-muted">{agent.available ? t.agentAvailable : t.agentMissing}</span>
            </span>
            {agent.path ? (
              <span className={cn(mono, 'break-all text-xs text-fg-muted')}>
                {t.agentPath}: {agent.path}
              </span>
            ) : null}
            <span className="text-xs text-pretty text-fg-muted">{t.agentLogin}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-pretty text-fg-muted">{t.agentsSoon}</p>
    </div>
  );
}

function Appearance() {
  return (
    <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 text-[13px]">
      <dt className="text-fg-muted">{t.theme}</dt>
      <dd className="text-fg">{t.themeDark}</dd>
    </dl>
  );
}

function Shortcuts() {
  return (
    <table className="w-full text-[13px]">
      <tbody>
        {t.shortcuts.map(([keys, action]) => (
          <tr key={keys} className="border-b border-divider">
            <td className="py-1.5 pe-4">
              <kbd className={cn(mono, 'rounded-md border border-divider bg-surface px-1.5 py-0.5 text-xs')}>
                {keys}
              </kbd>
            </td>
            <td className="py-1.5 text-fg">{action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Notifications() {
  const { settings } = useStudio();
  const approval = useStore(settings, state => state.notifyApproval);
  const done = useStore(settings, state => state.notifyDone);
  const row = (checked: boolean, label: string, patch: (value: boolean) => void) => (
    <label className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-divider">
      <input
        type="checkbox"
        checked={checked}
        onChange={event => patch(event.target.checked)}
        className="accent-accent"
      />
      <span className="text-fg">{label}</span>
    </label>
  );
  return (
    <div className="grid gap-2">
      {row(approval, t.notifyApproval, value => settings.getState().update({ notifyApproval: value }))}
      {row(done, t.notifyDone, value => settings.getState().update({ notifyDone: value }))}
      <p className="text-xs text-pretty text-fg-muted">{t.notifySoon}</p>
    </div>
  );
}

function Projects() {
  const { recent, client, projectId } = useStudio();
  useEnsureLoaded(recent);
  const list = useStore(recent, state => state.data) ?? [];
  return (
    <div className="grid gap-3">
      <p className="text-xs text-pretty text-fg-muted">{t.projectsHint}</p>
      {list.length === 0 ? <p className="text-xs text-fg-muted">{t.projectsEmpty}</p> : null}
      <ul className="grid gap-1">
        {list.map(entry => (
          <li key={entry.path} className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-[13px] hover:bg-divider">
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-fg">{entry.name}</span>
              <span className={cn(mono, 'truncate text-xs text-fg-muted')}>{entry.path}</span>
            </span>
            {projectId !== null && entry.path.toLowerCase() === projectId.toLowerCase() ? (
              <span className="text-xs text-fg-muted">{t.open}</span>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void client
                    .call('recent.remove', { path: entry.path })
                    .then(() => recent.getState().refresh())
                    .catch(() => undefined)
                }
              >
                {messages.shell.removeProject}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const CONTENT: Record<(typeof SECTIONS)[number], () => ReactNode> = {
  general: () => <General />,
  agents: () => <Agents />,
  appearance: () => <Appearance />,
  shortcuts: () => <Shortcuts />,
  notifications: () => <Notifications />,
  skills: () => <SkillsView />,
  projects: () => <Projects />,
};

export function SettingsDialog() {
  const { ui } = useStudio();
  const open = useStore(ui, state => state.settingsOpen);
  return (
    <Dialog.Root open={open} onOpenChange={next => ui.getState().setSettingsOpen(next)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/70" />
        <Dialog.Content
          aria-modal="true"
          aria-describedby={undefined}
          className="fixed start-1/2 top-1/2 z-50 grid h-[min(40rem,calc(100vh-4rem))] w-[min(56rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-floating-border bg-floating text-fg"
        >
          <div className="flex h-12 items-center justify-between border-b border-divider px-5">
            <Dialog.Title className="text-sm font-semibold">{t.title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button size="icon-sm" variant="ghost" aria-label={messages.board.close}>
                <Icon icon={X} />
              </Button>
            </Dialog.Close>
          </div>
          <RadixTabs.Root
            defaultValue="general"
            orientation="vertical"
            className="grid min-h-0 grid-cols-[12rem_minmax(0,1fr)]"
          >
            <RadixTabs.List aria-label={t.title} className="flex flex-col gap-0.5 border-e border-divider p-2">
              {SECTIONS.map(section => (
                <RadixTabs.Trigger
                  key={section}
                  value={section}
                  className={cn(
                    'flex h-8 items-center rounded-lg px-3 text-start text-[13px] text-fg-muted hover:bg-divider hover:text-fg',
                    'data-[state=active]:bg-divider data-[state=active]:text-fg',
                    focusRing,
                  )}
                >
                  {t.sections[section]}
                </RadixTabs.Trigger>
              ))}
            </RadixTabs.List>
            {SECTIONS.map(section => (
              <RadixTabs.Content
                key={section}
                value={section}
                className={cn('min-h-0 overflow-y-auto overscroll-contain outline-none', section !== 'skills' && 'p-5')}
              >
                {CONTENT[section]()}
              </RadixTabs.Content>
            ))}
          </RadixTabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
