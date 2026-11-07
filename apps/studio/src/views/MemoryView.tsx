/**
 * «Memoria» page (docs/STUDIO-AGENT-COCKPIT.md, Fase 3, Q11): what the project's Omni memory holds — the
 * learnings and decisions every agent of the project will share, Studio's conversations and the code graph.
 */
import { useEffect, useState } from 'react';
import { useStudio } from '@/app/studio-context';
import { cn, mono } from '@/components/ui/interaction';
import { formatAgo, formatInt, messages } from '@/i18n/messages.es';

const t = messages.memory;

interface MemorySummary {
  mode: 'project' | 'studio';
  path: string;
  counts: { observations: number; decisions: number; conversations: number; modules: number; dependencies: number };
  observations: Array<{ category: string; scope: string; summary: string; createdAt: string }>;
  decisions: Array<{ topic: string; status: string; basis: string; recordedAt: string }>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-1 rounded-xl border border-divider bg-surface px-4 py-3">
      <span className="text-xs text-fg-muted">{label}</span>
      <span className="text-xl font-semibold text-fg tabular-nums">{formatInt(value)}</span>
    </div>
  );
}

export function MemoryView() {
  const { client, projectId } = useStudio();
  const [summary, setSummary] = useState<MemorySummary | null>(null);
  const [failed, setFailed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: projectId is the trigger — another project means another memory
  useEffect(() => {
    let alive = true;
    setFailed(false);
    client
      .call('memory.summary', {})
      .then(result => {
        if (alive) setSummary(result as MemorySummary);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [client, projectId]);

  return (
    <section aria-label={t.title} className="h-full overflow-y-auto overscroll-contain">
      <div className="mx-auto grid w-full max-w-3xl gap-6 px-6 py-8">
        <header className="grid gap-1.5">
          <h1 className="text-lg font-semibold text-fg">{t.title}</h1>
          <p className="text-[13px] text-pretty text-fg-muted">{t.intro}</p>
        </header>
        {failed ? <p className="text-[13px] text-breach">{t.failed}</p> : null}
        {summary ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label={t.observations} value={summary.counts.observations} />
              <Stat label={t.decisions} value={summary.counts.decisions} />
              <Stat label={t.conversations} value={summary.counts.conversations} />
              <Stat label={t.modules} value={summary.counts.modules} />
            </div>
            <section aria-labelledby="memory-learnings" className="grid gap-2">
              <h2 id="memory-learnings" className="text-sm font-medium text-fg">
                {t.observations}
              </h2>
              {summary.observations.length === 0 ? (
                <p className="text-[13px] text-pretty text-fg-muted">{t.noObservations}</p>
              ) : (
                <ul className="grid gap-1.5">
                  {summary.observations.map(entry => (
                    <li
                      key={`${entry.createdAt}:${entry.summary}`}
                      className="grid gap-0.5 rounded-lg border border-divider px-3 py-2"
                    >
                      <span className="text-[13px] text-fg">{entry.summary}</span>
                      <span className="text-xs text-fg-muted">
                        {t.categories[entry.category] ?? entry.category} · {entry.scope} · {formatAgo(entry.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="memory-decisions" className="grid gap-2">
              <h2 id="memory-decisions" className="text-sm font-medium text-fg">
                {t.decisions}
              </h2>
              {summary.decisions.length === 0 ? (
                <p className="text-[13px] text-pretty text-fg-muted">{t.noDecisions}</p>
              ) : (
                <ul className="grid gap-1.5">
                  {summary.decisions.map(entry => (
                    <li
                      key={`${entry.recordedAt}:${entry.topic}`}
                      className="grid gap-0.5 rounded-lg border border-divider px-3 py-2"
                    >
                      <span className="text-[13px] text-fg">{entry.topic}</span>
                      <span className="text-xs text-pretty text-fg-muted">{entry.basis}</span>
                      <span className="text-xs text-fg-muted">
                        {entry.status} · {formatAgo(entry.recordedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <p className="text-xs text-fg-muted">
              {summary.mode === 'studio' ? t.studioMode : t.projectMode}{' '}
              <span className={cn('break-all', mono)}>{summary.path}</span>
            </p>
          </>
        ) : failed ? null : (
          <p className="text-[13px] text-fg-muted">{t.loading}</p>
        )}
      </div>
    </section>
  );
}
