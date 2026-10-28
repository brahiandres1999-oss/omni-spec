import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { runWizard } from '../src/wizard.mjs';
import { TerminalInstaller } from '../src/terminal-ui.mjs';
import { scaffoldProject } from '../src/generator.mjs';
import { checkProjectVersion } from '../src/updater.mjs';
import { detectPluginCoexistence, installPlugin } from '../src/plugin-manager.mjs';

const bin = fileURLToPath(new URL('../bin/omni-spec.mjs', import.meta.url));

describe('plugin coexistence and duplication diagnosis', () => {
  let testDir;
  let pluginDir;
  let projectDir;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'omni-coexist-'));
    pluginDir = join(testDir, '.gemini', 'config', 'plugins', 'omni-spec');
    projectDir = join(testDir, 'test-project');
    await mkdir(pluginDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  async function createMockPlugin(dir = pluginDir, version = '0.8.0-preview.1') {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'plugin.json'), JSON.stringify({ name: 'omni-spec' }));
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'omni-spec', version }));
  }

  function runCli(args, input = '', cwd = projectDir, home = testDir) {
    const result = spawnSync(process.execPath, [bin, ...args], {
      cwd,
      input,
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
      env: {
        ...process.env,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        HOME: home,
        USERPROFILE: home,
      },
    });
    assert.ifError(result.error);
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  test('AC-01 / AC-10: detectPluginCoexistence returns null if project is missing, plugin absent or skills absent', async () => {
    // 1. Outside project
    assert.equal(await detectPluginCoexistence(join(testDir, 'non-existent'), { targetDir: pluginDir }), null);

    // 2. Project without plugin
    await scaffoldProject(projectDir, { agent: 'antigravity' });
    assert.equal(await detectPluginCoexistence(projectDir, { targetDir: pluginDir }), null);

    // 3. Plugin present, but project has no registered local skills (clean plugin mode)
    await createMockPlugin(pluginDir);
    const cleanDir = join(testDir, 'clean-project');
    await mkdir(cleanDir, { recursive: true });
    await scaffoldProject(cleanDir, { agent: 'plugin' });
    assert.equal(await detectPluginCoexistence(cleanDir, { targetDir: pluginDir }), null);

    // 4. Directory has an unregistered custom skill in .agents/skills
    const customSkillDir = join(cleanDir, '.agents', 'skills', 'custom-skill');
    await mkdir(customSkillDir, { recursive: true });
    await writeFile(join(customSkillDir, 'SKILL.md'), '---\nname: custom\n---\nCustom skill');
    assert.equal(await detectPluginCoexistence(cleanDir, { targetDir: pluginDir }), null);
  });

  test('AC-05: Projects declared exclusively for other agents (claude, cursor, copilot, codex) never diagnose Antigravity coexistence', async () => {
    await createMockPlugin(pluginDir);

    for (const otherAgent of ['claude', 'cursor', 'copilot', 'codex', 'opencode', 'kilo', 'gemini', 'generic']) {
      const dir = join(testDir, `proj-${otherAgent}`);
      await mkdir(dir, { recursive: true });
      await scaffoldProject(dir, { agent: otherAgent });
      const diag = await detectPluginCoexistence(dir, { targetDir: pluginDir });
      assert.equal(diag, null, `Should not diagnose coexistence for ${otherAgent}`);
    }
  });

  test('AC-01: detectPluginCoexistence detects coexistence and provides canClean: true for antigravity-only project', async () => {
    await createMockPlugin(pluginDir);
    await scaffoldProject(projectDir, { agent: 'antigravity' });

    const diag = await detectPluginCoexistence(projectDir, { targetDir: pluginDir });
    assert.ok(diag);
    assert.equal(diag.detected, true);
    assert.equal(diag.pluginDir, pluginDir);
    assert.ok(diag.localSkills.includes('.agents/skills/omni-init/SKILL.md'));
    assert.equal(diag.canClean, true);
    assert.deepEqual(diag.actions, ['keep-local', 'review-clean']);
    assert.match(diag.message, /Posible duplicación de comandos/);
    assert.match(diag.message, /omni-spec clean --dry-run/);
  });

  test('AC-01 / AC-07: detectPluginCoexistence detects coexistence but sets canClean: false for mixed project', async () => {
    await createMockPlugin(pluginDir);
    await scaffoldProject(projectDir, { agent: 'antigravity,claude' });

    const diag = await detectPluginCoexistence(projectDir, { targetDir: pluginDir });
    assert.ok(diag);
    assert.equal(diag.detected, true);
    assert.equal(diag.canClean, false);
    assert.deepEqual(diag.actions, ['keep-local']);
    assert.match(diag.message, /otras herramientas/);
    assert.match(diag.message, /conserva las skills locales/);
  });

  test('AC-01: residual local skills in plugin mode are detected as coexistence', async () => {
    await createMockPlugin(pluginDir);
    await scaffoldProject(projectDir, { agent: 'antigravity' });

    // Manually switch manifest agent to 'plugin' while keeping .agents/skills
    const manifestPath = join(projectDir, 'specs', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.agent = 'plugin';
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const diag = await detectPluginCoexistence(projectDir, { targetDir: pluginDir });
    assert.ok(diag);
    assert.equal(diag.detected, true);
    assert.equal(diag.canClean, true);
  });

  test('AC-01: checkProjectVersion and CLI doctor include pluginCoexistence without altering healthy state', async () => {
    await createMockPlugin(pluginDir);
    await scaffoldProject(projectDir, { agent: 'antigravity' });

    const check = await checkProjectVersion(projectDir, { targetDir: pluginDir });
    assert.equal(check.isInstalled, true);
    assert.equal(check.healthy, true);
    assert.ok(check.pluginCoexistence);
    assert.equal(check.pluginCoexistence.detected, true);

    // Test doctor via CLI subprocess with isolated HOME
    const proc = runCli(['doctor'], '', projectDir, testDir);
    assert.equal(proc.code, 0, proc.stderr);
    assert.match(proc.stdout, /FILES SYNCHRONIZED/);
    assert.match(proc.stdout, /Coexistencia de plugin/);

    // Doctor with --json
    const procJson = runCli(['doctor', '--json'], '', projectDir, testDir);
    assert.equal(procJson.code, 0);
    const parsed = JSON.parse(procJson.stdout);
    assert.equal(parsed.healthy, true);
    assert.ok(parsed.pluginCoexistence);
    assert.equal(parsed.pluginCoexistence.detected, true);
  });

  test('AC-04: installPlugin detects coexistence when executed within project with local skills', async () => {
    await scaffoldProject(projectDir, { agent: 'antigravity' });

    const res = await installPlugin({ targetDir: pluginDir, projectDir });
    assert.equal(res.success, true);
    assert.ok(res.pluginCoexistence);
    assert.equal(res.pluginCoexistence.detected, true);
    assert.equal(res.pluginCoexistence.canClean, true);

    // Outside project
    const resOutside = await installPlugin({ targetDir: pluginDir, projectDir: testDir });
    assert.equal(resOutside.pluginCoexistence, undefined);
  });

  test('AC-03: runWizard with --yes retains deterministic non-interactive behavior without prompting', () => {
    const res = runCli(['init', '--yes', '--agent', 'antigravity'], '', projectDir, testDir);
    assert.equal(res.code, 0, res.stderr);
  });

  test('AC-02: runWizard interactive plain mode allows selecting plugin mode when Antigravity alone is chosen', async () => {
    await createMockPlugin(pluginDir);

    // 1 (English) -> antigravity -> 2 (Plugin mode) -> yes
    const res = runCli(['init'], '1\nantigravity\n2\nyes\n', projectDir, testDir);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /Antigravity global plugin detected/);
    assert.match(res.stdout, /Selected integrations: plugin/);

    const manifest = JSON.parse(await readFile(join(projectDir, 'specs', 'manifest.json'), 'utf8'));
    assert.equal(manifest.agent, 'plugin');

    // Confirm no local .agents/skills were created
    await assert.rejects(stat(join(projectDir, '.agents', 'skills')));
  });

  test('AC-02: runWizard interactive plain mode defaults to project mode when choice 1 is selected', async () => {
    await createMockPlugin(pluginDir);

    // 1 (English) -> antigravity -> 1 (Project mode) -> yes
    const res = runCli(['init'], '1\nantigravity\n1\nyes\n', projectDir, testDir);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /Selected integrations: antigravity/);

    const manifest = JSON.parse(await readFile(join(projectDir, 'specs', 'manifest.json'), 'utf8'));
    assert.equal(manifest.agent, 'antigravity');

    // Confirm local .agents/skills were created
    const skillStat = await stat(join(projectDir, '.agents', 'skills', 'omni-init', 'SKILL.md'));
    assert.ok(skillStat.isFile());
  });

  test('AC-07: runWizard interactive plain mode keeps local adapters when multiple tools are chosen', async () => {
    await createMockPlugin(pluginDir);

    // 1 (English) -> antigravity,claude -> yes
    const res = runCli(['init'], '1\nantigravity,claude\nyes\n', projectDir, testDir);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /Antigravity plugin installed: local skills will be kept/);
    assert.match(res.stdout, /Selected integrations: antigravity,claude/);

    const manifest = JSON.parse(await readFile(join(projectDir, 'specs', 'manifest.json'), 'utf8'));
    assert.equal(manifest.agent, 'antigravity,claude');
  });

  test('AC-08: reinitialization does not alter existing agent configuration', async () => {
    await createMockPlugin(pluginDir);
    await scaffoldProject(projectDir, { agent: 'antigravity' });

    // Running init on existing project with --yes
    const res = runCli(['init', '--yes'], '', projectDir, testDir);
    assert.equal(res.code, 0, res.stderr);

    const manifest = JSON.parse(await readFile(join(projectDir, 'specs', 'manifest.json'), 'utf8'));
    assert.equal(manifest.agent, 'antigravity');
  });

  test('AC-11: detectPluginCoexistence is read-only and does not write or modify files', async () => {
    await createMockPlugin(pluginDir);
    await scaffoldProject(projectDir, { agent: 'antigravity' });

    const fileStatBefore = await stat(join(projectDir, '.agents', 'skills', 'omni-init', 'SKILL.md'));
    const manifestStatBefore = await stat(join(projectDir, 'specs', 'manifest.json'));

    await detectPluginCoexistence(projectDir, { targetDir: pluginDir });

    const fileStatAfter = await stat(join(projectDir, '.agents', 'skills', 'omni-init', 'SKILL.md'));
    const manifestStatAfter = await stat(join(projectDir, 'specs', 'manifest.json'));

    assert.equal(fileStatBefore.mtimeMs, fileStatAfter.mtimeMs);
    assert.equal(manifestStatBefore.mtimeMs, manifestStatAfter.mtimeMs);
  });

  test('interactive agent flags still offer mode choice and mixed-tool explanation', async () => {
    await createMockPlugin();
    const plugin = runCli(['init', '--plain', '--lang', 'en', '--agent', 'antigravity'], '2\nyes\n');
    assert.equal(plugin.code, 0, plugin.stderr);
    assert.equal(JSON.parse(await readFile(join(projectDir, 'specs/manifest.json'), 'utf8')).agent, 'plugin');
    const mixedDir = join(testDir, 'mixed');
    await mkdir(mixedDir);
    const mixed = runCli(['init', '--plain', '--lang', 'en', '--ai', 'antigravity,claude'], 'yes\n', mixedDir);
    assert.equal(mixed.code, 0, mixed.stderr);
    assert.match(mixed.stdout, /local skills will be kept/);
  });

  test('invalid mode input is retried, while explicit cancellation is successful and writes nothing', async () => {
    await createMockPlugin();
    const retry = runCli(['init', '--plain', '--lang', 'en'], 'antigravity\nbanana\n2\nyes\n');
    assert.equal(retry.code, 0, retry.stderr);
    assert.match(retry.stdout, /Choose a number/);
    assert.equal(JSON.parse(await readFile(join(projectDir, 'specs/manifest.json'), 'utf8')).agent, 'plugin');
    const cancelledDir = join(testDir, 'cancelled');
    await mkdir(cancelledDir);
    const cancelled = runCli(['init', '--plain', '--lang', 'en'], 'antigravity\n1\nno\n', cancelledDir);
    assert.equal(cancelled.code, 0, cancelled.stderr);
    assert.match(cancelled.stdout, /Cancelled/);
    await assert.rejects(stat(join(cancelledDir, 'specs')), { code: 'ENOENT' });
    const eof = runCli(['init', '--plain', '--lang', 'en'], 'antigravity\nn\n', cancelledDir);
    assert.equal(eof.code, 1);
    await assert.rejects(stat(join(cancelledDir, 'specs')), { code: 'ENOENT' });
  });

  test('project diagnostic errors fail before changing an existing plugin', async () => {
    await createMockPlugin(pluginDir, 'sentinel');
    await mkdir(join(projectDir, 'specs'));
    await writeFile(join(projectDir, 'specs/manifest.json'), '{invalid');
    await assert.rejects(installPlugin({ targetDir: pluginDir, projectDir }), /manifest/);
    assert.equal(JSON.parse(await readFile(join(pluginDir, 'package.json'), 'utf8')).version, 'sentinel');
  });

  test('registered directories are not skills and missing entries do not diagnose coexistence', async () => {
    await createMockPlugin();
    await scaffoldProject(projectDir, { agent: 'antigravity' });
    const registry = JSON.parse(await readFile(join(projectDir, 'specs/.omni/managed.json'), 'utf8'));
    for (const name of Object.keys(registry.files).filter(name => name.startsWith('.agents/skills/'))) {
      await rm(join(projectDir, name));
      await mkdir(join(projectDir, name));
    }
    assert.equal(await detectPluginCoexistence(projectDir, { targetDir: pluginDir }), null);
  });

  test('TUI renders mixed explanation and flag mode choice, handles real key bytes and releases terminal', async () => {
    await createMockPlugin();
    for (const language of ['en', 'es']) {
      for (const mixed of [false, true]) {
        const input = new PassThrough();
        const output = new PassThrough();
        input.isTTY = output.isTTY = true;
        input.isRaw = false;
        input.setRawMode = value => {
          input.isRaw = value;
        };
        output.columns = 100;
        output.rows = 36;
        let frames = '';
        output.on('data', chunk => {
          frames += chunk.toString();
        });
        const original = TerminalInstaller.prototype.choose;
        const prompts = [];
        TerminalInstaller.prototype.choose = function (question) {
          prompts.push(question);
          const result = original.call(this, question);
          setImmediate(() => {
            if (question.multiple) input.write(' \x1b[B \r');
            else if (question.options.some(option => option.value === 'plugin')) input.write('\x1b[B\r');
            else input.write('\r');
          });
          return result;
        };
        try {
          const config = await runWizard(
            projectDir,
            {
              lang: language,
              pluginDir,
              ...(mixed ? {} : { agent: 'antigravity' }),
            },
            { input, output, env: {} },
          );
          assert.equal(config.agent, mixed ? 'antigravity,claude' : 'plugin');
          const text = stripVTControlCharacters(frames).replace(/\s+/g, ' ');
          if (mixed)
            assert.match(text, language === 'es' ? /se conservarán las skills locales/ : /local skills will be kept/);
          else assert.match(text, language === 'es' ? /sin generar nuevas skills locales/ : /no new local skills/);
          assert.ok(prompts.at(-1).details.some(detail => detail.includes(config.agent)));
          assert.equal(input.isRaw, false);
          assert.equal(input.listenerCount('keypress'), 0);
        } finally {
          TerminalInstaller.prototype.choose = original;
          input.destroy();
          output.destroy();
        }
      }
    }
  });

  test('CLI plugin install/update/upgrade diagnose the enclosing project from a subdirectory', async () => {
    await scaffoldProject(projectDir, { agent: 'antigravity' });
    const nested = join(projectDir, 'nested');
    await mkdir(nested);
    for (const sub of ['install', 'update', 'upgrade']) {
      const result = runCli(['plugin', sub, '--json'], '', nested);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).pluginCoexistence.detected, true);
    }
  });
});
