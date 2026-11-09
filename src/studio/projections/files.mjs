import { execFile } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { listProjectFiles } from '../../cartography/files.mjs';
import { isGitWorkTree } from '../../memory.mjs';
import { StudioError } from '../protocol.mjs';

const execFileAsync = promisify(execFile);

/**
 * Inspector "Files" tab: the project tree (same ignore rules as cartography) with the Git status
 * of each file from `git status --porcelain=v2 -z`, run without a shell.
 */

function statusFromXY(xy) {
  if (xy.includes('U')) return 'conflicted';
  if (xy[0] === 'A') return 'added';
  return 'modified';
}

/** @returns {Promise<Map<string, string>>} POSIX path → added | modified | renamed | untracked | conflicted. */
export async function gitStatusMap(root) {
  // A folder that is not a repository has a tree but no Git status.
  if (!(await isGitWorkTree(root))) return new Map();
  const { stdout } = await execFileAsync('git', ['status', '--porcelain=v2', '-z', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const status = new Map();
  const records = stdout.split('\0');
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record) continue;
    const afterFields = count => record.split(' ').slice(count).join(' ');
    if (record.startsWith('1 ')) status.set(afterFields(8), statusFromXY(record.slice(2, 4)));
    else if (record.startsWith('2 ')) {
      status.set(afterFields(9), 'renamed');
      index++; // the original path follows as its own NUL-separated record
    } else if (record.startsWith('u ')) status.set(afterFields(10), 'conflicted');
    else if (record.startsWith('? ')) status.set(record.slice(2), 'untracked');
  }
  return status;
}

const byKindThenName = (a, b) =>
  a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

function sortTree(node) {
  if (!node.children) return node;
  node.children.sort(byKindThenName);
  for (const child of node.children) sortTree(child);
  return node;
}

/**
 * @param {string} root
 * @param {{under?: string}} [options] Project-relative subtree.
 * @throws {StudioError} PATH_OUTSIDE_ROOT
 */
export async function fileTree(root, { under = '' } = {}) {
  const base = relative(root, resolve(root, under));
  if (base === '..' || base.startsWith(`..${sep}`) || isAbsolute(base))
    throw new StudioError('PATH_OUTSIDE_ROOT', `${under} is not inside the project.`);
  const prefix = base ? `${base.split(sep).join('/')}/` : '';
  const status = await gitStatusMap(root);
  const tree = {
    name: prefix ? prefix.slice(0, -1).split('/').pop() : '',
    path: prefix.slice(0, -1),
    kind: 'dir',
    children: [],
  };
  for (const path of listProjectFiles(root)) {
    if (!path.startsWith(prefix)) continue;
    const parts = path.slice(prefix.length).split('/');
    let node = tree;
    for (const [index, name] of parts.entries()) {
      const childPath = prefix + parts.slice(0, index + 1).join('/');
      const isFile = index === parts.length - 1;
      let child = node.children.find(entry => entry.name === name);
      if (!child) {
        child = isFile
          ? { name, path: childPath, kind: 'file', git: status.get(childPath) ?? null }
          : { name, path: childPath, kind: 'dir', children: [] };
        node.children.push(child);
      }
      node = child;
    }
  }
  return sortTree(tree);
}
