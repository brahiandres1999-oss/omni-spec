import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, parseVersion } from '../src/versions.mjs';
import { releaseMetadata } from '../scripts/release-meta.mjs';
test('SemVer prerelease ordering covers update from rc to stable and numeric rc identifiers', () => {
  const ordered = ['0.4.1', '0.5.0-alpha', '0.5.0-alpha.1', '0.5.0-beta', '0.5.0-rc.1', '0.5.0-rc.2', '0.5.0-rc.10', '0.5.0', '0.5.1', '0.6.0'];
  for (let i = 1; i < ordered.length; i++) {
    assert.equal(compareVersions(ordered[i-1], ordered[i]), -1);
    assert.equal(compareVersions(ordered[i], ordered[i-1]), 1);
  }
  assert.equal(compareVersions('0.5.0+local.1', '0.5.0+published'), 0);
});
test('invalid versions cannot drive update or release metadata', () => {
  for (const version of ['v0.5.0', '0.5', '0.05.0', '0.5.0-rc.01', '0.5.0-']) assert.throws(() => parseVersion(version), /Invalid semantic version/);
});
test('release metadata distinguishes channels and rejects mismatched tags', () => {
  assert.equal(releaseMetadata({ name: 'omni-spec', version: '0.5.0-rc.1' }).prerelease, true);
  assert.equal(releaseMetadata({ name: 'omni-spec', version: '0.5.0-rc.1' }).npmTag, 'next');
  assert.equal(releaseMetadata({ name: 'omni-spec', version: '0.5.0' }).npmTag, 'latest');
  assert.throws(() => releaseMetadata({ name: 'omni-spec', version: '0.5.0-rc.1' }, 'v0.5.0'), /does not match/);
});
