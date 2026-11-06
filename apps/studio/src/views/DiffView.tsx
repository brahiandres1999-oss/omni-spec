/**
 * DiffView — side-by-side reviewer with hunk cherry-picking (plan §11.4 VD-01…09, RV, D-8, D-10).
 *
 * Approving a hunk stages it (`git apply --cached` in the engine); rejecting leaves it in the working tree.
 * Studio never reverts code nor commits: it authorises Gate 2, and the engine refuses with GATE_LOCKED until
 * every hunk is decided and the verification is attested (shown as a Protected banner).
 */
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useEnsureLoaded, useRefreshOn, useStudio } from '@/app/studio-context';
import { Button } from '@/components/ui/button';
import { type DiffMode, DiffViewer, type DiffViewerHandle, type RemarkTarget } from '@/components/ui/diff-viewer';
import { GateBanner } from '@/components/ui/GateBanner';
import { ArrowRight, Columns2, FileDiff, Icon, Rows3, SendHorizontal, ShieldCheck } from '@/components/ui/icon';
import { cn, focusRing, mono, press } from '@/components/ui/interaction';
import { ProtectedState } from '@/components/ui/ProtectedState';
import { EmptyState, ErrorState, SkeletonBar, SkeletonRow, ViewFrame } from '@/components/ui/view-state';
import type { StudioError } from '@/ipc/client';
import type { DiffFile, DiffPayload } from '@/ipc/types';
import { formatInt, messages } from '@/i18n/messages.es';
import { reviewFor } from '@/stores/app';
import { allDecided, REMARK_MAX, remarkIsValid, type ReviewStore } from '@/stores/review';

const FRAME = 'grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]';

export function DiffView({ spec }: { spec: string }) {
  const { client, project, dispatch } = useStudio();
  const review = useMemo(() => reviewFor(client, project, spec), [client, project, spec]);
  const resource = useStore(review, state => state.resource);
  useEnsureLoaded(resource);
  useRefreshOn(['diff'], resource);

  const status = useStore(resource, state => state.status);
  const data = useStore(resource, state => state.data);
  const error = useStore(resource, state => state.error);
  const frameState = status === 'idle' ? 'loading' : status;

  return (
    <ViewFrame view="diff" state={frameState} layout="diff-review" className={FRAME}>
      {frameState === 'loading' ? (
        <>
          <div className="flex h-12 items-center gap-3 border-b border-divider px-4">
            <SkeletonBar className="w-40" />
            <SkeletonBar className="ms-auto w-56" />
          </div>
          <div className="flex flex-col gap-px p-0 pt-2">
            {Array.from({ length: 14 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows.
              <SkeletonRow key={index} token="diff-line" className="mx-4 rounded-sm" />
            ))}
          </div>
        </>
      ) : frameState === 'ready' && data ? (
        <Review review={review} data={data} />
      ) : (
        <>
          <div className="h-12 border-b border-divider" />
          {frameState === 'empty' ? (
            <EmptyState
              icon={FileDiff}
              title={messages.diff.emptyTitle}
              body={messages.diff.emptyBody}
              actions={[
                {
                  label: messages.diff.ctaBoard,
                  icon: ArrowRight,
                  onSelect: () => dispatch({ type: 'stage.open', tab: 'kanban' }),
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

/**
 * Gate 2 of `spec` is known to be locked before anyone presses the button: it is required and the
 * verification is not attested (E2E-09). The engine stays the authority (RV-11): this only avoids
 * offering an approval that cannot succeed.
 */
function useKnownGate2Lock(spec: string): string | null {
  const { project, snapshot } = useStudio();
  const board = useStore(
    useStore(project.board, state => state.resource),
    state => state.data,
  );
  const snap = useStore(snapshot, state => state.data);
  if (!spec) return null;
  const card = board
    ? [...board.lanes.flatMap(lane => lane.cards), ...board.unrouted].find(c => c.id === spec)
    : undefined;
  const slug = card?.slug ?? snap?.specs.find(entry => entry.id === spec)?.slug;
  const gates = card?.gates ?? (slug ? snap?.gates[slug] : undefined);
  if (!gates?.required || gates[2] === 'approved') return null;
  return card?.attestation === 'valid' ? null : messages.diff.gate2Unattested;
}

function Review({ review, data }: { review: ReviewStore; data: DiffPayload }) {
  const { client, ui } = useStudio();
  const decisions = useStore(review, state => state.decisions);
  const gate = useStore(review, state => state.gate);
  const staging = useStore(review, state => state.staging);
  const diffFocus = useStore(ui, state => state.diffFocus);
  const [mode, setMode] = useState<DiffMode>('unified');
  const [remarkTarget, setRemarkTarget] = useState<RemarkTarget | null>(null);
  const [loaded, setLoaded] = useState<Record<string, DiffFile>>({});
  const [failure, setFailure] = useState<StudioError | null>(null);
  const viewer = useRef<DiffViewerHandle | null>(null);
  const knownLock = useKnownGate2Lock(review.getState().spec);
  const gateReason = gate.status === 'locked' ? (gate.error?.detail ?? '') : knownLock;

  const files = data.files.map(file => loaded[file.path] ?? file);
  const hunkTotal = files.reduce((sum, file) => sum + (file.hunks?.length ?? 0), 0);
  const decided = files
    .flatMap(file => file.hunks ?? [])
    .filter(hunk => decisions[hunk.id]?.status === 'confirmed').length;
  const ready = allDecided({ ...data, files }, decisions);

  // Files tab → "open this file's diff" (SH-12).
  useEffect(() => {
    if (!diffFocus) return;
    ui.setState({ diffFocus: null });
    requestAnimationFrame(() => viewer.current?.scrollToFile(diffFocus.path));
  }, [diffFocus, ui]);

  const decide = (hunkId: string, decision: 'approve' | 'reject') => {
    setFailure(null);
    review
      .getState()
      .decide(hunkId, decision)
      .catch((reason: StudioError) => {
        setFailure(reason);
        if (reason.code === 'HUNK_STALE') void review.getState().resource.getState().refresh();
      });
  };

  const loadFile = (path: string) => {
    client
      .call('diff.getFile', { path })
      .then(file => setLoaded(current => ({ ...current, [path]: file as DiffFile })))
      .catch((reason: StudioError) => setFailure(reason));
  };

  return (
    <>
      <div className="flex min-h-12 flex-wrap items-center gap-3 border-b border-divider px-4 py-2">
        <div
          role="radiogroup"
          aria-label={messages.diff.mode}
          className="flex items-center rounded-lg border border-floating-border p-0.5"
        >
          {(
            [
              ['unified', messages.diff.unified, Rows3],
              ['split', messages.diff.split, Columns2],
            ] as const
          ).map(([value, label, glyph]) => (
            // biome-ignore lint/a11y/useSemanticElements: segmented control styled as buttons with radio semantics (VD-02)
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                'flex h-6 items-center gap-1.5 rounded-md ps-2.5 pe-3.5 text-[11px]',
                mode === value ? 'bg-divider text-fg' : 'text-fg-muted hover:text-fg',
                press,
                focusRing,
              )}
            >
              <Icon icon={glyph} />
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-fg-muted">
          <span className={cn('text-fg', mono)}>{messages.diff.decided(decided, hunkTotal)}</span>{' '}
          {messages.diff.decidedLabel}
        </span>
        {staging.status === 'done' ? (
          <span className="text-xs text-attested">{messages.diff.staged(staging.staged ?? 0)}</span>
        ) : null}
        {failure ? <span className="text-xs text-breach">{failure.message}</span> : null}
        <span className="flex-1" />
        <Button
          size="sm"
          disabled={!ready || staging.status === 'pending'}
          onClick={() => void review.getState().stageApproved()}
        >
          {messages.diff.stage}
        </Button>
        {gateReason !== null ? null : (
          <Button
            size="sm"
            variant="primary"
            icon={ShieldCheck}
            disabled={gate.status === 'pending' || gate.status === 'approved'}
            onClick={() => void review.getState().approveGate()}
          >
            {messages.diff.approveGate2}
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-col">
        {gateReason !== null ? <GateBanner reason={gateReason} /> : null}
        <DiffViewer
          files={files}
          mode={mode}
          decisions={decisions}
          remarkTarget={remarkTarget}
          onDecide={decide}
          onComment={setRemarkTarget}
          onLoadFile={loadFile}
          handle={viewer}
        />
        {remarkTarget ? (
          <RemarkComposer
            key={`${remarkTarget.file}:${remarkTarget.line}:${remarkTarget.side}`}
            target={remarkTarget}
            review={review}
            onDone={() => setRemarkTarget(null)}
          />
        ) : null}
      </div>
    </>
  );
}

function RemarkComposer({ target, review, onDone }: { target: RemarkTarget; review: ReviewStore; onDone(): void }) {
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const errorId = useId();

  useEffect(() => {
    box.current?.focus();
  }, []);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!remarkIsValid(text)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setSending(true);
    try {
      await review.getState().addRemark({ ...target, text });
      onDone();
    } catch (reason) {
      setFailure((reason as StudioError).message ?? messages.errors.fallback ?? '');
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      onSubmit={event => void submit(event)}
      className="flex flex-col gap-2 border-t border-divider bg-surface px-4 py-3 pb-24"
    >
      <div className="flex items-center gap-2 text-xs">
        <span className="text-fg-muted">{messages.diff.remark}</span>
        <span className={cn('text-accent', mono)}>
          {messages.diff.remarkFor(target.file, target.line, target.side)}
        </span>
        <span className="flex-1" />
        <span className={cn('text-fg-muted', mono, text.length > REMARK_MAX && 'text-breach')}>
          {formatInt(text.length)} / {formatInt(REMARK_MAX)}
        </span>
      </div>
      <textarea
        ref={box}
        aria-label={messages.diff.remark}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        value={text}
        rows={3}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submit();
          if (event.key === 'Escape') onDone();
        }}
        className={cn(
          'w-full resize-none rounded-lg border bg-floating px-3 py-2 text-[13px] text-fg placeholder:text-fg-muted',
          invalid ? 'border-breach' : 'border-floating-border',
          focusRing,
        )}
      />
      {invalid ? (
        <p id={errorId} className="text-xs text-breach">
          {messages.diff.remarkInvalid}
        </p>
      ) : null}
      {failure ? <p className="text-xs text-breach">{failure}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          {messages.diff.cancelRemark}
        </Button>
        <Button size="sm" variant="primary" type="submit" icon={SendHorizontal} disabled={sending}>
          {messages.diff.sendRemark}
        </Button>
      </div>
    </form>
  );
}
