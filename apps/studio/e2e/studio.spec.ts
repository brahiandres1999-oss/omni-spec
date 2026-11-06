import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import {
  type Project,
  type Studio,
  STUDIO_EXE,
  alive,
  descendants,
  launchStudio,
  makeProject,
  numberedLines,
  processTable,
  waitUntil,
} from './support/studio';

test.skip(process.platform !== 'win32', 'Omni Studio E2E runs on Windows only');

const GATE2_TEXT =
  'Compuerta 2 Bloqueada: Se requiere la atestación criptográfica HMAC de las pruebas unitarias y la verificación de 0 regresiones antes de autorizar el commit';

let project: Project;
let studio: Studio | undefined;

test.beforeEach(() => {
  project = makeProject();
});

test.afterEach(async () => {
  await studio?.stop();
  studio = undefined;
  project.cleanup();
});

async function open(root = project.root): Promise<Page> {
  studio = await launchStudio(root);
  await studio.page.getByRole('main').waitFor();
  return studio.page;
}

// Stage tabs only: the Inspector also has a "FinOps" tab (SH-03 vs SH-07).
const view = (page: Page, name: RegExp) =>
  page.getByRole('tablist', { name: 'Vistas' }).getByRole('tab', { name }).click();

/** Engine (node.exe) and terminal shells started by Studio, found in the live process tree. */
function studioChildren(): { engine: number[]; shells: number[]; all: number[] } {
  if (!studio?.process.pid) throw new Error('studio not running');
  const tree = descendants(studio.process.pid);
  return {
    engine: tree.filter(row => row.name.toLowerCase() === 'node.exe').map(row => row.pid),
    shells: tree.filter(row => /^(pwsh|powershell|cmd)\.exe$/i.test(row.name)).map(row => row.pid),
    all: tree.filter(row => !/^msedgewebview2\.exe$/i.test(row.name)).map(row => row.pid),
  };
}

test('E2E-01 the project is hydrated from process start in under 1.5 s (suite floor; bench target 500 ms)', async () => {
  project.cli('create', 'feature', 'login-flow', '--light');
  const page = await open();
  await page.waitForFunction(() => performance.getEntriesByName('studio:hydrated').length > 0);
  const boot = await page.evaluate(
    () =>
      (window as unknown as { __OMNI_STUDIO_BOOT__: { processStartEpochMs: number; hydratedEpochMs: number } })
        .__OMNI_STUDIO_BOOT__,
  );
  expect(boot.processStartEpochMs).toBeGreaterThan(0);
  const elapsed = boot.hydratedEpochMs - boot.processStartEpochMs;
  console.log(`E2E-01 process start → studio:hydrated = ${elapsed} ms`);
  expect(elapsed).toBeLessThan(1500);
  await expect(page.getByText('Login Flow')).toBeVisible();
});

test('E2E-02 loading → ready accumulates zero layout shift in all five views', async () => {
  project.cli('create', 'feature', 'login-flow', '--standard');
  project.write('src/a.ts', 'export const a = 1;\n');
  const page = await open();
  await page.evaluate(() => {
    const store = window as unknown as { __cls: number };
    store.__cls = 0;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[])
        if (!entry.hadRecentInput) store.__cls += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  for (const name of [/Kanban/, /Cartografía/, /Diffs/, /FinOps/, /Skills/]) {
    await view(page, name);
    await page.locator('[aria-busy="true"]').first().waitFor({ state: 'detached' });
  }
  expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBe(0);
});

test('E2E-03 an external edit refreshes the diff without reloading the page', async () => {
  project.write('src/app.txt', numberedLines(20));
  project.commit('base');
  const page = await open();
  await view(page, /Diffs/);
  let navigations = 0;
  page.on('framenavigated', () => navigations++);
  const editedAt = Date.now();
  writeFileSync(join(project.root, 'src/app.txt'), numberedLines(20).replace('line 7', 'edited from outside'));
  await expect(page.getByText('edited from outside')).toBeVisible({ timeout: 2000 });
  const latency = Date.now() - editedAt;
  console.log(`E2E-03 external edit → diff visible = ${latency} ms`);
  expect(latency).toBeLessThanOrEqual(500);
  expect(navigations).toBe(0);
});

test('E2E-04 scrolling a 10.000-line diff keeps p95 frame time ≤ 33 ms with bounded DOM rows', async () => {
  project.write('src/big.txt', numberedLines(10_000));
  project.commit('big base');
  project.write('src/big.txt', numberedLines(10_000, 'edited'));
  const page = await open();
  await view(page, /Diffs/);
  const scroller = page.locator('[data-testid="diff-scroll"]');
  await scroller.waitFor();
  const frames = await scroller.evaluate(async element => {
    const deltas: number[] = [];
    let last = performance.now();
    const end = last + 2000;
    await new Promise<void>(done => {
      const tick = (now: number) => {
        deltas.push(now - last);
        last = now;
        element.scrollTop += 240;
        if (now < end) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    return deltas.sort((a, b) => a - b);
  });
  const p95 = frames[Math.floor(frames.length * 0.95)] ?? Number.POSITIVE_INFINITY;
  console.log(`E2E-04 frames=${frames.length} p95=${p95.toFixed(1)} ms`);
  expect(p95).toBeLessThanOrEqual(33);
  expect(await page.locator('[data-testid="diff-row"]').count()).toBeLessThanOrEqual(200);
});

test('E2E-05 approving 2 of 3 hunks and staging leaves exactly those in the index', async () => {
  // Hunk decisions belong to a spec (review_decisions PK); without one the engine answers NO_ACTIVE_SPEC.
  project.cli('create', 'feature', 'review-flow', '--standard');
  const lines = numberedLines(60).split('\n');
  project.write('src/app.txt', lines.join('\n'));
  project.commit('base');
  lines[4] = 'changed 5';
  lines[29] = 'changed 30';
  lines[54] = 'changed 55';
  project.write('src/app.txt', lines.join('\n'));
  const page = await open();
  await view(page, /Diffs/);
  const hunks = page.locator('[data-testid="hunk"]');
  await expect(hunks).toHaveCount(3);
  await hunks
    .nth(0)
    .getByRole('button', { name: /Aprobar/ })
    .click();
  await hunks
    .nth(1)
    .getByRole('button', { name: /Rechazar/ })
    .click();
  await hunks
    .nth(2)
    .getByRole('button', { name: /Aprobar/ })
    .click();
  await page.getByRole('button', { name: /Preparar hunks aprobados/ }).click();
  await expect(page.getByText(/2 hunks preparados/)).toBeVisible();
  const cached = project.git('diff', '--cached', '-U0', '--', 'src/app.txt');
  expect(cached).toContain('+changed 5');
  expect(cached).toContain('+changed 55');
  expect(cached).not.toContain('changed 30');
});

test('E2E-06 the embedded terminal echoes input and follows the panel size', async () => {
  const page = await open();
  await page.getByRole('tab', { name: 'Terminal' }).click();
  const terminal = page.locator('[data-testid="terminal"]');
  await terminal.click();
  await page.keyboard.type('echo hola\r');
  await expect(terminal.locator('.xterm-rows')).toContainText('hola');
  const readWidth = async () => {
    await page.keyboard.type('$Host.UI.RawUI.WindowSize.Width\r');
    await page.waitForTimeout(500);
    // biome-ignore lint/performance/useDomNodeTextContent: Playwright locator API; xterm rows are <div>s and only innerText keeps their line breaks.
    const text = (await terminal.locator('.xterm-rows').innerText()).trim().split('\n');
    return Number(text.reverse().find(line => /^\d+$/.test(line.trim())));
  };
  const before = await readWidth();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1100,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.waitForTimeout(600);
  const after = await readWidth();
  expect(Number.isFinite(before) && Number.isFinite(after)).toBe(true);
  expect(after).not.toBe(before);
});

test('E2E-07 closing the window leaves no engine or shell process behind', async () => {
  const page = await open();
  await page.getByRole('tab', { name: 'Terminal' }).click();
  await page.locator('[data-testid="terminal"]').waitFor();
  const children = studioChildren();
  expect(children.engine.length).toBe(1);
  expect(children.shells.length).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: /Cerrar/ }).click();
  await studio?.exit;
  const waited = await waitUntil(() => alive(children.all).length === 0, 3000, 'children gone after close');
  console.log(`E2E-07 children gone ${waited} ms after exit`);
});

test('E2E-08 TerminateProcess on studio.exe kills the engine and shells through the Job Object', async () => {
  const page = await open();
  await page.getByRole('tab', { name: 'Terminal' }).click();
  await page.locator('[data-testid="terminal"]').waitFor();
  const children = studioChildren();
  expect(children.engine.length).toBe(1);
  execFileSync('taskkill', ['/PID', String(studio?.process.pid), '/F']);
  await studio?.exit;
  const waited = await waitUntil(() => alive(children.all).length === 0, 2000, 'job kill-on-close');
  console.log(`E2E-08 orphans reaped by the kernel in ${waited} ms`);
});

test('E2E-09 a spec whose gate 2 is locked shows the governance Protected state', async () => {
  project.cli('create', 'feature', 'greeting', '--full');
  const manifestPath = join(project.root, 'specs/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.governance = { ...manifest.governance, humanGates: 'full' };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  project.write('src/greet.cjs', "module.exports = name => 'Hello ' + name;\n");
  project.commit('full route');
  project.write('src/greet.cjs', "module.exports = name => ['Hello', name].join(' ');\n");
  const page = await open();
  await view(page, /Diffs/);
  await expect(page.getByText(GATE2_TEXT)).toBeVisible();
  await expect(page.getByRole('button', { name: /Aprobar Compuerta 2/ })).toHaveCount(0);
});

test('E2E-10 a killed engine shows the restarting state and recovers with the session intact', async () => {
  project.cli('create', 'feature', 'login-flow', '--light');
  const page = await open();
  // The risk filter is a group of toggle buttons in the "Filtros" toolbar (VB-03).
  const highRisk = () =>
    page
      .getByRole('toolbar', { name: 'Filtros' })
      .getByRole('group', { name: 'Riesgo' })
      .getByRole('button', { name: 'high', exact: true });
  await highRisk().click();
  await expect(highRisk()).toHaveAttribute('aria-pressed', 'true');
  const [engine] = studioChildren().engine;
  expect(engine).toBeDefined();
  execFileSync('taskkill', ['/PID', String(engine), '/F']);
  await expect(page.getByText(/Reiniciando el motor/)).toBeVisible({ timeout: 3000 });
  await expect(page.getByText(/Reiniciando el motor/)).toBeHidden({ timeout: 10_000 });
  await expect(highRisk()).toHaveAttribute('aria-pressed', 'true');
  expect(studioChildren().engine.length).toBe(1);
});

test('E2E-11 a second launch with a folder focuses the running window and switches project', async () => {
  const page = await open();
  const other = makeProject('omni-e2e-other-');
  try {
    other.cli('create', 'feature', 'other-flow', '--light');
    const second = spawn(STUDIO_EXE, [other.root], { stdio: 'ignore' });
    const code = await new Promise<number | null>(done => second.on('exit', done));
    expect(code).toBe(0);
    await expect(page.getByRole('banner')).toContainText(other.root.split(/[\\/]/).pop() ?? '');
    await expect(page.getByText('Other Flow')).toBeVisible();
    expect(processTable().filter(row => row.pid === studio?.process.pid).length).toBe(1);
  } finally {
    // The engine now runs inside `other` (cwd, memory.db): stop Studio before deleting it.
    await studio?.stop();
    studio = undefined;
    other.cleanup();
  }
});
