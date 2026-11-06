// @vitest-environment node
/// <reference types="node" />
/**
 * DS — static and compiled-CSS checks of STUDIO-DESIGN-SYSTEM.md (§1, §2.1, §3) per plan §11.6.
 *
 * Sources: every non-test `src/**\/*.{ts,tsx,css}` file (test files and `src/test/**` excluded). The scan
 * refuses to run while the contract files are missing, so it can never pass vacuously.
 *
 * Compiled CSS: produced deterministically by running the real pipeline in memory — Vite `build()` with
 * the app's own `vite.config.ts` (React + @tailwindcss/vite, production mode, `write: false`,
 * `minify: false`) — and reading the emitted `.css` assets. Nothing is written to `dist/`.
 */
import { existsSync, globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, test } from 'vitest';
import { contrastRatio } from '@/design/contrast';
import { colors, fonts } from '@/design/tokens';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BUILD_TIMEOUT = 180_000;

const CONTRACT_FILES = [
  'src/design/tokens.css',
  'src/design/tokens.ts',
  'src/design/contrast.ts',
  'src/components/ui/button.tsx',
  'src/components/ui/icon.tsx',
  'src/shell/AppShell.tsx',
  'src/views/BoardView.tsx',
  'src/views/DiffView.tsx',
];

interface SourceFile {
  path: string;
  text: string;
}

function sourceFiles(): SourceFile[] {
  const missing = CONTRACT_FILES.filter(path => !existsSync(`${APP_ROOT}${path}`));
  if (missing.length > 0)
    throw new Error(`design scan would be vacuous; missing contract files: ${missing.join(', ')}`);
  return globSync('src/**/*.{ts,tsx,css}', { cwd: APP_ROOT })
    .map(path => path.replaceAll('\\', '/'))
    .filter(path => !/\.test\.tsx?$/.test(path) && !path.startsWith('src/test/'))
    .sort()
    .map(path => ({ path, text: readFileSync(`${APP_ROOT}${path}`, 'utf8') }));
}

const read = (path: string) => readFileSync(`${APP_ROOT}${path}`, 'utf8');

function offenders(files: SourceFile[], pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of files) {
    file.text.split('\n').forEach((line, index) => {
      const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
      for (const match of line.matchAll(new RegExp(pattern.source, flags)))
        found.push(`${file.path}:${index + 1}: ${match[0]}`);
    });
  }
  return found;
}

// ------------------------------------------------------------------------------------------------
// Compiled CSS
// ------------------------------------------------------------------------------------------------

let cssPromise: Promise<string> | undefined;

function compiledCss(): Promise<string> {
  cssPromise ??= (async () => {
    const result: unknown = await build({
      root: APP_ROOT,
      configFile: `${APP_ROOT}vite.config.ts`,
      mode: 'production',
      logLevel: 'silent',
      build: { write: false, minify: false, emptyOutDir: false, reportCompressedSize: false },
    });
    type Chunk = { type: string; fileName: string; source?: string | Uint8Array };
    const outputs = (Array.isArray(result) ? result : [result]) as Array<{ output?: Chunk[] }>;
    const css = outputs
      .flatMap(output => output.output ?? [])
      .filter(chunk => chunk.type === 'asset' && chunk.fileName.endsWith('.css'))
      .map(chunk => (typeof chunk.source === 'string' ? chunk.source : new TextDecoder().decode(chunk.source)));
    if (css.length === 0) throw new Error('vite build emitted no CSS asset');
    return css.join('\n');
  })();
  return cssPromise;
}

interface CssRule {
  /** Style-rule preludes from outermost to innermost (nesting preserved). */
  selectors: string[];
  /** At-rule preludes enclosing the declarations (e.g. `@media (hover: hover)`). */
  atRules: string[];
  declarations: Array<[property: string, value: string]>;
}

/** Minimal brace walker: handles comments, strings and native nesting; enough for compiled Tailwind output. */
function parseCss(css: string): CssRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const stack: Array<{ prelude: string; buffer: string }> = [{ prelude: '', buffer: '' }];
  let quote: string | null = null;
  let escaped = false;
  for (const char of text) {
    const frame = stack[stack.length - 1];
    if (!frame) throw new Error('CSS walker lost its root frame');
    if (quote) {
      frame.buffer += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      frame.buffer += char;
    } else if (char === '{') {
      const cut = frame.buffer.lastIndexOf(';');
      stack.push({ prelude: frame.buffer.slice(cut + 1).trim(), buffer: '' });
      frame.buffer = frame.buffer.slice(0, cut + 1);
    } else if (char === '}') {
      const closed = stack.pop();
      if (!closed || stack.length === 0) throw new Error('unbalanced braces in compiled CSS');
      const chain = [...stack.slice(1).map(entry => entry.prelude), closed.prelude];
      const declarations = closed.buffer
        .split(';')
        .map(part => part.trim())
        .filter(part => part.includes(':'))
        .map(part => {
          const colon = part.indexOf(':');
          return [part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim()] as [string, string];
        });
      rules.push({
        selectors: chain.filter(prelude => !prelude.startsWith('@')),
        atRules: chain.filter(prelude => prelude.startsWith('@')),
        declarations,
      });
    } else {
      frame.buffer += char;
    }
  }
  if (stack.length !== 1) throw new Error('unbalanced braces in compiled CSS');
  return rules;
}

const PALETTE = {
  canvas: '#121213',
  surface: '#18181a',
  floating: '#1e1e21',
  floatingBorder: '#2a2a2e',
  divider: '#262628',
  accent: '#06b6d4',
  accentBright: '#22d3ee',
  governance: '#f59e0b',
  attested: '#10b981',
  breach: '#f43f5e',
} as const;

const kebab = (name: string) => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

describe('DS design system (static + compiled CSS)', () => {
  test(
    'DS-01 no gradients in sources or compiled CSS',
    async () => {
      expect(
        offenders(sourceFiles(), /(?:linear|radial|conic)-gradient\s*\(|\bbg-gradient-|\bbg-(?:linear|radial|conic)-/),
      ).toEqual([]);
      const gradients = parseCss(await compiledCss()).flatMap(rule =>
        rule.declarations.filter(([property, value]) => !property.startsWith('--') && /gradient\s*\(/.test(value)),
      );
      expect(gradients).toEqual([]);
    },
    BUILD_TIMEOUT,
  );

  test(
    'DS-02 no shadows except the focus ring token',
    async () => {
      expect(offenders(sourceFiles(), /(?:^|[\s"'`:])(?:shadow-(?!none\b)[^\s"'`]+|drop-shadow[^\s"'`]*)/)).toEqual([]);
      const shadows = parseCss(await compiledCss()).filter(rule =>
        rule.declarations.some(([property, value]) => property === 'box-shadow' && !/^none\b/.test(value)),
      );
      for (const rule of shadows)
        expect(rule.selectors.join(' '), 'box-shadow outside the focus ring').toContain(':focus-visible');
    },
    BUILD_TIMEOUT,
  );

  test('DS-04 §2.1 tokens are the single source of colour; no #000 and no colour literal outside the tokens', () => {
    expect(colors).toMatchObject(PALETTE);
    expect(colors.fg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colors.fgMuted).toMatch(/^#[0-9a-f]{6}$/i);
    const tokensCss = read('src/design/tokens.css');
    for (const [name, value] of Object.entries({ ...PALETTE, fg: colors.fg, fgMuted: colors.fgMuted })) {
      expect(tokensCss, `--color-${kebab(name)}`).toMatch(
        new RegExp(`--color-${kebab(name)}\\s*:\\s*${value}\\s*[;}]`, 'i'),
      );
    }

    const files = sourceFiles();
    expect(offenders(files, /#000(?:000)?\b/i)).toEqual([]);
    const outsideTokens = files.filter(file => !file.path.startsWith('src/design/'));
    expect(offenders(outsideTokens, /#[0-9a-f]{3,8}\b/i)).toEqual([]);
    expect(offenders(outsideTokens, /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\s*\(/i)).toEqual([]);
    expect(
      offenders(
        outsideTokens,
        /\b(?:bg|text|border|ring|fill|stroke|outline|divide|accent|caret|decoration|from|via|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d{2,3})?\b/,
      ),
    ).toEqual([]);
    expect(offenders(outsideTokens, /-\[#/)).toEqual([]);
  });

  test('DS-05 the governance amber is used only by GateBanner, ProtectedState, BlastRadius* and the Kanban gate lanes', () => {
    const whitelist = (path: string) =>
      path === 'src/design/tokens.css' ||
      path === 'src/design/tokens.ts' ||
      /\/(?:GateBanner|ProtectedState|BlastRadius[\w-]*)\.tsx?$/.test(path) ||
      path === 'src/components/ui/kanban-board.tsx';
    const pattern = /\bgovernance\b|#f59e0b/i;
    const files = sourceFiles();
    const outside = files.filter(file => !whitelist(file.path));
    expect(offenders(outside, pattern)).toEqual([]);
    const users = files.filter(
      file => whitelist(file.path) && !file.path.startsWith('src/design/') && pattern.test(file.text),
    );
    expect(
      users.map(file => file.path),
      'the Protected state must actually use the governance token',
    ).toEqual(expect.arrayContaining([expect.stringMatching(/ProtectedState\.tsx$/)]));
  });

  test('DS-06 WCAG contrast of the Obsidian theme', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#121213', '#121213')).toBeCloseTo(1, 5);
    for (const background of [colors.canvas, colors.surface, colors.floating]) {
      for (const text of [colors.fg, colors.fgMuted])
        expect(contrastRatio(text, background), `${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
      for (const accent of [colors.accent, colors.governance, colors.attested, colors.breach])
        expect(contrastRatio(accent, background), `${accent} on ${background}`).toBeGreaterThanOrEqual(3);
    }
  });

  test(
    'DS-07 typography: Cascadia Mono for data with tabular-nums, Segoe UI Variable for the interface',
    async () => {
      const normalize = (value: string) =>
        value
          .replace(/'/g, '"')
          .replace(/\s*,\s*/g, ', ')
          .trim();
      expect(normalize(fonts.mono)).toBe('"Cascadia Mono", Consolas, monospace');
      expect(normalize(fonts.sans)).toBe('"Segoe UI Variable", "Segoe UI", system-ui');
      const tokensCss = read('src/design/tokens.css');
      const declared = (name: string) => {
        const match = new RegExp(`--font-${name}\\s*:\\s*([^;}]+)`).exec(tokensCss);
        if (!match?.[1]) throw new Error(`tokens.css does not declare --font-${name}`);
        return normalize(match[1]);
      };
      expect(declared('mono')).toBe(normalize(fonts.mono));
      expect(declared('sans')).toBe(normalize(fonts.sans));
      const rules = parseCss(await compiledCss());
      const hasRule = (selector: RegExp) => rules.some(rule => rule.selectors.some(entry => selector.test(entry)));
      expect(hasRule(/\.font-mono\b/), '.font-mono is used').toBe(true);
      expect(hasRule(/\.tabular-nums\b/), '.tabular-nums is used').toBe(true);
    },
    BUILD_TIMEOUT,
  );

  test(
    'DS-09 transition-all appears neither in sources nor in compiled CSS',
    async () => {
      const files = sourceFiles();
      expect(offenders(files, /transition-all/)).toEqual([]);
      expect(read('src/components/ui/button.tsx')).toContain('transition-[scale,background-color,border-color]');
      const all = parseCss(await compiledCss()).flatMap(rule =>
        rule.declarations.filter(
          ([property, value]) =>
            (property === 'transition-property' && /(^|,)\s*all\b/.test(value)) ||
            (property === 'transition' && /^all\b|,\s*all\b/.test(value)),
        ),
      );
      expect(all).toEqual([]);
    },
    BUILD_TIMEOUT,
  );

  test(
    'DS-10 every compiled :hover rule sits inside @media (hover: hover); tap highlight is transparent',
    async () => {
      const rules = parseCss(await compiledCss());
      const hovers = rules.filter(
        rule => rule.declarations.length > 0 && rule.selectors.some(entry => entry.includes(':hover')),
      );
      expect(hovers.length, 'the app uses hover styles').toBeGreaterThan(0);
      const unguarded = hovers.filter(rule => !rule.atRules.some(prelude => /hover\s*:\s*hover/.test(prelude)));
      expect(unguarded.map(rule => rule.selectors.join(' '))).toEqual([]);
      expect(
        rules.some(rule =>
          rule.declarations.some(
            ([property, value]) => property === '-webkit-tap-highlight-color' && value === 'transparent',
          ),
        ),
      ).toBe(true);
    },
    BUILD_TIMEOUT,
  );

  test(
    'DS-11 animations only under motion-safe:, and reduced motion collapses transitions to instant opacity',
    async () => {
      const tokens = offenders(sourceFiles(), /[^\s"'`]*animate-[^\s"'`]+/).filter(
        entry => !/motion-safe:[^\s"'`]*animate-/.test(entry) && !/animate-none$/.test(entry),
      );
      expect(tokens).toEqual([]);

      const reduced = parseCss(await compiledCss()).filter(rule =>
        rule.atRules.some(prelude => /prefers-reduced-motion\s*:\s*reduce/.test(prelude)),
      );
      const universal = reduced.find(
        rule =>
          rule.selectors.some(selector => selector.includes('*')) &&
          rule.declarations.some(
            ([property, value]) => property === 'transition-property' && /^opacity\b/.test(value),
          ) &&
          rule.declarations.some(
            ([property, value]) => property === 'transition-duration' && /^0(?:\.0+)?m?s\b/.test(value),
          ),
      );
      expect(universal, 'a global reduced-motion rule limits transitions to instant opacity').toBeDefined();
      expect(
        reduced.some(rule =>
          rule.declarations.some(([property, value]) => property === 'scale' && /^none\b/.test(value)),
        ),
        'the press scale is neutralised under reduced motion',
      ).toBe(true);
    },
    BUILD_TIMEOUT,
  );
});
