/**
 * The question an agent asked through omni_ask_user, as a native panel above the composer (docs/STUDIO-AGENT-COCKPIT.md):
 * the same for Claude Code, Codex, Antigravity, OpenCode or Cline. One question at a time; each option is a button
 * (1–4 on the keyboard pick it), the recommended one is marked, and «Otra respuesta» takes the person's own words.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleHelp,
  CornerDownLeft,
  Icon,
  Mic,
  X,
} from '@/components/ui/icon';
import { cn, focusRing, press } from '@/components/ui/interaction';
import { messages } from '@/i18n/messages.es';
import type { AgentQuestion, ChatItem, ChatStore, QuestionAnswer } from '@/stores/chat';

const t = messages.chat;
const RECOMMENDED = /\s*\((recomendad[oa]|recommended)\)\s*$/i;

/** Label without the «(Recomendado)» suffix the agent adds, and whether it had it. */
function splitLabel(label: string): { text: string; recommended: boolean } {
  return { text: label.replace(RECOMMENDED, ''), recommended: RECOMMENDED.test(label) };
}

interface Draft {
  picked: string[];
  other: string;
}

const answerOf = (draft: Draft): string =>
  draft.other.trim() || draft.picked.map(label => splitLabel(label).text).join(', ');

export function QuestionPanel({
  item,
  chat,
  agentName,
}: {
  item: Extract<ChatItem, { type: 'question' }>;
  chat: ChatStore;
  agentName: string;
}) {
  const [minimized, setMinimized] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>(() => item.questions.map(() => ({ picked: [], other: '' })));
  const question = item.questions[step] as AgentQuestion;
  const draft = drafts[step] as Draft;
  const last = step === item.questions.length - 1;
  const ready = answerOf(draft) !== '';
  const answers = useMemo<QuestionAnswer[]>(
    () => item.questions.map((entry, at) => ({ question: entry.question, answer: answerOf(drafts[at] as Draft) })),
    [drafts, item.questions],
  );

  const triggerVoiceNotice = () => {
    setVoiceNotice('Dictado por voz no disponible aún (próximamente)');
    setTimeout(() => setVoiceNotice(null), 3500);
  };

  const update = (patch: Partial<Draft>) =>
    setDrafts(current => current.map((entry, at) => (at === step ? { ...entry, ...patch } : entry)));
  const submit = () => void chat.getState().answer(item.id, answers);
  const next = () => (last ? submit() : setStep(step + 1));
  const pick = (label: string) => {
    if (question.multiSelect) {
      update({
        picked: draft.picked.includes(label) ? draft.picked.filter(entry => entry !== label) : [...draft.picked, label],
        other: '',
      });
      return;
    }
    // A single choice answers the question at once, as in the agents' own question tools.
    const nextDrafts = drafts.map((entry, at) => (at === step ? { picked: [label], other: '' } : entry));
    setDrafts(nextDrafts);
    if (last)
      void chat.getState().answer(
        item.id,
        item.questions.map((entry, at) => ({
          question: entry.question,
          answer: answerOf(nextDrafts[at] as Draft),
        })),
      );
    else setStep(step + 1);
  };

  // 1–4 pick an option while the focus is not in the text field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (minimized) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const index = Number(event.key) - 1;
      const option = question.options[index];
      if (!option) return;
      event.preventDefault();
      pick(option.label);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-2">
      <section
        aria-label={t.questionFrom(agentName)}
        className={cn(
          'grid w-full min-w-0 rounded-[22px] border border-floating-border bg-floating transition-[border-color,padding] duration-150 ease-out',
          minimized ? 'p-2.5 px-3.5' : 'p-3.5',
        )}
      >
        {/* Header */}
        <div className={cn('flex items-center justify-between gap-3 px-1 min-w-0', !minimized && 'pb-2')}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative shrink-0">
              <Icon icon={CircleHelp} className="text-fg-muted" size={16} />
              <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-breach" />
            </div>
            <h3 className="truncate text-[14px] font-medium text-fg" title={question.question}>
              {question.question}
            </h3>
          </div>
          <div className="flex items-center gap-1 shrink-0 text-fg-muted">
            {item.questions.length > 1 ? (
              <span className="font-mono text-xs tabular-nums text-fg-muted me-1.5">
                {t.questionStep(step + 1, item.questions.length)}
              </span>
            ) : null}
            <button
              type="button"
              aria-label={minimized ? 'Expandir' : 'Minimizar'}
              title={minimized ? 'Expandir' : 'Minimizar'}
              onClick={() => setMinimized(v => !v)}
              className={cn(
                'grid size-6 place-items-center rounded-md text-fg-muted hover:text-fg hover:bg-surface transition-colors',
                focusRing,
              )}
            >
              <Icon icon={minimized ? ChevronUp : ChevronDown} size={16} />
            </button>
            <button
              type="button"
              aria-label="Cerrar"
              title="Cerrar"
              onClick={() => void chat.getState().answer(item.id, answers)}
              className={cn(
                'grid size-6 place-items-center rounded-md text-fg-muted hover:text-fg hover:bg-surface transition-colors',
                focusRing,
              )}
            >
              <Icon icon={X} size={16} />
            </button>
          </div>
        </div>

        {!minimized ? (
          <>
            {item.questions.length > 1 ? (
              <div role="tablist" aria-label={t.questions} className="flex flex-wrap gap-1 px-1 pb-2">
                {item.questions.map((entry, at) => (
                  <button
                    key={entry.question}
                    type="button"
                    role="tab"
                    aria-selected={at === step}
                    onClick={() => setStep(at)}
                    className={cn(
                      'flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                      at === step
                        ? 'border-accent/60 bg-accent/15 text-fg'
                        : 'border-divider text-fg-muted hover:border-fg-muted/40 hover:text-fg',
                      press,
                      focusRing,
                    )}
                  >
                    {answerOf(drafts[at] as Draft) ? <Icon icon={Check} size={16} className="text-attested" /> : null}
                    {entry.header || t.questionStep(at + 1, item.questions.length)}
                  </button>
                ))}
              </div>
            ) : null}

            {question.multiSelect ? <p className="px-1 pb-1 text-xs text-fg-muted">{t.questionMulti}</p> : null}

            {voiceNotice ? (
              <div
                role="status"
                aria-live="polite"
                className="mb-1 rounded-lg border border-accent/40 bg-surface px-2.5 py-1 text-center text-xs font-medium text-accent-bright"
              >
                {voiceNotice}
              </div>
            ) : null}

            {/* Options List */}
            <div className="grid gap-1 min-w-0">
              {question.options.map((option, at) => {
                const { text, recommended } = splitLabel(option.label);
                const chosen = draft.picked.includes(option.label);
                return (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => pick(option.label)}
                    className={cn(
                      'group flex w-full min-w-0 items-center gap-3 rounded-xl px-2.5 py-1.5 text-start text-xs',
                      'transition-[background-color,border-color] duration-150 ease-out',
                      chosen
                        ? 'bg-surface border border-accent/40 text-fg'
                        : 'border border-transparent hover:bg-surface/70 text-fg/90',
                      press,
                      focusRing,
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'grid size-5 shrink-0 place-items-center rounded-md font-mono text-[11px] tabular-nums',
                        chosen
                          ? 'bg-accent/25 text-accent-bright font-semibold'
                          : 'bg-surface border border-divider text-fg-muted group-hover:text-fg',
                      )}
                    >
                      {chosen ? <Icon icon={Check} size={16} /> : at + 1}
                    </span>
                    <span className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-x-2 truncate">
                      <span className="flex items-center gap-1.5 min-w-0 truncate">
                        {recommended ? (
                          <span className="text-fg-muted font-normal me-1 truncate">
                            (<span>{t.recommended}</span>)
                          </span>
                        ) : null}
                        <span className="text-[13px] text-fg truncate">{text}</span>
                      </span>
                      {option.description ? (
                        <span className="truncate text-xs text-fg-muted/70">{option.description}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}

              {/* Option N+1: "Other (write your answer)" with embedded Mic, Skip and Submit */}
              <div
                className={cn(
                  'group flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border px-2.5 py-1 transition-[background-color,border-color] duration-150 ease-out',
                  draft.other.trim() ? 'border-accent/40 bg-surface' : 'border-transparent hover:bg-surface/70',
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-5 shrink-0 place-items-center rounded-md border border-divider bg-surface font-mono text-[11px] tabular-nums text-fg-muted"
                  >
                    {question.options.length + 1}
                  </span>
                  <input
                    aria-label={t.otherAnswer}
                    placeholder={t.otherAnswer}
                    value={draft.other}
                    onChange={event => update({ other: event.target.value, picked: [] })}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && ready) {
                        event.preventDefault();
                        next();
                      }
                    }}
                    className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-muted/60"
                  />
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Dictar por voz"
                    title="Dictado por voz (próximamente)"
                    onClick={triggerVoiceNotice}
                    className={cn(
                      'grid size-7 place-items-center rounded-full text-fg-muted hover:text-fg hover:bg-surface transition-colors',
                      focusRing,
                    )}
                  >
                    <Icon icon={Mic} size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={next}
                    className={cn(
                      'px-2.5 py-1 text-xs font-medium text-fg-muted hover:text-fg transition-colors rounded-lg',
                      focusRing,
                    )}
                  >
                    {t.skipQuestion}
                  </button>
                  <button
                    type="button"
                    disabled={!ready}
                    onClick={next}
                    className={cn(
                      'flex items-center gap-1 rounded-full bg-breach px-3 py-1 text-xs font-medium text-fg',
                      'transition-opacity hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed',
                      press,
                      focusRing,
                    )}
                  >
                    <span>{t.sendAnswer}</span>
                    <Icon icon={CornerDownLeft} size={16} />
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

/** A question already answered (or withdrawn), as one compact block of the transcript. */
export function AnsweredQuestion({ item }: { item: Extract<ChatItem, { type: 'question' }> }) {
  if (item.status === 'cancelled')
    return (
      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        <Icon icon={CircleAlert} />
        {t.questionCancelled}
      </p>
    );
  return (
    <div className="grid gap-1.5 rounded-xl border border-divider bg-surface px-3 py-2.5 text-[13px]">
      {item.questions.map((entry, at) => (
        <div key={entry.question} className="grid gap-0.5">
          <span className="text-xs text-fg-muted">{entry.question}</span>
          <span className="flex items-center gap-1.5 text-fg">
            <Icon icon={Check} className="text-attested" />
            {item.answers?.[at]?.answer || '—'}
          </span>
        </div>
      ))}
    </div>
  );
}
