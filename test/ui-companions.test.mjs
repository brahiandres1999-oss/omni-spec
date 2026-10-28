import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PassThrough } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { createHash } from 'node:crypto';
import { detectProjectEnvironment } from '../src/detector.mjs';
import { syncManagedFiles, loadRegistry, managedHash } from '../src/managed.mjs';
import { companionCatalogAvailable, companionEntries, packageEntries } from '../src/assets.mjs';
import { loadManifest } from '../src/manifest.mjs';
import { updateProject } from '../src/updater.mjs';
import { runWizard } from '../src/wizard.mjs';
import { scaffoldProject } from '../src/generator.mjs';
import { TerminalInstaller } from '../src/terminal-ui.mjs';

const cli = fileURLToPath(new URL('../bin/omni-spec.mjs', import.meta.url));

async function tuiWizard(directory, options, respond = () => '\r', viewport = [100, 36]) {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = output.isTTY = true;
  input.isRaw = false;
  input.setRawMode = value => {
    input.isRaw = value;
  };
  [output.columns, output.rows] = viewport;
  let frames = '';
  output.on('data', chunk => {
    frames += chunk.toString();
  });
  const prompts = [];
  const original = TerminalInstaller.prototype.choose;
  TerminalInstaller.prototype.choose = function (question) {
    prompts.push(question);
    const result = original.call(this, question);
    setImmediate(() => input.write(respond(question)));
    return result;
  };
  try {
    const config = await runWizard(directory, options, { input, output, env: {} });
    assert.equal(input.isRaw, false);
    assert.equal(input.listenerCount('keypress'), 0);
    return { config, prompts, text: stripVTControlCharacters(frames) };
  } finally {
    TerminalInstaller.prototype.choose = original;
    input.destroy();
    output.destroy();
  }
}

function chooseValue(question, value) {
  const current = Math.max(
    0,
    question.options.findIndex(option => option.value === question.defaultValue),
  );
  const target = question.options.findIndex(option => option.value === value);
  assert.ok(target >= 0);
  return (target < current ? '\x1b[A' : '\x1b[B').repeat(Math.abs(target - current)) + '\r';
}

async function snapshot(directory) {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      result[`${entry.name}/`] = null;
      for (const [name, content] of Object.entries(await snapshot(path))) result[`${entry.name}/${name}`] = content;
    } else
      result[entry.name] = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
  }
  return result;
}

test('TASK-06 regression / AC-04, AC-05, AC-11: real TUI keys persist UI choices in both languages', {
  timeout: 30000,
}, async t => {
  for (const language of ['en', 'es']) {
    for (const signal of [false, true]) {
      await t.test(`${language}, UI signal ${signal}`, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'omni-tui-ui-'));
        try {
          await writeFile(
            join(directory, 'package.json'),
            JSON.stringify({
              name: 'wizard-fixture',
              dependencies: signal ? { react: '19.0.0' } : { express: '5.0.0' },
            }),
          );
          const { config, prompts, text } = await tuiWizard(
            directory,
            { lang: language, agent: 'claude' },
            question => {
              if (question.options.some(option => option.value === 'shadcn')) return chooseValue(question, 'shadcn');
              if (question.options.some(option => option.value === 'better')) return chooseValue(question, 'better');
              return '\r';
            },
          );
          assert.deepEqual(config.ui, signal ? { components: 'shadcn', companion: 'better' } : undefined);
          assert.equal(prompts.length, signal ? 3 : 1);
          if (signal) {
            assert.match(text, /UI: shadcn · better/);
            assert.match(text, language === 'es' ? /Compañero de diseño/ : /Design companion/);
          }
          await scaffoldProject(directory, config);
          assert.deepEqual((await loadManifest(directory)).ui, config.ui);
          assert.equal(existsSync(join(directory, 'specs/.omni/companions/better/INDEX.md')), signal);
          const preserved = await tuiWizard(directory, { lang: language, agent: 'claude' });
          assert.deepEqual(preserved.config.ui, config.ui);
          assert.equal(preserved.prompts.length, 1);
          const flags = await tuiWizard(directory, {
            lang: language,
            agent: 'claude',
            uiCompanion: 'frontend-design',
            uiComponents: 'radix',
          });
          assert.deepEqual(flags.config.ui, { companion: 'frontend-design', components: 'radix' });
          assert.equal(flags.prompts.length, 1);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      });
    }
    for (const cancelAt of ['shadcn', 'better']) {
      await t.test(`${language}, Esc at ${cancelAt} question`, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'omni-tui-cancel-'));
        try {
          await writeFile(join(directory, 'package.json'), '{"dependencies":{"react":"19.0.0"}}');
          const before = await readFile(join(directory, 'package.json'), 'utf8');
          const { config } = await tuiWizard(directory, { lang: language, agent: 'claude' }, question =>
            question.options.some(option => option.value === cancelAt) ? '\x1b' : '\r',
          );
          assert.equal(config, null);
          assert.deepEqual(await readdir(directory), ['package.json']);
          assert.equal(await readFile(join(directory, 'package.json'), 'utf8'), before);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      });
    }
  }
});

test('TASK-06 / AC-04, AC-11: plain CLI persists selections and skips UI questions on reinit in en/es', async () => {
  for (const language of ['en', 'es']) {
    for (const signal of [false, true]) {
      const directory = await mkdtemp(join(tmpdir(), 'omni-plain-ui-'));
      try {
        if (signal) {
          await mkdir(join(directory, 'apps/web'), { recursive: true });
          await writeFile(join(directory, 'apps/web/package.json'), '{"dependencies":{"react":"19.0.0"}}');
        }
        const args = ['init', '--plain', '--lang', language, '--agent', 'codex'];
        const result = runCli(args, signal ? '1\n2\nyes\n' : 'yes\n', directory);
        assert.equal(result.code, 0, result.stderr);
        const expected = signal ? { companion: 'better', components: 'shadcn' } : undefined;
        assert.deepEqual((await loadManifest(directory)).ui, expected);
        assert.equal(existsSync(join(directory, 'specs/.omni/companions/better/INDEX.md')), signal);
        if (signal) assert.match(result.stdout, /apps\/web/);
        else
          assert.doesNotMatch(
            result.stdout,
            /UI component kit|Sistema de componentes|Design companion|Compañero de diseño/,
          );
        const reinit = runCli(args, 'yes\n', directory);
        assert.equal(reinit.code, 0, reinit.stderr);
        assert.deepEqual((await loadManifest(directory)).ui, expected);
        assert.doesNotMatch(
          reinit.stdout,
          /UI component kit|Sistema de componentes|Design companion|Compañero de diseño/,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
});

test('AC-02: components.json signals UI in every detected module and is an actual file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-shadcn-module-'));
  try {
    await writeFile(join(directory, 'pyproject.toml'), '[project]\nname="fixture"');
    await writeFile(join(directory, 'components.json'), '{}');
    let detected = await detectProjectEnvironment(directory);
    assert.deepEqual(detected.modules[0].ui?.declaredComponents, ['shadcn']);
    assert.deepEqual(detected.ui.modules, ['.']);
    assert.equal(detected.ui.signal, true);
    assert.equal(detected.framework, 'Python');
    assert.equal(detected.detectedStack, 'Python');
    assert.equal(detected.docStandard, 'Python Docstrings (PEP 257)');
    assert.equal(detected.qualityGates, '');
    await writeFile(join(directory, 'package.json'), '{}');
    detected = await detectProjectEnvironment(directory);
    assert.equal(detected.modules.length, 2);
    assert.ok(detected.modules.every(module => module.ui?.declaredComponents.includes('shadcn')));
    assert.deepEqual(detected.ui.modules, ['.']);
    await rm(join(directory, 'components.json'));
    await mkdir(join(directory, 'components.json'));
    detected = await detectProjectEnvironment(directory);
    assert.equal(detected.ui.signal, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('F01 / AC-01, AC-02, AC-03: dependency presence recognizes empty ranges and preserves legacy fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-empty-ranges-'));
  const signals = [
    ['tailwindcss', { styling: ['tailwindcss'] }],
    ['@tailwindcss/vite', { styling: ['tailwindcss'] }],
    ['radix-ui', { declaredComponents: ['radix'] }],
    ['@radix-ui/react-dialog', { declaredComponents: ['radix'] }],
    ['@headlessui/react', { declaredComponents: ['headlessui'] }],
    ['preline', { declaredComponents: ['preline'] }],
    ['@preline/dropdown', { declaredComponents: ['preline'] }],
    ['flyonui', { declaredComponents: ['flyonui'] }],
    ...['next', 'react', 'vue', 'nuxt', 'svelte', '@sveltejs/kit', '@angular/core', 'astro', 'solid-js', 'preact'].map(
      name => [name, { frameworks: [name] }],
    ),
    ['express', {}],
    ['@nestjs/core', {}],
  ];
  const legacyFrameworks = {
    next: 'Next.js',
    react: 'React',
    vue: 'Vue.js',
    express: 'Express',
    '@nestjs/core': 'NestJS',
  };
  try {
    for (const field of ['dependencies', 'devDependencies']) {
      for (const location of ['.', 'apps/web']) {
        const root = join(directory, `${field}-${location === '.' ? 'root' : 'nested'}`);
        await mkdir(join(root, location), { recursive: true });
        for (const [name, expected] of signals) {
          const { frameworks = [], styling = [], declaredComponents = [] } = expected;
          const signal = frameworks.length + styling.length + declaredComponents.length > 0;
          for (const range of ['', '*', '^1.0.0']) {
            const label = `${field}/${location}/${name}/${JSON.stringify(range)}`;
            await writeFile(
              join(root, location, 'package.json'),
              JSON.stringify({ [field]: { [name]: range }, scripts: { test: 'node check.mjs' } }),
            );
            const result = await detectProjectEnvironment(root);
            assert.deepEqual(
              result.ui,
              { signal, frameworks, styling, declaredComponents, modules: signal ? [location] : [] },
              label,
            );
            assert.deepEqual(
              result.modules[0].ui,
              signal ? { frameworks, styling, declaredComponents, evidence: [name] } : null,
              label,
            );
            const legacy = range ? legacyFrameworks[name] || null : null;
            assert.equal(result.framework, legacy, label);
            assert.equal(
              result.detectedStack,
              `${location === '.' ? '' : 'Monorepo: '}${legacy || 'Node.js'} / JavaScript`,
              label,
            );
            assert.equal(result.docStandard, 'JSDoc', label);
            assert.equal(result.qualityGates, location === '.' ? 'npm test' : 'cd "apps/web" && npm test', label);
          }
        }
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('F01 / AC-04: empty ranges trigger both wizard branches for a nested UI module in en/es', async () => {
  for (const language of ['en', 'es']) {
    for (const mode of ['tui', 'plain']) {
      const directory = await mkdtemp(join(tmpdir(), 'omni-empty-range-wizard-'));
      try {
        await mkdir(join(directory, 'apps/web'), { recursive: true });
        const field = language === 'en' ? 'dependencies' : 'devDependencies';
        await writeFile(join(directory, 'apps/web/package.json'), JSON.stringify({ [field]: { tailwindcss: '' } }));
        const options = { lang: language, agent: 'codex' };
        if (mode === 'tui') {
          const { config, prompts } = await tuiWizard(directory, options);
          assert.equal(prompts.length, 3);
          assert.deepEqual(config.ui, { companion: 'none', components: 'none' });
          await scaffoldProject(directory, config);
        } else {
          const result = runCli(['init', '--plain', '--lang', language, '--agent', 'codex'], '\n\nyes\n', directory);
          assert.equal(result.code, 0, result.stderr);
          assert.match(result.stdout, language === 'es' ? /Sistema de componentes/ : /UI component kit/);
          assert.match(result.stdout, language === 'es' ? /Compañero de diseño/ : /Design companion/);
        }
        assert.deepEqual((await loadManifest(directory)).ui, { companion: 'none', components: 'none' });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
});

test('P-1: every approved framework independently produces a UI signal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-framework-signals-'));
  try {
    for (const framework of [
      'next',
      'react',
      'vue',
      'nuxt',
      'svelte',
      '@sveltejs/kit',
      '@angular/core',
      'astro',
      'solid-js',
      'preact',
    ]) {
      await writeFile(join(directory, 'package.json'), JSON.stringify({ devDependencies: { [framework]: '*' } }));
      const detected = await detectProjectEnvironment(directory);
      assert.equal(detected.ui.signal, true, framework);
      assert.deepEqual(detected.modules[0].ui.frameworks, [framework]);
      assert.deepEqual(detected.ui.frameworks, [framework]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P-2, P-4 / AC-04: one UI selection for multiple modules, defaults and confirmation at both TTY sizes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-ui-defaults-'));
  try {
    for (const name of ['web', 'admin']) {
      await mkdir(join(directory, 'apps', name), { recursive: true });
      await writeFile(
        join(directory, 'apps', name, 'package.json'),
        '{"dependencies":{"react":"19.0.0","radix-ui":"1.0.0"}}',
      );
    }
    await writeFile(join(directory, 'apps/web/components.json'), '{}');
    for (const language of ['en', 'es']) {
      for (const viewport of [
        [100, 36],
        [40, 18],
      ]) {
        const { config, prompts } = await tuiWizard(
          directory,
          { lang: language, agent: 'claude' },
          undefined,
          viewport,
        );
        assert.deepEqual(config.ui, { companion: 'none', components: 'shadcn' });
        assert.equal(prompts.length, 3);
        assert.equal(prompts[0].defaultValue, 'shadcn');
        assert.equal(prompts[1].defaultValue, 'none');
        assert.ok(prompts[0].details.some(detail => detail.includes('apps/admin') && detail.includes('apps/web')));
        assert.ok(prompts.at(-1).details.some(detail => detail.includes('apps/admin') && detail.includes('apps/web')));
      }
      const plain = runCli(['init', '--plain', '--lang', language, '--agent', 'claude'], '\n\nyes\n', directory);
      assert.equal(plain.code, 0, plain.stderr);
      assert.deepEqual((await loadManifest(directory)).ui, { companion: 'none', components: 'shadcn' });
      assert.equal(existsSync(join(directory, 'specs/.omni/companions')), false);
      await rm(join(directory, 'specs'), { recursive: true, force: true });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P-3, P-5 / AC-05, AC-11: all UI values, partial flags and saved fields agree with the schema', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-ui-flags-'));
  try {
    await writeFile(join(directory, 'package.json'), '{"dependencies":{"react":"19.0.0"}}');
    await writeFile(join(directory, 'components.json'), '{}');
    const companions = ['better', 'frontend-design', 'none'];
    const components = ['shadcn', 'radix', 'headlessui', 'preline', 'flyonui', 'none'];
    const schema = JSON.parse(await readFile(new URL('../schema/manifest.schema.json', import.meta.url), 'utf8'))
      .properties.ui;
    assert.deepEqual(schema.required, ['companion', 'components']);
    assert.deepEqual(schema.properties.companion.enum, companions);
    assert.deepEqual(schema.properties.components.enum, components);
    assert.equal(schema.additionalProperties, false);
    for (const companion of companions) {
      for (const kit of components) {
        const config = await runWizard(directory, { yes: true, uiCompanion: companion, uiComponents: kit });
        assert.deepEqual(config.ui, { companion, components: kit });
      }
    }
    const partial = await tuiWizard(directory, { lang: 'en', agent: 'claude', uiCompanion: 'better' });
    assert.deepEqual(partial.config.ui, { companion: 'better', components: 'shadcn' });
    assert.equal(partial.prompts.length, 1);
    await scaffoldProject(directory, partial.config);
    const kitOnly = runCli(['init', '--plain', '--lang', 'en', '--ui-components', 'radix'], 'yes\n', directory);
    assert.equal(kitOnly.code, 0, kitOnly.stderr);
    assert.deepEqual((await loadManifest(directory)).ui, { companion: 'better', components: 'radix' });
    const companionOnly = runCli(['init', '--yes', '--ui-companion', 'frontend-design'], '', directory);
    assert.equal(companionOnly.code, 0, companionOnly.stderr);
    assert.deepEqual((await loadManifest(directory)).ui, { companion: 'frontend-design', components: 'radix' });
    const untouched = await snapshot(directory);
    for (const flag of ['--ui-components', '--ui-companion']) {
      const invalid = runCli(['init', '--yes', flag, 'INVALID'], '', directory);
      assert.equal(invalid.code, 1);
      assert.match(invalid.stderr, /Valid values:/);
      assert.deepEqual(await snapshot(directory), untouched);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('TASK-04 regression / AC-06, AC-09: invalid manifest companions fail before writing paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-companion-invalid-'));
  try {
    assert.equal(runCli(['init', '--yes', '--ui-companion', 'none'], '', directory).code, 0);
    const manifest = await loadManifest(directory);
    for (const name of ['../bin', '..\\bin', '/bin', '', 'unknown', null]) {
      await assert.rejects(companionEntries(name), /Invalid UI companion/);
      manifest.ui.companion = name;
      await writeFile(join(directory, 'specs/manifest.json'), JSON.stringify(manifest));
      const before = await snapshot(directory);
      await assert.rejects(updateProject(directory), /Invalid UI companion/);
      assert.deepEqual(await snapshot(directory), before);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('TASK-04 / AC-07: absent catalog gives a pinned recovery command; other errors propagate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-assets-distribution-'));
  try {
    await mkdir(join(directory, 'src'));
    await cp(fileURLToPath(new URL('../src/assets.mjs', import.meta.url)), join(directory, 'src/assets.mjs'));
    const assets = await import(pathToFileURL(join(directory, 'src/assets.mjs')).href);
    await writeFile(join(directory, 'package.json'), '{"version":"0.8.0-preview.1"}');
    assert.equal(await assets.companionCatalogAvailable(), false);
    await assert.rejects(
      assets.companionEntries('better'),
      /npx omni-spec@0\.8\.0-preview\.1 init or npx omni-spec@0\.8\.0-preview\.1 update/,
    );
    await writeFile(join(directory, 'package.json'), '{invalid');
    await assert.rejects(assets.companionEntries('better'), SyntaxError);
    await writeFile(join(directory, 'package.json'), '{}');
    await assert.rejects(assets.companionEntries('better'), /package.json has no version/);
    await rm(join(directory, 'package.json'));
    await assert.rejects(assets.companionEntries('better'), { code: 'ENOENT' });
    await writeFile(join(directory, 'companions'), 'not a directory');
    await assert.rejects(assets.companionCatalogAvailable(), { code: 'ENOTDIR' });
    await rm(join(directory, 'companions'));
    await mkdir(join(directory, 'companions'));
    await writeFile(join(directory, 'companions/better'), 'not a directory');
    await assert.rejects(assets.companionEntries('better'), { code: 'ENOTDIR' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('TASK-07 / AC-11: isolated runtime preserves companions or rejects changes before writing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-runtime-companion-'));
  try {
    assert.equal(runCli(['init', '--yes', '--ui-companion', 'better'], '', directory).code, 0);
    const runtimeCli = join(directory, 'specs/.omni/runtime/bin/omni-spec.mjs');
    const invoke = args =>
      spawnSync(process.execPath, [runtimeCli, ...args], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 30000,
        windowsHide: true,
      });
    const before = await snapshot(directory);
    for (const name of ['none', 'frontend-design']) {
      const result = invoke(['init', '--yes', '--ui-companion', name]);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /cannot change companion/);
      assert.match(result.stderr, /npx omni-spec@0\.8\.0-preview\.1 init/);
      assert.deepEqual(await snapshot(directory), before);
    }
    const reinit = invoke(['init', '--yes']);
    assert.equal(reinit.status, 0, reinit.stderr);
    assert.match(reinit.stderr, /skipping companion synchronization/);
    const companionBefore = await snapshot(join(directory, 'specs/.omni/companions'));
    const update = invoke(['update', '--json']);
    assert.equal(update.status, 0, update.stderr);
    assert.match(update.stdout, /neither updated nor pruned/);
    assert.match(update.stdout, /npx omni-spec@0\.8\.0-preview\.1 update/);
    assert.deepEqual(await snapshot(join(directory, 'specs/.omni/companions')), companionBefore);
    assert.equal((await loadManifest(directory)).ui.companion, 'better');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function runCli(args, input = '', cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
    env: {
      ...process.env,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      HOME: join(cwd, 'isolated-home'),
      USERPROFILE: join(cwd, 'isolated-home'),
    },
  });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

test('TASK-01 / AC-07: attribution checksums, UTF-8 and complete INDEX routes', async () => {
  for (const [name, commit] of [
    ['better', '592aedc44d7d5b3e29740984252902f3e5402a1c'],
    ['frontend-design', '41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f'],
  ]) {
    const directory = fileURLToPath(new URL(`../companions/${name}/`, import.meta.url));
    const attribution = await readFile(join(directory, 'ATTRIBUTION.md'), 'utf8');
    assert.ok(attribution.includes(`**Commit:** ${commit}`));
    const checksums = [...attribution.matchAll(/\| `([^`]+)` \| `([a-f0-9]{64})` \|/g)];
    assert.ok(checksums.length > 0);
    const files = await snapshot(directory);
    const upstreamFiles = Object.keys(files).filter(
      path => files[path] !== null && !['INDEX.md', 'ATTRIBUTION.md'].includes(path),
    );
    assert.deepEqual(checksums.map(match => match[1]).sort(), upstreamFiles.sort());
    for (const [, path, hash] of checksums) {
      const content = await readFile(join(directory, path));
      new TextDecoder('utf-8', { fatal: true }).decode(content);
      assert.equal(createHash('sha256').update(content).digest('hex'), hash, path);
    }
    const index = await readFile(join(directory, 'INDEX.md'), 'utf8');
    assert.doesNotMatch(index, /5 estados obligatorios/);
    if (name === 'better') {
      const routed = [...index.matchAll(/`(better-[a-z-]+\/[a-z-]+\.md)`/gi)].map(match => match[1]);
      assert.deepEqual([...new Set(routed)].sort(), upstreamFiles.filter(path => path.endsWith('.md')).sort());
    } else assert.match(index, /SKILL\.md/);
  }
});

test('UI Companions & Frontend Synergy: Detector (AC-01, AC-02, AC-03)', async t => {
  let tempDir;

  t.beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omni-ui-detector-'));
  });

  t.afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('AC-01: detects tailwindcss and @tailwindcss/* styling', async () => {
    // 1. tailwindcss dependency
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'tailwind-app',
        dependencies: { react: '^19.0.0', tailwindcss: '^4.0.0' },
      }),
    );
    let result = await detectProjectEnvironment(tempDir);
    assert.equal(result.ui.signal, true);
    assert.deepEqual(result.ui.styling, ['tailwindcss']);
    assert.deepEqual(result.modules[0].ui.styling, ['tailwindcss']);
    assert.ok(result.modules[0].ui.evidence.includes('tailwindcss'));

    // 2. @tailwindcss/vite dependency
    await rm(join(tempDir, 'package.json'));
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'tailwind-pkg-app',
        devDependencies: { '@tailwindcss/vite': '^4.0.0' },
      }),
    );
    result = await detectProjectEnvironment(tempDir);
    assert.equal(result.ui.signal, true);
    assert.deepEqual(result.ui.styling, ['tailwindcss']);
    assert.deepEqual(result.modules[0].ui.styling, ['tailwindcss']);
    assert.ok(result.modules[0].ui.evidence.includes('@tailwindcss/vite'));
  });

  await t.test('AC-02: detects shadcn, radix, headlessui, preline and flyonui', async () => {
    // 1. shadcn via components.json
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'shadcn-app', dependencies: { react: '^19.0.0' } }),
    );
    await writeFile(join(tempDir, 'components.json'), JSON.stringify({ style: 'default' }));
    let result = await detectProjectEnvironment(tempDir);
    assert.equal(result.ui.signal, true);
    assert.deepEqual(result.ui.declaredComponents, ['shadcn']);
    assert.deepEqual(result.modules[0].ui.declaredComponents, ['shadcn']);
    assert.ok(result.modules[0].ui.evidence.includes('components.json'));

    // 2. radix via @radix-ui/react-dialog and radix-ui
    await rm(join(tempDir, 'components.json'));
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'radix-app', dependencies: { '@radix-ui/react-dialog': '^1.0.0' } }),
    );
    result = await detectProjectEnvironment(tempDir);
    assert.deepEqual(result.ui.declaredComponents, ['radix']);
    assert.deepEqual(result.modules[0].ui.declaredComponents, ['radix']);

    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'radix-unified-app', dependencies: { 'radix-ui': '^1.0.0' } }),
    );
    result = await detectProjectEnvironment(tempDir);
    assert.deepEqual(result.ui.declaredComponents, ['radix']);

    // 3. headlessui via @headlessui/react
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'headless-app', dependencies: { '@headlessui/react': '^2.0.0' } }),
    );
    result = await detectProjectEnvironment(tempDir);
    assert.deepEqual(result.ui.declaredComponents, ['headlessui']);

    // 4. preline via preline and @preline/*
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'preline-app', dependencies: { preline: '^2.0.0' } }),
    );
    result = await detectProjectEnvironment(tempDir);
    assert.deepEqual(result.ui.declaredComponents, ['preline']);

    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'preline-scoped-app', dependencies: { '@preline/overlay': '^2.0.0' } }),
    );
    result = await detectProjectEnvironment(tempDir);
    assert.deepEqual(result.ui.declaredComponents, ['preline']);

    // 5. flyonui
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'flyon-app', dependencies: { flyonui: '^1.0.0' } }),
    );
    result = await detectProjectEnvironment(tempDir);
    assert.deepEqual(result.ui.declaredComponents, ['flyonui']);

    // 6. Multiple kits combined (preserved in constant order UI_COMPONENT_KITS)
    await writeFile(join(tempDir, 'components.json'), JSON.stringify({}));
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'multi-kit-app',
        dependencies: {
          flyonui: '^1.0.0',
          '@headlessui/react': '^2.0.0',
          'radix-ui': '^1.0.0',
        },
      }),
    );
    result = await detectProjectEnvironment(tempDir);
    assert.deepEqual(result.ui.declaredComponents, ['shadcn', 'radix', 'headlessui', 'flyonui']);
  });

  await t.test('AC-03: subdirectory/monorepo signal and legacy contract non-regression', async () => {
    // 1. Monorepo with apps/web (React + Tailwind) and apps/api (Express backend)
    const webDir = join(tempDir, 'apps', 'web');
    const apiDir = join(tempDir, 'apps', 'api');
    await mkdir(webDir, { recursive: true });
    await mkdir(apiDir, { recursive: true });

    await writeFile(
      join(webDir, 'package.json'),
      JSON.stringify({
        name: 'web-app',
        dependencies: { react: '^19.0.0', tailwindcss: '^4.0.0' },
      }),
    );
    await writeFile(
      join(apiDir, 'package.json'),
      JSON.stringify({
        name: 'api-service',
        dependencies: { express: '^4.21.0' },
        scripts: { test: 'node check.mjs', lint: 'eslint .' },
      }),
    );

    let result = await detectProjectEnvironment(tempDir);
    assert.equal(result.ui.signal, true);
    assert.deepEqual(result.ui.frameworks, ['react']);
    assert.deepEqual(result.ui.styling, ['tailwindcss']);
    assert.deepEqual(result.ui.modules, ['apps/web']);
    // verify web module has ui, api module has ui: null
    const webMod = result.modules.find(m => m.directory === 'apps/web');
    const apiMod = result.modules.find(m => m.directory === 'apps/api');
    assert.ok(webMod.ui);
    assert.equal(apiMod.ui, null);
    // Contract stability: framework is still Next/React/etc., detectedStack is still monorepo format
    assert.ok(['React', 'Express'].includes(result.framework));
    assert.ok(result.detectedStack.includes('Monorepo: '));
    assert.ok(result.detectedStack.includes('React / JavaScript'));
    assert.ok(result.detectedStack.includes('Express / JavaScript'));
    assert.equal(result.docStandard, 'JSDoc');
    assert.equal(result.qualityGates, 'cd "apps/api" && npm test\ncd "apps/api" && npm run lint');

    // 2. Pure backend project (Express only)
    await rm(webDir, { recursive: true, force: true });
    result = await detectProjectEnvironment(tempDir);
    assert.equal(result.ui.signal, false);
    assert.deepEqual(result.ui.frameworks, []);
    assert.deepEqual(result.ui.styling, []);
    assert.deepEqual(result.ui.declaredComponents, []);
    assert.deepEqual(result.ui.modules, []);
    assert.equal(result.framework, 'Express');
    assert.equal(result.detectedStack, 'Monorepo: Express / JavaScript');
    assert.equal(result.docStandard, 'JSDoc');
    assert.equal(result.qualityGates, 'cd "apps/api" && npm test\ncd "apps/api" && npm run lint');

    // 3. Empty directory (Greenfield)
    await rm(join(tempDir, 'apps'), { recursive: true, force: true });
    result = await detectProjectEnvironment(tempDir);
    assert.equal(result.isGreenfield, true);
    assert.equal(result.ui.signal, false);
    assert.deepEqual(result.ui.frameworks, []);
    assert.deepEqual(result.ui.styling, []);
    assert.deepEqual(result.ui.declaredComponents, []);
    assert.deepEqual(result.ui.modules, []);
    assert.equal(result.detectedStack, null);
    assert.equal(result.framework, null);
    assert.equal(result.docStandard, 'Project conventions (review required)');
    assert.equal(result.qualityGates, '');
  });

  await t.test(
    'TASK-03 / AC-09, AC-11: syncManagedFiles accepts prune as string array and prunes under multiple prefixes',
    async () => {
      const fileA = 'specs/.omni/runtime/a.txt';
      const fileB = 'specs/.omni/runtime/b.txt';
      const fileC = 'specs/.omni/companions/better/c.txt';
      const fileD = 'specs/.omni/companions/better/d.txt';

      // Step 1: Install 4 files under 2 different prefixes
      const res1 = await syncManagedFiles(tempDir, [
        { path: fileA, content: 'content A' },
        { path: fileB, content: 'content B' },
        { path: fileC, content: 'content C' },
        { path: fileD, content: 'content D' },
      ]);
      assert.equal(res1.created.length, 4);

      // Step 2: Edit file D locally
      await writeFile(join(tempDir, fileD), 'edited content D');

      // Step 3: Sync keeping only file A and file C, with prune on both prefixes: ['specs/.omni/runtime/', 'specs/.omni/companions/']
      const res2 = await syncManagedFiles(
        tempDir,
        [
          { path: fileA, content: 'content A' },
          { path: fileC, content: 'content C' },
        ],
        { prune: ['specs/.omni/runtime/', 'specs/.omni/companions/'] },
      );

      // Unedited file B was removed from disk
      assert.deepEqual(res2.removed, [fileB]);
      assert.equal(existsSync(join(tempDir, fileB)), false);
      // Edited file D was preserved on disk
      assert.deepEqual(res2.preserved, [fileD]);
      assert.equal(existsSync(join(tempDir, fileD)), true);

      // Check registry: active files remain registered, pruned files (both removed and preserved) are no longer managed
      const reg = await loadRegistry(tempDir);
      assert.ok(reg.files[fileA]);
      assert.ok(reg.files[fileC]);
      assert.equal(reg.files[fileB], undefined);
      assert.equal(reg.files[fileD], undefined);
    },
  );

  await t.test(
    'TASK-04 / AC-07, AC-12: companionEntries, catalog availability and packageEntries isolation',
    async () => {
      // 1. Catalog availability in source package
      assert.equal(await companionCatalogAvailable(), true);

      // 2. companionEntries for better
      const betterEntries = await companionEntries('better');
      assert.ok(betterEntries.length >= 37);
      assert.ok(betterEntries.some(e => e.path === 'specs/.omni/companions/better/INDEX.md'));
      assert.ok(betterEntries.some(e => e.path === 'specs/.omni/companions/better/LICENSE'));
      assert.ok(betterEntries.some(e => e.path === 'specs/.omni/companions/better/better-accessibility/SKILL.md'));

      // 3. companionEntries for frontend-design
      const fdEntries = await companionEntries('frontend-design');
      assert.equal(fdEntries.length, 4);
      assert.ok(fdEntries.some(e => e.path === 'specs/.omni/companions/frontend-design/INDEX.md'));
      assert.ok(fdEntries.some(e => e.path === 'specs/.omni/companions/frontend-design/SKILL.md'));
      assert.ok(fdEntries.some(e => e.path === 'specs/.omni/companions/frontend-design/LICENSE.txt'));

      // 4. none and undefined return []
      assert.deepEqual(await companionEntries('none'), []);
      assert.deepEqual(await companionEntries(undefined), []);

      // 5. Unknown companion throws actionable error
      await assert.rejects(
        async () => companionEntries('non-existent-companion'),
        /Invalid UI companion "non-existent-companion". Valid values: better, frontend-design, none/,
      );

      // 6. packageEntries does not contain companions/ (runtime isolation)
      const pkgEntries = await packageEntries();
      assert.equal(
        pkgEntries.some(e => e.path.includes('companions')),
        false,
      );
    },
  );

  await t.test('TASK-05 / AC-05, AC-06: CLI flags, manifest and schema validation', async () => {
    // 1. Rejected on commands other than init
    let res = runCli(['status', '--ui-companion', 'better'], '', tempDir);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /--ui-companion is supported only by init\./);

    res = runCli(['status', '--ui-components', 'shadcn'], '', tempDir);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /--ui-components is supported only by init\./);

    // 2. AC-05: init --yes --ui-companion <c> --ui-components <k> writes ui to manifest even without UI signal
    res = runCli(['init', '--yes', '--ui-companion', 'better', '--ui-components', 'shadcn'], '', tempDir);
    assert.equal(res.code, 0, res.stderr);
    const manifest = await loadManifest(tempDir);
    assert.deepEqual(manifest.ui, { companion: 'better', components: 'shadcn' });
  });

  await t.test('TASK-06 / AC-04, AC-05, AC-06: Wizard invalid values and interactive prompt conditions', async () => {
    // 1. AC-06: Invalid companion value terminates with non-zero and does not modify project
    const cleanDir = await mkdtemp(join(tmpdir(), 'omni-wizard-clean-'));
    try {
      let res = runCli(['init', '--yes', '--ui-companion', 'invalid-companion'], '', cleanDir);
      assert.equal(res.code, 1);
      assert.match(
        res.stderr,
        /Invalid --ui-companion "invalid-companion"\. Valid values: better, frontend-design, none/,
      );
      assert.equal(existsSync(join(cleanDir, 'specs')), false);

      res = runCli(['init', '--yes', '--ui-components', 'invalid-kit'], '', cleanDir);
      assert.equal(res.code, 1);
      assert.match(
        res.stderr,
        /Invalid --ui-components "invalid-kit"\. Valid values: shadcn, radix, headlessui, preline, flyonui, none/,
      );
      assert.equal(existsSync(join(cleanDir, 'specs')), false);
    } finally {
      await rm(cleanDir, { recursive: true, force: true });
    }

    // 2. AC-04: Without UI signal, interactive wizard does NOT ask UI questions
    const noSignalDir = await mkdtemp(join(tmpdir(), 'omni-no-signal-'));
    try {
      const res = runCli(['init', '--plain'], '2\ncodex\nsí\n', noSignalDir);
      assert.equal(res.code, 0, res.stderr);
      assert.doesNotMatch(res.stdout, /UI component kit|Sistema de componentes UI/);
      assert.doesNotMatch(res.stdout, /UI companion|Companion de UI/);
    } finally {
      await rm(noSignalDir, { recursive: true, force: true });
    }

    // 3. AC-04: With UI signal, interactive wizard asks UI questions
    const signalDir = await mkdtemp(join(tmpdir(), 'omni-signal-'));
    try {
      await writeFile(
        join(signalDir, 'package.json'),
        JSON.stringify({ name: 'signal-app', dependencies: { react: '^19.0.0', tailwindcss: '^4.0.0' } }),
      );
      // plain text prompt accepts default choices: lang (2 for es), agent (codex), components (default), companion (default), confirm (sí)
      const res = runCli(['init', '--plain'], '2\ncodex\n\n\nsí\n', signalDir);
      assert.equal(res.code, 0, res.stderr);
      assert.match(res.stdout, /Sistema de componentes|UI component/);
      assert.match(res.stdout, /Compañero de diseño|UI [Cc]ompanion/);
      assert.match(res.stdout, /UI: none · none/);
    } finally {
      await rm(signalDir, { recursive: true, force: true });
    }
  });

  await t.test('TASK-07 / AC-07, AC-08, AC-11: Scaffold companion installation, isolation and reinit', async () => {
    // 1. AC-07 & AC-08: init with better companion installs companion files, managed.json entries, no gitignore entry, no host pollution
    const betterDir = await mkdtemp(join(tmpdir(), 'omni-scaffold-better-'));
    try {
      const hostPaths = [
        'AGENTS.md',
        '.agents/',
        '.claude/',
        '.cursor/',
        '.gemini/',
        '.kilo/',
        '.opencode/',
        '.github/',
        '.codex/',
      ];
      const hostSnapshot = async () =>
        Object.fromEntries(
          Object.entries(await snapshot(betterDir)).filter(([name]) =>
            hostPaths.some(prefix => name === prefix || name.startsWith(prefix)),
          ),
        );
      const baseline = runCli(['init', '--yes', '--agent', 'all', '--ui-companion', 'none'], '', betterDir);
      assert.equal(baseline.code, 0, baseline.stderr);
      const hostsBefore = await hostSnapshot();
      const res = runCli(
        ['init', '--yes', '--agent', 'all', '--ui-companion', 'better', '--ui-components', 'shadcn'],
        '',
        betterDir,
      );
      assert.equal(res.code, 0, res.stderr);
      assert.equal(existsSync(join(betterDir, 'specs/.omni/companions/better/INDEX.md')), true);
      assert.equal(existsSync(join(betterDir, 'specs/.omni/companions/better/LICENSE')), true);
      assert.equal(existsSync(join(betterDir, 'specs/.omni/companions/better/ATTRIBUTION.md')), true);
      assert.equal(
        existsSync(join(betterDir, 'specs/.omni/companions/better/better-accessibility/focus-and-keyboard.md')),
        true,
      );

      // Managed registry tracks companion files
      const reg = await loadRegistry(betterDir);
      const expectedEntries = await companionEntries('better');
      assert.deepEqual(
        Object.keys(reg.files)
          .filter(name => name.startsWith('specs/.omni/companions/'))
          .sort(),
        expectedEntries.map(entry => entry.path).sort(),
      );
      for (const entry of expectedEntries) {
        assert.equal(await readFile(join(betterDir, entry.path), 'utf8'), entry.content, entry.path);
        assert.equal(reg.files[entry.path].hash, managedHash(entry.content), entry.path);
      }

      // gitignore does NOT contain companions
      const gitignore = await readFile(join(betterDir, 'specs/.gitignore'), 'utf8');
      assert.equal(gitignore.includes('companions'), false);

      assert.deepEqual(await hostSnapshot(), hostsBefore);

      // 2. AC-11: Reinit without --ui flags preserves existing manifest.ui
      const reinitRes = runCli(['init', '--yes'], '', betterDir);
      assert.equal(reinitRes.code, 0, reinitRes.stderr);
      const manifestAfter = await loadManifest(betterDir);
      assert.deepEqual(manifestAfter.ui, { companion: 'better', components: 'shadcn' });
      assert.equal(existsSync(join(betterDir, 'specs/.omni/companions/better/INDEX.md')), true);

      // 3. AC-11: Reinit changing companion to frontend-design prunes unedited better files
      // Edit one file in better first to check preservation
      const editedPath = join(betterDir, 'specs/.omni/companions/better/INDEX.md');
      await writeFile(editedPath, '# Locally modified index');

      const switchRes = runCli(['init', '--yes', '--ui-companion', 'frontend-design'], '', betterDir);
      assert.equal(switchRes.code, 0, switchRes.stderr);

      // frontend-design installed
      assert.equal(existsSync(join(betterDir, 'specs/.omni/companions/frontend-design/INDEX.md')), true);
      assert.equal(existsSync(join(betterDir, 'specs/.omni/companions/frontend-design/SKILL.md')), true);

      // unedited better files removed
      assert.equal(
        existsSync(join(betterDir, 'specs/.omni/companions/better/better-accessibility/focus-and-keyboard.md')),
        false,
      );
      // edited better file preserved
      assert.equal(existsSync(editedPath), true);
      assert.equal(await readFile(editedPath, 'utf8'), '# Locally modified index');
      const switchedRegistry = await loadRegistry(betterDir);
      assert.equal(Object.hasOwn(switchedRegistry.files, 'specs/.omni/companions/better/INDEX.md'), false);
      const activeEntries = await companionEntries('frontend-design');
      assert.deepEqual(
        Object.keys(switchedRegistry.files)
          .filter(name => name.startsWith('specs/.omni/companions/'))
          .sort(),
        activeEntries.map(entry => entry.path).sort(),
      );
      for (const entry of activeEntries) {
        assert.equal(await readFile(join(betterDir, entry.path), 'utf8'), entry.content, entry.path);
        assert.equal(switchedRegistry.files[entry.path].hash, managedHash(entry.content), entry.path);
      }
      const diagnostic = runCli(['doctor', '--json'], '', betterDir);
      assert.equal(diagnostic.code, 0, diagnostic.stderr);
      assert.equal(JSON.parse(diagnostic.stdout).healthy, true);
      assert.deepEqual((await loadManifest(betterDir)).ui, { companion: 'frontend-design', components: 'shadcn' });
      const noneRes = runCli(['init', '--yes', '--ui-companion', 'none'], '', betterDir);
      assert.equal(noneRes.code, 0, noneRes.stderr);
      assert.equal((await loadManifest(betterDir)).ui.companion, 'none');
      assert.equal(existsSync(join(betterDir, 'specs/.omni/companions/frontend-design/SKILL.md')), false);
      assert.equal(await readFile(editedPath, 'utf8'), '# Locally modified index');
      assert.deepEqual(
        Object.keys((await loadRegistry(betterDir)).files).filter(name => name.startsWith('specs/.omni/companions/')),
        [],
      );
    } finally {
      await rm(betterDir, { recursive: true, force: true });
    }

    // 4. AC-07: init with none companion does NOT create companions directory
    const noneDir = await mkdtemp(join(tmpdir(), 'omni-scaffold-none-'));
    try {
      const res = runCli(['init', '--yes', '--ui-companion', 'none'], '', noneDir);
      assert.equal(res.code, 0, res.stderr);
      assert.equal(existsSync(join(noneDir, 'specs/.omni/companions')), false);
    } finally {
      await rm(noneDir, { recursive: true, force: true });
    }
  });

  await t.test(
    'TASK-08 / AC-09: update restores deleted, conflicts on edited, and backs up on --accept-updates',
    async () => {
      const projDir = await mkdtemp(join(tmpdir(), 'omni-update-companion-'));
      try {
        const res = runCli(
          ['init', '--yes', '--ui-companion', 'frontend-design', '--ui-components', 'shadcn'],
          '',
          projDir,
        );
        assert.equal(res.code, 0, res.stderr);

        const skillPath = join(projDir, 'specs/.omni/companions/frontend-design/SKILL.md');
        assert.equal(existsSync(skillPath), true);

        // 1. Delete an unedited companion file -> update restores it
        await rm(skillPath);
        assert.equal(existsSync(skillPath), false);

        const updRes1 = await updateProject(projDir, {});
        assert.equal(updRes1.success, true);
        assert.equal(existsSync(skillPath), true);
        assert.ok(updRes1.assets.created.includes('specs/.omni/companions/frontend-design/SKILL.md'));

        const shipped = await readFile(skillPath, 'utf8');
        const relativeSkill = 'specs/.omni/companions/frontend-design/SKILL.md';
        await syncManagedFiles(projDir, [{ path: relativeSkill, content: '# Previous packaged release' }]);
        const oldSnapshot = await snapshot(projDir);
        const preview = await updateProject(projDir, { dryRun: true });
        assert.ok(preview.assets.updated.includes(relativeSkill));
        assert.deepEqual(await snapshot(projDir), oldSnapshot);
        const upgraded = await updateProject(projDir);
        assert.ok(upgraded.assets.updated.includes(relativeSkill));
        assert.deepEqual(upgraded.assets.backups, []);
        assert.equal(await readFile(skillPath, 'utf8'), shipped);

        // 2. Edit companion file locally -> update detects conflict
        await writeFile(skillPath, '# Locally modified skill');
        const editedSnapshot = await snapshot(projDir);
        const conflictingPreview = await updateProject(projDir, { dryRun: true });
        assert.ok(conflictingPreview.assets.conflicts.includes(relativeSkill));
        await assert.rejects(async () => updateProject(projDir, {}), /Local changes preserved; update blocked/);
        assert.deepEqual(await snapshot(projDir), editedSnapshot);

        // 3. update with acceptUpdates -> replaces file and creates backup
        const updRes2 = await updateProject(projDir, { acceptUpdates: true });
        assert.equal(updRes2.success, true);
        assert.ok(updRes2.assets.updated.includes('specs/.omni/companions/frontend-design/SKILL.md'));
        assert.ok(updRes2.assets.backups.length > 0);
        const backup = updRes2.assets.backups.find(path => path.endsWith(relativeSkill));
        assert.ok(backup);
        assert.equal(await readFile(join(projDir, backup), 'utf8'), '# Locally modified skill');
        assert.equal(await readFile(skillPath, 'utf8'), shipped);
      } finally {
        await rm(projDir, { recursive: true, force: true });
      }
    },
  );

  await t.test('TASK-09 / AC-10: design.md carries UI companion rule and plan.md references it', async () => {
    const designPath = join(fileURLToPath(new URL('../src/resources/design.md', import.meta.url)));
    const planPath = join(fileURLToPath(new URL('../src/templates/01-feature/plan.md', import.meta.url)));

    const designContent = await readFile(designPath, 'utf8');
    const planContent = await readFile(planPath, 'utf8');

    // design.md checks
    assert.ok(designContent.includes('## UI companion'));
    assert.match(designContent, /specs\/\.omni\/companions\/<ui\.companion>\/INDEX\.md/);
    assert.match(
      designContent,
      /La constitución del proyecto y esta guía prevalecen sobre cualquier heurística del companion/,
    );
    assert.match(designContent, /no sustituye la comprobación ni la evidencia de aceptación/);

    // plan.md checks
    assert.match(
      planContent,
      /If specs\/manifest\.json declares ui\.companion, follow the .*UI companion.* rule in guide design and record the files consulted\./,
    );
  });
});
