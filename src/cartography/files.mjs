import fs from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_IGNORE_PATTERNS, compileIgnoreRule, compileIgnoreText, isIgnored } from '../snapshot.mjs';

/** Paths cartography never walks, on top of the snapshot defaults and the project's .gitignore files. */
const CARTOGRAPHY_IGNORES = ['.git/', '.hg/', '.svn/', 'specs/.omni/'];

function optionalText(path) {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) return null;
    throw error;
  }
}

/**
 * Lists every non-ignored file under `root` as sorted POSIX project-relative paths, synchronously
 * and without following symbolic links or junctions (so directory loops cannot recurse).
 * Ignore rules: snapshot defaults, .git/info/exclude, every .gitignore on the way down, and
 * .omnispecignore last, as in `snapshot.mjs`.
 * @returns {string[]}
 */
export function listProjectFiles(root) {
  const rules = [...DEFAULT_IGNORE_PATTERNS, ...CARTOGRAPHY_IGNORES]
    .map(line => compileIgnoreRule(line))
    .filter(Boolean);
  const exclude = optionalText(join(root, '.git', 'info', 'exclude'));
  if (exclude !== null) rules.push(...compileIgnoreText(exclude));
  const overrideText = optionalText(join(root, '.omnispecignore'));
  const overrides = overrideText === null ? [] : compileIgnoreText(overrideText);
  const files = [];
  const stack = [''];
  while (stack.length) {
    const directory = stack.pop();
    const absolute = directory ? join(root, ...directory.split('/')) : root;
    const gitignore = optionalText(join(absolute, '.gitignore'));
    if (gitignore !== null) rules.push(...compileIgnoreText(gitignore, directory));
    let entries;
    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true });
    } catch (error) {
      if (['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR'].includes(error.code)) continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      const isDirectory = entry.isDirectory();
      if (!isDirectory && !entry.isFile()) continue;
      const allRules = overrides.length ? [...rules, ...overrides] : rules;
      if (isIgnored(allRules, path, isDirectory)) continue;
      if (isDirectory) stack.push(path);
      else files.push(path);
    }
  }
  return files.sort();
}
