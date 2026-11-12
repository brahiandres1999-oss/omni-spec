// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${configDir} is the literal tsconfig placeholder (TypeScript 5.5).
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createResolver, parseJsonc, parsePnpmWorkspace } from '../src/cartography/resolver.mjs';
import { makeRepo } from '../test-support/cartography-fixtures.mjs';

let repo;
beforeEach(() => {
  repo = makeRepo('omni-resolver-');
});
afterEach(() => repo.cleanup());

const resolverFor = (files, options) => createResolver(repo.tree(files).root, options);
const target = (resolver, specifier, importer = 'src/main.ts', language) =>
  resolver.resolve(specifier, importer, language);
const pathOf = result => {
  assert.equal(result.kind, 'internal', JSON.stringify(result));
  return result.path;
};
const codes = resolver => resolver.warnings.map(warning => warning.code);

describe('RS-REL relative specifiers and probing', () => {
  test('RS-REL-01 extension probing order prefers TypeScript', () => {
    const resolver = resolverFor({
      'src/main.ts': '',
      'src/a.ts': '',
      'src/a.js': '',
      'src/b.jsx': '',
      'src/c.d.ts': '',
    });
    assert.equal(pathOf(target(resolver, './a')), 'src/a.ts');
    assert.equal(pathOf(target(resolver, './b')), 'src/b.jsx');
    assert.equal(pathOf(target(resolver, './c')), 'src/c.d.ts');
  });

  test('RS-REL-02 directory index', () => {
    const resolver = resolverFor({ 'src/main.ts': '', 'src/dir/index.ts': '' });
    assert.equal(pathOf(target(resolver, './dir')), 'src/dir/index.ts');
  });

  test('RS-REL-03 TypeScript ESM convention maps .js to the TypeScript source', () => {
    const resolver = resolverFor({
      'src/main.ts': '',
      'src/a.ts': '',
      'src/b.mts': '',
      'src/c.cts': '',
      'src/d.tsx': '',
      'src/e.tsx': '',
    });
    assert.equal(pathOf(target(resolver, './a.js')), 'src/a.ts');
    assert.equal(pathOf(target(resolver, './b.mjs')), 'src/b.mts');
    assert.equal(pathOf(target(resolver, './c.cjs')), 'src/c.cts');
    assert.equal(pathOf(target(resolver, './d.js')), 'src/d.tsx');
    assert.equal(pathOf(target(resolver, './e.jsx')), 'src/e.tsx');
  });

  test('RS-REL-04 an existing exact file wins', () => {
    const resolver = resolverFor({ 'src/main.ts': '', 'src/a.ts': '', 'src/a.js': '' });
    assert.equal(pathOf(target(resolver, './a.js')), 'src/a.js');
  });

  test('RS-REL-05 never leaves the root', () => {
    const resolver = resolverFor({ 'src/main.ts': '' });
    assert.deepEqual(target(resolver, '../../outside'), { kind: 'unresolved', specifier: '../../outside' });
  });

  test('RS-REL-06 paths are POSIX relative', () => {
    const resolver = resolverFor({ 'src/deep/main.ts': '', 'src/a.ts': '' });
    assert.equal(pathOf(target(resolver, '../a', 'src/deep/main.ts')), 'src/a.ts');
  });

  test('RS-REL-07 case mismatch resolves to the on-disk name with a warning', () => {
    const resolver = resolverFor({ 'src/main.ts': '', 'src/button.tsx': '' }, { caseInsensitive: true });
    const result = target(resolver, './Button');
    assert.equal(pathOf(result), 'src/button.tsx');
    assert.deepEqual(result.flags, ['case-mismatch']);
    const strict = createResolver(repo.root, { caseInsensitive: false });
    assert.equal(target(strict, './Button').kind, 'unresolved');
  });

  test('RS-REL-08 builtins and packages are external without probing', () => {
    const resolver = resolverFor({ 'src/main.ts': '', 'react.ts': '', 'fs.ts': '' });
    assert.deepEqual(target(resolver, 'node:fs'), { kind: 'external', name: 'node:fs' });
    assert.deepEqual(target(resolver, 'fs'), { kind: 'external', name: 'fs' });
    assert.deepEqual(target(resolver, 'react'), { kind: 'external', name: 'react' });
    assert.deepEqual(target(resolver, '@scope/pkg/sub'), { kind: 'external', name: '@scope/pkg' });
  });
});

describe('RS-TS tsconfig and jsconfig', () => {
  const base = { 'src/main.ts': '', 'src/a.ts': '' };

  test('RS-TS-01 longest prefix wins regardless of declaration order', () => {
    const resolver = resolverFor({
      ...base,
      'src/modules/billing/tax.ts': '',
      'src/features/billing/tax.ts': '',
      'src/billing/tax.ts': '',
      'tsconfig.json': {
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/features/billing/*': ['src/modules/billing/*'],
            '@/features/*': ['src/features/*'],
            '@/*': ['src/*'],
          },
        },
      },
    });
    assert.equal(pathOf(target(resolver, '@/features/billing/tax')), 'src/modules/billing/tax.ts');
    const reversed = makeRepo('omni-resolver-rev-');
    try {
      reversed.tree({
        'src/main.ts': '',
        'src/modules/billing/tax.ts': '',
        'tsconfig.json': {
          compilerOptions: {
            baseUrl: '.',
            paths: {
              '@/*': ['src/*'],
              '@/features/*': ['src/features/*'],
              '@/features/billing/*': ['src/modules/billing/*'],
            },
          },
        },
      });
      assert.equal(
        pathOf(createResolver(reversed.root).resolve('@/features/billing/tax', 'src/main.ts')),
        'src/modules/billing/tax.ts',
      );
    } finally {
      reversed.cleanup();
    }
  });

  test('RS-TS-02 an exact pattern beats a wildcard', () => {
    const resolver = resolverFor({
      ...base,
      'src/special.ts': '',
      'src/config/index.ts': '',
      'tsconfig.json': {
        compilerOptions: { baseUrl: '.', paths: { 'config*': ['src/config*'], config: ['src/special.ts'] } },
      },
    });
    assert.equal(pathOf(target(resolver, 'config')), 'src/special.ts');
  });

  test('RS-TS-03 the first existing target is used', () => {
    const resolver = resolverFor({
      ...base,
      'generated/x.ts': '',
      'tsconfig.json': { compilerOptions: { baseUrl: '.', paths: { '#gen/*': ['src/*', 'generated/*'] } } },
    });
    assert.equal(pathOf(target(resolver, '#gen/x')), 'generated/x.ts');
  });

  test('RS-TS-04 patterns with a suffix', () => {
    const resolver = resolverFor({
      ...base,
      'styles/theme.css': '',
      'tsconfig.json': { compilerOptions: { baseUrl: '.', paths: { '*.css': ['styles/*.css'] } } },
    });
    assert.equal(pathOf(target(resolver, 'theme.css')), 'styles/theme.css');
  });

  test('RS-TS-05 paths without baseUrl are relative to the declaring tsconfig', () => {
    const resolver = resolverFor({
      'app/src/main.ts': '',
      'app/src/lib/x.ts': '',
      'app/tsconfig.json': { compilerOptions: { paths: { '~/*': ['./src/*'] } } },
    });
    assert.equal(pathOf(target(resolver, '~/lib/x', 'app/src/main.ts')), 'app/src/lib/x.ts');
  });

  test('RS-TS-06 baseUrl fallback for bare specifiers', () => {
    const resolver = resolverFor({
      ...base,
      'src/components/Button.tsx': '',
      'tsconfig.json': { compilerOptions: { baseUrl: 'src' } },
    });
    assert.equal(pathOf(target(resolver, 'components/Button')), 'src/components/Button.tsx');
    assert.deepEqual(target(resolver, 'lodash'), { kind: 'external', name: 'lodash' });
  });

  test('RS-TS-07 extends chain inherits baseUrl relative to its declaring config', () => {
    const resolver = resolverFor({
      ...base,
      'lib/shared/x.ts': '',
      'config/base/tsconfig.root.json': {
        compilerOptions: { baseUrl: '../../lib', paths: { '@shared/*': ['shared/*'] } },
      },
      'config/tsconfig.mid.json': { extends: './base/tsconfig.root.json' },
      'tsconfig.json': { extends: './config/tsconfig.mid.json' },
    });
    assert.equal(pathOf(target(resolver, '@shared/x')), 'lib/shared/x.ts');
  });

  test('RS-TS-08 child paths replace inherited paths', () => {
    const resolver = resolverFor({
      ...base,
      'src/b/y.ts': '',
      'src/a/x.ts': '',
      'tsconfig.base.json': { compilerOptions: { baseUrl: '.', paths: { '@a/*': ['src/a/*'] } } },
      'tsconfig.json': { extends: './tsconfig.base.json', compilerOptions: { paths: { '@b/*': ['src/b/*'] } } },
    });
    assert.equal(pathOf(target(resolver, '@b/y')), 'src/b/y.ts');
    assert.notEqual(target(resolver, '@a/x').kind, 'internal');
  });

  test('RS-TS-09 extends arrays apply in order and the last wins', () => {
    const resolver = resolverFor({
      ...base,
      'src/one/x.ts': '',
      'src/two/x.ts': '',
      'one.json': { compilerOptions: { baseUrl: '.', paths: { '@x/*': ['src/one/*'] } } },
      'two.json': { compilerOptions: { baseUrl: '.', paths: { '@x/*': ['src/two/*'] } } },
      'tsconfig.json': { extends: ['./one.json', './two.json'] },
    });
    assert.equal(pathOf(target(resolver, '@x/x')), 'src/two/x.ts');
  });

  test('RS-TS-10 package extends from node_modules, missing ones only warn', () => {
    const resolver = resolverFor({
      ...base,
      'node_modules/@tsconfig/strict/tsconfig.json': { compilerOptions: { baseUrl: '../../../src' } },
      'tsconfig.json': { extends: '@tsconfig/strict/tsconfig.json' },
    });
    assert.equal(pathOf(target(resolver, 'a')), 'src/a.ts');
    const missing = makeRepo('omni-resolver-missing-');
    try {
      missing.tree({ 'src/main.ts': '', 'src/a.ts': '', 'tsconfig.json': { extends: '@tsconfig/absent' } });
      const fallback = createResolver(missing.root);
      assert.equal(pathOf(fallback.resolve('./a', 'src/main.ts')), 'src/a.ts');
      assert.ok(codes(fallback).includes('TSCONFIG_EXTENDS_MISSING'));
    } finally {
      missing.cleanup();
    }
  });

  test('RS-TS-11 extends cycles stop with a warning', () => {
    const resolver = resolverFor({
      ...base,
      'a.json': { extends: './b.json', compilerOptions: { baseUrl: 'src' } },
      'b.json': { extends: './a.json' },
      'tsconfig.json': { extends: './a.json' },
    });
    assert.equal(pathOf(target(resolver, 'a')), 'src/a.ts');
    assert.ok(codes(resolver).includes('TSCONFIG_EXTENDS_CYCLE'));
  });

  test('RS-TS-12 ${configDir} is the directory of the leaf config', () => {
    const resolver = resolverFor({
      'apps/web/src/main.ts': '',
      'apps/web/src/lib/x.ts': '',
      'tsconfig.shared.json': { compilerOptions: { paths: { '@/*': ['${configDir}/src/*'] } } },
      'apps/web/tsconfig.json': { extends: '../../tsconfig.shared.json' },
    });
    assert.equal(pathOf(target(resolver, '@/lib/x', 'apps/web/src/main.ts')), 'apps/web/src/lib/x.ts');
  });

  test('RS-TS-13 JSONC with comments, trailing commas and comment-like strings', () => {
    const text = `{
      // line comment
      "compilerOptions": {
        /* block */
        "baseUrl": ".",
        "paths": { "@/*": ["./src/*"], "~/*": ["./src/*",], },
        "homepage": "https://example.com/a",
      },
    }`;
    assert.deepEqual(parseJsonc(text), {
      compilerOptions: {
        baseUrl: '.',
        paths: { '@/*': ['./src/*'], '~/*': ['./src/*'] },
        homepage: 'https://example.com/a',
      },
    });
    const resolver = resolverFor({ ...base, 'tsconfig.json': text });
    assert.equal(pathOf(target(resolver, '@/a')), 'src/a.ts');
  });

  test('RS-TS-14 jsconfig.json is used when there is no tsconfig', () => {
    const resolver = resolverFor({
      'src/main.js': '',
      'src/lib/x.js': '',
      'jsconfig.json': { compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } },
    });
    assert.equal(pathOf(target(resolver, '@/lib/x', 'src/main.js', 'javascript')), 'src/lib/x.js');
  });

  test('RS-TS-15 each importer uses its nearest tsconfig', () => {
    const resolver = resolverFor({
      'apps/web/src/main.ts': '',
      'apps/web/src/x.ts': '',
      'packages/ui/src/main.ts': '',
      'packages/ui/src/x.ts': '',
      'apps/web/tsconfig.json': { compilerOptions: { paths: { '@/*': ['./src/*'] } } },
      'packages/ui/tsconfig.json': { compilerOptions: { paths: { '@/*': ['./src/*'] } } },
    });
    assert.equal(pathOf(target(resolver, '@/x', 'apps/web/src/main.ts')), 'apps/web/src/x.ts');
    assert.equal(pathOf(target(resolver, '@/x', 'packages/ui/src/main.ts')), 'packages/ui/src/x.ts');
  });

  test('RS-TS-16 a malformed tsconfig warns and keeps relative resolution', () => {
    const resolver = resolverFor({ ...base, 'tsconfig.json': '{ "compilerOptions": ' });
    assert.equal(pathOf(target(resolver, './a')), 'src/a.ts');
    assert.ok(codes(resolver).includes('TSCONFIG_INVALID'));
  });
});

describe('RS-PKG package.json imports', () => {
  test('RS-PKG-01 exact targets are relative to the package.json directory', () => {
    const resolver = resolverFor({
      'svc/package.json': { name: 'svc', imports: { '#db': './src/db/index.js' } },
      'svc/src/db/index.js': '',
      'svc/src/main.js': '',
      'tsconfig.json': { compilerOptions: { baseUrl: 'elsewhere' } },
    });
    assert.equal(pathOf(target(resolver, '#db', 'svc/src/main.js', 'javascript')), 'svc/src/db/index.js');
  });

  test('RS-PKG-02 wildcard targets with the .js to .ts convention', () => {
    const resolver = resolverFor({
      'package.json': { imports: { '#utils/*': './src/utils/*.js' } },
      'src/utils/date.ts': '',
      'src/main.ts': '',
    });
    assert.equal(pathOf(target(resolver, '#utils/date')), 'src/utils/date.ts');
  });

  test('RS-PKG-03 conditions follow the fixed order', () => {
    const resolver = resolverFor({
      'package.json': {
        imports: {
          '#a': { default: './src/default.js', import: './src/import.js', types: './src/types.ts' },
          '#b': { require: './src/require.js', default: './src/default.js' },
        },
      },
      'src/default.js': '',
      'src/import.js': '',
      'src/types.ts': '',
      'src/require.js': '',
      'src/main.ts': '',
    });
    assert.equal(pathOf(target(resolver, '#a')), 'src/types.ts');
    assert.equal(pathOf(target(resolver, '#b')), 'src/require.js');
  });

  test('RS-PKG-04 the nearest package.json scope applies', () => {
    const resolver = resolverFor({
      'package.json': { imports: { '#x': './root-x.js' } },
      'root-x.js': '',
      'pkg/package.json': { name: 'pkg', imports: { '#x': './inner-x.js' } },
      'pkg/inner-x.js': '',
      'pkg/main.js': '',
    });
    assert.equal(pathOf(target(resolver, '#x', 'pkg/main.js', 'javascript')), 'pkg/inner-x.js');
  });

  test('RS-PKG-05 undeclared subpath imports are unresolved', () => {
    const resolver = resolverFor({ 'package.json': { imports: {} }, 'src/main.ts': '' });
    assert.deepEqual(target(resolver, '#missing'), { kind: 'unresolved', specifier: '#missing' });
  });
});

describe('RS-WS monorepo workspaces', () => {
  const shared = {
    'packages/shared/package.json': {
      name: '@myorg/shared',
      exports: { '.': './src/index.ts', './utils': './src/utils.ts', './features/*': './src/features/*.ts' },
    },
    'packages/shared/src/index.ts': '',
    'packages/shared/src/utils.ts': '',
    'packages/shared/src/features/a.ts': '',
    'apps/web/package.json': { name: 'web', dependencies: { '@myorg/shared': 'workspace:*' } },
    'apps/web/src/main.ts': '',
  };
  const importer = 'apps/web/src/main.ts';

  test('RS-WS-01 pnpm-workspace.yaml with globs, quotes, comments and negation', () => {
    const yaml = "# workspace\npackages:\n  - 'apps/*'\n  - \"packages/**\"   # all depths\n  - '!**/test/**'\n";
    assert.deepEqual(parsePnpmWorkspace(yaml), ['apps/*', 'packages/**', '!**/test/**']);
    const resolver = resolverFor({
      ...shared,
      'pnpm-workspace.yaml': yaml,
      'packages/nested/deep/package.json': { name: '@myorg/deep' },
      'packages/nested/deep/index.ts': '',
      'packages/test/fixture/package.json': { name: '@myorg/fixture' },
      'packages/test/fixture/index.ts': '',
    });
    assert.deepEqual([...resolver.workspaces.keys()].sort(), ['@myorg/deep', '@myorg/shared', 'web']);
  });

  test('RS-WS-02 npm array and yarn object workspaces', () => {
    for (const workspaces of [['packages/*', 'apps/*'], { packages: ['packages/*', 'apps/*'] }]) {
      const local = makeRepo('omni-resolver-ws-');
      try {
        local.tree({ ...shared, 'package.json': { name: 'root', private: true, workspaces } });
        assert.deepEqual([...createResolver(local.root).workspaces.keys()].sort(), ['@myorg/shared', 'web']);
      } finally {
        local.cleanup();
      }
    }
  });

  test('RS-WS-03 workspace:* packages resolve to local sources without node_modules', () => {
    const resolver = resolverFor({ ...shared, 'package.json': { workspaces: ['packages/*', 'apps/*'] } });
    assert.equal(pathOf(target(resolver, '@myorg/shared', importer)), 'packages/shared/src/index.ts');
  });

  test('RS-WS-04 subpath exports, exact and wildcard', () => {
    const resolver = resolverFor({ ...shared, 'package.json': { workspaces: ['packages/*', 'apps/*'] } });
    assert.equal(pathOf(target(resolver, '@myorg/shared/utils', importer)), 'packages/shared/src/utils.ts');
    assert.equal(pathOf(target(resolver, '@myorg/shared/features/a', importer)), 'packages/shared/src/features/a.ts');
    assert.equal(target(resolver, '@myorg/shared/private', importer).kind, 'unresolved');
  });

  test('RS-WS-05 exports into an unbuilt dist fall back to src', () => {
    const resolver = resolverFor({
      'package.json': { workspaces: ['packages/*'] },
      'packages/core/package.json': {
        name: '@myorg/core',
        exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      },
      'packages/core/src/index.ts': '',
      'src/main.ts': '',
    });
    const result = target(resolver, '@myorg/core');
    assert.equal(pathOf(result), 'packages/core/src/index.ts');
    assert.deepEqual(result.flags, ['unbuilt']);
  });

  test('RS-WS-06 packages without exports use main, module, types, then index', () => {
    const resolver = resolverFor({
      'package.json': { workspaces: ['packages/*'] },
      'packages/a/package.json': { name: 'a', main: './lib/main.js' },
      'packages/a/lib/main.js': '',
      'packages/b/package.json': { name: 'b', types: './src/types.ts' },
      'packages/b/src/types.ts': '',
      'packages/c/package.json': { name: 'c' },
      'packages/c/index.ts': '',
      'src/main.ts': '',
    });
    assert.equal(pathOf(target(resolver, 'a')), 'packages/a/lib/main.js');
    assert.equal(pathOf(target(resolver, 'b')), 'packages/b/src/types.ts');
    assert.equal(pathOf(target(resolver, 'c')), 'packages/c/index.ts');
  });

  test('RS-WS-07 packages outside the workspaces stay external', () => {
    const resolver = resolverFor({
      'package.json': { workspaces: ['packages/*'] },
      'node_modules/left-pad/package.json': { name: 'left-pad', main: 'index.js' },
      'node_modules/left-pad/index.js': '',
      'src/main.ts': '',
    });
    assert.deepEqual(target(resolver, 'left-pad'), { kind: 'external', name: 'left-pad' });
  });

  test('RS-WS-08 duplicate workspace names warn and the first path wins', () => {
    const resolver = resolverFor({
      'package.json': { workspaces: ['packages/*'] },
      'packages/b-copy/package.json': { name: 'dup' },
      'packages/b-copy/index.ts': '',
      'packages/a-orig/package.json': { name: 'dup' },
      'packages/a-orig/index.ts': '',
      'src/main.ts': '',
    });
    assert.equal(pathOf(target(resolver, 'dup')), 'packages/a-orig/index.ts');
    assert.ok(codes(resolver).includes('WORKSPACE_DUPLICATE_NAME'));
  });

  test('RS-WS-09 the inter-package graph connects without install or symlinks', () => {
    const resolver = resolverFor({ ...shared, 'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n' });
    assert.equal(resolver.workspaces.get('@myorg/shared'), 'packages/shared');
    assert.equal(pathOf(target(resolver, '@myorg/shared/utils', importer)), 'packages/shared/src/utils.ts');
  });
});

describe('RS polyglot resolvers', () => {
  test('RS-PY-01 relative from-imports', () => {
    const resolver = resolverFor({
      'app/sub/a.py': '',
      'app/pkg/mod.py': '',
      'app/pkg/__init__.py': '',
      'app/sub/b/__init__.py': '',
    });
    const resolve = record => resolver.resolveImport(record, 'app/sub/a.py', 'python').map(pathOf);
    assert.deepEqual(resolve({ specifier: '..pkg.mod', level: 2, symbols: ['x'] }), ['app/pkg/mod.py']);
    assert.deepEqual(resolve({ specifier: '.', level: 1, symbols: ['b'] }), ['app/sub/b/__init__.py']);
    assert.deepEqual(resolve({ specifier: '..pkg', level: 2, symbols: ['mod'] }), ['app/pkg/mod.py']);
  });

  test('RS-PY-02 absolute imports from package roots, third parties external', () => {
    const resolver = resolverFor({
      'pyproject.toml': '[project]\nname = "svc"\n',
      'src/app/__init__.py': '',
      'src/app/core.py': '',
      'src/app/main.py': '',
    });
    const resolve = specifier =>
      resolver.resolveImport({ specifier, level: 0, symbols: ['*'] }, 'src/app/main.py', 'python');
    assert.deepEqual(resolve('app.core').map(pathOf), ['src/app/core.py']);
    assert.deepEqual(resolve('requests'), [{ kind: 'external', name: 'requests' }]);
  });

  test('RS-GO-01 module-prefixed imports point at the package files', () => {
    const resolver = resolverFor({
      'go.mod': 'module github.com/acme/svc\n\ngo 1.22\n',
      'cmd/main.go': '',
      'pkg/auth/auth.go': '',
      'pkg/auth/token.go': '',
      'pkg/auth/auth_test.go': '',
    });
    const results = resolver.resolveImport({ specifier: 'github.com/acme/svc/pkg/auth' }, 'cmd/main.go', 'go');
    assert.deepEqual(results.map(pathOf), ['pkg/auth/auth.go', 'pkg/auth/token.go']);
  });

  test('RS-GO-02 standard library and other modules are external', () => {
    const resolver = resolverFor({ 'go.mod': 'module github.com/acme/svc\n', 'main.go': '' });
    for (const specifier of ['fmt', 'net/http', 'github.com/other/lib'])
      assert.deepEqual(resolver.resolveImport({ specifier }, 'main.go', 'go'), [{ kind: 'external', name: specifier }]);
  });

  test('RS-RS-01 mod declarations', () => {
    const resolver = resolverFor({
      'Cargo.toml': '[package]\nname = "app"\n',
      'src/lib.rs': '',
      'src/foo.rs': '',
      'src/bar/mod.rs': '',
      'src/foo/inner.rs': '',
    });
    const resolve = (specifier, importer) =>
      resolver.resolveImport({ specifier, kind: 'mod' }, importer, 'rust').map(pathOf);
    assert.deepEqual(resolve('foo', 'src/lib.rs'), ['src/foo.rs']);
    assert.deepEqual(resolve('bar', 'src/lib.rs'), ['src/bar/mod.rs']);
    assert.deepEqual(resolve('inner', 'src/foo.rs'), ['src/foo/inner.rs']);
  });

  test('RS-RS-02 use paths and external crates', () => {
    const resolver = resolverFor({
      'Cargo.toml': '[package]\nname = "app"\n',
      'src/main.rs': '',
      'src/models.rs': '',
      'src/net/mod.rs': '',
      'src/net/http.rs': '',
    });
    const resolve = (specifier, importer = 'src/main.rs') =>
      resolver.resolveImport({ specifier, kind: 'use' }, importer, 'rust');
    assert.deepEqual(resolve('crate::models::User').map(pathOf), ['src/models.rs']);
    assert.deepEqual(resolve('crate::net::http::get').map(pathOf), ['src/net/http.rs']);
    assert.deepEqual(resolve('super::models', 'src/net/mod.rs').map(pathOf), ['src/models.rs']);
    assert.deepEqual(resolve('super::http', 'src/net/http.rs').map(pathOf), ['src/net/http.rs']);
    assert.deepEqual(resolve('self::http', 'src/net/mod.rs').map(pathOf), ['src/net/http.rs']);
    assert.deepEqual(resolve('serde::Deserialize'), [{ kind: 'external', name: 'serde' }]);
  });

  test('RS-JV-01 class imports map to source roots', () => {
    const resolver = resolverFor({
      'src/main/java/com/corp/model/User.java': '',
      'src/main/java/com/corp/app/App.java': '',
      'src/test/java/com/corp/model/UserFixture.java': '',
    });
    const resolve = specifier => resolver.resolveImport({ specifier }, 'src/main/java/com/corp/app/App.java', 'java');
    assert.deepEqual(resolve('com.corp.model.User').map(pathOf), ['src/main/java/com/corp/model/User.java']);
    assert.deepEqual(resolve('com.corp.model.UserFixture').map(pathOf), [
      'src/test/java/com/corp/model/UserFixture.java',
    ]);
    assert.deepEqual(resolve('java.util.List'), [{ kind: 'external', name: 'java.util' }]);
  });

  test('RS-JV-02 wildcard imports reach every class of the package', () => {
    const resolver = resolverFor({
      'src/main/java/com/corp/util/A.java': '',
      'src/main/java/com/corp/util/B.java': '',
      'src/main/java/com/corp/util/sub/C.java': '',
      'src/main/java/com/corp/app/App.java': '',
    });
    const results = resolver.resolveImport(
      { specifier: 'com.corp.util', wildcard: true },
      'src/main/java/com/corp/app/App.java',
      'java',
    );
    assert.deepEqual(results.map(pathOf), ['src/main/java/com/corp/util/A.java', 'src/main/java/com/corp/util/B.java']);
  });
});
