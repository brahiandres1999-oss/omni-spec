import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const host = process.env.TAURI_DEV_HOST;

/**
 * Under Vitest the DOM test files run in the "client" environment, where `vitest:normalize-url` (and Vite's
 * asset plugin) rewrite `new URL('../../', import.meta.url)` against `self.location`, i.e. a dev-server URL
 * (`http://localhost:3000/@fs/…`). The tests resolve repository paths from those URLs with
 * `fileURLToPath`, so in test files the base is passed as `String(import.meta.url)`, which neither rewrite
 * matches. Application code and builds are untouched.
 */
const META_URL_RE = /(\bnew\s+URL\s*\(\s*(?:'[^']+'|"[^"]+"|`[^`]+`)\s*,\s*)import\.meta\.url(\s*\))/g;

function keepFileUrlsUnderVitest(): Plugin {
  return {
    name: 'omni:keep-file-urls-under-vitest',
    enforce: 'pre',
    transform(code, id) {
      if (!process.env.VITEST || !/\.test\.[cm]?[jt]sx?$/.test(id.split('?')[0] ?? '')) return null;
      if (!code.includes('import.meta.url')) return null;
      return { code: code.replace(META_URL_RE, '$1String(import.meta.url)$2'), map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), keepFileUrlsUnderVitest()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Tauri expects a fixed port and must see Rust errors in the terminal.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    restoreMocks: true,
  },
});
