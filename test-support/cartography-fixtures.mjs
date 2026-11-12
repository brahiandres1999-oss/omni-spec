import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Deterministic PRNG (mulberry32) so generated fixtures are identical on every run. */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Temporary repository with helpers to write and remove files by POSIX relative path. */
export function makeRepo(prefix = 'omni-carto-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const repo = {
    root,
    write(path, content = '') {
      const absolute = join(root, ...path.split('/'));
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
      return repo;
    },
    tree(files) {
      for (const [path, content] of Object.entries(files)) repo.write(path, content);
      return repo;
    },
    remove(path) {
      unlinkSync(join(root, ...path.split('/')));
      return repo;
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
  return repo;
}

const SNIPPETS = [
  index => `const label${index} = 'import x from "not-a-dep"'; // import fake from 'evil'`,
  index => `export function compute${index}(a, b) { return a / b / ${index + 1}; }`,
  index => `const pattern${index} = /import\\s+[a-z]+\\/from/g;`,
  index => `const view${index} = \`<p>\${value${index % 7}} / \${ "a\`b" }</p>\`;`,
  index => `/* block import 'evil-${index}'\n   continues */ let n${index} = ${index};`,
  index => `if (n${index % 5} > 2) { total += n${index % 5} / 2; }`,
  index => `export const item${index} = { id: ${index}, name: "item-${index}", tags: ['a', 'b'] };`,
  index => `async function load${index}() { return import('./lazy-${index % 3}.js'); }`,
];

/** Synthetic TypeScript of exactly `lines` lines mixing imports, strings, templates, regexes and comments. */
export function syntheticTypeScript(lines, seed = 1) {
  const random = seededRandom(seed);
  const out = [
    "import { readFile } from 'node:fs/promises';",
    "import type { Config } from './config.js';",
    "import * as utils from '@/shared/utils';",
  ];
  while (out.length < lines) {
    const snippet = SNIPPETS[Math.floor(random() * SNIPPETS.length)](out.length);
    for (const line of snippet.split('\n')) if (out.length < lines) out.push(line);
  }
  return out.join('\n');
}

/**
 * Writes a deterministic TypeScript monorepo: `packages` workspace packages plus an app, `files`
 * modules in total with about `loc` lines each, aliases through tsconfig paths and cross-package
 * imports through package names.
 */
export function writeSyntheticMonorepo(root, { files = 4000, loc = 125, packages = 3, seed = 7 } = {}) {
  const random = seededRandom(seed);
  const write = (path, content) => {
    const absolute = join(root, ...path.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  };
  const names = Array.from({ length: packages }, (_, index) => `pkg${index}`);
  write('package.json', JSON.stringify({ name: 'synthetic', private: true, workspaces: ['packages/*', 'apps/*'] }));
  write(
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['apps/web/src/*'] } } }, null, 2),
  );
  for (const name of names)
    write(
      `packages/${name}/package.json`,
      JSON.stringify({ name: `@synthetic/${name}`, exports: { '.': './src/index.ts', './*': './src/*.ts' } }),
    );
  write('apps/web/package.json', JSON.stringify({ name: 'web' }));
  const perOwner = Math.floor(files / (packages + 1));
  const owners = [...names.map(name => `packages/${name}/src`), 'apps/web/src'];
  let written = 0;
  let totalLoc = 0;
  owners.forEach((owner, ownerIndex) => {
    const count = ownerIndex === owners.length - 1 ? files - written : perOwner;
    for (let index = 0; index < count; index++) {
      const imports = [];
      if (index > 0) imports.push(`import { value${index - 1} } from './m${index - 1}.js';`);
      if (index > 1) imports.push(`import type { Shape${index - 2} } from './m${index - 2}';`);
      if (ownerIndex === owners.length - 1 && index > 2)
        imports.push(`import { value${index - 3} } from '@/m${index - 3}';`);
      const other = names[Math.floor(random() * names.length)];
      imports.push(`import { value0 } from '@synthetic/${other}';`);
      imports.push("import { join } from 'node:path';");
      const body = syntheticTypeScript(Math.max(loc - imports.length - 2, 10), seed + written)
        .split('\n')
        .slice(3);
      const content = [
        ...imports,
        ...body,
        `export const value${index} = ${index};`,
        `export interface Shape${index} { id: number }`,
      ].join('\n');
      write(`${owner}/m${index}.ts`, content);
      totalLoc += content.split('\n').length;
      written++;
    }
    write(`${owner}/index.ts`, "export * from './m0.js';\nexport { value1 as first } from './m1.js';\n");
    written++;
    totalLoc += 2;
    // Targets of the snippets' dynamic import('./lazy-N.js').
    for (let lazy = 0; lazy < 3; lazy++) {
      write(`${owner}/lazy-${lazy}.ts`, `export const lazy${lazy} = ${lazy};\n`);
      written++;
      totalLoc += 1;
    }
  });
  return { files: written, loc: totalLoc };
}
