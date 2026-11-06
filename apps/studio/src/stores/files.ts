/** Files store (SH-12): `files.tree` with Git marks and the expanded directories of the Inspector tree. */
import { createStore } from 'zustand/vanilla';
import type { StudioClient } from '@/ipc/client';
import type { FileNode } from '@/ipc/types';
import { createResourceStore, type ResourceStore } from './resource';

export interface FilesState {
  resource: ResourceStore<FileNode>;
  expanded: Record<string, boolean>;
  toggle(path: string): void;
}

export interface FlatFile {
  node: FileNode;
  depth: number;
}

/** Depth-first rows of the visible tree: directories first, then files, alphabetically (PJ-FIL-01 order). */
export function flattenTree(root: FileNode | undefined, expanded: Record<string, boolean>): FlatFile[] {
  const rows: FlatFile[] = [];
  const walk = (nodes: FileNode[] | undefined, depth: number) => {
    for (const node of nodes ?? []) {
      rows.push({ node, depth });
      if (node.kind === 'dir' && expanded[node.path]) walk(node.children, depth + 1);
    }
  };
  walk(root?.children, 1);
  return rows;
}

/** Every file path of the tree (command palette search). */
export function allFiles(root: FileNode | undefined): string[] {
  const paths: string[] = [];
  const walk = (nodes: FileNode[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.kind === 'file') paths.push(node.path);
      else walk(node.children);
    }
  };
  walk(root?.children);
  return paths;
}

export function createFilesStore(client: StudioClient) {
  return createStore<FilesState>()((set, get) => ({
    resource: createResourceStore<FileNode>(() => client.call('files.tree', {}), {
      isEmpty: data => (data.children ?? []).length === 0,
    }),
    expanded: {},
    toggle(path) {
      set({ expanded: { ...get().expanded, [path]: !get().expanded[path] } });
    },
  }));
}

export type FilesStore = ReturnType<typeof createFilesStore>;
