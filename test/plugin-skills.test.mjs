import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const builder = join(packageRoot, 'scripts', 'build-plugin-skills.mjs');

async function generatedFiles(root) {
  const skills = (await readdir(join(root, 'skills'))).sort();
  return [...skills.map(name => join('skills', name, 'SKILL.md')), join('rules', 'constitution.md')];
}

test('packaged plugin skills and rule match what build-plugin-skills generates', async () => {
  const out = await mkdtemp(join(tmpdir(), 'omni-plugin-skills-'));
  try {
    const result = spawnSync(process.execPath, [builder], { cwd: out, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const expected = await generatedFiles(out);
    assert.deepEqual(await generatedFiles(packageRoot), expected);
    for (const file of expected)
      assert.equal(await readFile(join(packageRoot, file), 'utf8'), await readFile(join(out, file), 'utf8'), file);
  } finally {
    await rm(out, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
