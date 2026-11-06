/**
 * Minimal JavaScript/TypeScript lexer with no dependencies. It separates code from comments,
 * strings, template text and regex literals so rule engines (Omni-Guardian anti-slop, the hollow
 * assertion guard) never match code-shaped text inside data. It is a token stream, not a parser.
 */

const KEYWORDS_BEFORE_EXPRESSION = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);
const IDENT_START_RE = /[\p{ID_Start}$_#]/u;
const IDENT_PART_RE = /[\p{ID_Continue}$\u200c\u200d]/u;

// ASCII fast paths keep the lexer cheap; the Unicode regexes only see non-ASCII input.
function isIdentStart(char) {
  const code = char.charCodeAt(0);
  if (code < 128)
    return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 36 || code === 95 || code === 35;
  return IDENT_START_RE.test(char);
}

function isIdentPart(char) {
  const code = char.charCodeAt(0);
  if (code < 128)
    return (
      (code >= 97 && code <= 122) ||
      (code >= 65 && code <= 90) ||
      (code >= 48 && code <= 57) ||
      code === 36 ||
      code === 95
    );
  return IDENT_PART_RE.test(char);
}

function lexError(code, message, line) {
  const error = new Error(`${code}: ${message} (line ${line})`);
  error.code = code;
  error.line = line;
  return error;
}

/**
 * @param {string} source
 * @returns {{type:'comment'|'string'|'template'|'regex'|'ident'|'number'|'punct', value:string, start:number, end:number, line:number}[]}
 * @throws {Error} code LEX_UNTERMINATED when a string, template, regex or block comment never closes.
 */
export function lex(source) {
  const tokens = [];
  const length = source.length;
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  // Each entry is the brace depth at which a template interpolation `${` opened.
  const templateStack = [];
  let braceDepth = 0;

  const push = (type, start, end, startLine) => {
    tokens.push({ type, value: source.slice(start, end), start, end, line: startLine });
  };
  const lastCode = () => {
    for (let index = tokens.length - 1; index >= 0; index--) if (tokens[index].type !== 'comment') return tokens[index];
    return null;
  };
  const regexAllowed = () => {
    const previous = lastCode();
    if (!previous) return true;
    if (previous.type === 'ident') return KEYWORDS_BEFORE_EXPRESSION.has(previous.value);
    if (previous.type === 'punct') return ![')', ']', '}'].includes(previous.value);
    return false;
  };
  const newline = index => {
    const char = source[index];
    if (char === '\r') {
      line++;
      return source[index + 1] === '\n' ? 2 : 1;
    }
    if (char === '\n' || char === '\u2028' || char === '\u2029') {
      line++;
      return 1;
    }
    return 0;
  };

  // Reads template text from `start` (just after ` or a closing interpolation }) to the next
  // backtick or `${`. Returns true when the template continues into an interpolation.
  const readTemplate = start => {
    const startLine = line;
    let index = start;
    while (index < length) {
      const char = source[index];
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === '`') {
        push('template', start - 1, index + 1, startLine);
        i = index + 1;
        return false;
      }
      if (char === '$' && source[index + 1] === '{') {
        push('template', start - 1, index + 2, startLine);
        templateStack.push(braceDepth);
        i = index + 2;
        return true;
      }
      const step = newline(index);
      index += step || 1;
    }
    throw lexError('LEX_UNTERMINATED', 'template literal never closes', startLine);
  };

  if (source.startsWith('#!', i)) {
    const end = source.indexOf('\n', i);
    push('comment', i, end === -1 ? length : end, line);
    i = end === -1 ? length : end;
  }

  while (i < length) {
    const char = source[i];
    const skip = newline(i);
    if (skip) {
      i += skip;
      continue;
    }
    if (char === ' ' || char === '\t' || char === '\f' || char === '\v' || char === '\u00a0' || char === '\ufeff') {
      i++;
      continue;
    }
    const start = i;
    const startLine = line;
    if (char === '/' && source[i + 1] === '/') {
      while (i < length && !'\r\n\u2028\u2029'.includes(source[i])) i++;
      push('comment', start, i, startLine);
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) throw lexError('LEX_UNTERMINATED', 'block comment never closes', startLine);
      for (let index = i + 2; index < end; ) index += newline(index) || 1;
      i = end + 2;
      push('comment', start, i, startLine);
      continue;
    }
    if (char === '"' || char === "'") {
      i++;
      while (i < length && source[i] !== char) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if ('\r\n'.includes(source[i])) break;
        i++;
      }
      if (source[i] !== char) throw lexError('LEX_UNTERMINATED', 'string never closes', startLine);
      i++;
      push('string', start, i, startLine);
      continue;
    }
    if (char === '`') {
      readTemplate(i + 1);
      continue;
    }
    if (char === '}' && templateStack.length && templateStack[templateStack.length - 1] === braceDepth) {
      templateStack.pop();
      readTemplate(i + 1);
      continue;
    }
    if (char === '/' && regexAllowed()) {
      i++;
      let inClass = false;
      while (i < length) {
        const current = source[i];
        if ('\r\n\u2028\u2029'.includes(current)) break;
        if (current === '\\') {
          i += 2;
          continue;
        }
        if (current === '[') inClass = true;
        else if (current === ']') inClass = false;
        else if (current === '/' && !inClass) break;
        i++;
      }
      if (source[i] !== '/') throw lexError('LEX_UNTERMINATED', 'regular expression never closes', startLine);
      i++;
      while (i < length && isIdentPart(source[i])) i++;
      push('regex', start, i, startLine);
      continue;
    }
    if (char >= '0' && char <= '9') {
      i++;
      while (i < length && /[0-9a-zA-Z_.]/.test(source[i])) i++;
      push('number', start, i, startLine);
      continue;
    }
    if (isIdentStart(char) || char === '\\') {
      i++;
      while (i < length && (isIdentPart(source[i]) || source[i] === '\\')) i++;
      push('ident', start, i, startLine);
      continue;
    }
    if (char === '{') braceDepth++;
    else if (char === '}') braceDepth--;
    i++;
    push('punct', start, i, startLine);
  }
  if (templateStack.length) throw lexError('LEX_UNTERMINATED', 'template interpolation never closes', line);
  return tokens;
}

/** @returns {ReturnType<typeof lex>} Tokens that are code (no comments, strings, templates or regexes). */
export function codeTokens(tokens) {
  return tokens.filter(token => token.type === 'ident' || token.type === 'number' || token.type === 'punct');
}

/**
 * Balanced `{ \u2026 }` ranges as indexes into `tokens`. Template interpolation braces are not tokens.
 * @returns {{open:number, close:number, depth:number}[]} In closing order.
 * @throws {Error} LEX_UNBALANCED when braces do not pair up.
 */
export function blocks(tokens) {
  const stack = [];
  const ranges = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'punct') continue;
    if (token.value === '{') stack.push(index);
    else if (token.value === '}') {
      if (!stack.length) throw lexError('LEX_UNBALANCED', 'closing brace without an opening one', token.line);
      const open = stack.pop();
      ranges.push({ open, close: index, depth: stack.length });
    }
  }
  if (stack.length) throw lexError('LEX_UNBALANCED', 'opening brace never closes', tokens[stack.at(-1)].line);
  return ranges;
}
