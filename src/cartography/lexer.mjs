/**
 * Pushdown DFA lexer for brownfield cartography (blueprint §4.3.1). One linear pass per file masks
 * every comment, string, template text and regex literal with spaces while keeping delimiters, line
 * breaks and the exact length. Extraction regexes then run on code only, and every specifier is read
 * from the original source at the same offsets, so no import is ever taken from data.
 * Zero dependencies; works on UTF-16 code units, the native shape of V8 strings.
 */

const SPACE = 0x20;
const LF = 0x0a;
const CR = 0x0d;

const EXTENSION_LANGUAGES = new Map([
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.mts', 'typescript'],
  ['.cts', 'typescript'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.py', 'python'],
  ['.go', 'go'],
  ['.rs', 'rust'],
  ['.java', 'java'],
]);

/** @returns {'typescript'|'javascript'|'python'|'go'|'rust'|'java'|null} */
export function detectLanguage(path) {
  const name = String(path).toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot === -1 ? null : (EXTENSION_LANGUAGES.get(name.slice(dot)) ?? null);
}

// Keywords after which a `/` starts a regular expression rather than a division (same set as js-lexer).
const REGEX_KEYWORDS = new Set([
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

// ASCII character classes: 1 whitespace, 2 identifier start, 3 digit, 4 `#` (private name start).
const CHAR_CLASS = new Uint8Array(128);
for (const code of [9, 10, 11, 12, 13, 32]) CHAR_CLASS[code] = 1;
for (let code = 65; code <= 90; code++) CHAR_CLASS[code] = 2;
for (let code = 97; code <= 122; code++) CHAR_CLASS[code] = 2;
CHAR_CLASS[36] = 2;
CHAR_CLASS[95] = 2;
for (let code = 48; code <= 57; code++) CHAR_CLASS[code] = 3;
CHAR_CLASS[35] = 4;
const isUnicodeSpace = code => code === 0xa0 || code === 0xfeff || code === 0x2028 || code === 0x2029;
const isIdentCode = code => (code < 128 ? CHAR_CLASS[code] === 2 || CHAR_CLASS[code] === 3 : !isUnicodeSpace(code));
const isIdentStartCode = code =>
  code < 128 ? CHAR_CLASS[code] === 2 || CHAR_CLASS[code] === 4 : !isUnicodeSpace(code);
const isSpaceCode = code => (code < 128 ? CHAR_CLASS[code] === 1 : isUnicodeSpace(code));

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const NON_LATIN1 = /[Ā-￿]/;

/**
 * UTF-16 code units of the source in a typed array, which the maskers read and overwrite. Reading a
 * Uint16Array is monomorphic, unlike charCodeAt across one-byte and two-byte V8 strings.
 * `blank` replaces a range with spaces but keeps CR and LF; ranges arrive in increasing order.
 */
function maskBuffer(source) {
  const length = source.length;
  const buffer = Buffer.alloc(length * 2);
  let codes;
  if (LITTLE_ENDIAN) {
    buffer.write(source, 0, 'utf16le');
    codes = new Uint16Array(buffer.buffer, buffer.byteOffset, length);
  } else {
    codes = new Uint16Array(length);
    for (let index = 0; index < length; index++) codes[index] = source.charCodeAt(index);
  }
  let nextLf = -1;
  let nextCr = -1;
  const breakAfter = (character, from) => {
    const found = source.indexOf(character, from);
    return found === -1 ? Number.POSITIVE_INFINITY : found;
  };
  return {
    codes,
    blank(start, end) {
      if (end <= start) return;
      if (end - start < 64) for (let index = start; index < end; index++) codes[index] = SPACE;
      else codes.fill(SPACE, start, end);
      if (nextLf < start) nextLf = breakAfter('\n', start);
      while (nextLf < end) {
        codes[nextLf] = LF;
        nextLf = breakAfter('\n', nextLf + 1);
      }
      if (nextCr < start) nextCr = breakAfter('\r', start);
      while (nextCr < end) {
        codes[nextCr] = CR;
        nextCr = breakAfter('\r', nextCr + 1);
      }
    },
    text() {
      // Latin-1 sources produce a one-byte masked string: half the heap of a UTF-16 one.
      if (!NON_LATIN1.test(source)) return Buffer.from(codes).toString('latin1');
      if (LITTLE_ENDIAN) return buffer.toString('utf16le');
      const chunks = [];
      for (let offset = 0; offset < length; offset += 8192)
        chunks.push(String.fromCharCode(...codes.subarray(offset, offset + 8192)));
      return chunks.join('');
    },
  };
}

function maskJavaScript(source) {
  const length = source.length;
  const out = maskBuffer(source);
  const { codes } = out;
  let i = 0;
  if (codes[0] === 0xfeff) {
    out.blank(0, 1);
    i = 1;
  }
  if (codes[i] === 35 && codes[i + 1] === 33) {
    let end = i;
    while (end < length && codes[end] !== LF && codes[end] !== CR) end++;
    out.blank(i, end);
    i = end;
  }
  // Pushdown state: each entry is the brace depth at which a template interpolation `${` opened.
  const templateStack = [];
  let braceDepth = 0;
  // Last significant token, for the regex-or-division decision.
  let lastKind = 0; // 0 none, 1 identifier or keyword, 3 punctuator, 4 literal/number, 5 property name
  let lastPunct = 0;
  let previousPunct = 0;
  let previousPunctAdjacent = false;
  let lastPunctEnd = -1;

  const readTemplate = start => {
    // `start` is the first character after ` or after the } that closes an interpolation.
    let index = start;
    while (index < length) {
      const code = codes[index];
      if (code === 92) {
        index += 2;
        continue;
      }
      if (code === 96) {
        out.blank(start, index);
        lastKind = 4;
        return index + 1;
      }
      if (code === 36 && codes[index + 1] === 123) {
        out.blank(start, index);
        templateStack.push(braceDepth);
        lastKind = 3;
        lastPunct = 123;
        return index + 2;
      }
      index++;
    }
    out.blank(start, length);
    return length;
  };

  // Keyword lookup is deferred to the rare `/` after an identifier, so identifiers cost no allocation.
  let lastIdentStart = 0;
  let lastIdentEnd = 0;
  const regexAllowed = () => {
    if (lastKind === 0) return true;
    if (lastKind === 1) return REGEX_KEYWORDS.has(source.slice(lastIdentStart, lastIdentEnd));
    if (lastKind === 3) {
      if (lastPunct === 41 || lastPunct === 93 || lastPunct === 125) return false;
      // Postfix ++ and -- end an operand, so a following slash divides.
      if ((lastPunct === 43 || lastPunct === 45) && previousPunct === lastPunct && previousPunctAdjacent) return false;
      return true;
    }
    return false;
  };

  while (i < length) {
    const code = codes[i];
    if (isSpaceCode(code)) {
      i++;
      continue;
    }
    if (code === 47) {
      const next = codes[i + 1];
      if (next === 47) {
        let end = i + 2;
        while (end < length) {
          const current = codes[end];
          if (current === LF || current === CR || current === 0x2028 || current === 0x2029) break;
          end++;
        }
        out.blank(i, end);
        i = end;
        continue;
      }
      if (next === 42) {
        const close = source.indexOf('*/', i + 2);
        const end = close === -1 ? length : close + 2;
        out.blank(i, end);
        i = end;
        continue;
      }
      if (regexAllowed()) {
        let index = i + 1;
        let inClass = false;
        while (index < length) {
          const current = codes[index];
          if (current === LF || current === CR) break;
          if (current === 92) {
            index += 2;
            continue;
          }
          if (current === 91) inClass = true;
          else if (current === 93) inClass = false;
          else if (current === 47 && !inClass) break;
          index++;
        }
        if (codes[index] === 47) {
          out.blank(i + 1, index);
          index++;
          while (index < length && isIdentCode(codes[index])) index++;
          i = index;
          lastKind = 4;
          continue;
        }
        // Unterminated on this line: it was a division after all; fall through as punctuator.
      }
    }
    if (code === 39 || code === 34) {
      let index = i + 1;
      while (index < length) {
        const current = codes[index];
        if (current === code) break;
        if (current === 92) {
          index += codes[index + 1] === CR && codes[index + 2] === LF ? 3 : 2;
          continue;
        }
        // Recovery: a string cannot span lines; JSX text such as Don't must not swallow the file.
        if (current === LF || current === CR) break;
        index++;
      }
      out.blank(i + 1, Math.min(index, length));
      i = codes[index] === code ? index + 1 : index;
      lastKind = 4;
      continue;
    }
    if (code === 96) {
      i = readTemplate(i + 1);
      continue;
    }
    if (code === 125 && templateStack.length && templateStack[templateStack.length - 1] === braceDepth) {
      templateStack.pop();
      i = readTemplate(i + 1);
      continue;
    }
    if (isIdentStartCode(code) || code === 92) {
      const start = i;
      i++;
      while (i < length && (isIdentCode(codes[i]) || codes[i] === 92)) i++;
      if (lastKind === 3 && lastPunct === 46 && !(previousPunct === 46 && previousPunctAdjacent)) lastKind = 5;
      else {
        lastKind = 1;
        lastIdentStart = start;
        lastIdentEnd = i;
      }
      continue;
    }
    if (code >= 48 && code <= 57) {
      i++;
      while (i < length && (isIdentCode(codes[i]) || codes[i] === 46)) i++;
      lastKind = 4;
      continue;
    }
    if (code === 123) braceDepth++;
    else if (code === 125) braceDepth--;
    previousPunctAdjacent = lastKind === 3 && lastPunctEnd === i;
    previousPunct = lastKind === 3 ? lastPunct : 0;
    lastPunct = code;
    lastKind = 3;
    lastPunctEnd = i + 1;
    i++;
  }
  return out.text();
}

function maskPython(source) {
  const length = source.length;
  const out = maskBuffer(source);
  const { codes } = out;
  let i = codes[0] === 0xfeff ? 1 : 0;
  if (i) out.blank(0, 1);
  while (i < length) {
    const code = codes[i];
    if (code === 35) {
      let end = i;
      while (end < length && codes[end] !== LF && codes[end] !== CR) end++;
      out.blank(i, end);
      i = end;
      continue;
    }
    if (code === 39 || code === 34) {
      const triple = codes[i + 1] === code && codes[i + 2] === code;
      let index = i + (triple ? 3 : 1);
      while (index < length) {
        const current = codes[index];
        if (current === 92) {
          index += 2;
          continue;
        }
        if (current === code && (!triple || (codes[index + 1] === code && codes[index + 2] === code))) break;
        if (!triple && (current === LF || current === CR)) break;
        index++;
      }
      const open = i + (triple ? 3 : 1);
      out.blank(open, Math.min(index, length));
      i = index >= length ? length : codes[index] === code ? index + (triple ? 3 : 1) : index;
      continue;
    }
    i++;
  }
  return out.text();
}

/** Go, Rust and Java share C-style comments; they differ in string and character literals. */
function maskCStyle(source, language) {
  const length = source.length;
  const out = maskBuffer(source);
  const { codes } = out;
  let i = codes[0] === 0xfeff ? 1 : 0;
  if (i) out.blank(0, 1);
  while (i < length) {
    const code = codes[i];
    const next = codes[i + 1];
    if (code === 47 && next === 47) {
      let end = i;
      while (end < length && codes[end] !== LF && codes[end] !== CR) end++;
      out.blank(i, end);
      i = end;
      continue;
    }
    if (code === 47 && next === 42) {
      let depth = 1;
      let index = i + 2;
      while (index < length && depth > 0) {
        const current = codes[index];
        if (current === 42 && codes[index + 1] === 47) {
          depth--;
          index += 2;
        } else if (language === 'rust' && current === 47 && codes[index + 1] === 42) {
          depth++;
          index += 2;
        } else index++;
      }
      out.blank(i, index);
      i = index;
      continue;
    }
    if (language === 'rust' && (code === 114 || code === 98) && (i === 0 || !isIdentCode(codes[i - 1]))) {
      // Raw strings r"…", r#"…"#, br"…"; byte strings b"…" are handled as ordinary strings below.
      let index = code === 98 && codes[i + 1] === 114 ? i + 2 : code === 114 ? i + 1 : -1;
      if (index !== -1) {
        let hashes = 0;
        while (codes[index] === 35) {
          hashes++;
          index++;
        }
        if (codes[index] === 34) {
          const closing = `"${'#'.repeat(hashes)}`;
          const close = source.indexOf(closing, index + 1);
          const end = close === -1 ? length : close;
          out.blank(index + 1, end);
          i = close === -1 ? length : close + closing.length;
          continue;
        }
      }
    }
    if (language === 'java' && code === 34 && next === 34 && codes[i + 2] === 34) {
      let index = i + 3;
      while (index < length) {
        if (codes[index] === 92) {
          index += 2;
          continue;
        }
        if (codes[index] === 34 && codes[index + 1] === 34 && codes[index + 2] === 34) break;
        index++;
      }
      out.blank(i + 3, Math.min(index, length));
      i = Math.min(index + 3, length);
      continue;
    }
    if (code === 34 || (language === 'go' && code === 96)) {
      const raw = code === 96;
      let index = i + 1;
      while (index < length) {
        const current = codes[index];
        if (current === code) break;
        if (!raw && current === 92) {
          index += 2;
          continue;
        }
        if (!raw && language !== 'rust' && (current === LF || current === CR)) break;
        index++;
      }
      out.blank(i + 1, Math.min(index, length));
      i = codes[index] === code ? index + 1 : index;
      continue;
    }
    if (code === 39) {
      // Character literal, unless it is a Rust lifetime such as 'a in &'a str.
      let end = -1;
      if (next === 92) {
        const close = source.indexOf("'", i + 3);
        if (close !== -1 && close - i <= 12) end = close;
      } else {
        const width = next >= 0xd800 && next <= 0xdbff ? 2 : 1;
        if (codes[i + 1 + width] === 39) end = i + 1 + width;
      }
      if (end !== -1) {
        out.blank(i + 1, end);
        i = end + 1;
        continue;
      }
    }
    i++;
  }
  return out.text();
}

/**
 * @param {string} source
 * @param {string} [language] typescript | javascript | python | go | rust | java
 * @returns {string} Same length as `source`; data and comments replaced by spaces, line breaks kept.
 */
export function maskSource(source, language = 'javascript') {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return maskJavaScript(source);
    case 'python':
      return maskPython(source);
    case 'go':
    case 'rust':
    case 'java':
      return maskCStyle(source, language);
    default:
      throw new RangeError(`Unsupported language: ${language}`);
  }
}

/**
 * Maps offsets to 1-based line numbers; CRLF counts once. Lookups usually arrive in increasing
 * order, so the counter only walks forward from the previous offset (restarting when it goes back).
 */
function lineIndex(source) {
  // Lone CRs (classic Mac line ends) are rare; without them, native indexOf jumps between LFs.
  const loneCr = /\r(?!\n)/.test(source);
  let offsetSeen = 0;
  let line = 1;
  let nextLf = -1;
  return offset => {
    if (offset < offsetSeen) {
      offsetSeen = 0;
      line = 1;
      nextLf = -1;
    }
    if (loneCr) {
      for (let index = offsetSeen; index < offset; index++) {
        const code = source.charCodeAt(index);
        if (code === LF) line++;
        else if (code === CR && source.charCodeAt(index + 1) !== LF) line++;
      }
    } else {
      if (nextLf < offsetSeen) nextLf = source.indexOf('\n', offsetSeen);
      while (nextLf !== -1 && nextLf < offset) {
        line++;
        nextLf = source.indexOf('\n', nextLf + 1);
      }
      if (nextLf === -1) nextLf = Number.POSITIVE_INFINITY;
    }
    offsetSeen = offset;
    return line;
  };
}

/** Cursor over masked code with the original source alongside for reading literals. */
class Cursor {
  constructor(masked, source, position) {
    this.masked = masked;
    this.source = source;
    this.position = position;
  }
  skip() {
    const { masked } = this;
    while (this.position < masked.length && isSpaceCode(masked.charCodeAt(this.position))) this.position++;
    return this;
  }
  peek() {
    return this.skip().masked[this.position];
  }
  word() {
    this.skip();
    const start = this.position;
    if (!isIdentStartCode(this.masked.charCodeAt(start))) return null;
    let end = start + 1;
    while (end < this.masked.length && isIdentCode(this.masked.charCodeAt(end))) end++;
    return this.masked.slice(start, end);
  }
  takeWord(expected) {
    const word = this.word();
    if (word === null || (expected !== undefined && word !== expected)) return null;
    this.position += word.length;
    return word;
  }
  take(character) {
    if (this.peek() !== character) return false;
    this.position++;
    return true;
  }
  /** Reads a quoted literal; masked text keeps the quotes, the original keeps the value. */
  string() {
    const quote = this.peek();
    if (quote !== "'" && quote !== '"') return null;
    const close = this.masked.indexOf(quote, this.position + 1);
    if (close === -1) return null;
    const value = this.source.slice(this.position + 1, close);
    this.position = close + 1;
    return value;
  }
}

const TS_DECLARATIONS = new Map([
  ['const', 'variable'],
  ['let', 'variable'],
  ['var', 'variable'],
  ['function', 'function'],
  ['class', 'class'],
  ['interface', 'interface'],
  ['type', 'type'],
  ['enum', 'enum'],
  ['namespace', 'namespace'],
  ['module', 'namespace'],
]);
const DECLARATION_MODIFIERS = new Set(['declare', 'abstract', 'async', 'default']);

/** Parses `{ a, type b, c as d }` (cursor on `{`). */
function braceList(cursor) {
  if (!cursor.take('{')) return null;
  const close = cursor.masked.indexOf('}', cursor.position);
  if (close === -1) return null;
  const items = [];
  for (const raw of cursor.masked.slice(cursor.position, close).split(',')) {
    const parts = raw.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    let typeOnly = false;
    if (parts[0] === 'type' && parts.length > 1 && parts[1] !== 'as') {
      typeOnly = true;
      parts.shift();
    }
    const name = parts[0];
    const alias = parts[1] === 'as' && parts[2] ? parts[2] : name;
    if (!/^[\p{L}\p{N}$_]+$/u.test(name)) continue;
    items.push({ name, alias, typeOnly });
  }
  cursor.position = close + 1;
  return items;
}

function scanJavaScript(source, masked, lineOf) {
  const imports = [];
  const exports = [];
  const reexports = [];
  const opaqueSites = [];
  const keyword = /(?<![\w$.#])(import|export|require)(?![\w$])/g;
  for (const match of masked.matchAll(keyword)) {
    const at = match.index;
    const cursor = new Cursor(masked, source, at + match[1].length);
    const line = lineOf(at);
    if (match[1] === 'require') {
      if (!cursor.take('(')) continue;
      const specifier = cursor.string();
      if (specifier !== null && cursor.peek() === ')')
        imports.push(record(specifier, 'require', 'value', ['*'], line, { bindings: [] }));
      else if (specifier === null) opaqueSites.push({ line });
      continue;
    }
    if (match[1] === 'import') {
      const next = cursor.peek();
      if (next === '.') continue;
      if (next === '(') {
        cursor.position++;
        const quote = cursor.peek();
        if (quote === '`') {
          const close = masked.indexOf('`', cursor.position + 1);
          const raw = close === -1 ? '' : source.slice(cursor.position + 1, close);
          if (close !== -1 && !raw.includes('${')) {
            cursor.position = close + 1;
            imports.push(record(raw, 'dynamic', 'value', ['*'], line, { bindings: [] }));
          } else opaqueSites.push({ line });
          continue;
        }
        const specifier = cursor.string();
        if (specifier !== null && (cursor.peek() === ')' || cursor.peek() === ','))
          imports.push(record(specifier, 'dynamic', 'value', ['*'], line, { bindings: [] }));
        else opaqueSites.push({ line });
        continue;
      }
      parseStaticImport(cursor, line, imports);
      continue;
    }
    parseExport(cursor, line, imports, exports, reexports);
  }
  return { imports, exports, reexports, hasOpaqueDependencies: opaqueSites.length > 0, opaqueSites };
}

function record(specifier, kind, edgeType, symbols, line, extra = {}) {
  return { specifier, kind, edgeType, symbols, typeOnlySymbols: [], line, bindings: [], ...extra };
}

function parseStaticImport(cursor, line, imports) {
  const side = cursor.string();
  if (side !== null) {
    imports.push(record(side, 'side-effect', 'value', ['*'], line));
    return;
  }
  let typeOnly = false;
  const save = cursor.position;
  if (cursor.takeWord('type')) {
    const after = cursor.word();
    if (after === 'from' || cursor.peek() === ',' || cursor.peek() === '=') cursor.position = save;
    else typeOnly = true;
  }
  const bindings = [];
  const typeOnlySymbols = [];
  for (;;) {
    const next = cursor.peek();
    if (next === '{') {
      const list = braceList(cursor);
      if (!list) return;
      for (const item of list) {
        bindings.push({ imported: item.name, local: item.alias });
        if (item.typeOnly) typeOnlySymbols.push(item.name);
      }
    } else if (next === '*') {
      cursor.position++;
      if (!cursor.takeWord('as')) return;
      const local = cursor.takeWord();
      if (!local) return;
      bindings.push({ imported: '*', local });
    } else {
      const word = cursor.word();
      if (!word || word === 'from') break;
      cursor.takeWord();
      // `import x = require('y')`: the require( that follows is recorded by its own keyword match.
      if (cursor.peek() === '=') return;
      bindings.push({ imported: 'default', local: word });
    }
    if (!cursor.take(',')) break;
  }
  if (!cursor.takeWord('from')) return;
  const specifier = cursor.string();
  if (specifier === null) return;
  const symbols = bindings.map(binding => binding.imported);
  const allTyped = typeOnly || (symbols.length > 0 && typeOnlySymbols.length === symbols.length);
  imports.push(
    record(specifier, 'static', allTyped ? 'type_only' : 'value', symbols.length ? symbols : ['*'], line, {
      bindings,
      typeOnlySymbols: typeOnly ? [...symbols] : typeOnlySymbols,
    }),
  );
}

function parseExport(cursor, line, imports, exports, reexports) {
  const save = cursor.position;
  let typeOnly = false;
  if (cursor.takeWord('type')) {
    if (cursor.peek() === '{' || cursor.peek() === '*') typeOnly = true;
    else cursor.position = save;
  }
  const next = cursor.peek();
  if (next === '*') {
    cursor.position++;
    let namespace = null;
    if (cursor.takeWord('as')) namespace = cursor.takeWord();
    if (!cursor.takeWord('from')) return;
    const specifier = cursor.string();
    if (specifier === null) return;
    const edgeType = typeOnly ? 'type_only' : 'value';
    reexports.push({ specifier, symbols: '*', namespace, edgeType, line });
    imports.push(record(specifier, 'reexport', edgeType, ['*'], line));
    return;
  }
  if (next === '{') {
    const list = braceList(cursor);
    if (!list) return;
    const fromSave = cursor.position;
    if (cursor.takeWord('from')) {
      const specifier = cursor.string();
      if (specifier === null) return;
      const allTyped = typeOnly || (list.length > 0 && list.every(item => item.typeOnly));
      const edgeType = allTyped ? 'type_only' : 'value';
      reexports.push({
        specifier,
        symbols: list.map(item => ({ imported: item.name, exported: item.alias })),
        namespace: null,
        edgeType,
        line,
      });
      imports.push(
        record(
          specifier,
          'reexport',
          edgeType,
          list.map(item => item.name),
          line,
          { typeOnlySymbols: list.filter(item => typeOnly || item.typeOnly).map(item => item.name) },
        ),
      );
      return;
    }
    cursor.position = fromSave;
    for (const item of list)
      exports.push({ name: item.alias, kind: 'named', local: item.name, line, typeOnly: typeOnly || item.typeOnly });
    return;
  }
  if (cursor.peek() === '=') {
    exports.push({ name: 'default', kind: 'default', line });
    return;
  }
  let word = cursor.takeWord();
  if (word === 'default') {
    exports.push({ name: 'default', kind: 'default', line });
    return;
  }
  while (word && DECLARATION_MODIFIERS.has(word)) word = cursor.takeWord();
  const kind = word && TS_DECLARATIONS.get(word);
  if (!kind) return;
  if (word === 'function' && cursor.peek() === '*') cursor.position++;
  if (word === 'const' && cursor.word() === 'enum') {
    cursor.takeWord();
    const name = cursor.takeWord();
    if (name) exports.push({ name, kind: 'enum', line });
    return;
  }
  const name = cursor.takeWord();
  if (name) exports.push({ name, kind, line });
}

function scanPython(_source, masked, lineOf) {
  const imports = [];
  const exports = [];
  const statement =
    /^[ \t]*(?:(from)[ \t]+([.\w]+)[ \t]+import[ \t]+(\([^)]*\)|[^\n\r;]+)|(import)[ \t]+([^\n\r;]+))/gm;
  for (const match of masked.matchAll(statement)) {
    const line = lineOf(match.index + match[0].search(/\S/));
    if (match[1]) {
      const module = match[2];
      const level = /^\.*/.exec(module)[0].length;
      const symbols = match[3]
        .replace(/[()\\]/g, ' ')
        .split(',')
        .map(part => part.trim().split(/\s+/)[0])
        .filter(Boolean);
      imports.push({
        specifier: module,
        kind: 'static',
        edgeType: 'value',
        symbols,
        level,
        line,
        bindings: [],
        typeOnlySymbols: [],
      });
    } else {
      for (const part of match[5].split(',')) {
        const name = part.trim().split(/\s+/)[0];
        if (name && /^[\w.]+$/.test(name))
          imports.push({
            specifier: name,
            kind: 'static',
            edgeType: 'value',
            symbols: ['*'],
            level: 0,
            line,
            bindings: [],
            typeOnlySymbols: [],
          });
      }
    }
  }
  const definition = /^(?:async[ \t]+)?(def|class)[ \t]+([A-Za-z_]\w*)/gm;
  for (const match of masked.matchAll(definition))
    exports.push({ name: match[2], kind: match[1] === 'def' ? 'function' : 'class', line: lineOf(match.index) });
  return {
    imports,
    exports,
    reexports: [],
    hasOpaqueDependencies: /\b(?:__import__|importlib\.import_module)\s*\(/.test(masked),
    opaqueSites: [],
  };
}

function stringAt(masked, source, position) {
  const quote = masked[position];
  const close = masked.indexOf(quote, position + 1);
  return close === -1 ? null : { value: source.slice(position + 1, close), end: close + 1 };
}

function scanGo(source, masked, lineOf) {
  const imports = [];
  const packageName = /^[ \t]*package[ \t]+(\w+)/m.exec(masked)?.[1] ?? null;
  const spec = /([\w.]+[ \t]+)?(["`])/y;
  const addSpec = (position, line) => {
    spec.lastIndex = position;
    const found = spec.exec(masked);
    if (!found) return;
    const literal = stringAt(masked, source, position + (found[1]?.length ?? 0));
    if (literal)
      imports.push({
        specifier: literal.value,
        alias: found[1] ? found[1].trim() : null,
        kind: 'static',
        edgeType: 'value',
        symbols: ['*'],
        line,
        bindings: [],
        typeOnlySymbols: [],
      });
  };
  const keyword = /^[ \t]*import\b[ \t]*/gm;
  for (const match of masked.matchAll(keyword)) {
    const after = match.index + match[0].length;
    if (masked[after] === '(') {
      const close = masked.indexOf(')', after);
      const block = masked.slice(after + 1, close === -1 ? masked.length : close);
      let offset = after + 1;
      for (const row of block.split('\n')) {
        const trimmed = row.search(/\S/);
        if (trimmed !== -1) addSpec(offset + trimmed, lineOf(offset + trimmed));
        offset += row.length + 1;
      }
    } else addSpec(after, lineOf(after));
  }
  const exports = [];
  const exported = /^(?:func(?:[ \t]+\([^)]*\))?|type|var|const)[ \t]+([A-Z]\w*)/gm;
  for (const match of masked.matchAll(exported))
    exports.push({ name: match[1], kind: 'named', line: lineOf(match.index) });
  return { package: packageName, imports, exports, reexports: [], hasOpaqueDependencies: false, opaqueSites: [] };
}

/** Expands `a::{b, c::{d, e}}` into leaf paths. */
function expandUseTree(tree) {
  // `@` marks an alias (`x as y`) so whitespace can be dropped from the tree.
  const trimmed = tree.replace(/\s+as\s+/g, '@').replace(/\s+/g, '');
  const open = trimmed.indexOf('{');
  if (open === -1) return [trimmed];
  const prefix = trimmed.slice(0, open);
  const inner = trimmed.slice(open + 1, trimmed.lastIndexOf('}'));
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < inner.length; index++) {
    if (inner[index] === '{') depth++;
    else if (inner[index] === '}') depth--;
    else if (inner[index] === ',' && depth === 0) {
      parts.push(inner.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts
    .filter(Boolean)
    .flatMap(part => (part === 'self' ? [prefix.replace(/::$/, '')] : expandUseTree(prefix + part)));
}

function scanRust(_source, masked, lineOf) {
  const imports = [];
  const exports = [];
  const use = /(?<![\w])(?:pub(?:\([^)]*\))?[ \t]+)?use[ \t]+([^;]+);/g;
  for (const match of masked.matchAll(use)) {
    const line = lineOf(match.index);
    for (const leaf of expandUseTree(match[1])) {
      const [path, alias] = leaf.split('@');
      const specifier = path.replace(/::$/, '');
      if (!specifier) continue;
      imports.push({
        specifier,
        alias: alias ?? null,
        kind: 'use',
        edgeType: 'value',
        symbols: [specifier.split('::').pop()],
        line,
        bindings: [],
        typeOnlySymbols: [],
      });
    }
  }
  const mod = /(?<![\w])(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+([A-Za-z_]\w*)[ \t]*;/g;
  for (const match of masked.matchAll(mod))
    imports.push({
      specifier: match[1],
      kind: 'mod',
      edgeType: 'value',
      symbols: ['*'],
      line: lineOf(match.index),
      bindings: [],
      typeOnlySymbols: [],
    });
  imports.sort((a, b) => a.line - b.line);
  const exported = /(?<![\w])pub[ \t]+(?:async[ \t]+)?(fn|struct|enum|trait|type|const|static)[ \t]+([A-Za-z_]\w*)/g;
  for (const match of masked.matchAll(exported))
    exports.push({ name: match[2], kind: match[1], line: lineOf(match.index) });
  return { imports, exports, reexports: [], hasOpaqueDependencies: false, opaqueSites: [] };
}

function scanJava(_source, masked, lineOf) {
  const imports = [];
  const packageName = /^[ \t]*package[ \t]+([\w.]+)[ \t]*;/m.exec(masked)?.[1] ?? null;
  const statement = /^[ \t]*import[ \t]+(static[ \t]+)?([\w.]+)(\.\*)?[ \t]*;/gm;
  for (const match of masked.matchAll(statement))
    imports.push({
      specifier: match[2],
      kind: 'static',
      edgeType: 'value',
      symbols: [match[3] ? '*' : match[2].split('.').pop()],
      wildcard: Boolean(match[3]),
      static: Boolean(match[1]),
      line: lineOf(match.index + match[0].search(/\S/)),
      bindings: [],
      typeOnlySymbols: [],
    });
  const exports = [];
  const declared = /\bpublic[ \t]+(?:(?:final|abstract|sealed|static)[ \t]+)*(class|interface|enum|record)[ \t]+(\w+)/g;
  for (const match of masked.matchAll(declared))
    exports.push({ name: match[2], kind: match[1], line: lineOf(match.index) });
  return { package: packageName, imports, exports, reexports: [], hasOpaqueDependencies: false, opaqueSites: [] };
}

/**
 * Extracts dependencies and exports from one module.
 * @param {string} source
 * @param {{language?: string}} [options]
 */
export function scanModule(source, { language = 'javascript' } = {}) {
  const masked = maskSource(source, language);
  const lineOf = lineIndex(source);
  let result;
  switch (language) {
    case 'typescript':
    case 'javascript':
      result = scanJavaScript(source, masked, lineOf);
      break;
    case 'python':
      result = scanPython(source, masked, lineOf);
      break;
    case 'go':
      result = scanGo(source, masked, lineOf);
      break;
    case 'rust':
      result = scanRust(source, masked, lineOf);
      break;
    default:
      result = scanJava(source, masked, lineOf);
  }
  // One shape for every language keeps consumers monomorphic.
  return {
    language,
    package: result.package ?? null,
    imports: result.imports.map(item => ({
      specifier: item.specifier,
      kind: item.kind,
      edgeType: item.edgeType,
      symbols: item.symbols,
      typeOnlySymbols: item.typeOnlySymbols,
      bindings: item.bindings,
      line: item.line,
      level: item.level ?? 0,
      alias: item.alias ?? null,
      wildcard: item.wildcard ?? false,
      static: item.static ?? false,
    })),
    exports: result.exports,
    reexports: result.reexports,
    hasOpaqueDependencies: result.hasOpaqueDependencies,
    opaqueSites: result.opaqueSites,
  };
}
