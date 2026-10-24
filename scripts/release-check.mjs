import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { releaseMetadata } from './release-meta.mjs';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const meta = releaseMetadata(
  pkg,
  process.env.RELEASE_REF || (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined),
);
assert.equal(pkg.publishConfig?.tag, meta.npmTag, 'publishConfig.tag must follow prerelease/stable channel');
assert.equal(pkg.publishConfig?.access, 'public');
assert.equal(pkg.repository?.url, 'git+https://github.com/brahiandres1999-oss/omni-spec.git');
assert.equal(pkg.bin?.['omni-spec'], 'bin/omni-spec.mjs');
assert.ok(!Object.keys(pkg.dependencies || {}).length, 'Runtime must have no external dependencies');
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
assert.equal(lock.version, meta.version, 'Lockfile version must match package');
assert.equal(lock.packages?.['']?.version, meta.version, 'Lockfile root package version must match package');
const banner = await readFile(new URL('../assets/omni-spec-banner.svg', import.meta.url), 'utf8');
assert.ok(banner.includes(meta.version.split('-')[0]), 'Banner must identify the current release family');
if (meta.npmTag === 'preview') assert.ok(banner.includes('Preview'), 'Banner must identify Preview status');
assert.ok(readme.split(/\r?\n/).includes(`# OmniSpec ${meta.version}`), 'README version must match package');
assert.ok(readme.includes('assets/omni-spec-banner.svg'), 'Preserve the project banner');
assert.ok(changelog.includes(`## [${meta.version}]`), 'Changelog must include this release');
await access(new URL('../' + meta.notes, import.meta.url));
console.log(JSON.stringify({ ready: true, ...meta, publication: 'Not performed by this check' }, null, 2));
