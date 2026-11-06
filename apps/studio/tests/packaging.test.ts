import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const STUDIO = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO = resolve(STUDIO, '../..');
const TAURI = join(STUDIO, 'src-tauri');
const RELEASE = join(TAURI, 'target', 'release');
const conf = JSON.parse(readFileSync(join(TAURI, 'tauri.conf.json'), 'utf8'));
const rootVersion = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version as string;
const installer = () => {
  const dir = join(RELEASE, 'bundle', 'nsis');
  const file = existsSync(dir) ? readdirSync(dir).find(name => name.endsWith('-setup.exe')) : undefined;
  if (!file) throw new Error(`No NSIS installer in ${dir}; run npm run tauri build first.`);
  return join(dir, file);
};
/** Installing writes HKCU and the Start Menu of the current user: CI runners only. */
const onCi = process.platform === 'win32' && process.env.CI === 'true';
const regQuery = (key: string) => spawnSync('reg', ['query', key], { encoding: 'utf8' });
const SHELL_KEYS = [
  'HKCU\\Software\\Classes\\Directory\\shell\\OmniStudio',
  'HKCU\\Software\\Classes\\Directory\\Background\\shell\\OmniStudio',
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe('PK packaging', () => {
  test('PK-01 the bundle ships the omni-spec core as resources without node_modules, tests or source maps', () => {
    installer();
    const resources = join(RELEASE, 'omni-spec');
    for (const required of ['bin/omni-spec.mjs', 'src/cli.mjs', 'src/studio/engine.mjs', 'schema', 'skills'])
      expect(existsSync(join(resources, required)), required).toBe(true);
    const files = walk(resources).map(path => path.slice(resources.length + 1).replaceAll('\\', '/'));
    expect(files.filter(path => /(^|\/)(node_modules|test|test-support)\//.test(path))).toEqual([]);
    expect(files.filter(path => path.endsWith('.map'))).toEqual([]);
    expect(walk(join(STUDIO, 'dist')).filter(path => path.endsWith('.map'))).toEqual([]);
  });

  test('PK-02 the NSIS hooks register the Explorer context menu under HKCU and remove it on uninstall', () => {
    const hooks = readFileSync(join(TAURI, 'windows', 'hooks.nsh'), 'utf8');
    expect(conf.bundle.windows.nsis.installerHooks).toBe('./windows/hooks.nsh');
    for (const key of [
      'Software\\Classes\\Directory\\shell\\OmniStudio',
      'Software\\Classes\\Directory\\Background\\shell\\OmniStudio',
    ]) {
      expect(hooks).toContain(`WriteRegStr HKCU "${key}\\command" "" '"$INSTDIR\\omni-studio.exe" "%V"'`);
      expect(hooks).toContain(`DeleteRegKey HKCU "${key}"`);
    }
    if (!onCi) return;
    execFileSync(installer(), ['/S']);
    for (const key of SHELL_KEYS) expect(regQuery(`${key}\\command`).stdout).toContain('"%V"');
    const uninstaller = join(process.env.LOCALAPPDATA ?? '', 'Omni Studio', 'uninstall.exe');
    execFileSync(uninstaller, ['/S']);
    for (const key of SHELL_KEYS) expect(regQuery(key).status).not.toBe(0);
  });

  test('PK-03 the installer is per-user (no administrator rights)', () => {
    expect(conf.bundle.targets).toEqual(['nsis']);
    expect(conf.bundle.windows.nsis.installMode).toBe('currentUser');
  });

  test('PK-04 WebView2 is installed with the download bootstrapper', () => {
    expect(conf.bundle.windows.webviewInstallMode.type).toBe('downloadBootstrapper');
  });

  test('PK-05 app, Tauri config and crate versions match the root package', () => {
    const app = JSON.parse(readFileSync(join(STUDIO, 'package.json'), 'utf8')).version;
    const cargo = /^version = "([^"]+)"/m.exec(readFileSync(join(TAURI, 'Cargo.toml'), 'utf8'))?.[1];
    expect({ app, tauri: conf.version, cargo }).toEqual({ app: rootVersion, tauri: rootVersion, cargo: rootVersion });
  });

  test('PK-06 the installer size is reported (budget 15 MB, informative)', () => {
    const megabytes = statSync(installer()).size / 1024 / 1024;
    console.log(`PK-06 installer ${megabytes.toFixed(2)} MB`);
    expect(megabytes).toBeGreaterThan(0);
  });

  test.runIf(onCi)('PK-07 uninstalling leaves no shortcut, key or process', () => {
    execFileSync(installer(), ['/S']);
    const startMenu = join(
      process.env.APPDATA ?? '',
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Omni Studio.lnk',
    );
    expect(existsSync(startMenu)).toBe(true);
    execFileSync(join(process.env.LOCALAPPDATA ?? '', 'Omni Studio', 'uninstall.exe'), ['/S']);
    expect(existsSync(startMenu)).toBe(false);
    for (const key of SHELL_KEYS) expect(regQuery(key).status).not.toBe(0);
    const tasks = execFileSync('tasklist', ['/FI', 'IMAGENAME eq omni-studio.exe'], { encoding: 'utf8' });
    expect(tasks).not.toContain('omni-studio.exe');
  });
});
