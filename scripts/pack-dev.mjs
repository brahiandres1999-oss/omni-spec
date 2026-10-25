/**
 * Pack a development build that cannot be mistaken for a published release.
 *
 * Usage: `npm run pack:dev [destination]` (default destination: `artifacts/dev`).
 * Copies exactly the files `npm pack` would publish into a temporary folder, sets the copy's
 * version to `<package.json version>+dev.<UTC YYYYMMDDTHHMMSSZ>` and packs that copy, so the
 * repository package.json and the release flow stay untouched. SemVer build metadata keeps
 * `update` ordering identical to the base version while the file name and `omni-spec version`
 * identify the development build.
 * Prints `{ package, version, sha256 }` as JSON. Throws when npm cannot be resolved through
 * npm_execpath, when npm fails, or when the copy would pack a different file list. The
 * temporary copy is removed whether packing succeeds or fails.
 */
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run via npm run pack:dev.');
const destination = resolve(process.argv[2] || join(root, 'artifacts', 'dev'));

function pack(cwd, options) {
  const result = spawnSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', ...options], {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout)[0];
}

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
const version = `${pkg.version}+dev.${stamp}`;
const publishable = pack(root, ['--dry-run']);
const staging = await mkdtemp(join(tmpdir(), 'omnispec-pack-dev-'));
try {
  for (const { path } of publishable.files) {
    await mkdir(dirname(join(staging, path)), { recursive: true });
    await copyFile(join(root, path), join(staging, path));
  }
  await writeFile(join(staging, 'package.json'), JSON.stringify({ ...pkg, version }, null, 2) + '\n');
  await mkdir(destination, { recursive: true });
  const info = pack(staging, ['--pack-destination', destination]);
  assert.deepEqual(
    info.files.map(f => f.path).sort(),
    publishable.files.map(f => f.path).sort(),
    'The development package must contain exactly the publishable files',
  );
  const file = join(destination, info.filename);
  const sha256 = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
  console.log(JSON.stringify({ package: file, version: info.version, sha256 }, null, 2));
} finally {
  await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
