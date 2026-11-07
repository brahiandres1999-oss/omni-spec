/**
 * Line diff of an agent edit (Edit's old_string → new_string, or a whole new file): unchanged lines in
 * between, removed lines red, added lines green, like a Git hunk. LCS on lines, capped so a huge edit
 * degrades to "all removed, then all added" instead of freezing the UI.
 */
import { cn, mono } from './interaction';

export type DiffLine = { kind: 'same' | 'del' | 'add'; text: string };

const MAX_CELLS = 250_000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  if (a.length * b.length > MAX_CELLS)
    return [...a.map(text => ({ kind: 'del' as const, text })), ...b.map(text => ({ kind: 'add' as const, text }))];
  // at(i, j) = length of the LCS of a[i..] and b[j..], in one flat table.
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  const at = (i: number, j: number) => table[i * width + j] ?? 0;
  const line = (lines: string[], index: number) => lines[index] ?? '';
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] = line(a, i) === line(b, j) ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (line(a, i) === line(b, j)) {
      out.push({ kind: 'same', text: line(a, i) });
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) out.push({ kind: 'del', text: line(a, i++) });
    else out.push({ kind: 'add', text: line(b, j++) });
  }
  while (i < a.length) out.push({ kind: 'del', text: line(a, i++) });
  while (j < b.length) out.push({ kind: 'add', text: line(b, j++) });
  return out;
}

const ROW = {
  same: 'text-fg-muted',
  del: 'bg-breach/12 text-fg',
  add: 'bg-attested/12 text-fg',
} as const;
const SIGN = { same: ' ', del: '−', add: '+' } as const;

export function LineDiff({ before, after, className }: { before: string; after: string; className?: string }) {
  return <DiffLines lines={diffLines(before, after)} className={className} />;
}

/** Lines already diffed (the conversation review folds them per file). */
export function DiffLines({ lines, className }: { lines: DiffLine[]; className?: string }) {
  const added = lines.filter(line => line.kind === 'add').length;
  const removed = lines.filter(line => line.kind === 'del').length;
  return (
    <div className={cn('overflow-hidden rounded-md border border-divider bg-canvas', className)}>
      <div className={cn(mono, 'flex gap-3 border-b border-divider bg-surface px-2.5 py-1 text-xs')}>
        <span className="text-attested">+{added}</span>
        <span className="text-breach">−{removed}</span>
      </div>
      <div className={cn(mono, 'max-h-72 overflow-auto overscroll-contain py-1 text-xs leading-5')}>
        {lines.map((line, index) => (
          // Lines have no identity beyond their position in this diff.
          // biome-ignore lint/suspicious/noArrayIndexKey: static list rendered once per edit
          <div key={index} className={cn('flex min-w-max', ROW[line.kind])}>
            <span aria-hidden="true" className="w-6 shrink-0 select-none text-center opacity-70">
              {SIGN[line.kind]}
            </span>
            <span className="whitespace-pre pe-3">{line.text || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
