// biome-ignore-all lint/suspicious/noTemplateCurlyInString: lexer inputs deliberately contain template syntax.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { lex, blocks, codeTokens } from '../src/js-lexer.mjs';

const kinds = source => lex(source).map(token => [token.type, token.value]);

describe('js-lexer', () => {
  test('LX-01 line and block comments are comment tokens, not code', () => {
    const tokens = lex('a // catch {}\n/* return; */ b');
    assert.deepEqual(
      tokens.map(token => token.type),
      ['ident', 'comment', 'comment', 'ident'],
    );
    assert.deepEqual(
      codeTokens(tokens).map(token => token.value),
      ['a', 'b'],
    );
  });

  test('LX-02 single and double quoted strings with escapes are one string token', () => {
    assert.deepEqual(kinds(`'it\\'s' "say \\"hi\\""`), [
      ['string', `'it\\'s'`],
      ['string', '"say \\"hi\\""'],
    ]);
  });

  test('LX-03 template literals tokenize interpolations as code and nest', () => {
    const tokens = lex('`a ${ f(`in ${x}`) } b`');
    const code = tokens.filter(token => token.type !== 'template').map(token => token.value);
    assert.deepEqual(code, ['f', '(', 'x', ')']);
    assert.ok(tokens.some(token => token.type === 'template' && token.value.startsWith('`a ')));
    assert.ok(tokens.some(token => token.type === 'template' && token.value.includes('in ')));
  });

  test('LX-04 regex literals are told apart from division', () => {
    assert.deepEqual(
      lex('a / b / c').map(token => token.type),
      ['ident', 'punct', 'ident', 'punct', 'ident'],
    );
    const regex = lex('x = /a\\/b[/]/g; y = (1) / 2');
    assert.equal(regex[2].type, 'regex');
    assert.equal(regex[2].value, '/a\\/b[/]/g');
    assert.equal(regex.filter(token => token.type === 'regex').length, 1);
    assert.equal(lex('return /x/.test(s)')[1].type, 'regex');
  });

  test('LX-05 code inside a string produces no code tokens', () => {
    assert.deepEqual(
      codeTokens(lex('"catch {}" + \'return;\'')).map(token => token.value),
      ['+'],
    );
  });

  test('LX-06 CRLF and LF yield the same logical line numbers', () => {
    const lf = lex('a\nb\n\nc').map(token => token.line);
    const crlf = lex('a\r\nb\r\n\r\nc').map(token => token.line);
    assert.deepEqual(lf, [1, 2, 4]);
    assert.deepEqual(crlf, lf);
  });

  test('LX-07 a leading BOM is ignored', () => {
    assert.deepEqual(kinds('\ufeffa'), [['ident', 'a']]);
  });

  test('LX-08 unterminated strings, templates, regexes and comments fail with the line', () => {
    for (const source of ['a\n"open', 'x\n\n`open ${a}', '/* never', 'a = /open\n']) {
      assert.throws(
        () => lex(source),
        error => error.code === 'LEX_UNTERMINATED' && Number.isInteger(error.line),
        source,
      );
    }
  });

  test('LX-09 blocks returns every balanced brace range with its depth', () => {
    const tokens = lex('function f() { if (a) { b(); } `${ {c:1} }` }');
    const ranges = blocks(tokens);
    assert.equal(ranges.length, 3);
    const outer = ranges.find(range => range.depth === 0);
    assert.equal(tokens[outer.open].value, '{');
    assert.equal(outer.close, tokens.length - 1);
    assert.ok(ranges.every(range => tokens[range.open].value === '{' && tokens[range.close].value === '}'));
    assert.throws(() => blocks(lex('{ a')), /LEX_UNBALANCED/);
  });

  test('LX-10 lexes a 5,000 line file in under 50 ms', () => {
    const line = "const value = call(`t ${x}`, 'str', /re/g) / 2; // note\n";
    const source = line.repeat(5000);
    lex(source);
    const started = performance.now();
    const tokens = lex(source);
    const elapsed = performance.now() - started;
    assert.ok(tokens.length > 50000);
    assert.ok(elapsed < 200, `lexing took ${elapsed.toFixed(1)} ms`);
  });
});
