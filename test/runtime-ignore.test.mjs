import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { updateProject, getCliVersion } from '../src/updater.mjs';
import { projectStatus } from '../src/project-state.mjs';
import { packageEntries } from '../src/assets.mjs';
import { loadManifest, saveManifest } from '../src/manifest.mjs';
import { managedHash } from '../src/managed.mjs';

const cli = fileURLToPath(new URL('../bin/omni-spec.mjs', import.meta.url));
const RUNTIME = 'specs/.omni/runtime/';
const INDEX_COMMAND = 'git rm -r --cached specs/.omni/runtime';
const UNREADABLE = 'specs/.omni/runtime/package.json is not valid JSON or has no version';
const gitAvailable = !spawnSync('git', ['--version']).error;
const version = await getCliVersion();
// The managed section of specs/.gitignore as released up to 83eaa24, before it ignored the runtime.
const PREVIOUS_SECTION = `# OMNI-SPEC-START
# OmniSpec local state (managed section). Specs and their records remain versioned.
manifest.lock/
*.tmp
manifest.json.tmp.*
.omni/verify.lock/
.omni/verification-logs/
.omni/backups/
.omni/inputs/
# OMNI-SPEC-END`;
const ORPHANS = {
  missing: `${RUNTIME}src/removed-missing.mjs`,
  intact: `${RUNTIME}src/removed-intact.mjs`,
  edited: `${RUNTIME}src/removed-edited.mjs`,
};

let root;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omni-runtime-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function run(args, cwd = root) {
  const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', data => (stdout += data));
  child.stderr.on('data', data => (stderr += data));
  return once(child, 'close').then(([code]) => ({ code, stdout, stderr, lines: stdout.split(/\r?\n/) }));
}

async function runJson(args, cwd = root) {
  const result = await run([...args, '--json'], cwd);
  return { ...result, json: JSON.parse(result.stdout) };
}

const notices = lines => lines.filter(line => line.startsWith('[NOTICE] '));
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

function initGit(cwd) {
  for (const args of [
    ['init', '-q'],
    ['config', 'user.name', 'OmniSpec Test'],
    ['config', 'user.email', 'omnispec-test@example.invalid'],
    ['config', 'core.autocrlf', 'false'],
  ])
    assert.equal(git(cwd, ...args).status, 0, args.join(' '));
}

async function projectIn(name, options) {
  const dir = join(root, name);
  await mkdir(dir);
  await scaffoldProject(dir, options);
  return dir;
}

const sectionOf = text => text.match(/# OMNI-SPEC-START[\s\S]*?# OMNI-SPEC-END/)?.[0];
const registryPath = dir => join(dir, 'specs', '.omni', 'managed.json');
const readRegistry = async dir => JSON.parse(await readFile(registryPath(dir), 'utf8'));

async function register(dir, files) {
  const registry = await readRegistry(dir);
  Object.assign(registry.files, files);
  await writeFile(registryPath(dir), JSON.stringify(registry, null, 2) + '\n');
}

// Leaves specs/.gitignore as an older release installed it: on disk and in the registry.
async function usePreviousSection(dir, before = '', after = '') {
  await writeFile(join(dir, 'specs', '.gitignore'), before + PREVIOUS_SECTION + '\n' + after);
  await register(dir, { 'specs/.gitignore': { hash: managedHash(PREVIOUS_SECTION), section: 'hash' } });
}

const runtimeEntries = async () => (await packageEntries()).filter(entry => entry.path.startsWith(RUNTIME));
const removeRuntime = dir => rm(join(dir, RUNTIME), { recursive: true, force: true });
const runtimePackage = dir => join(dir, RUNTIME, 'package.json');

async function edit(dir, name) {
  const path = join(dir, name);
  await writeFile(path, (await readFile(path, 'utf8')) + '\n// local edit\n');
}

async function setRuntimeVersion(dir, value) {
  const pkg = JSON.parse(await readFile(runtimePackage(dir), 'utf8'));
  await writeFile(runtimePackage(dir), JSON.stringify({ ...pkg, version: value }, null, 2) + '\n');
}

async function setProjectVersion(dir, value) {
  await saveManifest(dir, { ...(await loadManifest(dir)), version: value });
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

// Registry entries for runtime files that the running package no longer ships.
async function addOrphans(dir) {
  const original = 'export const removed = true;\n';
  await writeFile(join(dir, ORPHANS.intact), original);
  await writeFile(join(dir, ORPHANS.edited), original + '// local edit\n');
  const entry = { hash: managedHash(original), section: false };
  await register(dir, { [ORPHANS.missing]: entry, [ORPHANS.intact]: entry, [ORPHANS.edited]: entry });
}

test('AC-01: init ignores the local runtime inside the managed section of specs/.gitignore', async () => {
  await scaffoldProject(root);
  const lines = sectionOf(await readFile(join(root, 'specs', '.gitignore'), 'utf8')).split('\n');
  const previous = PREVIOUS_SECTION.split('\n').filter(line => !line.startsWith('#'));
  assert.equal(previous.length, 7);
  for (const entry of [...previous, '.omni/runtime/']) assert.ok(lines.includes(entry), entry);
});

test('AC-02: update adds the runtime line to a previous section and keeps the user rules around it', async () => {
  await scaffoldProject(root);
  await usePreviousSection(root, 'drafts/\n\n', '\nmore-user-rules/\n');
  const result = await updateProject(root);
  assert.ok(!result.assets.conflicts.includes('specs/.gitignore'));
  const text = await readFile(join(root, 'specs', '.gitignore'), 'utf8');
  assert.ok(sectionOf(text).split('\n').includes('.omni/runtime/'));
  assert.ok(text.startsWith('drafts/\n\n# OMNI-SPEC-START\n'));
  assert.ok(text.endsWith('# OMNI-SPEC-END\n\nmore-user-rules/\n'));
});

test('AC-03: Git ignores the runtime and still versions the manifest, the registry and the templates', {
  skip: !gitAvailable && 'git unavailable',
}, async () => {
  await scaffoldProject(root);
  initGit(root);
  assert.equal(git(root, 'config', 'core.excludesFile', '').status, 0);
  const ignored = path => {
    const result = git(root, 'check-ignore', '--no-index', '-q', path);
    assert.ok([0, 1].includes(result.status), result.stderr);
    return result.status === 0;
  };
  assert.equal(ignored(`${RUNTIME}bin/omni-spec.mjs`), true);
  for (const path of ['specs/manifest.json', 'specs/.omni/managed.json', 'specs/_templates/01-feature/spec.md'])
    assert.equal(ignored(path), false, path);
});

test('AC-04, AC-05: update restores a deleted runtime from the package and keeps project files', async () => {
  await scaffoldProject(root);
  const spec = await createSpec(root, 'feature', 'greeting');
  await updateProject(root);
  const kept = [
    'CONSTITUTION.md',
    'specs/project-context.md',
    'specs/manifest.json',
    'specs/.omni/managed.json',
    ...(await readdir(join(root, 'specs', spec.slug))).map(name => `specs/${spec.slug}/${name}`),
  ];
  assert.ok(kept.length > 4);
  const before = await Promise.all(kept.map(name => readFile(join(root, name))));
  await removeRuntime(root);
  const result = await updateProject(root);
  const runtime = await runtimeEntries();
  assert.deepEqual(result.assets.created.sort(), runtime.map(entry => entry.path).sort());
  assert.deepEqual(result.assets.conflicts, []);
  assert.deepEqual(result.assets.backups, []);
  assert.deepEqual(result.assets.removed, []);
  for (const entry of runtime) assert.equal(await readFile(join(root, entry.path), 'utf8'), entry.content, entry.path);
  for (const [index, name] of kept.entries()) assert.deepEqual(await readFile(join(root, name)), before[index], name);
  const doctor = await run(['doctor']);
  assert.equal(doctor.code, 0, doctor.stdout);
});

test('AC-06, AC-15: a runtime of another version or without a readable version is replaced without conflict', async () => {
  const cases = {
    other: dir => setRuntimeVersion(dir, '0.0.1'),
    missing: dir => unlink(runtimePackage(dir)),
    invalid: dir => writeFile(runtimePackage(dir), '{ "version": '),
    unversioned: dir => writeFile(runtimePackage(dir), '{ "name": "omni-spec" }\n'),
  };
  const runtime = await runtimeEntries();
  for (const [name, prepare] of Object.entries(cases)) {
    const dir = await projectIn(name);
    await prepare(dir);
    await edit(dir, `${RUNTIME}src/fit.mjs`);
    const result = await updateProject(dir);
    assert.deepEqual(result.assets.conflicts, [], name);
    assert.deepEqual(result.assets.backups, [], name);
    assert.equal(await exists(join(dir, 'specs', '.omni', 'backups')), false, name);
    for (const entry of runtime)
      assert.equal(await readFile(join(dir, entry.path), 'utf8'), entry.content, `${name}: ${entry.path}`);
    assert.equal(
      result.notices.some(notice => notice.startsWith(UNREADABLE)),
      ['invalid', 'unversioned'].includes(name),
      name,
    );
  }
});

test('AC-15: update reports an unreadable runtime version in its JSON and text output', async () => {
  await scaffoldProject(root);
  await writeFile(runtimePackage(root), 'not json');
  const preview = await runJson(['update', '--dry-run']);
  assert.equal(preview.code, 0, preview.stdout);
  assert.ok(preview.json.notices.some(notice => notice.startsWith(UNREADABLE)));
  const applied = await run(['update']);
  assert.equal(applied.code, 0, applied.stderr);
  assert.ok(notices(applied.lines).some(line => line.startsWith(`[NOTICE] ${UNREADABLE}`)));
});

test('AC-07: an edited runtime of the project version still blocks update', async () => {
  await scaffoldProject(root);
  await edit(root, `${RUNTIME}src/fit.mjs`);
  await assert.rejects(updateProject(root), /update blocked: specs\/\.omni\/runtime\/src\/fit\.mjs\. /);
  assert.match(await readFile(join(root, RUNTIME, 'src', 'fit.mjs'), 'utf8'), /local edit/);
});

test('AC-20: a newer CLI still protects an edited runtime of the project version', async () => {
  await scaffoldProject(root);
  await setProjectVersion(root, '0.0.1');
  await setRuntimeVersion(root, '0.0.1');
  await register(root, {
    [`${RUNTIME}package.json`]: { hash: managedHash(await readFile(runtimePackage(root), 'utf8')), section: false },
  });
  await edit(root, `${RUNTIME}src/fit.mjs`);
  await assert.rejects(updateProject(root), /update blocked: specs\/\.omni\/runtime\/src\/fit\.mjs\. /);
});

test('AC-08: update leaves the Git index of a committed runtime unchanged', {
  skip: !gitAvailable && 'git unavailable',
}, async () => {
  await scaffoldProject(root);
  await usePreviousSection(root);
  initGit(root);
  assert.equal(git(root, 'add', 'specs').status, 0);
  const indexed = () => git(root, 'ls-files', 'specs/.omni/runtime').stdout;
  const before = indexed();
  assert.equal(before.trim().split('\n').length, (await runtimeEntries()).length);
  await updateProject(root);
  assert.equal(indexed(), before);
});

test('AC-24: update --dry-run reports the runtime entries it would prune without writing', async () => {
  await scaffoldProject(root);
  await addOrphans(root);
  const registry = await readFile(registryPath(root), 'utf8');
  const preview = await runJson(['update', '--dry-run']);
  assert.equal(preview.code, 0, preview.stdout);
  assert.deepEqual(preview.json.assets.removed.sort(), [ORPHANS.intact, ORPHANS.missing]);
  assert.deepEqual(preview.json.assets.preserved, [ORPHANS.edited]);
  const text = await run(['update', '--dry-run']);
  assert.match(text.stdout, /, 2 removed, /);
  for (const name of [ORPHANS.missing, ORPHANS.intact]) assert.ok(text.lines.includes(`REMOVE ${name}`), name);
  assert.ok(
    text.lines.includes(
      `[NOTICE] Would keep ${ORPHANS.edited}: it is no longer part of OmniSpec ${version} and has local edits; its managed-file entry would be removed.`,
    ),
  );
  assert.equal(await readFile(registryPath(root), 'utf8'), registry);
  assert.equal(await exists(join(root, ORPHANS.intact)), true);
  assert.equal(await exists(join(root, ORPHANS.edited)), true);
});

test('AC-21, AC-22, AC-23: update prunes runtime entries the package no longer ships and keeps edited files', async () => {
  const text = await projectIn('text');
  await addOrphans(text);
  const applied = await run(['update'], text);
  assert.equal(applied.code, 0, applied.stderr);
  assert.match(applied.stdout, /, 2 removed, /);
  assert.ok(
    applied.lines.includes(
      `[NOTICE] Kept ${ORPHANS.edited}: it is no longer part of OmniSpec ${version} and has local edits; its managed-file entry was removed.`,
    ),
  );
  const { files } = await readRegistry(text);
  for (const name of Object.values(ORPHANS)) assert.equal(Object.hasOwn(files, name), false, name);
  assert.equal(await exists(join(text, ORPHANS.intact)), false);
  assert.match(await readFile(join(text, ORPHANS.edited), 'utf8'), /local edit/);
  const doctor = await run(['doctor'], text);
  assert.equal(doctor.code, 0, doctor.stdout);

  const json = await projectIn('json');
  await addOrphans(json);
  const result = await runJson(['update'], json);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.json.assets.removed.sort(), [ORPHANS.intact, ORPHANS.missing]);
  assert.deepEqual(result.json.assets.preserved, [ORPHANS.edited]);
  assert.ok(result.json.notices.some(notice => notice.startsWith(`Kept ${ORPHANS.edited}: `)));
});

test('a blocked update prunes nothing', async () => {
  await scaffoldProject(root);
  await addOrphans(root);
  await edit(root, `${RUNTIME}src/fit.mjs`);
  const registry = await readFile(registryPath(root), 'utf8');
  await assert.rejects(updateProject(root), /Local changes preserved/);
  assert.equal(await readFile(registryPath(root), 'utf8'), registry);
  assert.equal(await exists(join(root, ORPHANS.intact)), true);
});

test('pruning ignores crafted registry keys that leave the runtime folder', async () => {
  await scaffoldProject(root);
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'index.js'), 'keep me');
  await register(root, { [`${RUNTIME}../../../src/index.js`]: { hash: managedHash('keep me'), section: false } });
  await updateProject(root);
  assert.equal(await readFile(join(root, 'src', 'index.js'), 'utf8'), 'keep me');
});

test('pruning never deletes a shipped runtime file through a key that differs in case or trailing dots', async () => {
  const live = `${RUNTIME}src/fit.mjs`;
  const alias = `${RUNTIME}src/FIT.mjs`;
  const casing = await projectIn('case');
  const content = await readFile(join(casing, live), 'utf8');
  const entry = { hash: managedHash(content), section: false };
  await register(casing, { [alias]: entry });
  await updateProject(casing);
  assert.equal(await readFile(join(casing, live), 'utf8'), content);
  const { files } = await readRegistry(casing);
  assert.equal(Object.hasOwn(files, alias), false);
  assert.equal(Object.hasOwn(files, live), true);
  const doctor = await run(['doctor'], casing);
  assert.equal(doctor.code, 0, doctor.stdout);

  const dots = await projectIn('dots');
  await register(dots, { [`${live}.`]: entry, [`${live} `]: entry });
  await updateProject(dots);
  assert.equal(await readFile(join(dots, live), 'utf8'), content);
});

test('AC-09: update warns that a committed runtime stays in the Git index when it adds the line', async () => {
  await scaffoldProject(root);
  await usePreviousSection(root);
  const preview = await runJson(['update', '--dry-run']);
  assert.ok(preview.json.notices.some(notice => notice.includes(INDEX_COMMAND)));
  const previewText = await run(['update', '--dry-run']);
  assert.ok(notices(previewText.lines).some(line => line.includes(INDEX_COMMAND)));
  const applied = await run(['update']);
  assert.equal(applied.code, 0, applied.stderr);
  assert.ok(notices(applied.lines).some(line => line.includes(INDEX_COMMAND)));
  const again = await runJson(['update']);
  assert.equal(again.code, 0, again.stderr);
  assert.ok(!again.stdout.includes(INDEX_COMMAND));
});

test('AC-09: update gives no index notice when the section already ignores the runtime', async () => {
  await scaffoldProject(root);
  const preview = await run(['update', '--dry-run']);
  assert.equal(preview.code, 0, preview.stdout);
  assert.ok(!preview.stdout.includes(INDEX_COMMAND));
  const applied = await run(['update', '--json']);
  assert.equal(applied.code, 0, applied.stderr);
  assert.ok(!applied.stdout.includes(INDEX_COMMAND));
});

test('AC-16: the index notice also covers a specs/.gitignore without a managed section or no file', async () => {
  const userRules = await projectIn('user-rules');
  await writeFile(join(userRules, 'specs', '.gitignore'), 'drafts/\n');
  const preview = await run(['update', '--dry-run'], userRules);
  assert.ok(notices(preview.lines).some(line => line.includes(INDEX_COMMAND)));
  const applied = await runJson(['update'], userRules);
  assert.ok(applied.json.notices.some(notice => notice.includes(INDEX_COMMAND)));

  const absent = await projectIn('absent');
  await unlink(join(absent, 'specs', '.gitignore'));
  const absentPreview = await runJson(['update', '--dry-run'], absent);
  assert.ok(absentPreview.json.notices.some(notice => notice.includes(INDEX_COMMAND)));
  const absentApplied = await run(['update'], absent);
  assert.ok(notices(absentApplied.lines).some(line => line.includes(INDEX_COMMAND)));
});

test('AC-10: doctor summarizes a missing runtime in one line and lists the other managed files', async () => {
  await scaffoldProject(root);
  await removeRuntime(root);
  const template = 'specs/_templates/01-feature/spec.md';
  const deleted = 'specs/_templates/02-bugfix/bug.md';
  await edit(root, template);
  await unlink(join(root, deleted));
  const text = await run(['doctor']);
  assert.equal(text.code, 1);
  assert.ok(
    text.lines.includes(
      `[RUNTIME MISSING] specs/.omni/runtime/ is missing. Restore it: npx omni-spec@${version} update`,
    ),
    text.stdout,
  );
  assert.ok(!text.lines.some(line => line.startsWith(RUNTIME)));
  assert.ok(text.lines.includes(template) && text.lines.includes(deleted), text.stdout);
  const { json } = await runJson(['doctor']);
  assert.deepEqual(json.runtime, { status: 'MISSING', version: null, restore: `npx omni-spec@${version} update` });
  assert.ok(![...json.integrity.changed, ...json.integrity.missing].some(name => name.startsWith(RUNTIME)));
  assert.deepEqual(json.integrity.changed.sort(), [template, deleted].sort());
  assert.deepEqual(json.integrity.missing, [deleted]);
  assert.equal(json.healthy, false);
});

test('AC-17: doctor lists each missing file of an incomplete runtime of the project version', async () => {
  await scaffoldProject(root);
  const removed = [`${RUNTIME}src/fit.mjs`, `${RUNTIME}bin/omni-spec.mjs`];
  for (const name of removed) await unlink(join(root, name));
  const text = await run(['doctor']);
  assert.equal(text.code, 1);
  for (const name of removed) assert.ok(text.lines.includes(name), name);
  assert.ok(!text.lines.some(line => line.startsWith('[RUNTIME ')));
  const { json } = await runJson(['doctor']);
  assert.equal(Object.hasOwn(json, 'runtime'), false);
});

test('AC-25: doctor summarizes a runtime of another version in one line', async () => {
  await scaffoldProject(root);
  await setRuntimeVersion(root, '0.0.1');
  await edit(root, `${RUNTIME}src/fit.mjs`);
  const text = await run(['doctor']);
  assert.equal(text.code, 1);
  assert.ok(
    text.lines.includes(
      `[RUNTIME VERSION] Local runtime 0.0.1 differs from project ${version}. Restore it: npx omni-spec@${version} update`,
    ),
    text.stdout,
  );
  assert.ok(!text.lines.some(line => line.startsWith(RUNTIME)));
  const { json } = await runJson(['doctor']);
  assert.deepEqual(json.runtime, {
    status: 'VERSION_MISMATCH',
    version: '0.0.1',
    restore: `npx omni-spec@${version} update`,
  });
});

test('AC-26: in plugin mode doctor neither summarizes nor lists the unused local runtime', async () => {
  const missing = await projectIn('missing', { agent: 'plugin' });
  assert.ok(Object.keys((await readRegistry(missing)).files).some(name => name.startsWith(RUNTIME)));
  await removeRuntime(missing);
  const other = await projectIn('other', { agent: 'plugin' });
  await setRuntimeVersion(other, '0.0.1');
  for (const dir of [missing, other]) {
    const text = await run(['doctor'], dir);
    assert.equal(text.code, 0, text.stdout);
    assert.ok(!text.stdout.includes('[RUNTIME '), text.stdout);
    assert.ok(!text.lines.some(line => line.startsWith(RUNTIME)), text.stdout);
    const { json } = await runJson(['doctor'], dir);
    assert.equal(Object.hasOwn(json, 'runtime'), false);
    assert.ok(![...json.integrity.changed, ...json.integrity.missing].some(name => name.startsWith(RUNTIME)));
  }
});

test('AC-11, AC-18, AC-19, AC-27, AC-29: status warns when the CLI and project versions differ', async () => {
  const cases = [
    { projectVersion: '999.0.0', agent: 'antigravity', action: 'npx omni-spec@999.0.0 update' },
    {
      projectVersion: '0.0.1',
      agent: 'antigravity',
      action: 'npx omni-spec@0.0.1 update',
      upgrade: 'update --dry-run',
    },
    { projectVersion: '999.0.0', agent: 'plugin', action: 'npx omni-spec@999.0.0 plugin update' },
    { projectVersion: '0.0.1', agent: 'plugin', shared: true, downgrade: true },
    { projectVersion: `${version}+build.1`, agent: 'plugin', shared: true },
    { projectVersion: '0.8', agent: 'antigravity', action: 'npx omni-spec@0.8 update' },
    { projectVersion: '0.8', agent: 'plugin', shared: true },
  ];
  for (const item of cases) {
    const label = `${item.agent} ${item.projectVersion}`;
    const dir = await projectIn(label.replace(/\W/g, '-'), { agent: item.agent });
    const baseline = await projectStatus(dir);
    assert.deepEqual(baseline.progress.warnings, [], label);
    assert.ok(!(await run(['status'], dir)).stdout.includes('[WARN]'), label);
    await setProjectVersion(dir, item.projectVersion);
    const status = await projectStatus(dir);
    assert.equal(status.progress.warnings.length, 1, label);
    const [warning] = status.progress.warnings;
    assert.equal(warning.code, 'CLI_VERSION_MISMATCH');
    assert.equal(warning.cliVersion, version);
    assert.equal(warning.projectVersion, item.projectVersion);
    assert.equal(warning.action, item.action, label);
    assert.equal(warning.upgrade, item.upgrade, label);
    assert.ok(warning.message.includes(version) && warning.message.includes(item.projectVersion), label);
    if (item.action) assert.ok(warning.message.includes(item.action), label);
    if (item.upgrade) assert.match(warning.message, /upgrades the project/, label);
    else assert.doesNotMatch(warning.message, /upgrades the project/, label);
    if (item.shared) assert.match(warning.message, /every project on this machine/, label);
    if (item.downgrade) assert.match(warning.message, /downgrading it/, label);
    else assert.doesNotMatch(warning.message, /downgrad/, label);
    if (item.agent === 'plugin') {
      assert.doesNotMatch(JSON.stringify(warning), /omni-spec@\S+ update/, label);
      assert.ok(!JSON.stringify(warning).includes('update --dry-run'), label);
    }
    assert.deepEqual(status.progress.blockers, baseline.progress.blockers, label);
    assert.equal(status.progress.nextAction, baseline.progress.nextAction, label);
    const text = await run(['status'], dir);
    assert.equal(text.code, 0, text.stderr);
    assert.ok(text.lines.includes(`[WARN] CLI_VERSION_MISMATCH: ${warning.message}`), label);
    const json = await runJson(['status'], dir);
    assert.equal(json.code, 0, json.stderr);
    assert.deepEqual(json.json.progress.warnings, status.progress.warnings, label);
  }
});
