import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI } from '../test-support/studio-fixtures.mjs';
import { newPipePath, newSecret } from '../test-support/studio-host.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const run = (args, options = {}) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 30000, windowsHide: true, ...options });

describe('CLI-S studio-engine command', () => {
  test('CLI-S-01 help lists studio-engine under the internal commands', () => {
    const result = run(['--help']);
    assert.equal(result.status, 0);
    const internal = result.stdout.slice(result.stdout.search(/internal/i));
    assert.ok(result.stdout.search(/internal/i) > 0, 'an internal section exists');
    assert.match(internal, /^\s+studio-engine\b/m);
  });

  test('CLI-S-02 studio-engine without --pipe prints usage and exits 2', () => {
    const result = run(['studio-engine'], { input: newSecret() + '\n' });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /--pipe/);
  });

  test('CLI-S-03 studio-engine outside an OmniSpec project runs in studio mode and writes nothing there', () => {
    const outside = mkdtempSync(join(tmpdir(), 'omni-no-project-'));
    const home = mkdtempSync(join(tmpdir(), 'omni-studio-home-'));
    try {
      const result = run(['studio-engine', '--pipe', newPipePath()], {
        cwd: outside,
        input: newSecret() + '\n',
        env: { ...process.env, OMNI_STUDIO_HOME: home },
      });
      // Nobody listens on the pipe, so the engine cannot connect; it must not refuse the folder itself.
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stderr, /omni-spec init/i);
      assert.deepEqual(readdirSync(outside), []);
    } finally {
      rmSync(outside, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('PKG npm package stays independent of apps/studio', () => {
  function packedFiles() {
    const npmCli = process.env.npm_execpath;
    const args = ['pack', '--dry-run', '--json', '--ignore-scripts'];
    const result = npmCli
      ? spawnSync(process.execPath, [npmCli, ...args], { cwd: ROOT, encoding: 'utf8', windowsHide: true })
      : spawnSync('npm', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout)[0].files.map(file => file.path.replaceAll('\\', '/'));
  }

  test('PKG-01 the npm tarball contains nothing from apps/', () => {
    const files = packedFiles();
    assert.ok(files.includes('src/cli.mjs'));
    assert.deepEqual(
      files.filter(path => path.startsWith('apps/')),
      [],
    );
  });

  test('PKG-02 the root package keeps zero runtime dependencies', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(manifest.dependencies, undefined);
    assert.equal(manifest.workspaces, undefined, 'apps/studio must not become a root workspace (D-16)');
  });
});
