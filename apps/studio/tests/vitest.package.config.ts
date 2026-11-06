import { defineConfig } from 'vitest/config';

/** Packaging checks run against a release build (`npm run tauri build`); they are not part of `npm test`. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 600_000,
  },
});
