import { defineConfig } from '@playwright/test';

/**
 * E2E against the real debug build (src-tauri/target/debug/omni-studio.exe). Playwright attaches
 * to WebView2 over CDP; the remote debugging port exists only in debug builds (SEC-04, D-15).
 * One worker: every test owns a Studio process tree and measures timing on this machine.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
});
