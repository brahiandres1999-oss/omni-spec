/**
 * Composer of a conversation (docs/STUDIO-AGENT-COCKPIT.md, Fase 3 Q8, Q15–Q17, Q20, Q25):
 *  - Modelo agrupado por agente, con submenú de razonamiento (only levels the agent reports).
 *  - Permisos: Preguntar siempre, Predeterminado, Automático, Sin restricciones (red) and Planificar.
 *  - Queue: with the agent working, Enter queues the message (visible, editable, cancelable) and Ctrl+Enter
 *    interrupts the turn and sends it; Ajustes › General swaps the two.
 *  - «+», `@` and `/`: mention a project file or pick one of the agent's commands and skills.
 */
import { DropdownMenu } from 'radix-ui';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useStudio } from '@/app/studio-context';
import { Button } from '@/components/ui/button';
import {
  Check,
  ChevronDown,
  File,
  Icon,
  Pencil,
  Plus,
  SendHorizontal,
  ShieldAlert,
  Sparkles,
  Square,
  X,
  Zap,
} from '@/components/ui/icon';
import { cn, focusRing, mono, press } from '@/components/ui/interaction';
import { type MenuOption, OptionMenu } from '@/components/ui/option-menu';
import { messages } from '@/i18n/messages.es';
import type { AgentStatus } from '@/stores/chat';
import { allFiles } from '@/stores/files';
import { isPermissionLevel, PERMISSION_LEVELS } from '@/stores/settings';

const t = messages.chat;
const DEFAULT = '';
const MAX_SUGGESTIONS = 8;

type Agent = AgentStatus['agents'][number];

const menuItem = cn(
  'relative flex min-h-8 cursor-default select-none items-center gap-2 rounded-md ps-7 pe-3 py-1.5 text-[13px] text-fg outline-none',
  'data-[highlighted]:bg-divider data-[disabled]:opacity-45 data-[state=open]:bg-divider',
);
const menuContent = 'z-50 min-w-52 rounded-xl border border-floating-border bg-floating p-1';
const menuLabel = 'px-3 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted';
const pill = cn(
  'inline-flex h-7 items-center gap-1.5 rounded-lg border border-transparent ps-2 pe-1.5 text-xs text-fg-muted',
  'transition-[scale,background-color,color] duration-150 ease-out enabled:hover:bg-divider enabled:hover:text-fg',
  'disabled:opacity-45 data-[state=open]:bg-divider data-[state=open]:text-fg',
  press,
  focusRing,
);

/** The token being typed at the caret when it is a mention (`@src/a`) or a command at the start (`/omni`). */
export function activeToken(draft: string, caret: number): { kind: '@' | '/'; query: string; start: number } | null {
  const before = draft.slice(0, caret);
  const match = /(^|\s)([@/])([^\s]*)$/.exec(before);
  if (!match) return null;
  const kind = match[2] as '@' | '/';
  const query = match[3] ?? '';
  const start = before.length - query.length - 1;
  // Agents only take a command as the first word of the message.
  if (kind === '/' && before.slice(0, start).trim() !== '') return null;
  return { kind, query, start };
}

const fold = (value: string) => value.toLocaleLowerCase('es');

/** Files whose path contains the query, the ones whose name starts with it first. */
export function rankFiles(paths: readonly string[], query: string): string[] {
  const needle = fold(query);
  const hits = paths.filter(path => fold(path).includes(needle));
  const name = (path: string) => fold(path.slice(path.lastIndexOf('/') + 1));
  return hits
    .sort((a, b) => Number(!name(a).startsWith(needle)) - Number(!name(b).startsWith(needle)) || a.length - b.length)
    .slice(0, MAX_SUGGESTIONS);
}

function rankCommands(commands: readonly string[], query: string): string[] {
  const needle = fold(query);
  return commands
    .filter(command => fold(command).includes(needle))
    .sort((a, b) => Number(!fold(a).startsWith(needle)) - Number(!fold(b).startsWith(needle)))
    .slice(0, MAX_SUGGESTIONS);
}

function ModelMenu({ agent }: { agent: Agent | undefined }) {
  const { project } = useStudio();
  const options = useStore(project.chat, state => state.options);
  const status = useStore(project.chat, state => state.status);
  const locked = useStore(project.chat, state => state.sessionId !== null || state.items.length > 0);
  const agents = useMemo(() => {
    const all = status?.agents ?? (agent ? [agent] : []);
    if (locked && agent) return [agent];
    return all;
  }, [status?.agents, agent, locked]);
  const efforts = agent?.efforts ?? [];
  const modelLabel = options.model ? (t.models[options.model] ?? options.model) : t.defaultOption;
  const effortLabel = options.effort ? (t.efforts[options.effort] ?? options.effort) : t.defaultOption;
  const set = (patch: { agent?: string | null; model?: string | null; effort?: string | null }) =>
    project.chat.getState().setOptions(patch);
  const currentValue = options.model ?? DEFAULT;
  const pickModel = (value: string) => {
    if (!value) {
      set({ model: null });
      return;
    }
    const owner = agents.find(entry => (entry.models ?? []).includes(value));
    const nextAgent = owner?.id ?? agent?.id ?? null;
    const permission = project.chat.getState().permission;
    if (owner?.permissions && !owner.permissions.includes(permission)) {
      project.chat.getState().setPermission('ask');
    }
    set({ agent: nextAgent, model: value });
  };
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger aria-label={`${t.modelLabel}: ${modelLabel}`} className={pill}>
        <Icon icon={Sparkles} />
        <span className="tabular-nums">
          {efforts.length > 0 ? t.modelPill(modelLabel, effortLabel.toLowerCase()) : modelLabel}
        </span>
        <Icon icon={ChevronDown} className="opacity-70" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="start" sideOffset={6} className={menuContent}>
          <DropdownMenu.RadioGroup value={currentValue} onValueChange={pickModel}>
            {(agents.length > 0
              ? agents
              : [
                  {
                    id: 'claude',
                    label: t.agent,
                    available: true,
                    path: null,
                    models: ['fable', 'opus', 'sonnet', 'haiku'],
                    efforts: [],
                  },
                ]
            ).map((entry, index) => (
              <DropdownMenu.Group key={entry.id}>
                {index > 0 ? <DropdownMenu.Separator className="my-1 h-px bg-divider" /> : null}
                <DropdownMenu.Label className={menuLabel}>{entry.label}</DropdownMenu.Label>
                {index === 0 ? (
                  <DropdownMenu.RadioItem value={DEFAULT} className={menuItem}>
                    <DropdownMenu.ItemIndicator className="absolute start-2 inline-flex">
                      <Icon icon={Check} className="text-accent" />
                    </DropdownMenu.ItemIndicator>
                    {t.defaultOption}
                  </DropdownMenu.RadioItem>
                ) : null}
                {(entry.models ?? Object.keys(t.models)).map(value => (
                  <DropdownMenu.RadioItem key={`${entry.id}:${value}`} value={value} className={menuItem}>
                    <DropdownMenu.ItemIndicator className="absolute start-2 inline-flex">
                      <Icon icon={Check} className="text-accent" />
                    </DropdownMenu.ItemIndicator>
                    {t.models[value] ?? value}
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.Group>
            ))}
          </DropdownMenu.RadioGroup>
          {efforts.length > 0 ? (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-divider" />
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className={menuItem}>
                  <span className="flex-1">{t.reasoning}</span>
                  <span className="text-xs text-fg-muted">{effortLabel}</span>
                  <Icon icon={ChevronDown} className="-rotate-90 opacity-70" />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent sideOffset={6} className={menuContent}>
                    <DropdownMenu.Label className={menuLabel}>{t.reasoning}</DropdownMenu.Label>
                    <DropdownMenu.RadioGroup
                      value={options.effort ?? DEFAULT}
                      onValueChange={value => set({ effort: value || null })}
                    >
                      {[DEFAULT, ...efforts].map(value => (
                        <DropdownMenu.RadioItem key={value || 'default'} value={value} className={menuItem}>
                          <DropdownMenu.ItemIndicator className="absolute start-2 inline-flex">
                            <Icon icon={Check} className="text-accent" />
                          </DropdownMenu.ItemIndicator>
                          {value ? (t.efforts[value] ?? value) : t.defaultOption}
                        </DropdownMenu.RadioItem>
                      ))}
                    </DropdownMenu.RadioGroup>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function PermissionMenu({ agent }: { agent: Agent | undefined }) {
  const { project } = useStudio();
  const permission = useStore(project.chat, state => state.permission);
  // A level the agent does not have is not offered (Q25).
  const levels = PERMISSION_LEVELS.filter(level => !agent?.permissions || agent.permissions.includes(level));
  const options: MenuOption[] = levels.map(level => ({
    value: level,
    label: t.permissions[level] ?? level,
    hint: t.permissionHints[level],
  }));
  return (
    <OptionMenu
      label={t.permissionLabel}
      value={permission}
      options={options}
      icon={ShieldAlert}
      tone={permission === 'bypass' ? 'danger' : undefined}
      onChange={value => {
        if (isPermissionLevel(value)) project.chat.getState().setPermission(value);
      }}
    />
  );
}

function Queue() {
  const { project } = useStudio();
  const queue = useStore(project.chat, state => state.queue);
  if (queue.length === 0) return null;
  return (
    <ul aria-label={t.queueRegion} className="grid gap-1 px-1 pb-1">
      {queue.map(entry => (
        <li
          key={entry.id}
          className="flex min-w-0 items-center gap-2 rounded-lg bg-divider/60 py-1 ps-2.5 pe-1 text-xs"
        >
          <span className="shrink-0 text-fg-muted">{t.queued}</span>
          <span className="min-w-0 flex-1 truncate text-fg" title={entry.text}>
            {entry.text}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`${t.editQueued}: ${entry.text}`}
            title={t.editQueued}
            onClick={() => project.chat.getState().editQueued(entry.id)}
          >
            <Icon icon={Pencil} />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`${t.removeQueued}: ${entry.text}`}
            title={t.removeQueued}
            onClick={() => project.chat.getState().unqueue(entry.id)}
          >
            <Icon icon={X} />
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function Composer({
  agent,
  available,
  busy,
  pending,
}: {
  agent: Agent | undefined;
  available: boolean;
  busy: boolean;
  /** «Opus 5.5 ahora → Haiku desde tu próximo mensaje», when the next message changes model or effort. */
  pending: { text: string; title?: string } | null;
}) {
  const { project, settings } = useStudio();
  const chat = project.chat;
  const draft = useStore(chat, state => state.draft);
  const commands = useStore(chat, state => state.commands);
  const enterWhileBusy = useStore(settings, state => state.enterWhileBusy);
  const filesResource = useStore(project.files, state => state.resource);
  const tree = useStore(filesResource, state => state.data);
  const skillsResource = useStore(project.skills, state => state.resource);
  const skillsData = useStore(skillsResource, state => state.data);
  const input = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const token = activeToken(draft, caret);
  const tokenKey = token ? `${token.start}:${token.kind}${token.query}` : null;
  const open = token !== null && dismissed !== tokenKey;
  const files = useMemo(() => allFiles(tree), [tree]);
  const { allCommands, skillHints } = useMemo(() => {
    const hints = new Map<string, string>();
    const names = new Set<string>();
    for (const skill of skillsData?.items ?? []) {
      if (!skill.enabled) continue;
      names.add(skill.name);
      if (skill.description) hints.set(skill.name, skill.description);
    }
    for (const command of commands) names.add(command);
    return { allCommands: [...names], skillHints: hints };
  }, [skillsData, commands]);
  const suggestions = !open
    ? []
    : token.kind === '@'
      ? rankFiles(files, token.query)
      : rankCommands(allCommands, token.query);

  useEffect(() => {
    if (token?.kind === '@' && filesResource.getState().status === 'idle') void filesResource.getState().load();
    if (token?.kind === '/' && skillsResource.getState().status === 'idle') void skillsResource.getState().load();
  }, [token?.kind, filesResource, skillsResource]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new token starts at the first suggestion
  useEffect(() => setActive(0), [tokenKey]);

  const syncCaret = () => setCaret(input.current?.selectionStart ?? draft.length);

  /** Puts `@` or `/` at the caret (the «+» menu) and opens its suggestions. */
  const insertTrigger = (kind: '@' | '/') => {
    const element = input.current;
    const at = kind === '/' ? 0 : (element?.selectionStart ?? draft.length);
    const before = kind === '/' ? '' : draft.slice(0, at);
    const after = kind === '/' ? draft.replace(/^\/\S*\s?/, '') : draft.slice(at);
    const spacer = before && !/\s$/.test(before) ? ' ' : '';
    const next = `${before}${spacer}${kind}${after}`;
    const position = before.length + spacer.length + 1;
    chat.getState().setDraft(next);
    setCaret(position);
    setDismissed(null);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(position, position);
    });
  };

  const choose = (value: string) => {
    if (!token) return;
    const replacement = `${token.kind}${value} `;
    const next = draft.slice(0, token.start) + replacement + draft.slice(caret).replace(/^\S*/, '').replace(/^\s/, '');
    const position = token.start + replacement.length;
    chat.getState().setDraft(next);
    setCaret(position);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(position, position);
    });
  };

  const submit = (interrupt: boolean) => {
    if (interrupt) void chat.getState().interrupt();
    else void chat.getState().send();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && suggestions.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive(index => (index + step + suggestions.length) % suggestions.length);
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) || event.key === 'Tab') {
        event.preventDefault();
        const pick = suggestions[active] ?? suggestions[0];
        if (pick) choose(pick);
        return;
      }
    }
    if (open && event.key === 'Escape') {
      event.preventDefault();
      setDismissed(tokenKey);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      // Enter queues and Ctrl+Enter interrupts (or the other way round, from Ajustes).
      const interrupt = busy && event.ctrlKey !== (enterWhileBusy === 'interrupt');
      submit(interrupt);
    } else if (event.key === 'Escape' && busy) {
      event.preventDefault();
      void chat.getState().cancel();
    }
  };

  const listId = 'composer-suggestions';
  const activeId = open && suggestions[active] !== undefined ? `${listId}-${active}` : undefined;

  return (
    <form
      className="mx-auto w-full max-w-3xl px-4 pb-4"
      onSubmit={event => {
        event.preventDefault();
        submit(false);
      }}
    >
      {/* Concentric corners: rounded-2xl (16px) frame = rounded-lg (8px) controls + p-2 (8px). */}
      <div
        className="relative grid gap-1 rounded-2xl border border-floating-border bg-floating p-2 transition-[border-color] duration-150 ease-out focus-within:border-fg-muted/40"
        onPointerDown={event => {
          if (event.target === event.currentTarget) input.current?.focus();
        }}
      >
        {open ? (
          <div className="absolute inset-x-0 bottom-full mb-2 overflow-hidden rounded-xl border border-floating-border bg-floating p-1">
            {suggestions.length === 0 ? (
              <p className="px-3 py-2 text-xs text-fg-muted">{token.kind === '@' ? t.noFiles : t.noCommands}</p>
            ) : (
              <div id={listId} role="listbox" aria-label={t.suggestions} className="grid gap-0.5">
                {suggestions.map((value, index) => {
                  const slash = value.lastIndexOf('/');
                  const name = token.kind === '@' && slash !== -1 ? value.slice(slash + 1) : value;
                  const detail =
                    token.kind === '@' ? (slash !== -1 ? value.slice(0, slash) : '') : (skillHints.get(value) ?? '');
                  return (
                    <div
                      key={value}
                      id={`${listId}-${index}`}
                      role="option"
                      tabIndex={-1}
                      aria-label={token.kind === '/' ? `/${value}` : value}
                      aria-selected={index === active}
                      onPointerDown={event => {
                        event.preventDefault();
                        choose(value);
                      }}
                      onPointerMove={() => setActive(index)}
                      className={cn(
                        'flex min-h-8 cursor-default items-center gap-2 rounded-lg px-2.5 py-1 text-[13px]',
                        index === active ? 'bg-divider text-fg' : 'text-fg-muted',
                      )}
                    >
                      <Icon
                        icon={token.kind === '@' ? File : Zap}
                        className={cn('shrink-0', index === active ? 'text-accent' : 'text-fg-muted')}
                      />
                      <span className={cn(mono, 'shrink-0 text-xs font-medium text-fg')}>
                        {token.kind === '/' ? `/${name}` : name}
                      </span>
                      {detail ? (
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate text-end text-[11px] text-fg-muted',
                            token.kind === '@' && mono,
                          )}
                        >
                          {detail}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
        <Queue />
        <textarea
          ref={input}
          aria-label={t.placeholder}
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          value={draft}
          rows={Math.min(8, Math.max(2, draft.split('\n').length))}
          placeholder={busy ? t.placeholderBusy : t.placeholder}
          onChange={event => {
            chat.getState().setDraft(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
          }}
          onSelect={syncCaret}
          onKeyDown={onKeyDown}
          className="max-h-56 min-h-12 resize-none bg-transparent px-2 py-1.5 text-[14px] leading-relaxed text-fg outline-none placeholder:text-fg-muted"
        />
        <div className="flex items-center gap-1">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger aria-label={t.add} title={t.add} className={cn(pill, 'px-1.5')}>
              <Icon icon={Plus} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content side="top" align="start" sideOffset={6} className={menuContent}>
                <DropdownMenu.Item className={menuItem} onSelect={() => insertTrigger('@')}>
                  <Icon icon={File} className="absolute start-2 text-fg-muted" />
                  <span className="flex-1">{t.mentionFile}</span>
                  <kbd className={cn(mono, 'text-xs text-fg-muted')}>@</kbd>
                </DropdownMenu.Item>
                <DropdownMenu.Item className={menuItem} onSelect={() => insertTrigger('/')}>
                  <Icon icon={Zap} className="absolute start-2 text-fg-muted" />
                  <span className="flex-1">{t.addAction}</span>
                  <kbd className={cn(mono, 'text-xs text-fg-muted')}>/</kbd>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <ModelMenu agent={agent} />
          <PermissionMenu agent={agent} />
          {/* Always mounted so the change is announced when it appears. */}
          <span
            aria-live="polite"
            className="min-w-0 flex-1 truncate px-2 text-xs text-fg-muted"
            title={pending?.title}
          >
            {pending?.text}
          </span>
          {busy ? (
            <Button
              variant="secondary"
              size="icon"
              aria-label={t.stop}
              title={`${t.stop} (Esc)`}
              onClick={() => void chat.getState().cancel()}
            >
              <Icon icon={Square} />
            </Button>
          ) : null}
          {!busy || draft.trim() ? (
            <Button
              variant="primary"
              size="icon"
              type="submit"
              aria-label={busy ? t.queueSend : t.send}
              title={busy ? t.queueSend : t.send}
              disabled={!draft.trim() || !available}
            >
              <Icon icon={SendHorizontal} />
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
