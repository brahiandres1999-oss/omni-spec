import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, type Page, chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
export const STUDIO_EXE = resolve(HERE, '../../src-tauri/target/debug/omni-studio.exe');
const OMNI_CLI = resolve(HERE, '../../../../bin/omni-spec.mjs');

export interface Project {
  root: string;
  git(...args: string[]): string;
  cli(...args: string[]): string;
  write(rel: string, text: string): void;
  commit(message: string): void;
  cleanup(): void;
}

/** Real OmniSpec project initialised with the repository CLI. */
export function makeProject(prefix = 'omni-e2e-'): Project {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const cli = (...args: string[]) =>
    execFileSync(process.execPath, [OMNI_CLI, ...args], { cwd: root, encoding: 'utf8' });
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'e2e@example.com');
  git('config', 'user.name', 'E2E');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  cli('init', '--yes');
  const commit = (message: string) => {
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', message);
  };
  commit('init');
  return {
    root,
    git,
    cli,
    write,
    commit,
    cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
}

export function numberedLines(count: number, label = 'line'): string {
  return Array.from({ length: count }, (_, index) => `${label} ${index + 1}`).join('\n') + '\n';
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('no port'));
      server.close(() => resolvePort(address.port));
    });
  });
}

export interface ProcessInfo {
  pid: number;
  parentPid: number;
  name: string;
}

/** Every process on the machine with its parent, from Win32_Process. */
export function processTable(): ProcessInfo[] {
  const json = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return (JSON.parse(json) as { ProcessId: number; ParentProcessId: number; Name: string }[]).map(row => ({
    pid: row.ProcessId,
    parentPid: row.ParentProcessId,
    name: row.Name,
  }));
}

export function descendants(rootPid: number, table = processTable()): ProcessInfo[] {
  const found: ProcessInfo[] = [];
  const queue = [rootPid];
  while (queue.length) {
    const parent = queue.shift();
    for (const row of table)
      if (row.parentPid === parent && !found.some(entry => entry.pid === row.pid)) {
        found.push(row);
        queue.push(row.pid);
      }
  }
  return found;
}

export function alive(pids: number[], table = processTable()): number[] {
  const live = new Set(table.map(row => row.pid));
  return pids.filter(pid => live.has(pid));
}

export async function waitUntil(check: () => boolean, timeoutMs: number, what: string): Promise<number> {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`${what}: not within ${timeoutMs} ms`);
    await new Promise(done => setTimeout(done, 100));
  }
  return Date.now() - startedAt;
}

export interface Studio {
  process: ChildProcess;
  browser: Browser;
  page: Page;
  exit: Promise<number | null>;
  stop(): Promise<void>;
}

/** Launches the debug build for `projectRoot` and attaches Playwright to its WebView2 over CDP. */
export async function launchStudio(projectRoot: string, extraArgs: string[] = []): Promise<Studio> {
  if (!existsSync(STUDIO_EXE))
    throw new Error(`Build the debug app first: npm run tauri build -- --debug (missing ${STUDIO_EXE})`);
  const port = await freePort();
  const child = spawn(STUDIO_EXE, [projectRoot, ...extraArgs], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      OMNI_STUDIO_USER_DATA: mkdtempSync(join(tmpdir(), 'omni-e2e-userdata-')),
    },
    stdio: 'ignore',
  });
  const exit = new Promise<number | null>(done => child.on('exit', code => done(code)));
  let browser: Browser | undefined;
  const deadline = Date.now() + 20_000;
  while (!browser) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise(done => setTimeout(done, 200));
    }
  }
  const context = browser.contexts()[0];
  if (!context) throw new Error('WebView2 exposed no browser context');
  const page = context.pages()[0] ?? (await context.waitForEvent('page'));
  return {
    process: child,
    browser,
    page,
    exit,
    async stop() {
      await browser?.close();
      if (child.exitCode === null) {
        try {
          execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } catch {
          // WebView2's sandboxed renderers refuse TerminateProcess ("operación no permitida"); they
          // exit with their browser process once studio.exe is gone.
        }
        await exit;
      }
    },
  };
}
