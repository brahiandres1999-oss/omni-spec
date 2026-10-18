import { readFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseVersion } from '../src/versions.mjs';

export function releaseMetadata(pkg, ref = `v${pkg.version}`) {
  const version = parseVersion(pkg.version);
  if (ref !== `v${pkg.version}`) throw new Error(`Tag ${ref} does not match package version ${pkg.version}.`);
  return { version: pkg.version, tag: ref, prerelease: version.pre.length > 0, npmTag: version.pre.length ? 'next' : 'latest', filename: `${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.version}.tgz`, notes: `docs/releases/${pkg.version}.md` };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const meta = releaseMetadata(pkg, process.env.RELEASE_REF || process.env.GITHUB_REF_NAME || `v${pkg.version}`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, Object.entries(meta).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
  console.log(JSON.stringify(meta, null, 2));
}
