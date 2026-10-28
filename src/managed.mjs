import { readFile, writeFile, mkdir, lstat, unlink } from 'node:fs/promises';
import { writeFileAtomic } from './fs-retry.mjs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const registryPath = 'specs/.omni/managed.json';
export const hash = content => createHash('sha256').update(content).digest('hex');
// Managed sections inside user-owned files: HTML comments for Markdown, '#' comments for
// line-oriented files such as .gitignore. Registry entries store true (html) or 'hash'.
const SECTION_MARKERS = {
  html: ['<!-- OMNI-SPEC-START -->', '<!-- OMNI-SPEC-END -->'],
  hash: ['# OMNI-SPEC-START', '# OMNI-SPEC-END'],
};
const markersFor = section => SECTION_MARKERS[section === 'hash' ? 'hash' : 'html'];
const escapeMarker = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sectionPatternFor = section => {
  const [start, end] = markersFor(section);
  return new RegExp(`${escapeMarker(start)}[\\s\\S]*?${escapeMarker(end)}`);
};
// Line endings are normalized so a checkout converted to CRLF (Git core.autocrlf on
// Windows) is not mistaken for a local edit.
const lf = content => content.replace(/\r\n/g, '\n');
/** SHA-256 of a whole managed file with line endings normalized. */
export const managedHash = content => hash(lf(String(content)));

/**
 * Extract the OmniSpec-managed section of a user-owned file.
 * @param {string} content File content.
 * @param {'hash'|boolean} section 'hash' for '#' markers (.gitignore), otherwise HTML comment markers.
 * @returns {string|null} The first section, markers included, or null when the content has none.
 */
export const managedSection = (content, section) => content.match(sectionPatternFor(section))?.[0] ?? null;
const fingerprint = (content, section) => hash(lf(section ? managedSection(content, section) || '' : content));
// Registry keys are versioned data: only plain relative keys may be pruned, never '.'/'..'
// segments or segments ending in '.' or ' ', which Windows trims into another file's name.
const plainKey = name => !name.includes('\\') && name.split('/').every(part => part && !/[. ]$/.test(part));

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

/** Persist the managed-file registry atomically. */
export async function saveRegistry(root, registry) {
  const target = await safePath(root, registryPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFileAtomic(target, JSON.stringify(registry, null, 2) + '\n');
}

/**
 * Write managed files and their registry entries after checking every destination first.
 * A file that differs from its registered fingerprint is a local edit (unknown legacy content
 * is user-owned): it blocks the sync unless acceptUpdates backs it up before replacing it.
 * Side effects, except with dryRun: writes files, backups under specs/.omni/backups/ and the
 * registry, and deletes unedited pruned files.
 * @param {string} root Project root.
 * @param {Array<{path: string, content: string, section?: 'hash'|boolean, replace?: boolean}>} entries
 *   Files to install. section manages only the marked part of a user-owned file; replace overwrites
 *   a differing file without treating it as a local edit (no conflict, no backup).
 * @param {{dryRun?: boolean, acceptUpdates?: boolean, prune?: string|string[]}} [options] prune is a path
 *   prefix or list of prefixes: registry entries under any prefix that are not in entries are removed. Their files are deleted
 *   when they still match the registered fingerprint and kept when edited. A key that differs from
 *   an entry only in letter case loses its registry entry but never its file, which a
 *   case-insensitive file system shares with that entry. Keys with backslashes, empty segments or
 *   segments ending in '.' or ' ' are never pruned.
 * @returns {Promise<{created: string[], updated: string[], conflicts: string[], backups: string[],
 *   removed: string[], preserved: string[]}>} removed lists pruned entries whose files are deleted
 *   (with dryRun, would be), already absent or shared with an entry; preserved lists pruned entries
 *   whose edited files are kept.
 * @throws {Error} Malformed managed section, unsafe or symlinked path, invalid registry, or local
 *   edits without acceptUpdates outside dryRun (nothing is written, deleted or pruned); with dryRun
 *   they are returned in conflicts.
 */
export async function syncManagedFiles(root, entries, options = {}) {
  const registry = await loadRegistry(root);
  const actions = [],
    conflicts = [];
  for (const [name, entry] of new Map(entries.map(e => [e.path, e]))) {
    const path = await safePath(root, name);
    const previous = await optionalRead(path);
    let content = entry.content;
    const sectionPattern = entry.section ? sectionPatternFor(entry.section) : null;
    if (entry.section && previous !== null) {
      const [startMarker, endMarker] = markersFor(entry.section);
      const starts = previous.split(startMarker).length - 1;
      const ends = previous.split(endMarker).length - 1;
      if (starts !== ends || starts > 1 || (starts && !sectionPattern.test(previous)))
        throw new Error(`Malformed OmniSpec section: ${name}`);
      content = starts
        ? previous.replace(sectionPattern, () => entry.content)
        : previous.trimEnd() + '\n\n' + entry.content + '\n';
    }
    const known = registry.files[name];
    const noOwnedSection = entry.section && previous !== null && !sectionPattern.test(previous);
    if (previous !== null && previous !== content && lf(previous) === lf(content)) content = previous;
    const changedLocally =
      previous !== null &&
      previous !== content &&
      !noOwnedSection &&
      !entry.replace &&
      (known?.hash || known) !== fingerprint(previous, entry.section);
    if (changedLocally && !options.acceptUpdates) conflicts.push(name);
    actions.push({ name, path, content, previous, changedLocally, section: entry.section });
  }
  const orphans = [];
  if (options.prune) {
    const prefixes = [].concat(options.prune);
    const installed = new Set(actions.map(action => action.name));
    // On case-insensitive file systems a key that differs only in case names an installed file.
    const shipped = new Set(actions.map(action => action.name.toLowerCase()));
    for (const [name, digest] of Object.entries(registry.files)) {
      if (!prefixes.some(p => name.startsWith(p)) || installed.has(name) || !plainKey(name)) continue;
      const path = await safePath(root, name);
      const content = shipped.has(name.toLowerCase()) ? null : await optionalRead(path);
      orphans.push({
        name,
        path,
        exists: content !== null,
        edited: content !== null && fingerprint(content, digest.section) !== (digest.hash || digest),
      });
    }
  }
  const summary = {
    created: actions.filter(a => a.previous === null).map(a => a.name),
    updated: actions.filter(a => a.previous !== null && a.previous !== a.content).map(a => a.name),
    conflicts,
    backups: [],
    removed: orphans.filter(orphan => !orphan.edited).map(orphan => orphan.name),
    preserved: orphans.filter(orphan => orphan.edited).map(orphan => orphan.name),
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
      section: action.section === 'hash' ? 'hash' : Boolean(action.section),
    };
  }
  for (const orphan of orphans) {
    if (orphan.exists && !orphan.edited) await unlink(orphan.path);
    delete registry.files[orphan.name];
  }
  await saveRegistry(root, registry);
  return summary;
}

/**
 * Compare every registered managed file with its fingerprint. Read-only.
 * @param {string} root Project root.
 * @returns {Promise<{tracked: number, changed: string[], missing: string[]}>} changed lists every
 *   registered file that is missing or differs; missing lists only the absent ones.
 * @throws {Error} Invalid registry, unsafe or symlinked path, or an unreadable file.
 */
export async function checkManagedFiles(root) {
  const registry = await loadRegistry(root);
  const changed = [],
    missing = [];
  for (const [name, digest] of Object.entries(registry.files)) {
    const content = await optionalRead(await safePath(root, name));
    if (content === null) missing.push(name);
    if (content === null || fingerprint(content, digest.section) !== (digest.hash || digest)) changed.push(name);
  }
  return { tracked: Object.keys(registry.files).length, changed, missing };
}
