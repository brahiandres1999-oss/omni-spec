import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { releaseMetadata } from './release-meta.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const meta = releaseMetadata(pkg);
const verifying = process.argv[2] === 'verify';
const directory = resolve(root, verifying ? process.argv[3] || 'artifacts/release' : 'artifacts/release');
if (!verifying) {
  if (!process.env.npm_execpath) throw new Error('Run via npm run release:pack.');
  await mkdir(directory, { recursive: true });
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'pack', '--ignore-scripts', '--json', '--pack-destination', directory], { cwd: root, encoding: 'utf8', timeout: 120000, windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const info = JSON.parse(result.stdout)[0];
  assert.equal(info.filename, meta.filename);
  assert.ok(!info.files.some(f => /^(?:test|test-support|artifacts|\.git|\.github)\//.test(f.path)));
}
const file = join(directory, meta.filename);
const sha256 = createHash('sha256').update(await readFile(file)).digest('hex');
const checksum = join(directory, meta.filename + '.sha256');
if (verifying) assert.equal((await readFile(checksum, 'utf8')).trim(), `${sha256}  ${meta.filename}`, 'Release checksum mismatch');
else await writeFile(checksum, `${sha256}  ${meta.filename}\n`);
console.log(JSON.stringify({ verified: verifying, package: file, sha256, ...meta }, null, 2));
