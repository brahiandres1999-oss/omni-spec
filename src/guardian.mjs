import { access, chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { delimiter, dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDirectory } from './checks.mjs';
import { codeTokens, lex } from './js-lexer.mjs';

/**
 * Omni-Guardian: the lexical gate every engine-run command passes before it reaches the OS.
 * Commands are tokenized without a shell and spawned with `shell: false`, so quoted text is inert
 * data. The gate stops chaining, substitution and redirection, unapproved or system binaries and
 * working directories outside the project. It is not a sandbox: an allowed `node` runs any script.
 */

export const DEFAULT_ALLOWED_BINARIES = [
  'node',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'deno',
  'git',
  'vitest',
  'jest',
  'playwright',
  'tsc',
  'biome',
  'eslint',
  'python',
  'python3',
  'pytest',
  'uv',
  'ruff',
  'mypy',
  'mvn',
  'mvnw',
  'gradle',
  'gradlew',
  'java',
  'javac',
  'go',
  'cargo',
  'rustc',
  'dotnet',
];

export const FORBIDDEN_BINARIES = new Set([
  'cmd',
  'powershell',
  'pwsh',
  'wscript',
  'cscript',
  'certutil',
  'bitsadmin',
  'reg',
  'regedit',
  'regsvr32',
  'rundll32',
  'mshta',
  'msiexec',
  'format',
  'diskpart',
  'attrib',
  'icacls',
  'takeown',
  'schtasks',
  'wmic',
  'bash',
  'sh',
  'zsh',
  'wsl',
]);

/** Packages whose `bin` entry provides a local tool, keyed by the command name. */
const LOCAL_TOOLS = {
  vitest: 'vitest',
  tsc: 'typescript',
  biome: '@biomejs/biome',
  jest: 'jest',
  eslint: 'eslint',
  prettier: 'prettier',
};
const NPX_SAFE_FLAGS = new Set(['--no-install', '--no', '--offline', '-q', '--quiet']);
const GIT_HAZARDOUS_PREFIXES = ['--upload-pack', '--receive-pack', '--exec', '--config-env', '--exec-path', '-u'];
const GIT_HAZARDOUS_SUBCOMMANDS = {
  submodule: ['foreach'],
  bisect: ['run'],
  'filter-branch': null,
  difftool: null,
  mergetool: null,
};
const WINDOWS_EXTENSION = /\.(exe|cmd|bat|com)$/i;
const LINE_SEPARATOR = /[\r\n\u2028\u2029]/;
// C0/C1 controls except tab, zero-width characters, BiDi embeddings, overrides and isolates.
const INVISIBLE_RANGES = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
const hex = code => `\\u${code.toString(16).padStart(4, '0')}`;
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([from, to]) => `${hex(from)}-${hex(to)}`).join('')}]`);
const UNQUOTED_OPERATORS = new Set(['&', '|', ';', '<', '>', '`', '$']);

export class GuardianError extends Error {
  /**
   * @param {string} code Stable machine-readable code (GUARDIAN_*).
   * @param {string} message Human explanation including the remedy.
   * @param {'policy'|'environment'} [category] policy blocks are never executed; environment means the
   *   command was acceptable but cannot run on this machine.
   */
  constructor(code, message, category = 'policy') {
    super(`${code}: ${message}`);
    this.name = 'GuardianError';
    this.code = code;
    this.category = category;
  }
}

/**
 * Splits a command line into argv without a shell. Double quotes accept `\"` and `\\` escapes,
 * single quotes are literal, and a backslash outside quotes is a path character.
 * @param {string} commandLine
 * @returns {string[]}
 * @throws {GuardianError} On operators outside quotes, line separators, invisible characters or open quotes.
 */
export function tokenizeCommand(commandLine) {
  if (typeof commandLine !== 'string' || !commandLine.trim())
    throw new GuardianError('GUARDIAN_EMPTY_COMMAND', 'The command line is empty.');
  if (LINE_SEPARATOR.test(commandLine))
    throw new GuardianError(
      'GUARDIAN_SHELL_OPERATOR',
      'Line breaks chain commands. Register each command as its own check.',
    );
  if (INVISIBLE.test(commandLine))
    throw new GuardianError(
      'GUARDIAN_INVISIBLE_CHAR',
      'The command contains control, zero-width or bidirectional characters that hide what runs.',
    );
  const tokens = [];
  let current = '';
  let started = false;
  let quote = null;
  for (let index = 0; index < commandLine.length; index++) {
    const char = commandLine[index];
    if (quote === '"') {
      if (char === '\\' && (commandLine[index + 1] === '"' || commandLine[index + 1] === '\\')) {
        current += commandLine[++index];
      } else if (char === '"') quote = null;
      else current += char;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (char === ' ' || char === '\t') {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    if (UNQUOTED_OPERATORS.has(char))
      throw new GuardianError(
        'GUARDIAN_SHELL_OPERATOR',
        `"${char}" outside quotes chains, substitutes or redirects commands (&, |, ;, \`, $, >, <). Split the work into separate checks.`,
      );
    current += char;
    started = true;
  }
  if (quote) throw new GuardianError('GUARDIAN_PARSE_ERROR', `Unclosed ${quote} quote in the command line.`);
  if (started) tokens.push(current);
  return tokens;
}

function normalizeName(name) {
  return name.toLowerCase().replace(WINDOWS_EXTENSION, '');
}

function validateExtensions(allowedBinaries) {
  if (!Array.isArray(allowedBinaries)) throw new TypeError('guardian.allowedBinaries must be an array of names.');
  for (const name of allowedBinaries)
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name))
      throw new TypeError(`guardian.allowedBinaries entry "${name}" must be a bare executable name.`);
  return allowedBinaries.map(normalizeName);
}

function npxProblem(args) {
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) {
    if (!NPX_SAFE_FLAGS.has(args[index])) return `npx option "${args[index]}" can fetch or run other packages`;
    index++;
  }
  return index < args.length ? null : 'npx needs the tool to run';
}

function gitProblem(args) {
  for (const arg of args) {
    if (arg === '-c' || /^-c./.test(arg)) return 'git -c can configure an arbitrary program (pager, alias, ssh)';
    if (GIT_HAZARDOUS_PREFIXES.some(prefix => arg === prefix || arg.startsWith(`${prefix}=`)))
      return `git option "${arg}" runs an arbitrary program`;
    if (arg.includes('ext::')) return 'the ext:: transport runs an arbitrary program';
  }
  const subcommand = args.find(arg => !arg.startsWith('-'));
  if (subcommand in GIT_HAZARDOUS_SUBCOMMANDS) {
    const actions = GIT_HAZARDOUS_SUBCOMMANDS[subcommand];
    if (!actions || args.some(arg => actions.includes(arg))) return `git ${subcommand} runs an arbitrary program`;
  }
  if (subcommand === 'rebase' && args.some(arg => arg === '-x' || arg === '--exec' || arg.startsWith('--exec=')))
    return 'git rebase --exec runs an arbitrary program';
  return null;
}

/**
 * Validates a command without touching the file system.
 * @param {string} commandLine
 * @param {{allowedBinaries?: string[]}} [options] Project additions to the default toolchain.
 * @returns {{binary: string, rawBinary: string, args: string[], local: boolean}}
 * @throws {GuardianError}
 */
export function auditCommandSyntax(commandLine, { allowedBinaries = [] } = {}) {
  const extensions = validateExtensions(allowedBinaries);
  const [rawBinary, ...args] = tokenizeCommand(commandLine);
  if (!rawBinary) throw new GuardianError('GUARDIAN_EMPTY_COMMAND', 'The command line is empty.');
  let local = false;
  let name = rawBinary;
  if (/[\\/]/.test(rawBinary)) {
    const portable = rawBinary.replace(/\\/g, '/').replace(/^\.\//, '');
    const match = /^node_modules\/\.bin\/([^/]+)$/.exec(portable);
    if (!match)
      throw new GuardianError(
        'GUARDIAN_PATH_BINARY',
        `"${rawBinary}" names a path. Use the bare tool name, or node_modules/.bin/<tool> for project tools.`,
      );
    local = true;
    name = match[1];
  }
  const binary = normalizeName(name);
  if (FORBIDDEN_BINARIES.has(binary))
    throw new GuardianError('GUARDIAN_FORBIDDEN_BINARY', `Direct execution of "${binary}" is prohibited.`);
  const allowed = local ? Object.keys(LOCAL_TOOLS) : [...DEFAULT_ALLOWED_BINARIES, ...extensions];
  if (!allowed.includes(binary))
    throw new GuardianError(
      'GUARDIAN_UNAUTHORIZED_BINARY',
      `"${binary}" is not in the approved toolchain. Add it to guardian.allowedBinaries in specs/manifest.json if the project needs it.`,
    );
  let problem = null;
  if (binary === 'npx') problem = npxProblem(args);
  else if (binary === 'npm' && ['exec', 'x'].includes(args.find(arg => !arg.startsWith('-')))) {
    const rest = args.slice(args.findIndex(arg => arg === 'exec' || arg === 'x') + 1);
    const tool = rest.find(arg => !arg.startsWith('-'));
    problem =
      tool && [...DEFAULT_ALLOWED_BINARIES, ...extensions].includes(normalizeName(tool))
        ? null
        : 'npm exec runs an unapproved package';
  } else if (binary === 'git') problem = gitProblem(args);
  if (binary === 'npx' && !problem) {
    const tool = args.find(arg => !arg.startsWith('-'));
    const approved = [...DEFAULT_ALLOWED_BINARIES, ...extensions, ...Object.keys(LOCAL_TOOLS)].filter(
      item => item !== 'npx',
    );
    if (!approved.includes(normalizeName(tool))) problem = `npx would run the unapproved package "${tool}"`;
  }
  if (problem) throw new GuardianError('GUARDIAN_HAZARDOUS_ARGUMENT', `${problem}.`);
  return { binary, rawBinary, args, local };
}

/**
 * Validates a command and its working directory inside the project.
 * @param {string} commandLine
 * @param {{root: string, cwd?: string, allowedBinaries?: string[]}} options
 * @returns {Promise<ReturnType<typeof auditCommandSyntax> & {cwd: string}>}
 */
export async function auditCommand(commandLine, { root, cwd = '.', allowedBinaries = [] }) {
  const audited = auditCommandSyntax(commandLine, { allowedBinaries });
  let directory;
  try {
    directory = await checkDirectory(root, cwd);
  } catch (error) {
    throw new GuardianError(
      'GUARDIAN_UNSAFE_CWD',
      `Working directory "${cwd}" is outside the project, a link or missing (${error.message}).`,
    );
  }
  return { ...audited, cwd: directory };
}

async function exists(path, mode = constants.F_OK) {
  try {
    await access(path, mode);
    return (await stat(path)).isFile();
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

async function npmScript(script) {
  const base = dirname(process.execPath);
  for (const candidate of [
    join(base, 'node_modules', 'npm', 'bin', script),
    join(base, '..', 'lib', 'node_modules', 'npm', 'bin', script),
  ])
    if (await exists(candidate)) return candidate;
  return null;
}

async function localToolScript(binary, root, cwd) {
  const packageName = LOCAL_TOOLS[binary];
  if (!packageName) return null;
  const top = resolve(root);
  for (let directory = resolve(cwd); ; directory = dirname(directory)) {
    const packageDir = join(directory, 'node_modules', ...packageName.split('/'));
    let manifest;
    try {
      manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
    const bin = typeof manifest?.bin === 'string' ? manifest.bin : manifest?.bin?.[binary];
    if (typeof bin === 'string') {
      const script = resolve(packageDir, bin);
      const rel = relative(packageDir, script);
      if (rel.startsWith('..') || isAbsolute(rel))
        throw new GuardianError('GUARDIAN_PATH_BINARY', `${packageName} declares a bin outside its package.`);
      return script;
    }
    const rel = relative(top, directory);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  }
}

function pathEntries(env) {
  const key = Object.keys(env).find(name => name.toUpperCase() === 'PATH');
  return (key ? env[key] : '').split(delimiter).filter(Boolean);
}

async function searchPath(binary, env, platform) {
  let shellOnly = null;
  for (const directory of pathEntries(env)) {
    if (platform === 'win32') {
      for (const extension of ['.exe', '.com'])
        if (await exists(join(directory, binary + extension))) return { file: join(directory, binary + extension) };
      for (const extension of ['.cmd', '.bat'])
        if (!shellOnly && (await exists(join(directory, binary + extension))))
          shellOnly = join(directory, binary + extension);
    } else if (await exists(join(directory, binary), constants.X_OK)) return { file: join(directory, binary) };
  }
  return { file: null, shellOnly };
}

/**
 * Turns an audited command into a shell-free spawn plan. Node tools run as `node <script>` so
 * Windows never needs cmd.exe for their .cmd shims (CVE-2024-27980).
 * @param {{binary: string, args: string[]}} audited
 * @param {{root: string, cwd: string, env?: NodeJS.ProcessEnv, platform?: string}} options
 * @returns {Promise<{file: string, args: string[]}>}
 * @throws {GuardianError} GUARDIAN_BINARY_NOT_FOUND (environment) or GUARDIAN_SHELL_REQUIRED (policy).
 */
export async function resolveExecution(audited, { root, cwd, env = process.env, platform = process.platform }) {
  const { binary, args } = audited;
  if (binary === 'node') return { file: process.execPath, args: [...args] };
  if (binary === 'npm' || binary === 'npx') {
    const script = await npmScript(binary === 'npm' ? 'npm-cli.js' : 'npx-cli.js');
    if (script) {
      const extra = binary === 'npx' && !args.some(arg => arg === '--no' || arg === '--no-install') ? ['--no'] : [];
      return { file: process.execPath, args: [script, ...extra, ...args] };
    }
  }
  const local = await localToolScript(binary, root, cwd);
  if (local) return { file: process.execPath, args: [local, ...args] };
  const found = await searchPath(binary, env, platform);
  if (found.file) return { file: found.file, args: [...args] };
  if (found.shellOnly)
    throw new GuardianError(
      'GUARDIAN_SHELL_REQUIRED',
      `"${binary}" is only available as ${found.shellOnly}, which needs cmd.exe. Run it through node or install a native executable.`,
    );
  throw new GuardianError(
    'GUARDIAN_BINARY_NOT_FOUND',
    `"${binary}" is approved but not installed or not on PATH.`,
    'environment',
  );
}

// ---------------------------------------------------------------------------------------------
// Pre-commit inspection
// ---------------------------------------------------------------------------------------------

export const HOOK_MARKER = 'omni-spec guardian hook v1';
const SOURCE_FILE = /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/i;
const TYPESCRIPT_FILE = /\.(?:[cm]?ts|tsx)$/i;
const STRONG_MARKER = /^(?:<{7}|>{7}|\|{7})(?: |$)/;
const SEPARATOR_MARKER = /^={7}$/;
const SUPPRESSION = /guardian-allow\s+([A-Z_]+)\s*:\s*(\S[^\n]*)?/g;
const SILENT_RETURNS = new Set([
  'return',
  'return;',
  'return null',
  'return null;',
  'return undefined',
  'return undefined;',
]);
const TERMINATORS = new Set(['return', 'throw', 'break', 'continue']);
const REACHABLE_AFTER_TERMINATOR = new Set(['case', 'default', 'function']);
const BLIND_TYPE_PREFIX = new Set([':', 'as', '<', '|', '&']);

const RULE_MESSAGES = {
  GUARDIAN_CONFLICT_MARKER: 'unresolved merge conflict marker',
  SLOP_EMPTY_CATCH: 'empty catch block swallows the error; handle it, rethrow it or document a guardian-allow',
  SLOP_SWALLOWED_ERROR: 'catch block silently returns, hiding the failure from the caller',
  SLOP_BLIND_TYPE: '"any" disables type checking; name the type or use unknown with a guard',
  SLOP_BLIND_CAST: '"as unknown as" forces a type without proof; validate the value instead',
  SLOP_DEAD_CODE: 'code that can never run',
};

function violation(file, line, code) {
  return { file, line, code, message: RULE_MESSAGES[code] };
}

// A suppression covers the line before a finding through the last line of its construct, so a
// catch block can carry its reason inside the block it excuses.
const spans = new WeakMap();

/**
 * Unresolved merge markers at column 0. A bare `=======` only counts next to another marker so
 * Markdown setext underlines do not block commits.
 * @returns {{file:string,line:number,code:string,message:string}[]}
 */
export function conflictMarkers(file, text) {
  const strong = [];
  const separators = [];
  text.split(/\r?\n/).forEach((content, index) => {
    if (STRONG_MARKER.test(content)) strong.push(index + 1);
    else if (SEPARATOR_MARKER.test(content)) separators.push(index + 1);
  });
  if (!strong.length) return [];
  return [...strong, ...separators]
    .sort((a, b) => a - b)
    .map(line => violation(file, line, 'GUARDIAN_CONFLICT_MARKER'));
}

function pairs(code) {
  const match = new Map();
  const stack = [];
  const opening = { ')': '(', ']': '[', '}': '{' };
  code.forEach((token, index) => {
    if (token.type !== 'punct') return;
    if (token.value === '(' || token.value === '[' || token.value === '{') stack.push(index);
    else if (opening[token.value]) {
      const open = stack.pop();
      if (open !== undefined) {
        match.set(open, index);
        match.set(index, open);
      }
    }
  });
  return match;
}

function suppressions(tokens) {
  const allowed = new Map();
  for (const token of tokens) {
    if (token.type !== 'comment') continue;
    const lastLine = token.line + (token.value.match(/\r\n|\r|\n/g)?.length ?? 0);
    for (const [, code, reason] of token.value.matchAll(SUPPRESSION)) {
      if (!reason?.replace(/\*\/\s*$/, '').trim()) continue;
      for (const line of [token.line, lastLine]) {
        if (!allowed.has(line)) allowed.set(line, new Set());
        allowed.get(line).add(code);
      }
    }
  }
  return allowed;
}

function deadAfterTerminator(code, index) {
  const previous = code[index - 1];
  const next = code[index + 1];
  if (next?.value === ':' || next?.value === '.') return null;
  if (previous && !(previous.type === 'punct' && ['{', ';', '}', ':'].includes(previous.value))) return null;
  let depth = 0;
  for (let cursor = index + 1; cursor < code.length; cursor++) {
    const token = code[cursor];
    if (token.type !== 'punct') continue;
    if (token.value === '(' || token.value === '[' || token.value === '{') {
      depth++;
      continue;
    }
    if (token.value === ')' || token.value === ']' || token.value === '}') {
      if (--depth < 0) return null;
      continue;
    }
    if (token.value === ';' && depth === 0) {
      const following = code[cursor + 1];
      if (!following || following.value === '}' || REACHABLE_AFTER_TERMINATOR.has(following.value)) return null;
      return following;
    }
  }
  return null;
}

/**
 * Anti-slop rules over a lexed source file.
 * @param {string} file Repository-relative path (decides TypeScript rules).
 * @param {string} text File content.
 * @param {{addedLines?: Set<number>}} [options] When given, only these lines are judged.
 * @returns {{file:string,line:number,code:string,message:string}[]}
 * @throws {Error} LEX_* when the file cannot be tokenized.
 */
export function inspectSource(file, text, { addedLines } = {}) {
  const tokens = lex(text);
  const code = codeTokens(tokens);
  const match = pairs(code);
  const typescript = TYPESCRIPT_FILE.test(file);
  const found = [];
  code.forEach((token, index) => {
    if (token.type !== 'ident') return;
    const previous = code[index - 1];
    const next = code[index + 1];
    if (token.value === 'catch' && previous?.value === '}') {
      let cursor = index + 1;
      if (code[cursor]?.value === '(' && match.has(cursor)) cursor = match.get(cursor) + 1;
      if (code[cursor]?.value === '{' && match.has(cursor)) {
        const body = code.slice(cursor + 1, match.get(cursor));
        const kind = !body.length
          ? 'SLOP_EMPTY_CATCH'
          : SILENT_RETURNS.has(
                body
                  .map(item => item.value)
                  .join(' ')
                  .replace(' ;', ';'),
              )
            ? 'SLOP_SWALLOWED_ERROR'
            : null;
        if (kind) {
          const item = violation(file, token.line, kind);
          spans.set(item, code[match.get(cursor)].line);
          found.push(item);
        }
      }
      return;
    }
    if ((token.value === 'if' || token.value === 'while') && next?.value === '(') {
      const condition = code[index + 2];
      if ((condition?.value === 'false' || condition?.value === '0') && code[index + 3]?.value === ')')
        found.push(violation(file, token.line, 'SLOP_DEAD_CODE'));
      return;
    }
    if (TERMINATORS.has(token.value)) {
      const unreachable = deadAfterTerminator(code, index);
      if (unreachable) found.push(violation(file, unreachable.line, 'SLOP_DEAD_CODE'));
      return;
    }
    if (!typescript) return;
    if (token.value === 'any') {
      const generic = previous?.value === ',' && next?.value === '>';
      const array = next?.value === '[' && code[index + 2]?.value === ']';
      if (BLIND_TYPE_PREFIX.has(previous?.value) || generic || array)
        found.push(violation(file, token.line, 'SLOP_BLIND_TYPE'));
      return;
    }
    if (token.value === 'as' && next?.value === 'unknown' && code[index + 2]?.value === 'as')
      found.push(violation(file, token.line, 'SLOP_BLIND_CAST'));
  });
  const allowed = suppressions(tokens);
  const suppressed = item => {
    for (let line = item.line - 1; line <= (spans.get(item) ?? item.line); line++)
      if (allowed.get(line)?.has(item.code)) return true;
    return false;
  };
  return found.filter(item => (!addedLines || addedLines.has(item.line)) && !suppressed(item));
}

function gitBuffer(root, args, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => reject(new GuardianError('GUARDIAN_GIT_UNAVAILABLE', error.message, 'environment')));
    child.on('close', code => {
      if (code === 0) resolvePromise(Buffer.concat(stdout));
      else
        reject(
          new GuardianError(
            'GUARDIAN_GIT_FAILED',
            `git ${args[0]} failed: ${Buffer.concat(stderr).toString('utf8').trim()}`,
            'environment',
          ),
        );
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

const DIFF_SAFE = ['--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--diff-filter=ACM'];

async function stagedEntries(root) {
  const raw = (await gitBuffer(root, ['diff', '--cached', '--raw', '-z', '--no-abbrev', ...DIFF_SAFE])).toString(
    'utf8',
  );
  const parts = raw.split('\0');
  const entries = [];
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const [, newMode, , sha] = parts[index].replace(/^:/, '').split(' ');
    entries.push({ path: parts[index + 1], mode: newMode, sha });
  }
  return entries;
}

/** @returns {Promise<string[]>} Paths added, copied or modified in the index (renames count as added). */
export async function stagedFiles(root) {
  return (await stagedEntries(root)).map(entry => entry.path);
}

async function readBlobs(root, entries) {
  const blobs = entries.filter(entry => entry.mode !== '160000');
  if (!blobs.length) return new Map();
  const output = await gitBuffer(root, ['cat-file', '--batch'], blobs.map(entry => `${entry.sha}\n`).join(''));
  const contents = new Map();
  let offset = 0;
  for (const entry of blobs) {
    const headerEnd = output.indexOf(10, offset);
    const [, , size] = output.subarray(offset, headerEnd).toString('latin1').split(' ');
    const start = headerEnd + 1;
    contents.set(entry.path, output.subarray(start, start + Number(size)));
    offset = start + Number(size) + 1;
  }
  return contents;
}

async function addedLineSets(root, count) {
  const patch = (
    await gitBuffer(root, ['diff', '--cached', '-U0', '--src-prefix=a/', '--dst-prefix=b/', ...DIFF_SAFE])
  ).toString('utf8');
  const sets = [];
  for (const section of patch.split(/^diff --git /m).slice(1)) {
    const lines = new Set();
    for (const [, start, length] of section.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
      const first = Number(start);
      const total = length === undefined ? 1 : Number(length);
      for (let line = first; line < first + total; line++) lines.add(line);
    }
    sets.push(lines);
  }
  if (sets.length !== count)
    throw new GuardianError('GUARDIAN_GIT_FAILED', 'git diff returned a different file list than git diff --raw.');
  return sets;
}

/**
 * Inspects the content staged in the index (never the working tree).
 * @param {string} root Repository working tree.
 * @returns {Promise<{files:string[], violations:object[], skipped:string[], warnings:string[]}>}
 */
export async function inspectStaged(root) {
  const entries = await stagedEntries(root);
  const result = { files: entries.map(entry => entry.path), violations: [], skipped: [], warnings: [] };
  if (!entries.length) return result;
  const [blobs, added] = await Promise.all([readBlobs(root, entries), addedLineSets(root, entries.length)]);
  entries.forEach((entry, index) => {
    const content = blobs.get(entry.path);
    if (!content || content.subarray(0, 8000).includes(0)) {
      result.skipped.push(entry.path);
      return;
    }
    const text = content.toString('utf8');
    result.violations.push(...conflictMarkers(entry.path, text));
    if (!SOURCE_FILE.test(entry.path)) return;
    try {
      result.violations.push(...inspectSource(entry.path, text, { addedLines: added[index] }));
    } catch (error) {
      if (!/^LEX_/.test(error.code)) throw error;
      result.warnings.push(`${entry.path}: anti-slop rules skipped (${error.message})`);
    }
  });
  result.violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Hook installation
// ---------------------------------------------------------------------------------------------

const HOOK_FILES = ['pre-commit', 'pre-commit.cmd', 'pre-commit.ps1'];

function portablePath(path) {
  return /^[A-Za-z]:[\\/]/.test(path) ? path.replace(/\\/g, '/') : path;
}

/**
 * The three hook scripts. Git (including Git for Windows) only runs the sh hook; the .cmd and .ps1
 * shims let people and Omni Studio run the same check by hand.
 * @param {{node: string, guardian: string}} paths Absolute node executable and guardian module.
 * @returns {{sh: string, cmd: string, ps1: string}}
 */
export function hookScripts({ node, guardian }) {
  const sh = value => `'${portablePath(value).replace(/'/g, `'\\''`)}'`;
  const cmd = value => `"${value.replace(/%/g, '%%')}"`;
  const ps = value => `'${value.replace(/'/g, "''")}'`;
  return {
    sh: [
      '#!/bin/sh',
      `# ${HOOK_MARKER}`,
      '# Installed by omni-spec; remove with: omni-spec guardian uninstall',
      `node=${sh(node)}`,
      '[ -x "$node" ] || node=node',
      `"$node" ${sh(guardian)} pre-commit || exit $?`,
      'chained="$(dirname "$0")/pre-commit.local"',
      'if [ -f "$chained" ]; then',
      '  exec "$chained" "$@"',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    cmd: [
      '@echo off',
      `rem ${HOOK_MARKER}`,
      `${cmd(node)} ${cmd(guardian)} pre-commit %*`,
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n'),
    ps1: [`# ${HOOK_MARKER}`, `& ${ps(node)} ${ps(guardian)} pre-commit @args`, 'exit $LASTEXITCODE', ''].join('\r\n'),
  };
}

async function hookDirectory(root) {
  const [cdup, hooksPath, commonDir] = (
    await Promise.all([
      gitBuffer(root, ['rev-parse', '--show-cdup']),
      gitBuffer(root, ['rev-parse', '--git-path', 'hooks']),
      gitBuffer(root, ['rev-parse', '--git-common-dir']),
    ])
  ).map(output => output.toString('utf8').trim());
  const top = resolve(root, cdup || '.');
  const directory = resolve(root, hooksPath);
  const inside = base => {
    const rel = relative(base, directory);
    return !rel.startsWith('..') && !isAbsolute(rel);
  };
  if (!inside(top) && !inside(resolve(root, commonDir)))
    throw new GuardianError(
      'GUARDIAN_HOOKS_OUTSIDE_REPO',
      `Git hooks resolve to ${directory}, outside this repository (core.hooksPath). Install the hook there by hand or set a repository-local core.hooksPath.`,
    );
  return directory;
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Installs the pre-commit hook and shims. A foreign pre-commit hook is kept as pre-commit.local
 * and still runs after the guardian passes.
 * @param {string} root
 * @param {{force?: boolean}} [options] force moves a second foreign hook to a timestamped backup.
 * @returns {Promise<{directory: string, chained: boolean, backup: string|null}>}
 */
export async function installHooks(root, { force = false } = {}) {
  const directory = await hookDirectory(root);
  await mkdir(directory, { recursive: true });
  const target = join(directory, 'pre-commit');
  const local = join(directory, 'pre-commit.local');
  const existing = await readOptional(target);
  let backup = null;
  if (existing !== null && !existing.includes(HOOK_MARKER)) {
    if ((await readOptional(local)) === null) await rename(target, local);
    else if (force) {
      backup = `${target}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await rename(target, backup);
    } else
      throw new GuardianError(
        'GUARDIAN_HOOK_CONFLICT',
        `${target} is a foreign hook and pre-commit.local is already taken. Merge them by hand or pass --force to back it up.`,
      );
  }
  const scripts = hookScripts({ node: process.execPath, guardian: fileURLToPath(import.meta.url) });
  await writeFile(target, scripts.sh, { mode: 0o755 });
  await chmod(target, 0o755);
  await writeFile(join(directory, 'pre-commit.cmd'), scripts.cmd);
  await writeFile(join(directory, 'pre-commit.ps1'), scripts.ps1);
  return { directory, chained: (await readOptional(local)) !== null, backup };
}

/** Removes only the guardian's files and restores a chained foreign hook. */
export async function uninstallHooks(root) {
  const directory = await hookDirectory(root);
  const removed = [];
  for (const name of HOOK_FILES) {
    const path = join(directory, name);
    const content = await readOptional(path);
    if (content?.includes(HOOK_MARKER)) {
      await unlink(path);
      removed.push(name);
    }
  }
  const local = join(directory, 'pre-commit.local');
  if (removed.includes('pre-commit') && (await readOptional(local)) !== null)
    await rename(local, join(directory, 'pre-commit'));
  return { directory, removed };
}

/** Entry point used by the hook: `node guardian.mjs pre-commit`. */
export async function runPreCommit(root = process.cwd(), { stderr = process.stderr } = {}) {
  const result = await inspectStaged(root);
  for (const warning of result.warnings) stderr.write(`omni-guardian: warning: ${warning}\n`);
  for (const item of result.violations) stderr.write(`${item.file}:${item.line} ${item.code} ${item.message}\n`);
  if (result.violations.length)
    stderr.write(`omni-guardian: commit blocked (${result.violations.length} problem(s) in staged content).\n`);
  return result.violations.length ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase() &&
  process.argv[2] === 'pre-commit';
if (invokedDirectly)
  runPreCommit().then(
    code => {
      process.exitCode = code;
    },
    error => {
      process.stderr.write(`omni-guardian: ${error.message}\n`);
      process.exitCode = 2;
    },
  );
