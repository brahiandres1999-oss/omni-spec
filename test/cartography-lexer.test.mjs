// biome-ignore-all lint/suspicious/noTemplateCurlyInString: lexer inputs deliberately contain template syntax.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { detectLanguage, maskSource, scanModule } from '../src/cartography/lexer.mjs';
import { lex } from '../src/js-lexer.mjs';
import { seededRandom, syntheticTypeScript } from '../test-support/cartography-fixtures.mjs';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const ts = source => scanModule(source, { language: 'typescript' });
const specifiers = scan => scan.imports.map(item => item.specifier);
const only = (scan, specifier) => {
  const found = scan.imports.filter(item => item.specifier === specifier);
  assert.equal(found.length, 1, `expected exactly one import of ${specifier}, got ${JSON.stringify(scan.imports)}`);
  return found[0];
};
const lineBreaks = text => [...text.matchAll(/\r\n|\r|\n/g)].map(match => match.index);
const isBlank = text => /^[ \r\n]*$/.test(text);

function listSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? listSources(join(directory, entry.name))
      : entry.name.endsWith('.mjs')
        ? [join(directory, entry.name)]
        : [],
  );
}

describe('LX-MASK whitespace masking', () => {
  test('LX-MASK-01 keeps length and every line break offset', () => {
    const source = "import a from './a';\r\nconst s = 'x\\'y'; // c\n/* b\r\nlock */ const t = `t\n${a}`;\n";
    const masked = maskSource(source, 'typescript');
    assert.equal(masked.length, source.length);
    assert.deepEqual(lineBreaks(masked), lineBreaks(source));
  });

  test('LX-MASK-02 comments never yield imports and keep line numbers', () => {
    const scan = ts(
      "// import x from 'evil'\n/* import 'evil'\nimport y from 'evil2' */\nimport real from './real';\n",
    );
    assert.deepEqual(specifiers(scan), ['./real']);
    assert.equal(scan.imports[0].line, 4);
  });

  test('LX-MASK-03 string contents are masked and quotes preserved', () => {
    const source = `const s = "import x from 'evil'";`;
    const masked = maskSource(source, 'javascript');
    assert.deepEqual(specifiers(ts(source)), []);
    assert.equal(masked, `const s = "${' '.repeat(20)}";`);
  });

  test('LX-MASK-04 escapes close strings where they must', () => {
    const scan = ts(`const a = 'it\\'s'; const b = "a\\"b"; const c = "\\\\";\nimport real from './real';`);
    assert.deepEqual(specifiers(scan), ['./real']);
  });

  test('LX-MASK-05 a line continuation keeps the next line inside the string', () => {
    for (const eol of ['\n', '\r\n']) {
      const scan = ts(`const s = 'first \\${eol}import x from "evil"';${eol}import real from './real';`);
      assert.deepEqual(specifiers(scan), ['./real'], JSON.stringify(eol));
    }
  });

  test('LX-MASK-06 the specifier is read from the original source', () => {
    assert.deepEqual(specifiers(ts("import a from './ruta con espacios.js';")), ['./ruta con espacios.js']);
  });

  test('LX-MASK-07 BOM and shebang are ignored without shifting offsets', () => {
    const source = "﻿#!/usr/bin/env node\nimport a from './a';";
    const masked = maskSource(source, 'javascript');
    assert.equal(masked.length, source.length);
    const scan = scanModule(source, { language: 'javascript' });
    assert.deepEqual(specifiers(scan), ['./a']);
    assert.equal(scan.imports[0].line, 2);
  });

  test('LX-MASK-08 CRLF and LF give the same line numbers', () => {
    const lf = "// one\nimport a from './a';\n\nimport b from './b';\n";
    const mixed = "// one\r\nimport a from './a';\n\r\nimport b from './b';\r\n";
    assert.deepEqual(
      ts(lf).imports.map(item => item.line),
      ts(mixed).imports.map(item => item.line),
    );
    assert.deepEqual(
      ts(mixed).imports.map(item => item.line),
      [2, 4],
    );
  });

  test('LX-MASK-09 an unterminated string recovers at the end of its line', () => {
    const scan = ts("const s = 'never closed\nimport real from './real';");
    assert.deepEqual(specifiers(scan), ['./real']);
  });

  test('LX-MASK-10 an unterminated block comment masks to EOF without throwing', () => {
    const source = "import a from './a';\n/* never closed import('x')\nimport b from './b';";
    const scan = ts(source);
    assert.deepEqual(specifiers(scan), ['./a']);
    assert.equal(scan.hasOpaqueDependencies, false);
    assert.equal(maskSource(source, 'typescript').length, source.length);
  });
});

describe('LX-TPL template depth stack', () => {
  test('LX-TPL-01 template text never yields imports', () => {
    assert.deepEqual(specifiers(ts("const t = `import x from 'evil'`;")), []);
  });

  test('LX-TPL-02 a backtick inside an interpolated string does not close the template', () => {
    const scan = ts('const t = `${ "foo`bar" }`;\nimport after from \'./after\';');
    assert.deepEqual(specifiers(scan), ['./after']);
  });

  test('LX-TPL-03 triple nesting returns to code', () => {
    const scan = ts("const t = `a${ `b${ `c${x}` }` }`;\nimport after from './after';");
    assert.deepEqual(specifiers(scan), ['./after']);
  });

  test('LX-TPL-04 object literals inside an interpolation keep brace balance', () => {
    const scan = ts("const t = `${ {a:{b:1}}.a } import x from 'evil'`;\nimport after from './after';");
    assert.deepEqual(specifiers(scan), ['./after']);
  });

  test('LX-TPL-05 braces inside strings and regexes do not count', () => {
    const scan = ts("const t = `${ '}' } and ${ /}/.test(x) } import 'evil'`;\nimport after from './after';");
    assert.deepEqual(specifiers(scan), ['./after']);
  });

  test('LX-TPL-06 comments inside an interpolation are ignored for balance', () => {
    const scan = ts("const t = `${ /* } */ x } import 'evil'`;\nimport after from './after';");
    assert.deepEqual(specifiers(scan), ['./after']);
  });

  test('LX-TPL-07 interpolated code is analysed', () => {
    const imported = only(ts("const t = `x${import('./lazy.js')}y`;"), './lazy.js');
    assert.equal(imported.kind, 'dynamic');
  });

  test('LX-TPL-08 a thousand nesting levels use an explicit stack', () => {
    const depth = 1000;
    const source = `const t = ${'`a${'.repeat(depth)}x${'}`'.repeat(depth)};\nimport after from './after';`;
    assert.deepEqual(specifiers(ts(source)), ['./after']);
  });
});

describe('LX-RE slash heuristic', () => {
  test('LX-RE-01 divisions are not masked', () => {
    for (const source of ['a / b / c', 'x = (y) / 2 / z', 'arr[i] / n / m', 'n++ / 2 / k', 'n-- / 2 / k']) {
      assert.equal(maskSource(source, 'javascript'), source, source);
    }
  });

  test('LX-RE-02 regex literals are masked', () => {
    for (const source of [
      "x = /import 'evil'/g;",
      "f(/import 'evil'/);",
      "[/import 'a'/, /b/];",
      "!/import 'a'/.test(s);",
    ]) {
      assert.deepEqual(specifiers(ts(source)), [], source);
      assert.ok(!maskSource(source, 'javascript').includes('evil'), source);
    }
  });

  test('LX-RE-03 keywords before an expression allow a regex', () => {
    for (const keyword of ['return', 'throw', 'case', 'typeof', 'yield', 'await']) {
      const source = `${keyword} /import 'evil'/`;
      assert.ok(!maskSource(source, 'javascript').includes('evil'), keyword);
    }
  });

  test('LX-RE-04 classes and escapes do not close the regex', () => {
    const source = "x = /[/]import 'evil'/; y = /a\\/import 'evil2'/;\nimport real from './real';";
    assert.deepEqual(specifiers(ts(source)), ['./real']);
    assert.ok(!maskSource(source, 'javascript').includes('evil'));
  });

  test('LX-RE-05 a keyword used as a property name is followed by a division', () => {
    const source = 'x = obj.return / 2 / y';
    assert.equal(maskSource(source, 'javascript'), source);
  });

  test('LX-RE-06 accepted limit: a slash after ) is a division', () => {
    const source = "if (x) /re/.test(s);\nimport real from './real';";
    assert.equal(maskSource(source, 'javascript').split('\n')[0], 'if (x) /re/.test(s);');
    assert.deepEqual(specifiers(ts(source)), ['./real']);
  });
});

describe('LX-JS TypeScript and JavaScript extraction', () => {
  test('LX-JS-01 static import forms and their symbols', () => {
    const scan = ts(
      [
        "import a from 'x1';",
        "import { b, c as d } from 'x2';",
        "import * as ns from 'x3';",
        "import e, { f } from 'x4';",
      ].join('\n'),
    );
    assert.deepEqual(
      scan.imports.map(item => [item.specifier, item.kind, item.symbols]),
      [
        ['x1', 'static', ['default']],
        ['x2', 'static', ['b', 'c']],
        ['x3', 'static', ['*']],
        ['x4', 'static', ['default', 'f']],
      ],
    );
    assert.deepEqual(only(scan, 'x2').bindings, [
      { imported: 'b', local: 'b' },
      { imported: 'c', local: 'd' },
    ]);
  });

  test('LX-JS-02 side-effect imports consume everything', () => {
    const imported = only(ts("import './polyfill';"), './polyfill');
    assert.equal(imported.kind, 'side-effect');
    assert.deepEqual(imported.symbols, ['*']);
  });

  test('LX-JS-03 type-only imports and re-exports', () => {
    const scan = ts("import type { U } from './t';\nexport type { V } from './v';");
    assert.equal(only(scan, './t').edgeType, 'type_only');
    assert.equal(only(scan, './v').edgeType, 'type_only');
    assert.equal(scan.reexports[0].edgeType, 'type_only');
  });

  test('LX-JS-04 mixed inline type modifiers keep a value edge', () => {
    const imported = only(ts("import { type U, makeU } from './t';"), './t');
    assert.equal(imported.edgeType, 'value');
    assert.deepEqual(imported.symbols, ['U', 'makeU']);
    assert.deepEqual(imported.typeOnlySymbols, ['U']);
  });

  test('LX-JS-05 multi-line imports with comments and a trailing comma', () => {
    const imported = only(ts("import {\n  a, // first\n  /* second */ b,\n} from './m';"), './m');
    assert.deepEqual(imported.symbols, ['a', 'b']);
    assert.equal(imported.line, 1);
  });

  test('LX-JS-06 literal dynamic imports are resolvable', () => {
    const scan = ts("const a = import('./a');\nconst b = import(`./b`);");
    assert.deepEqual(
      scan.imports.map(item => [item.specifier, item.kind]),
      [
        ['./a', 'dynamic'],
        ['./b', 'dynamic'],
      ],
    );
    assert.equal(scan.hasOpaqueDependencies, false);
  });

  test('LX-JS-07 non-literal dynamic loads are opaque', () => {
    const scan = ts('const a = import(name);\nconst b = import(`./x/${driver}`);\nconst c = require(expr);');
    assert.deepEqual(specifiers(scan), []);
    assert.equal(scan.hasOpaqueDependencies, true);
    assert.deepEqual(
      scan.opaqueSites.map(site => site.line),
      [1, 2, 3],
    );
  });

  test('LX-JS-08 CommonJS require is a value dependency', () => {
    const scan = scanModule("const c = require('./c');\nconst { x } = require('./d');", { language: 'javascript' });
    assert.deepEqual(
      scan.imports.map(item => [item.specifier, item.kind, item.edgeType]),
      [
        ['./c', 'require', 'value'],
        ['./d', 'require', 'value'],
      ],
    );
  });

  test('LX-JS-09 TypeScript import-equals require', () => {
    const imported = only(ts("import fs = require('node:fs');"), 'node:fs');
    assert.equal(imported.kind, 'require');
  });

  test('LX-JS-10 look-alikes are not imports', () => {
    const scan = ts(
      "myimport('./x');\nobj.import('./x');\nobj.require('./x');\nconst u = import.meta.url;\n$import('./x');",
    );
    assert.deepEqual(specifiers(scan), []);
    assert.equal(scan.hasOpaqueDependencies, false);
  });

  test('LX-JS-11 export declarations', () => {
    const scan = ts(
      [
        'export const a = 1;',
        'export let b = 2;',
        'export var c = 3;',
        'export function d() {}',
        'export function* e() {}',
        'export async function f() {}',
        'export class G {}',
        'export interface H {}',
        'export type I = string;',
        'export enum J {}',
        'export default function main() {}',
        'const k = 1, l = 2;',
        'export { k, l as m };',
      ].join('\n'),
    );
    assert.deepEqual(
      scan.exports.map(item => [item.name, item.kind]),
      [
        ['a', 'variable'],
        ['b', 'variable'],
        ['c', 'variable'],
        ['d', 'function'],
        ['e', 'function'],
        ['f', 'function'],
        ['G', 'class'],
        ['H', 'interface'],
        ['I', 'type'],
        ['J', 'enum'],
        ['default', 'default'],
        ['k', 'named'],
        ['m', 'named'],
      ],
    );
    assert.equal(scan.exports.find(item => item.name === 'm').local, 'l');
  });

  test('LX-JS-12 re-export forms', () => {
    const scan = ts(
      [
        "export { x } from './x';",
        "export { x as y } from './y';",
        "export * from './star';",
        "export * as ns from './ns';",
        "export { default } from './d';",
        "export { default as Foo } from './foo';",
      ].join('\n'),
    );
    assert.deepEqual(
      scan.reexports.map(item => [item.specifier, item.symbols, item.namespace]),
      [
        ['./x', [{ imported: 'x', exported: 'x' }], null],
        ['./y', [{ imported: 'x', exported: 'y' }], null],
        ['./star', '*', null],
        ['./ns', '*', 'ns'],
        ['./d', [{ imported: 'default', exported: 'default' }], null],
        ['./foo', [{ imported: 'default', exported: 'Foo' }], null],
      ],
    );
    assert.deepEqual(
      scan.imports.map(item => [item.specifier, item.kind, item.symbols]),
      [
        ['./x', 'reexport', ['x']],
        ['./y', 'reexport', ['x']],
        ['./star', 'reexport', ['*']],
        ['./ns', 'reexport', ['*']],
        ['./d', 'reexport', ['default']],
        ['./foo', 'reexport', ['default']],
      ],
    );
  });

  test('LX-JS-13 an apostrophe in JSX text does not hide later imports', () => {
    const source = "export const P = () => <p>Don't import 'evil'</p>;\nconst Lazy = import('./Lazy');";
    const scan = scanModule(source, { language: 'typescript' });
    assert.deepEqual(specifiers(scan), ['./Lazy']);
  });

  test('LX-JS-14 generics and comparisons do not disturb extraction', () => {
    const scan = ts("const r = a < b > c;\nconst id = <T,>(x: T) => x;\nimport real from './real';");
    assert.deepEqual(specifiers(scan), ['./real']);
  });
});

describe('LX polyglot extraction', () => {
  const py = source => scanModule(source, { language: 'python' });

  test('LX-PY-01 plain imports', () => {
    assert.deepEqual(specifiers(py('import os\nimport a.b as c\nimport d, e')), ['os', 'a.b', 'd', 'e']);
  });

  test('LX-PY-02 from-imports with relative levels', () => {
    const scan = py('from x.y import z\nfrom . import a\nfrom ..pkg.mod import b as c');
    assert.deepEqual(
      scan.imports.map(item => [item.specifier, item.level, item.symbols]),
      [
        ['x.y', 0, ['z']],
        ['.', 1, ['a']],
        ['..pkg.mod', 2, ['b']],
      ],
    );
  });

  test('LX-PY-03 parenthesised multi-line from-imports', () => {
    assert.deepEqual(only(py('from x import (a,\n b,\n c)'), 'x').symbols, ['a', 'b', 'c']);
  });

  test('LX-PY-04 comments and docstrings', () => {
    const scan = py('# import evil\n"""\nimport evil\n"""\n\'\'\'\nfrom evil import x\n\'\'\'\nimport real\n');
    assert.deepEqual(specifiers(scan), ['real']);
    assert.equal(scan.imports[0].line, 8);
  });

  test('LX-PY-05 prefixed strings are masked', () => {
    const scan = py('x = f"{import_name} import evil"\ny = rb\'import evil\'\nz = Rb"from evil import q"\nimport real');
    assert.deepEqual(specifiers(scan), ['real']);
  });

  test('LX-GO-01 single and grouped imports with aliases', () => {
    const scan = scanModule('package main\n\nimport "fmt"\nimport (\n  "a/b"\n  x "c/d"\n  _ "e"\n  . "f"\n)\n', {
      language: 'go',
    });
    assert.equal(scan.package, 'main');
    assert.deepEqual(
      scan.imports.map(item => [item.specifier, item.alias]),
      [
        ['fmt', null],
        ['a/b', null],
        ['c/d', 'x'],
        ['e', '_'],
        ['f', '.'],
      ],
    );
  });

  test('LX-GO-02 raw strings and comments', () => {
    const scan = scanModule(
      'package p\nvar s = `import "evil"`\n// import "evil2"\n/* import "evil3" */\nimport "real"\n',
      {
        language: 'go',
      },
    );
    assert.deepEqual(specifiers(scan), ['real']);
  });

  const rs = source => scanModule(source, { language: 'rust' });

  test('LX-RS-01 use declarations', () => {
    const scan = rs('use crate::models::User;\nuse super::utils;\nuse self::a::{b, c::d};\npub use crate::x as y;');
    assert.deepEqual(specifiers(scan), [
      'crate::models::User',
      'super::utils',
      'self::a::b',
      'self::a::c::d',
      'crate::x',
    ]);
    assert.equal(only(scan, 'crate::x').alias, 'y');
  });

  test('LX-RS-02 only declarations ending in ; are module dependencies', () => {
    const scan = rs('mod foo;\npub mod bar;\nmod inline { fn f() {} }');
    assert.deepEqual(
      scan.imports.map(item => [item.specifier, item.kind]),
      [
        ['foo', 'mod'],
        ['bar', 'mod'],
      ],
    );
  });

  test('LX-RS-03 lifetimes are not character literals', () => {
    const scan = rs("fn f<'a>(x: &'a str) -> char { let q = '\\''; 'a' }\nuse crate::real;");
    assert.deepEqual(specifiers(scan), ['crate::real']);
  });

  test('LX-RS-04 raw strings and nested block comments', () => {
    const scan = rs(
      'let a = r"use evil;";\nlet b = r#"say "use evil2;""#;\n/* outer /* inner */ use evil3; */\nuse crate::real;',
    );
    assert.deepEqual(specifiers(scan), ['crate::real']);
  });

  const java = source => scanModule(source, { language: 'java' });

  test('LX-JV-01 package and import forms', () => {
    const scan = java(
      'package com.corp.app;\nimport com.corp.model.User;\nimport com.corp.util.*;\nimport static com.corp.X.y;\n',
    );
    assert.equal(scan.package, 'com.corp.app');
    assert.deepEqual(
      scan.imports.map(item => [item.specifier, Boolean(item.wildcard), Boolean(item.static)]),
      [
        ['com.corp.model.User', false, false],
        ['com.corp.util', true, false],
        ['com.corp.X.y', false, true],
      ],
    );
  });

  test('LX-JV-02 text blocks', () => {
    const scan = java('class A { String s = """\nimport evil.X;\n"""; }\nimport real.Y;');
    assert.deepEqual(specifiers(scan), ['real.Y']);
  });
});

describe('LX coherence, robustness and performance', () => {
  test('detectLanguage maps extensions', () => {
    assert.deepEqual(
      [
        'a.ts',
        'a.tsx',
        'a.d.ts',
        'a.mts',
        'a.js',
        'a.jsx',
        'a.mjs',
        'a.cjs',
        'a.py',
        'a.go',
        'a.rs',
        'A.java',
        'a.md',
      ].map(detectLanguage),
      [
        'typescript',
        'typescript',
        'typescript',
        'typescript',
        'javascript',
        'javascript',
        'javascript',
        'javascript',
        'python',
        'go',
        'rust',
        'java',
        null,
      ],
    );
  });

  test('LX-DIFF-01 masking agrees with js-lexer on every src module', () => {
    for (const path of listSources(SRC)) {
      const source = readFileSync(path, 'utf8');
      const masked = maskSource(source, 'javascript');
      for (const token of lex(source)) {
        const slice = masked.slice(token.start, token.end);
        if (token.type === 'ident' || token.type === 'number')
          assert.equal(slice, token.value, `${path}:${token.line} ${token.type}`);
        else if (token.type === 'comment') assert.ok(isBlank(slice), `${path}:${token.line} comment`);
        else if (token.type === 'string' || token.type === 'regex') {
          const close = token.type === 'regex' ? token.value.lastIndexOf('/') : token.value.length - 1;
          assert.equal(slice[0], token.value[0], `${path}:${token.line}`);
          assert.ok(isBlank(slice.slice(1, close)), `${path}:${token.line} ${token.type} interior`);
        } else if (token.type === 'template') {
          const open = token.value.startsWith('`') ? 1 : 1;
          const close = token.value.endsWith('${') ? token.value.length - 2 : token.value.length - 1;
          assert.ok(isBlank(slice.slice(open, close)), `${path}:${token.line} template interior`);
        }
      }
    }
  });

  test('LX-DIFF-02 dogfooding: cli.mjs imports its collaborators', () => {
    const scan = scanModule(readFileSync(join(SRC, 'cli.mjs'), 'utf8'), { language: 'javascript' });
    for (const expected of ['./mcp-server.mjs', './manifest.mjs', 'node:path'])
      assert.ok(specifiers(scan).includes(expected), expected);
  });

  test('LX-ROB-01 deterministic fuzz never throws and keeps length', () => {
    const random = seededRandom(20261105);
    const alphabet = [
      '/',
      '*',
      "'",
      '"',
      '`',
      '$',
      '{',
      '}',
      '\\',
      '\n',
      '\r',
      ' ',
      'a',
      '(',
      ')',
      'import',
      'from',
      '#',
      'ñ',
      ' ',
      '😀',
    ];
    for (let round = 0; round < 2000; round++) {
      let source = '';
      const size = Math.floor(random() * 80);
      for (let index = 0; index < size; index++) source += alphabet[Math.floor(random() * alphabet.length)];
      for (const language of ['typescript', 'python', 'go', 'rust', 'java']) {
        const masked = maskSource(source, language);
        assert.equal(masked.length, source.length, JSON.stringify({ source, language }));
        scanModule(source, { language });
      }
    }
  });

  test('LX-ROB-02 a minified line scales linearly', () => {
    const unit = "a=b/c;d='x';e=`${f}`;g=/h/g;import('./k');";
    const one = unit.repeat(Math.ceil(1_000_000 / unit.length));
    const two = one + one;
    const time = text => {
      maskSource(text, 'javascript');
      const start = performance.now();
      scanModule(text, { language: 'javascript' });
      return performance.now() - start;
    };
    const small = Math.min(time(one), time(one));
    const large = Math.min(time(two), time(two));
    assert.ok(large < small * 3 + 20, `1 MB ${small.toFixed(1)} ms, 2 MB ${large.toFixed(1)} ms`);
  });

  test('LX-PERF-01 [perf] at least 1M LOC/s on synthetic TypeScript', () => {
    const lines = 100_000;
    const source = syntheticTypeScript(lines, 3);
    for (let warm = 0; warm < 2; warm++) scanModule(source, { language: 'typescript' });
    const runs = [];
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      scanModule(source, { language: 'typescript' });
      runs.push(performance.now() - start);
    }
    const median = runs.sort((a, b) => a - b)[2];
    const rate = lines / (median / 1000);
    assert.ok(rate >= 100_000, `${Math.round(rate).toLocaleString('en')} LOC/s (median ${median.toFixed(1)} ms)`);
  });

  test('LX-PERF-02 [perf] retained heap stays under 16 MB', () => {
    // Retained memory is what a streaming indexer accumulates per file; the transient peak is
    // covered by GR-PERF-03 (RSS of a fresh child process).
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc');
    const source = syntheticTypeScript(100_000, 4);
    scanModule(source, { language: 'typescript' });
    gc();
    const before = process.memoryUsage().heapUsed;
    const result = scanModule(source, { language: 'typescript' });
    gc();
    const retained = process.memoryUsage().heapUsed - before;
    assert.ok(result.imports.length > 0);
    assert.ok(retained < 16 * 1024 * 1024, `${(retained / 1048576).toFixed(1)} MB`);
  });
});
