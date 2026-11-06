/**
 * SkillsView — Smart Skill Hub (plan §11.4 VS-01…05, PJ-SKL, D-9): installed and project skills with their
 * estimated weight, server-confirmed switches and the context budget meter. Over budget warns, never blocks.
 */
import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { useEnsureLoaded, useRefreshOn, useStudio } from '@/app/studio-context';
import { ArrowDownWideNarrow, CircleAlert, Icon, RefreshCw, Sparkles } from '@/components/ui/icon';
import { cn, focusRing, mono, press } from '@/components/ui/interaction';
import { ProtectedState } from '@/components/ui/ProtectedState';
import {
  EmptyState,
  ErrorState,
  rowHeightClass,
  SkeletonBar,
  SkeletonRow,
  ViewFrame,
} from '@/components/ui/view-state';
import type { Skill, SkillsPayload } from '@/ipc/types';
import { formatInt, formatPercent, messages } from '@/i18n/messages.es';
import type { SkillsStore } from '@/stores/skills';

const FRAME = 'grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]';

export function SkillsView() {
  const { project, dispatch } = useStudio();
  const skills = project.skills;
  const resource = useStore(skills, state => state.resource);
  useEnsureLoaded(resource);
  useRefreshOn(['skills'], resource);
  const status = useStore(resource, state => state.status);
  const data = useStore(resource, state => state.data);
  const error = useStore(resource, state => state.error);
  const frameState = status === 'idle' ? 'loading' : status;

  return (
    <ViewFrame view="skills" state={frameState} layout="skills-list" className={FRAME}>
      {frameState === 'loading' ? (
        <>
          <div className="flex h-24 flex-col justify-center gap-3 border-b border-divider px-5">
            <SkeletonBar className="w-48" />
            <SkeletonBar className="h-2 w-full" />
          </div>
          <div className="flex flex-col gap-2 px-5 py-4">
            <SkeletonRow token="skill" />
            <SkeletonRow token="skill" />
            <SkeletonRow token="skill" />
          </div>
        </>
      ) : frameState === 'ready' && data ? (
        <SkillsList data={data} store={skills} />
      ) : (
        <>
          <div className="h-24 border-b border-divider" />
          {frameState === 'empty' ? (
            <EmptyState
              icon={Sparkles}
              title={messages.skills.emptyTitle}
              body={messages.skills.emptyBody}
              actions={[
                {
                  label: messages.skills.ctaRescan,
                  icon: RefreshCw,
                  primary: true,
                  onSelect: () => dispatch({ type: 'skills.rescan' }),
                },
              ]}
            />
          ) : frameState === 'protected' ? (
            <ProtectedState reason={error?.detail ?? ''} />
          ) : (
            <ErrorState error={error} onRetry={() => void resource.getState().retry()} />
          )}
        </>
      )}
    </ViewFrame>
  );
}

function SkillsList({ data, store }: { data: SkillsPayload; store: SkillsStore }) {
  const [byWeight, setByWeight] = useState(false);
  const pending = useStore(store, state => state.pending);
  const failures = useStore(store, state => state.failures);
  const items = useMemo(
    () => (byWeight ? [...data.items].sort((a, b) => b.weight.tokens - a.weight.tokens) : data.items),
    [byWeight, data.items],
  );
  const over = data.activeTokens > data.budgetTokens;
  const share = data.budgetTokens > 0 ? data.activeTokens / data.budgetTokens : 0;

  return (
    <>
      <div className="flex h-24 flex-col justify-center gap-2 border-b border-divider px-5">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-fg">{messages.skills.title}</h2>
          <span className="text-xs text-fg-muted">
            {messages.skills.budget}: <span className={cn('text-fg', mono)}>{formatInt(data.activeTokens)}</span> /{' '}
            <span className={mono}>{formatInt(data.budgetTokens)}</span> {messages.skills.tokens} ·{' '}
            <span className={cn(over ? 'text-breach' : 'text-fg', mono)}>{formatPercent(share)}</span>
          </span>
          <span className="flex-1" />
          <button
            type="button"
            aria-pressed={byWeight}
            onClick={() => setByWeight(value => !value)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-lg border ps-2.5 pe-3.5 text-xs',
              byWeight
                ? 'border-accent/60 bg-accent/15 text-accent-bright'
                : 'border-floating-border text-fg-muted hover:text-fg',
              press,
              focusRing,
            )}
          >
            <Icon icon={ArrowDownWideNarrow} />
            {messages.skills.sortByWeight}
          </button>
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: a native <meter> cannot be styled consistently; ARIA meter with explicit values (VS-03) */}
        <div
          role="meter"
          aria-label={messages.skills.budget}
          aria-valuemin={0}
          aria-valuemax={data.budgetTokens}
          aria-valuenow={data.activeTokens}
          aria-valuetext={`${formatInt(data.activeTokens)} ${messages.skills.tokens} (${formatPercent(share)})`}
          className="h-1.5 w-full overflow-hidden rounded-full bg-divider"
        >
          <div
            className={cn('h-full rounded-full', over ? 'bg-breach' : 'bg-accent')}
            style={{ width: `${Math.min(100, share * 100).toFixed(2)}%` }}
          />
        </div>
        {over ? (
          <p role="status" className="flex items-center gap-1.5 text-xs text-breach">
            <Icon icon={CircleAlert} />
            {messages.skills.overBudget}
          </p>
        ) : null}
      </div>
      <ul className="min-h-0 overflow-y-auto overscroll-contain px-5 pt-3 pb-24">
        {items.map(item => (
          <SkillRow
            key={item.name}
            skill={item}
            budget={data.budgetTokens}
            pending={pending[item.name] === true}
            failure={failures[item.name]?.message}
            onToggle={() => void store.getState().toggle(item.name, !item.enabled)}
          />
        ))}
      </ul>
    </>
  );
}

function SkillRow({
  skill,
  budget,
  pending,
  failure,
  onToggle,
}: {
  skill: Skill;
  budget: number;
  pending: boolean;
  failure: string | undefined;
  onToggle(): void;
}) {
  const share = budget > 0 ? skill.weight.tokens / budget : 0;
  return (
    <li
      data-skill={skill.name}
      data-row-height="skill"
      className={cn(
        rowHeightClass('skill'),
        'grid grid-cols-[minmax(0,1fr)_10rem_auto] items-center gap-4 border-b border-divider',
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('truncate text-[13px] text-fg', mono)}>{skill.name}</span>
          <span className="shrink-0 rounded-full border border-floating-border px-1.5 text-[10px] text-fg-muted">
            {messages.skills.origin[skill.origin] ?? skill.origin}
          </span>
        </div>
        {skill.problem ? (
          <span data-problem={skill.problem} className="flex min-w-0 items-center gap-1 text-[11px] text-breach">
            <Icon icon={CircleAlert} className="size-3.5" />
            <span className="truncate">{messages.skills.problems[skill.problem] ?? skill.problem}</span>
          </span>
        ) : (
          <span className="truncate text-[11px] text-fg-muted">{failure ?? skill.description}</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-end text-[11px] text-fg-muted">
          <span className={cn('text-fg', mono)}>{formatInt(skill.weight.tokens)}</span> {messages.skills.tokens} (
          {messages.skills.estimated})
        </span>
        <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-divider">
          <div
            className={cn('h-full rounded-full', skill.enabled ? 'bg-accent' : 'bg-fg-muted/40')}
            style={{ width: `${Math.min(100, share * 100).toFixed(2)}%` }}
          />
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={skill.enabled}
        aria-label={messages.skills.toggle(skill.name)}
        aria-busy={pending || undefined}
        onClick={onToggle}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border',
          skill.enabled ? 'border-accent bg-accent' : 'border-floating-border bg-divider',
          pending && 'opacity-60',
          press,
          focusRing,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-3.5 rounded-full bg-fg motion-safe:transition-[translate] motion-safe:duration-150',
            skill.enabled ? 'translate-x-[18px]' : 'translate-x-[2px]',
          )}
        />
      </button>
    </li>
  );
}
