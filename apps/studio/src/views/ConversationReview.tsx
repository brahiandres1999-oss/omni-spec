/**
 * Resumen › Revisión (docs/STUDIO-AGENT-COCKPIT.md, Fase 3 Q14): «Cambios», only the files this conversation
 * touched with the line diff of each edit and +N −M, and «Impacto» (what was Cartografía): the Blast Radius of
 * each touched file, with the whole module map one click away. The repo-wide diff is in Archivos › Cambios de git.
 */
import { Dialog } from 'radix-ui';
import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { useEnsureLoaded, useStudio } from '@/app/studio-context';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, FileDiff, Icon, Network, X } from '@/components/ui/icon';
import { cn, focusRingInset, mono } from '@/components/ui/interaction';
import { DiffLines } from '@/components/ui/line-diff';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { messages } from '@/i18n/messages.es';
import { type ConversationReview as Review, conversationReview, type TouchedFile } from '@/stores/conversation-review';
import { CartographyView } from './CartographyView';
import { BlastRadiusPanel } from './cartography/BlastRadiusPanel';

const t = messages.review;

/** The review of the open conversation; the panel button shows its +N −M. */
export function useConversationReview(): Review {
  const { project, projectId } = useStudio();
  const items = useStore(project.chat, state => state.items);
  return useMemo(() => conversationReview(items, projectId), [items, projectId]);
}

export function Counts({ added, removed, className }: { added: number; removed: number; className?: string }) {
  return (
    <span className={cn(mono, 'flex shrink-0 gap-1.5 text-xs tabular-nums', className)}>
      <span className="text-attested">+{added}</span>
      <span className="text-breach">−{removed}</span>
    </span>
  );
}

function FileChanges({ file }: { file: TouchedFile }) {
  const [open, setOpen] = useState(true);
  return (
    <li className="border-b border-divider" data-review-file={file.path}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className={cn(
          'flex min-h-9 w-full min-w-0 items-center gap-2 px-3 text-start text-xs hover:bg-divider',
          focusRingInset,
        )}
      >
        <Icon icon={open ? ChevronDown : ChevronRight} className="text-fg-muted" />
        <span className={cn(mono, 'min-w-0 flex-1 truncate text-fg')} title={file.path}>
          {file.path}
        </span>
        <Counts added={file.added} removed={file.removed} />
      </button>
      {open ? (
        <div className="grid gap-2 px-3 pb-3">
          {file.edits.map(edit => (
            <div key={edit.id} className="grid gap-1">
              {edit.replacesFile ? <span className="text-[11px] text-fg-muted">{t.wholeFile}</span> : null}
              <DiffLines lines={edit.lines} />
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function Changes({ review }: { review: Review }) {
  if (review.files.length === 0)
    return (
      <div className="grid justify-items-center gap-2 px-6 py-12 text-center">
        <Icon icon={FileDiff} size={18} className="text-fg-muted" />
        <p className="text-xs text-balance text-fg-muted">{t.empty}</p>
      </div>
    );
  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
      <div className="flex items-center gap-2 border-b border-divider px-3 py-2 text-xs text-fg-muted">
        <span className="flex-1">{t.files(review.files.length)}</span>
        <Counts added={review.added} removed={review.removed} />
      </div>
      <ul aria-label={t.changes}>
        {review.files.map(file => (
          <FileChanges key={file.path} file={file} />
        ))}
      </ul>
    </div>
  );
}

function Impact({ review }: { review: Review }) {
  const { project } = useStudio();
  const graph = project.graph;
  const resource = useStore(graph, state => state.resource);
  useEnsureLoaded(resource);
  const selected = useStore(graph, state => state.selected);
  const heat = useStore(graph, state => state.heat);
  const [mapOpen, setMapOpen] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="border-b border-divider px-3 py-2 text-xs text-pretty text-fg-muted">{t.impactHint}</p>
      {review.files.length === 0 ? (
        <p className="px-3 py-3 text-xs text-fg-muted">{t.impactEmpty}</p>
      ) : (
        <ul aria-label={t.impactFiles} className="max-h-40 shrink-0 overflow-y-auto border-b border-divider py-1">
          {review.files.map(file => (
            <li key={file.path}>
              <button
                type="button"
                aria-pressed={selected === file.path}
                onClick={() => void graph.getState().select(file.path)}
                className={cn(
                  mono,
                  'flex min-h-7 w-full items-center px-3 text-start text-xs hover:bg-divider',
                  selected === file.path ? 'text-fg' : 'text-fg-muted',
                  focusRingInset,
                )}
              >
                <span className="truncate">{file.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected && review.files.some(file => file.path === selected) ? (
          <BlastRadiusPanel selected={selected} status={heat.status} heat={heat.data} error={heat.error} />
        ) : null}
      </div>
      <div className="border-t border-divider p-2">
        <Button size="sm" variant="ghost" icon={Network} onClick={() => setMapOpen(true)}>
          {t.openMap}
        </Button>
      </div>
      <Dialog.Root open={mapOpen} onOpenChange={setMapOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/70" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-6 z-50 grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-floating-border bg-canvas text-fg"
          >
            <div className="flex h-11 items-center justify-between border-b border-divider px-4">
              <Dialog.Title className="text-sm font-semibold">{t.mapTitle}</Dialog.Title>
              <Dialog.Close asChild>
                <Button size="icon-sm" variant="ghost" aria-label={messages.board.close}>
                  <Icon icon={X} />
                </Button>
              </Dialog.Close>
            </div>
            <CartographyView />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

export function ConversationReview() {
  const review = useConversationReview();
  const [view, setView] = useState<'changes' | 'impact'>('changes');
  return (
    <Tabs
      value={view}
      onValueChange={value => setView(value as 'changes' | 'impact')}
      className="flex h-full min-h-0 flex-col"
    >
      <TabsList aria-label={t.region} className="h-9 shrink-0 border-b border-divider px-2">
        <TabsTrigger value="changes">{t.changes}</TabsTrigger>
        <TabsTrigger value="impact">{t.impact}</TabsTrigger>
      </TabsList>
      <TabsContent value="changes" className="min-h-0 flex-1">
        <Changes review={review} />
      </TabsContent>
      <TabsContent value="impact" className="min-h-0 flex-1">
        <Impact review={review} />
      </TabsContent>
    </Tabs>
  );
}
