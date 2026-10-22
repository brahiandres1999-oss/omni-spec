import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { join, relative as relativePath, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';

/** Directories never attested: VCS metadata and OmniSpec's own runtime/state. */
const ALWAYS_IGNORED = new Set(['.git', '.omni']);

/**
 * Generated, cache and editor locations excluded by default at any depth. A project can
 * re-include one with a negated pattern (for example `!build/`) in .omnispecignore.
 */
export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules/',
  '.venv/',
  'venv/',
  '__pycache__/',
  '.pytest_cache/',
  '.mypy_cache/',
  '.ruff_cache/',
  '.tox/',
  '.nox/',
  'dist/',
  'build/',
  'target/',
  'coverage/',
  '.nyc_output/',
  '.next/',
  '.nuxt/',
  '.svelte-kit/',
  '.angular/',
  '.turbo/',
  '.parcel-cache/',
  '.cache/',
  '.gradle/',
  '.idea/',
  '.vscode/',
  '.vs/',
  '.dart_tool/',
  '.terraform/',
  'test-results/',
  'playwright-report/',
  'blob-report/',
  '.DS_Store',
  'Thumbs.db',
  '*.tsbuildinfo',
  '.eslintcache',
  '.stylelintcache',
  'npm-debug.log*',
  'yarn-error.log*',
  'pnpm-debug.log*',
];

export const SNAPSHOT_LIMITS = Object.freeze({ files: 20000, bytes: 256 * 1024 * 1024 });

const REGEX_SPECIAL = /[\\^$.*+?()[\]{}|/-]/g;
const escapeRegex = character => character.replace(REGEX_SPECIAL, '\\$&');
// Matching is case-sensitive on every platform so a snapshot recorded on one OS verifies on
// another. Git folds case on Windows/macOS; a path it ignores there that OmniSpec still
// attests fails closed (verify reports it) and can be excluded in .omnispecignore.
// Patterns and paths are compared as UTF-8 bytes, as Git does, so '?' matches one byte.
const bytes = text => Buffer.from(text, 'utf8').toString('latin1');
const POSIX_CLASSES = {
  alnum: 'a-zA-Z0-9',
  alpha: 'a-zA-Z',
  blank: ' \\t',
  cntrl: '\\x00-\\x1f\\x7f',
  digit: '0-9',
  graph: '!-~',
  lower: 'a-z',
  print: ' -~',
  punct: '!-\\/:-@\\[-`{-~',
  space: '\\s',
  upper: 'A-Z',
  xdigit: '0-9A-Fa-f',
};

/**
 * Parse a bracket expression starting at `start` ('['). Returns the regex source and the
 * index of the closing ']', or null when the bracket is unterminated.
 * Bracket expressions never match '/', and an inverted range matches nothing, as in Git.
 */
function bracket(text, start) {
  let index = start + 1;
  let negate = false;
  if (text[index] === '!' || text[index] === '^') {
    negate = true;
    index++;
  }
  const members = [];
  let first = true;
  while (index < text.length) {
    let character = text[index];
    if (character === ']' && !first) {
      const body = members.join('');
      const source = body ? `(?!/)[${negate ? '^' : ''}${body}]` : negate ? '[^/]' : '(?!)';
      return { source, end: index };
    }
    first = false;
    if (character === '[' && text[index + 1] === ':') {
      const close = text.indexOf(':]', index + 2);
      const name = close > 0 ? text.slice(index + 2, close) : null;
      if (name && Object.hasOwn(POSIX_CLASSES, name)) {
        members.push(POSIX_CLASSES[name]);
        index = close + 2;
        continue;
      }
    }
    if (character === '\\') {
      if (index + 1 >= text.length) return null;
      character = text[++index];
    }
    let next = index + 1;
    if (text[next] === '-' && text[next + 1] !== undefined && text[next + 1] !== ']') {
      let last = text[next + 1];
      next += 2;
      if (last === '\\') {
        if (next >= text.length) return null;
        last = text[next++];
      }
      // Git tests the range start on its own first, so an inverted range still matches
      // its first character and nothing else.
      members.push(
        character.codePointAt(0) <= last.codePointAt(0)
          ? `${escapeRegex(character)}-${escapeRegex(last)}`
          : escapeRegex(character),
      );
      index = next;
      continue;
    }
    members.push(escapeRegex(character));
    index = next;
  }
  return null;
}

/**
 * Compile one gitignore-syntax line. Supports comments, escapes, negation, directory-only
 * patterns, anchoring, `*`, `?`, bracket expressions (ranges, negation, POSIX classes)
 * and `**` segments. Invalid patterns never throw: like Git, they simply match nothing.
 * @param {string} line Raw pattern line.
 * @param {string} base Project-relative directory containing the ignore file ('' for root).
 * @returns {object|null} Compiled rule, or null for blank, comment or invalid lines.
 */
export function compileIgnoreRule(line, base = '') {
  let text = bytes(line.replace(/\r$/, ''));
  if (!text || text.startsWith('#')) return null;
  text = text.replace(/(?<!\\) +$/, '');
  if (!text) return null;
  let negate = false;
  if (text.startsWith('!')) {
    negate = true;
    text = text.slice(1);
  } else if (text.startsWith('\\!') || text.startsWith('\\#')) text = text.slice(1);
  let dirOnly = false;
  if (text.endsWith('/') && !text.endsWith('\\/')) {
    dirOnly = true;
    text = text.replace(/\/+$/, '');
  }
  if (!text) return null;
  const anchored = text.slice(0, -1).includes('/') || text.startsWith('/');
  text = text.replace(/^\/+/, '');
  let source = '';
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '*') {
      if (text[index + 1] === '*') {
        const startsSegment = index === 0 || text[index - 1] === '/';
        if (startsSegment && text[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 2;
          continue;
        }
        if (startsSegment && index + 2 === text.length) {
          source += '.*';
          index += 1;
          continue;
        }
        // Git lets a '**' that follows other characters cross directories before a '/'.
        if (!startsSegment && text[index + 2] === '/') {
          source += '.*';
          index += 1;
          continue;
        }
        index += 1;
      }
      source += '[^/]*';
    } else if (character === '?') source += '[^/]';
    else if (character === '[') {
      const parsed = bracket(text, index);
      // An unterminated bracket makes the whole pattern match nothing, as in Git.
      if (!parsed) return null;
      else {
        source += parsed.source;
        index = parsed.end;
      }
    } else if (character === '\\') {
      if (index + 1 >= text.length) return null;
      source += escapeRegex(text[++index]);
    } else source += escapeRegex(character);
  }
  let regex;
  try {
    regex = new RegExp(`^${source}$`);
  } catch {
    return null;
  }
  return { negate, dirOnly, anchored, base, regex };
}

/** @returns {object[]} Compiled rules from file text. */
export function compileIgnoreText(text, base = '') {
  return text
    .replace(/^\uFEFF/, '')
    .split('\n')
    .map(line => compileIgnoreRule(line, base))
    .filter(Boolean);
}

/**
 * Decide whether a project-relative path is ignored. The last matching rule wins, as in Git.
 * @param {object[]} rules Ordered rules (defaults, root, deeper .gitignore files, .omnispecignore).
 * @param {string} path Project-relative path with forward slashes.
 * @param {boolean} isDirectory Whether the entry is a directory.
 * @returns {boolean} True when excluded.
 */
export function isIgnored(rules, path, isDirectory) {
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDirectory) continue;
    const full = bytes(path);
    if (rule.base && !full.startsWith(bytes(rule.base) + '/')) continue;
    const relative = rule.base ? full.slice(bytes(rule.base).length + 1) : full;
    const subject = rule.anchored ? relative : relative.slice(relative.lastIndexOf('/') + 1);
    if (rule.regex.test(subject)) ignored = !rule.negate;
  }
  return ignored;
}

async function optionalText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) return null;
    throw error;
  }
}

async function isDirectoryPath(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Ignore rules that apply to the whole project, in increasing priority: defaults, the
 * project's own .git/info/exclude and root .gitignore. `.omnispecignore` is returned
 * separately because it is evaluated after every .gitignore, including nested ones.
 * Ignore files in parent directories are deliberately not read: a parent repository
 * (for example a dotfiles repository in the home folder) must not be able to switch off
 * attestation. A monorepo package lists extra outputs in its own .omnispecignore.
 * @returns {Promise<{rules: object[], overrides: object[]}>}
 */
export async function rootIgnoreRules(root) {
  const rules = DEFAULT_IGNORE_PATTERNS.map(line => compileIgnoreRule(line));
  if (await isDirectoryPath(join(root, '.git'))) {
    const text = await optionalText(join(root, '.git', 'info', 'exclude'));
    if (text !== null) rules.push(...compileIgnoreText(text));
  }
  const text = await optionalText(join(root, '.gitignore'));
  if (text !== null) rules.push(...compileIgnoreText(text));
  const override = await optionalText(join(root, '.omnispecignore'));
  return { rules, overrides: override === null ? [] : compileIgnoreText(override) };
}

/** @returns {{files:number, bytes:number}} A shared file/byte budget for one snapshot. */
export function newBudget() {
  return { files: 0, bytes: 0 };
}

async function charge(budget, path, label) {
  budget.files += 1;
  budget.bytes += (await stat(path)).size;
  if (budget.files > SNAPSHOT_LIMITS.files || budget.bytes > SNAPSHOT_LIMITS.bytes)
    throw new Error(
      `${label} exceeds 20,000 files / 256 MiB. Exclude generated or vendored paths in .gitignore or .omnispecignore.`,
    );
}

async function internalFileTarget(root, name) {
  try {
    const base = await realpath(root);
    const target = await realpath(join(root, name));
    const inside = relativePath(base, target).split(sep).join('/');
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) return null;
    // Links into VCS metadata, OmniSpec state or specifications would attest records that
    // OmniSpec itself rewrites, so they are refused like external links.
    if (/^(?:\.git|specs)(?:\/|$)/.test(inside) || /(?:^|\/)\.omni(?:\/|$)/.test(inside)) return null;
    return (await stat(target)).isFile() ? target : null;
  } catch {
    return null;
  }
}

const compareNames = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Walk project files that are not ignored and hash the selected ones.
 * Ignored entries (including symlinks inside them) are never read.
 * @param {string} root Project root.
 * @param {object} options select(name) chooses files to hash; skipTop names top-level entries to skip;
 *   label names the snapshot in limit errors.
 * @returns {Promise<Map<string,string>>} Sorted map of relative path to SHA-256.
 * @throws {Error} Symlinked inputs or snapshot limits.
 */
export async function hashProjectFiles(root, options = {}) {
  const { select = () => true, skipTop = new Set(), label = 'Snapshot', symlinks = 'reject' } = options;
  const budget = options.budget || newBudget();
  const { rules: rootRules, overrides } = await rootIgnoreRules(root);
  const files = new Map();
  async function walk(relative, rules) {
    const directory = relative ? join(root, relative) : root;
    let localRules = rules;
    if (relative) {
      const text = await optionalText(join(directory, '.gitignore'));
      if (text !== null) localRules = [...rules, ...compileIgnoreText(text, relative)];
    }
    const effective = overrides.length ? [...localRules, ...overrides] : localRules;
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => compareNames(a.name, b.name));
    for (const entry of entries) {
      if (ALWAYS_IGNORED.has(entry.name)) continue;
      if (!relative && skipTop.has(entry.name)) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const isDirectory = entry.isDirectory();
      const symlink = entry.isSymbolicLink();
      // A symlink to an ignored directory (for example node_modules -> ../shared) is ignored too.
      if (isIgnored(effective, name, isDirectory) || (symlink && isIgnored(effective, name, true))) continue;
      if (symlink) {
        if (symlinks === 'skip' || (symlinks === 'reject-selected' && !select(name))) continue;
        // A link to a regular file inside the project (for example CLAUDE.md -> AGENTS.md)
        // is attested by its target's content. Directory or external links are refused.
        const target = await internalFileTarget(root, name);
        if (target) {
          if (select(name)) {
            await charge(budget, target, label);
            files.set(
              name,
              createHash('sha256')
                .update(await readFile(target))
                .digest('hex'),
            );
          }
          continue;
        }
        throw new Error(
          `${label} cannot attest symlinked source: ${name} (directory, outside the project, or into .git/specs/.omni). Ignore it in .omnispecignore or use a regular-file project copy.`,
        );
      }
      if (isDirectory) await walk(name, localRules);
      else if (entry.isFile() && select(name)) {
        const path = join(root, name);
        await charge(budget, path, label);
        files.set(
          name,
          createHash('sha256')
            .update(await readFile(path))
            .digest('hex'),
        );
      }
    }
  }
  await walk('', rootRules);
  return files;
}

/** Hash every regular file in a directory tree without ignore rules, rejecting symlinks. */
export async function hashTree(root, relative, { exclude = new Set(), label = 'Snapshot', budget = newBudget() } = {}) {
  const files = new Map();
  async function walk(current) {
    const entries = (await readdir(join(root, current), { withFileTypes: true })).sort((a, b) =>
      compareNames(a.name, b.name),
    );
    for (const entry of entries) {
      const name = `${current}/${entry.name}`;
      if (exclude.has(name)) continue;
      if (entry.isSymbolicLink())
        throw new Error(`${label} cannot attest symlinked source: ${name}. Use a regular-file project copy.`);
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) {
        await charge(budget, join(root, name), label);
        files.set(
          name,
          createHash('sha256')
            .update(await readFile(join(root, name)))
            .digest('hex'),
        );
      }
    }
  }
  await walk(relative);
  return files;
}

/** Combine file hashes and configuration into one order-independent digest. */
export function digestFiles(files, extra = '') {
  const digest = createHash('sha256');
  for (const name of [...files.keys()].sort(compareNames)) digest.update(`${name}\0${files.get(name)}\n`);
  digest.update(extra);
  return digest.digest('hex');
}

/** @returns {string[]} Paths added, removed or modified between two snapshots. */
export function changedFiles(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter(name => before.get(name) !== after.get(name))
    .sort(compareNames);
}
