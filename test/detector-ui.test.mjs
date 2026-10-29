import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { detectProjectEnvironment } from '../src/detector.mjs';
import { loadManifest } from '../src/manifest.mjs';
import { runWizard } from '../src/wizard.mjs';
import { updateProject } from '../src/updater.mjs';
import { TerminalInstaller } from '../src/terminal-ui.mjs';

const cli = fileURLToPath(new URL('../bin/omni-spec.mjs', import.meta.url));

function runCli(args, stdin = '', cwd = process.cwd()) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    input: stdin,
    encoding: 'utf8',
  });
  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

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

test('UI Detector: detects tailwindcss and styling packages', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'omni-detector-tw-'));
  try {
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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('UI Detector: detects shadcn, radix, headlessui, preline and flyonui', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'omni-detector-kits-'));
  try {
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

    // 2. radix and others
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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('UI Detector: monorepo subdirectories and non-UI module isolation', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'omni-detector-mono-'));
  try {
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

    const result = await detectProjectEnvironment(tempDir);
    assert.equal(result.ui.signal, true);
    assert.deepEqual(result.ui.frameworks, ['react']);
    assert.deepEqual(result.ui.styling, ['tailwindcss']);
    assert.deepEqual(result.ui.modules, ['apps/web']);
    const webMod = result.modules.find(m => m.directory === 'apps/web');
    const apiMod = result.modules.find(m => m.directory === 'apps/api');
    assert.ok(webMod.ui);
    assert.equal(apiMod.ui, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('UI Wizard: prompts for component kit on UI signal and does not prompt for companions', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'omni-wizard-ui-'));
  try {
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'wizard-ui-fixture',
        dependencies: { react: '19.0.0' },
      }),
    );
    const { config, prompts } = await tuiWizard(tempDir, { lang: 'es', agent: 'claude' }, question => {
      if (question.options?.some(o => o.value === 'shadcn')) return chooseValue(question, 'shadcn');
      return '\r';
    });
    assert.deepEqual(config.ui, { components: 'shadcn' });
    assert.equal(config.ui.companion, undefined);
    assert.ok(prompts.some(q => q.options?.some(o => o.value === 'shadcn')));
    assert.ok(!prompts.some(q => q.options?.some(o => o.value === 'better' || o.value === 'frontend-design')));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('CLI: --ui-companion flag is rejected as unknown option', () => {
  const res = runCli(['init', '--yes', '--ui-companion', 'better']);
  assert.equal(res.code, 1);
  assert.ok(res.stderr.includes('Unknown option: --ui-companion'));
});

test('CLI: init creates project without companions directory or manifest companion field', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'omni-init-clean-'));
  try {
    const res = runCli(['init', '--yes', '--agent', 'plugin', '--ui-components', 'shadcn'], '', tempDir);
    assert.equal(res.code, 0, res.stderr);
    assert.equal(existsSync(join(tempDir, 'specs/.omni/companions')), false);
    const manifest = await loadManifest(tempDir);
    assert.deepEqual(manifest.ui, { components: 'shadcn' });
    assert.equal(manifest.ui.companion, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Updater: update preserves clean project without creating companions directory', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'omni-update-clean-'));
  try {
    const initRes = runCli(['init', '--yes', '--agent', 'plugin'], '', tempDir);
    assert.equal(initRes.code, 0, initRes.stderr);

    const updRes = await updateProject(tempDir, {});
    assert.equal(updRes.success, true);
    assert.equal(existsSync(join(tempDir, 'specs/.omni/companions')), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Schema and Templates: companion references removed from schema, design.md and plan.md', async () => {
  const schemaPath = fileURLToPath(new URL('../schema/manifest.schema.json', import.meta.url));
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  assert.equal(schema.properties.ui.properties.companion, undefined);
  assert.deepEqual(schema.properties.ui.required, ['components']);

  const designPath = fileURLToPath(new URL('../src/resources/design.md', import.meta.url));
  const design = await readFile(designPath, 'utf8');
  assert.ok(!design.includes('## UI companion'));
  assert.ok(!design.includes('specs/.omni/companions/'));

  const planPath = fileURLToPath(new URL('../src/templates/01-feature/plan.md', import.meta.url));
  const plan = await readFile(planPath, 'utf8');
  assert.ok(!plan.includes('ui.companion'));
  assert.ok(!plan.includes('UI companion'));
});
