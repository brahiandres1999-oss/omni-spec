/**
 * «Revisión de esta conversación» (docs/STUDIO-AGENT-COCKPIT.md, Fase 3 Q14): only the files this conversation
 * touched, read from its `tool` events with a `file_path`, each with the line diff of every edit and +N −M.
 * Pure, so it is tested without a store. A tool that failed or was rejected changed nothing and is left out.
 */
import { type DiffLine, diffLines } from '@/components/ui/line-diff';
import type { ChatItem, ToolInput } from './chat';

export interface FileEdit {
  /** Id of the tool call. */
  id: string;
  tool: string;
  /** A Write replaces the whole file: the earlier content is unknown, so every line counts as added. */
  replacesFile: boolean;
  lines: DiffLine[];
}

export interface TouchedFile {
  /** Path relative to the project when it is inside it, with `/`. */
  path: string;
  edits: FileEdit[];
  added: number;
  removed: number;
}

export interface ConversationReview {
  files: TouchedFile[];
  added: number;
  removed: number;
}

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

const text = (input: ToolInput, key: string) => {
  const value = input?.[key];
  return typeof value === 'string' ? value : null;
};

/** `C:\dev\app\src\a.ts` under `C:\dev\app` → `src/a.ts`; a path outside the project stays absolute. */
export function relativePath(path: string, root: string | null): string {
  const normal = path.replaceAll('\\', '/');
  if (!root) return normal;
  const base = root.replaceAll('\\', '/').replace(/\/+$/, '');
  const windows = /^[a-z]:\//i.test(base);
  const same = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (same(normal.slice(0, base.length + 1), `${base}/`)) return normal.slice(base.length + 1);
  return normal;
}

function linesOf(name: string, input: ToolInput): DiffLine[] {
  if (name === 'Write') return diffLines('', text(input, 'content') ?? '');
  if (name === 'NotebookEdit') return diffLines('', text(input, 'new_source') ?? '');
  if (name === 'MultiEdit') {
    const edits = Array.isArray(input?.edits) ? (input.edits as unknown[]) : [];
    return edits.flatMap(edit => {
      const entry = edit && typeof edit === 'object' ? (edit as Record<string, unknown>) : {};
      const before = typeof entry.old_string === 'string' ? entry.old_string : '';
      const after = typeof entry.new_string === 'string' ? entry.new_string : '';
      return diffLines(before, after);
    });
  }
  return diffLines(text(input, 'old_string') ?? '', text(input, 'new_string') ?? '');
}

export function conversationReview(items: readonly ChatItem[], root: string | null): ConversationReview {
  const byPath = new Map<string, TouchedFile>();
  for (const item of items) {
    if (item.type !== 'tool' || item.status === 'error' || !EDIT_TOOLS.has(item.name)) continue;
    const file = text(item.input, 'file_path') ?? text(item.input, 'notebook_path');
    if (!file) continue;
    const path = relativePath(file, root);
    const lines = linesOf(item.name, item.input);
    const added = lines.filter(line => line.kind === 'add').length;
    const removed = lines.filter(line => line.kind === 'del').length;
    const entry = byPath.get(path) ?? { path, edits: [], added: 0, removed: 0 };
    entry.edits.push({ id: item.id, tool: item.name, replacesFile: item.name === 'Write', lines });
    entry.added += added;
    entry.removed += removed;
    byPath.set(path, entry);
  }
  const files = [...byPath.values()];
  return {
    files,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
  };
}
