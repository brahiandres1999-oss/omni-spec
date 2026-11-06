import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { lex } from './js-lexer.mjs';

/**
 * Anti-hollow assertion guard (OMNI-AGENTIC-SECURITY-AUDIT section 6, barrier 3). It reads test
 * files as tokens and refuses tests that assert nothing, assert constants (`expect(true).toBe(true)`)
 * or never reference project code. It is a lexical check, not a proof that a test is meaningful.
 */

const execFileAsync = promisify(execFile);
const TEST_FILE = /(?:^|\/)(?:test|tests|__tests__)\/.+\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const ASSERT_METHODS = new Set([
  'ok',
  'equal',
  'strictEqual',
  'deepEqual',
  'deepStrictEqual',
  'notEqual',
  'notStrictEqual',
  'notDeepEqual',
  'notDeepStrictEqual',
  'throws',
  'rejects',
  'doesNotThrow',
  'doesNotReject',
  'match',
  'doesNotMatch',
  'fail',
  'ifError',
  'partialDeepStrictEqual',
]);
const COMPARISONS = new Set([
  'equal',
  'strictEqual',
  'deepEqual',
  'deepStrictEqual',
  'partialDeepStrictEqual',
  'toBe',
  'toEqual',
  'toStrictEqual',
]);
const CONSTANT_IDENTS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

function closing(tokens, open) {
  let depth = 0;
  for (let index = open; index < tokens.length; index++) {
    const value = tokens[index].type === 'punct' ? tokens[index].value : null;
    if (value === '(' || value === '[' || value === '{') depth++;
    else if (value === ')' || value === ']' || value === '}') {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Top-level comma-separated arguments between an opening parenthesis and its match. */
function argumentsOf(tokens, open) {
  const close = closing(tokens, open);
  if (close === -1) return { args: [], close: tokens.length - 1 };
  const args = [];
  let current = [];
  let depth = 0;
  for (let index = open + 1; index < close; index++) {
    const token = tokens[index];
    if (token.type === 'punct') {
      if ('([{'.includes(token.value)) depth++;
      else if (')]}'.includes(token.value)) depth--;
      else if (token.value === ',' && depth === 0) {
        args.push(current);
        current = [];
        continue;
      }
    }
    current.push(token);
  }
  if (current.length) args.push(current);
  return { args, close };
}

const text = tokens => tokens.map(token => token.value).join(' ');

function isConstant(tokens) {
  if (!tokens.length) return false;
  return tokens.every(
    token =>
      token.type === 'string' ||
      token.type === 'number' ||
      (token.type === 'template' && !token.value.endsWith('${')) ||
      (token.type === 'ident' && CONSTANT_IDENTS.has(token.value)) ||
      (token.type === 'punct' && ['-', '+', '!'].includes(token.value)),
  );
}

function tautology(kind, subject, expected) {
  if (kind === 'truthy') return isConstant(subject);
  if (!subject?.length) return false;
  if (isConstant(subject)) return true;
  return COMPARISONS.has(kind) && expected?.length > 0 && text(subject) === text(expected);
}

function referencesProject(tokens) {
  return tokens.some(token => token.type === 'string' && /^['"]\.{1,2}(?:\/|['"]$)/.test(token.value));
}

/**
 * @param {string} file Repository-relative path, used in findings.
 * @param {string} source Test file content.
 * @returns {{assertions: number, findings: {file: string, line: number, code: string, message: string}[]}}
 */
export function inspectTestSource(file, source) {
  const tokens = lex(source).filter(token => token.type !== 'comment');
  const findings = [];
  let assertions = 0;
  const report = (line, code, message) => findings.push({ file, line, code, message });
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'ident') continue;
    const next = tokens[index + 1];
    if (token.value === 'assert' && tokens[index - 1]?.value !== '.' && next?.value === '(') {
      assertions++;
      const { args } = argumentsOf(tokens, index + 1);
      if (tautology('truthy', args[0]))
        report(token.line, 'TAUTOLOGICAL_ASSERTION', `assert(${text(args[0])}) always passes`);
      continue;
    }
    if (token.value === 'assert' && next?.value === '.' && ASSERT_METHODS.has(tokens[index + 2]?.value)) {
      const method = tokens[index + 2].value;
      if (tokens[index + 3]?.value !== '(') continue;
      assertions++;
      const { args } = argumentsOf(tokens, index + 3);
      const kind = method === 'ok' ? 'truthy' : method;
      if ((kind === 'truthy' || COMPARISONS.has(kind)) && tautology(kind, args[0], args[1]))
        report(token.line, 'TAUTOLOGICAL_ASSERTION', `assert.${method}(${args.map(text).join(', ')}) always passes`);
      continue;
    }
    if (token.value === 'expect' && tokens[index - 1]?.value !== '.' && next?.value === '(') {
      const { args, close } = argumentsOf(tokens, index + 1);
      let cursor = close + 1;
      let matcher = null;
      while (tokens[cursor]?.value === '.' && tokens[cursor + 1]?.type === 'ident') {
        matcher = tokens[cursor + 1].value;
        cursor += 2;
      }
      if (!matcher || matcher === 'not' || tokens[cursor]?.value !== '(') continue;
      assertions++;
      const expected = argumentsOf(tokens, cursor).args[0];
      if (tautology(COMPARISONS.has(matcher) ? matcher : 'truthy', args[0], expected))
        report(token.line, 'TAUTOLOGICAL_ASSERTION', `expect(${text(args[0])}).${matcher}(...) always passes`);
    }
  }
  const tautologies = findings.length;
  if (!assertions || tautologies === assertions)
    findings.unshift({
      file,
      line: 1,
      code: 'HOLLOW_TEST_DETECTED',
      message: 'Test file contains zero meaningful assertions against the target module.',
    });
  if (!referencesProject(tokens))
    findings.push({
      file,
      line: 1,
      code: 'CONTRACT_FRAUD_DETECTED',
      message: 'Test file never imports or references project code.',
    });
  return { assertions, findings };
}

/**
 * Test files added, modified or untracked relative to HEAD. Outside a Git repository the guard
 * has no baseline and returns no files.
 * @returns {Promise<string[]>}
 */
export async function changedTestFiles(root) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'],
      {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
    ));
  } catch (error) {
    if (error.code === 'ENOENT' || /not a git repository/i.test(error.stderr ?? '')) return [];
    throw error;
  }
  return stdout
    .split('\0')
    .filter(entry => entry.length > 3 && !entry.slice(0, 2).includes('D'))
    .map(entry => entry.slice(3))
    .filter(path => TEST_FILE.test(path));
}

/**
 * Findings for every changed test file in a project.
 * @returns {Promise<{file: string, line: number, code: string, message: string}[]>}
 */
export async function hollowTestFindings(root) {
  const findings = [];
  for (const file of await changedTestFiles(root)) {
    let source;
    try {
      source = await readFile(join(root, file), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') continue;
      throw error;
    }
    try {
      findings.push(...inspectTestSource(file, source).findings);
    } catch (error) {
      if (!/^LEX_/.test(error.code)) throw error;
      findings.push({ file, line: error.line ?? 1, code: 'HOLLOW_TEST_UNREADABLE', message: error.message });
    }
  }
  return findings;
}
