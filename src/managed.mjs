import { readFile, writeFile, mkdir, rename, lstat } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const registryPath = 'specs/.omni/managed.json';
export const hash = content => createHash('sha256').update(content).digest('hex');
const sectionPattern = /<!-- OMNI-SPEC-START -->[\s\S]*?<!-- OMNI-SPEC-END -->/;
const fingerprint = (content, section) => hash(section ? content.match(sectionPattern)?.[0] || '' : content);

export async function safePath(root, name) {
  const base = resolve(root);
  const target = resolve(base, name);
  const rel = relative(base, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Unsafe project path: ${name}`);
  let current = target;
  while (current !== base) {
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing managed symlink: ${name}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    current = dirname(current);
  }
  return target;
}

async function optionalRead(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function loadRegistry(root) {
  const raw = await optionalRead(await safePath(root, registryPath));
  if (raw === null) return { version: 1, files: {} };
  const registry = JSON.parse(raw);
  if (registry.version !== 1 || !registry.files || typeof registry.files !== 'object')
    throw new Error('Invalid managed-file registry. Restore specs/.omni/managed.json.');
  return registry;
}

// Check every destination before writing. Unknown legacy contents are user-owned.
export async function syncManagedFiles(root, entries, options = {}) {
  const registry = await loadRegistry(root);
  const actions = [],
    conflicts = [];
  for (const [name, entry] of new Map(entries.map(e => [e.path, e]))) {
    const path = await safePath(root, name);
    const previous = await optionalRead(path);
    let content = entry.content;
    if (entry.section && previous !== null) {
      const starts = (previous.match(/<!-- OMNI-SPEC-START -->/g) || []).length;
      const ends = (previous.match(/<!-- OMNI-SPEC-END -->/g) || []).length;
      if (starts !== ends || starts > 1 || (starts && !sectionPattern.test(previous)))
        throw new Error(`Malformed OmniSpec section: ${name}`);
      content = starts
        ? previous.replace(sectionPattern, () => entry.content)
        : previous.trimEnd() + '\n\n' + entry.content + '\n';
    }
    const known = registry.files[name];
    const noOwnedSection = entry.section && previous !== null && !sectionPattern.test(previous);
    const changedLocally =
      previous !== null &&
      previous !== content &&
      !noOwnedSection &&
      (known?.hash || known) !== fingerprint(previous, entry.section);
    if (changedLocally && !options.acceptUpdates) conflicts.push(name);
    actions.push({ name, path, content, previous, changedLocally, section: entry.section });
  }
  const summary = {
    created: actions.filter(a => a.previous === null).map(a => a.name),
    updated: actions.filter(a => a.previous !== null && a.previous !== a.content).map(a => a.name),
    conflicts,
    backups: [],
  };
  if (options.dryRun) return summary;
  if (conflicts.length)
    throw new Error(
      `Local changes preserved; update blocked: ${conflicts.join(', ')}. Review update --dry-run, then use --accept-updates to back up and replace these files.`,
    );
  const backupId = `${Date.now()}-${randomUUID()}`;
  for (const action of actions) {
    if (action.previous !== action.content) {
      if (action.changedLocally) {
        const backup = `specs/.omni/backups/${backupId}/${action.name}`;
        const backupPath = await safePath(root, backup);
        await mkdir(dirname(backupPath), { recursive: true });
        await writeFile(backupPath, action.previous, { flag: 'wx' });
        summary.backups.push(backup);
      }
      await mkdir(dirname(action.path), { recursive: true });
      await writeFile(action.path, action.content, 'utf8');
    }
    registry.files[action.name] = {
      hash: fingerprint(action.content, action.section),
      section: Boolean(action.section),
    };
  }
  const target = await safePath(root, registryPath);
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `managed.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(registry, null, 2) + '\n');
  await rename(temporary, target);
  return summary;
}

export async function checkManagedFiles(root) {
  const registry = await loadRegistry(root);
  const changed = [];
  for (const [name, digest] of Object.entries(registry.files)) {
    const content = await optionalRead(await safePath(root, name));
    if (content === null || fingerprint(content, digest.section) !== (digest.hash || digest)) changed.push(name);
  }
  return { tracked: Object.keys(registry.files).length, changed };
}
