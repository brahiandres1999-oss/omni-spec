import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const smoke = fileURLToPath(new URL('../scripts/package-smoke.mjs', import.meta.url));

test('a failed package smoke keeps its temporary folder and reports where it is', async () => {
  const fake = await mkdtemp(join(tmpdir(), 'omni-fake-npm-'));
  const npm = join(fake, 'npm-cli.mjs');
  await writeFile(npm, 'console.error("simulated npm failure");\nprocess.exit(1);\n');
  let kept;
  try {
    const result = spawnSync(process.execPath, [smoke], {
      encoding: 'utf8',
      timeout: 60000,
      windowsHide: true,
      env: { ...process.env, npm_execpath: npm },
    });
    assert.notEqual(result.status, 0, result.stdout);
    kept = /files remain in (.*omnispec-package-[A-Za-z0-9]+)$/m.exec(result.stderr)?.[1];
    assert.ok(kept, result.stderr);
    assert.ok((await stat(kept)).isDirectory());
  } finally {
    await rm(fake, { recursive: true, force: true });
    if (kept) await rm(kept, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
