import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { hashProjectFiles, DEFAULT_IGNORE_PATTERNS, compileIgnoreText, isIgnored } from '../src/snapshot.mjs';

test('embedded double stars stay within one directory; a globstar segment crosses directories', () => {
  for (const pattern of ['a*/b', 'a**/b', 'a***/b']) {
    const rules = compileIgnoreText(pattern);
    assert.equal(isIgnored(rules, 'a/b', false), true, pattern);
    assert.equal(isIgnored(rules, 'ax/b', false), true, pattern);
    assert.equal(isIgnored(rules, 'a/x/b', false), false, pattern);
    assert.equal(isIgnored(rules, 'a/x/y/b', false), false, pattern);
  }
  const rules = compileIgnoreText('a/**/b');
  for (const path of ['a/b', 'a/x/b', 'a/x/y/b']) assert.equal(isIgnored(rules, path, false), true, path);
});

let git = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch {
  git = false;
}
// Windows forbids some file-name characters and trailing spaces; those cases run elsewhere.
const portable = name =>
  process.platform !== 'win32' ||
  (!/[*?<>|:"\\]|[ .]$/.test(name) && [...name].every(char => char.charCodeAt(0) >= 32));
const cases = JSON.parse(await readFile(new URL('../test-support/ignore-cases.json', import.meta.url), 'utf8')).filter(
  item => [...item.files, ...Object.keys(item.ignores)].every(name => name.split('/').every(portable)),
);

// Differential check against Git itself: the files OmniSpec attests must be exactly the
// untracked files Git does not ignore. Defaults are disabled to compare pure .gitignore rules.
test('ignore rules match git ls-files --exclude-standard', {
  skip: !git && 'git unavailable',
  timeout: 180000,
}, async t => {
  const defaults = DEFAULT_IGNORE_PATTERNS.splice(0);
  try {
    for (const item of cases) {
      const root = await mkdtemp(join(tmpdir(), 'omni-ignore-'));
      try {
        execFileSync('git', ['init', '-q'], { cwd: root });
        // OmniSpec matches case-sensitively everywhere; compare against the same Git mode.
        execFileSync('git', ['config', 'core.ignorecase', 'false'], { cwd: root });
        for (const [file, body] of Object.entries(item.ignores)) {
          await mkdir(dirname(join(root, file)), { recursive: true });
          await writeFile(join(root, file), body);
        }
        for (const file of item.files) {
          await mkdir(dirname(join(root, file)), { recursive: true });
          await writeFile(join(root, file), 'x');
        }
        const expected = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
          cwd: root,
          encoding: 'utf8',
        })
          .split('\0')
          .filter(Boolean)
          .sort();
        const actual = [...(await hashProjectFiles(root)).keys()].sort();
        if (item.expectedFiles) {
          // Some Git builds let embedded '**' cross directories. Keep the documented
          // semantics fixed, while recognizing only this exact legacy oracle result.
          assert.deepEqual(actual, item.expectedFiles, JSON.stringify(item.ignores));
          if (JSON.stringify(expected) !== JSON.stringify(item.expectedFiles)) {
            assert.deepEqual(expected, item.legacyGitFiles, JSON.stringify(item.ignores));
            t.diagnostic('Installed Git uses legacy embedded-globstar matching; OmniSpec retains a/x/b.');
          }
        } else assert.deepEqual(actual, expected, JSON.stringify(item.ignores));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  } finally {
    DEFAULT_IGNORE_PATTERNS.push(...defaults);
  }
});
