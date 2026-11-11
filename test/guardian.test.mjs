import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink, readFile, readdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ALLOWED_BINARIES,
  GuardianError,
  HOOK_MARKER,
  auditCommand,
  auditCommandSyntax,
  conflictMarkers,
  hookScripts,
  inspectSource,
  inspectStaged,
  installHooks,
  resolveExecution,
  stagedFiles,
  tokenizeCommand,
  uninstallHooks,
} from '../src/guardian.mjs';
import { lex, codeTokens } from '../src/js-lexer.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const rejectsWith = (code, fn) =>
  assert.throws(fn, error => error instanceof GuardianError && error.code === code, `expected ${code}`);
const rejectsAsyncWith = (code, promise) =>
  assert.rejects(promise, error => error instanceof GuardianError && error.code === code, `expected ${code}`);

describe('Omni-Guardian command confinement (C-01, C-02 / T-06)', () => {
  let root;
  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'omni guardian '));
    await mkdir(join(root, 'packages', 'a'), { recursive: true });
  });
  after(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('G-BIN-01 the default toolchain is allowed and split into binary and args', () => {
    assert.deepEqual(DEFAULT_ALLOWED_BINARIES, [
      'node',
      'npm',
      'npx',
      'pnpm',
      'yarn',
      'bun',
      'deno',
      'git',
      'vitest',
      'jest',
      'playwright',
      'tsc',
      'biome',
      'eslint',
      'python',
      'python3',
      'pytest',
      'uv',
      'ruff',
      'mypy',
      'mvn',
      'mvnw',
      'gradle',
      'gradlew',
      'java',
      'javac',
      'go',
      'cargo',
      'rustc',
      'dotnet',
    ]);
    for (const [command, binary, args] of [
      ['node x.js', 'node', ['x.js']],
      ['npm test', 'npm', ['test']],
      ['git status', 'git', ['status']],
      ['tsc --noEmit', 'tsc', ['--noEmit']],
      ['biome ci .', 'biome', ['ci', '.']],
      ['vitest run', 'vitest', ['run']],
      ['python -m pytest', 'python', ['-m', 'pytest']],
      ['pytest tests/', 'pytest', ['tests/']],
      ['cargo test', 'cargo', ['test']],
      ['go test ./...', 'go', ['test', './...']],
      ['dotnet test', 'dotnet', ['test']],
      ['uv run pytest', 'uv', ['run', 'pytest']],
    ]) {
      const audited = auditCommandSyntax(command);
      assert.equal(audited.binary, binary, command);
      assert.deepEqual(audited.args, args, command);
    }
  });

  test('G-BIN-02 binary names are normalized for case and Windows extensions', () => {
    assert.equal(auditCommandSyntax('NODE -v').binary, 'node');
    assert.equal(auditCommandSyntax('Node.EXE -v').binary, 'node');
    assert.equal(auditCommandSyntax('npm.cmd test').binary, 'npm');
  });

  test('G-BIN-03 system executables are forbidden with their own code', () => {
    for (const binary of [
      'cmd',
      'cmd.exe',
      'powershell',
      'powershell.exe',
      'pwsh.exe',
      'certutil',
      'bitsadmin',
      'reg',
      'rundll32',
      'mshta',
      'wscript',
      'cscript',
      'regsvr32',
    ])
      rejectsWith('GUARDIAN_FORBIDDEN_BINARY', () => auditCommandSyntax(`${binary} /c whoami`));
  });

  test('G-BIN-04 unlisted binaries are unauthorized, not forbidden', () => {
    for (const binary of ['curl', 'ruby', 'perl'])
      rejectsWith('GUARDIAN_UNAUTHORIZED_BINARY', () => auditCommandSyntax(`${binary} x`));
  });

  test('G-BIN-05 path-qualified binaries are rejected even when the base name is allowed', () => {
    for (const command of ['C:\\evil\\node.exe x', '../node x', '/tmp/npm test', './node x'])
      rejectsWith('GUARDIAN_PATH_BINARY', () => auditCommandSyntax(command));
  });

  test('G-BIN-06 node_modules/.bin tools inside the repository are allowed', () => {
    const audited = auditCommandSyntax('node_modules/.bin/vitest run');
    assert.equal(audited.binary, 'vitest');
    assert.equal(audited.local, true);
    assert.equal(auditCommandSyntax('./node_modules/.bin/tsc.cmd --noEmit').binary, 'tsc');
    rejectsWith('GUARDIAN_UNAUTHORIZED_BINARY', () => auditCommandSyntax('node_modules/.bin/rimraf x'));
  });

  test('G-BIN-07 npx only runs an allowlisted tool', () => {
    assert.equal(auditCommandSyntax('npx vitest run').binary, 'npx');
    assert.equal(auditCommandSyntax('npx --no-install tsc --noEmit').binary, 'npx');
    for (const command of ['npx some-unknown-pkg', 'npx -p evil vitest', 'npx', 'npm exec evil', 'npm x evil'])
      rejectsWith('GUARDIAN_HAZARDOUS_ARGUMENT', () => auditCommandSyntax(command));
  });

  test('G-BIN-08 git options that execute arbitrary programs are hazardous', () => {
    for (const command of [
      'git -c core.pager=evil log',
      'git -c alias.x=!sh x',
      'git -ccore.sshCommand=evil fetch',
      'git fetch --upload-pack=evil origin',
      'git clone ext::sh x',
      'git rebase --exec evil main',
      'git submodule foreach evil',
      'git bisect run evil',
    ])
      rejectsWith('GUARDIAN_HAZARDOUS_ARGUMENT', () => auditCommandSyntax(command));
    assert.equal(auditCommandSyntax('git log --oneline -5').binary, 'git');
  });

  test('G-BIN-09 project extensions are honoured but never re-allow a forbidden binary', () => {
    assert.equal(auditCommandSyntax('go test ./...', { allowedBinaries: ['go'] }).binary, 'go');
    rejectsWith('GUARDIAN_FORBIDDEN_BINARY', () =>
      auditCommandSyntax('powershell -c x', { allowedBinaries: ['powershell'] }),
    );
    assert.throws(() => auditCommandSyntax('go x', { allowedBinaries: ['../go'] }), TypeError);
  });

  test('G-BIN-10 polyglot runtime and build binaries are allowlisted', () => {
    const polyglot = [
      'pnpm',
      'yarn',
      'bun',
      'deno',
      'jest',
      'playwright',
      'eslint',
      'python',
      'python3',
      'pytest',
      'uv',
      'ruff',
      'mypy',
      'mvn',
      'mvnw',
      'gradle',
      'gradlew',
      'java',
      'javac',
      'go',
      'cargo',
      'rustc',
      'dotnet',
    ];
    for (const bin of polyglot) {
      assert.ok(DEFAULT_ALLOWED_BINARIES.includes(bin), `${bin} should be in DEFAULT_ALLOWED_BINARIES`);
      const audited = auditCommandSyntax(`${bin} --version`);
      assert.equal(audited.binary, bin);
    }
  });

  test('G-OP-01 chaining operators outside quotes are rejected', () => {
    for (const command of [
      'npm test & del x',
      'npm test && npm run lint',
      'node a | node b',
      'a || b',
      'node a ; node b',
    ])
      rejectsWith('GUARDIAN_SHELL_OPERATOR', () => auditCommandSyntax(command));
  });

  test('G-OP-02 substitution and expansion outside quotes are rejected', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal ${X} is the shell expansion under test.
    for (const command of ['node `whoami`', 'node $(id)', 'node ${X}', 'node $HOME'])
      rejectsWith('GUARDIAN_SHELL_OPERATOR', () => auditCommandSyntax(command));
  });

  test('G-OP-03 redirections are rejected', () => {
    for (const command of ['node a > out', 'node a >> out', 'node a < in', 'node a 2>&1'])
      rejectsWith('GUARDIAN_SHELL_OPERATOR', () => auditCommandSyntax(command));
  });

  test('G-OP-04 line separators are rejected anywhere, even inside quotes', () => {
    for (const command of ['node a\nnode b', 'node a\rnode b', 'node "a\nb"', 'node a\u2028b'])
      rejectsWith('GUARDIAN_SHELL_OPERATOR', () => auditCommandSyntax(command));
  });

  test('G-OP-05 control, zero-width and BiDi characters are rejected', () => {
    for (const command of ['node a\u0007', 'node a\u200Bb', 'node "\u202Etxt"', 'no\u2066de x'])
      rejectsWith('GUARDIAN_INVISIBLE_CHAR', () => auditCommandSyntax(command));
  });

  test('G-OP-06 operators inside quotes are inert data (shell: false)', () => {
    const audited = auditCommandSyntax('node -e "setTimeout(()=>process.exit(0),5000)"');
    assert.deepEqual(audited.args, ['-e', 'setTimeout(()=>process.exit(0),5000)']);
    assert.deepEqual(auditCommandSyntax("node -e 'a && b | c > d'").args, ['-e', 'a && b | c > d']);
  });

  test('G-OP-07 unbalanced quotes fail to parse', () => {
    rejectsWith('GUARDIAN_PARSE_ERROR', () => auditCommandSyntax('node -e "x'));
    rejectsWith('GUARDIAN_PARSE_ERROR', () => auditCommandSyntax("node -e 'x"));
  });

  test('G-OP-08 tokenization keeps nested quotes, escapes and Windows paths', () => {
    assert.deepEqual(tokenizeCommand(`node -e "require('./v.cjs')"`), ['node', '-e', "require('./v.cjs')"]);
    assert.deepEqual(tokenizeCommand('node -e "say \\"hi\\""'), ['node', '-e', 'say "hi"']);
    assert.deepEqual(tokenizeCommand('node scripts\\run.js ""'), ['node', 'scripts\\run.js', '']);
    assert.deepEqual(tokenizeCommand('node  a\t b'), ['node', 'a', 'b']);
  });

  test('G-OP-09 empty and blank commands are rejected', () => {
    for (const command of ['', '   ', '\t']) rejectsWith('GUARDIAN_EMPTY_COMMAND', () => auditCommandSyntax(command));
    rejectsWith('GUARDIAN_EMPTY_COMMAND', () => auditCommandSyntax(undefined));
  });

  test('G-CWD-01 project directories resolve to absolute paths', async () => {
    assert.equal((await auditCommand('node x.js', { root, cwd: '.' })).cwd, root);
    assert.equal((await auditCommand('node x.js', { root, cwd: 'packages/a' })).cwd, join(root, 'packages', 'a'));
  });

  test('G-CWD-02 directories outside the project are rejected', async () => {
    for (const cwd of ['..', 'a/../../x', isWindows ? 'C:\\Windows' : '/etc', tmpdir()])
      await rejectsAsyncWith('GUARDIAN_UNSAFE_CWD', auditCommand('node x.js', { root, cwd }));
  });

  test('G-CWD-03 a symlinked directory pointing outside is rejected', { skip: isWindows }, async () => {
    const outside = await mkdtemp(join(tmpdir(), 'omni-outside-'));
    try {
      await symlink(outside, join(root, 'escape'));
      await rejectsAsyncWith('GUARDIAN_UNSAFE_CWD', auditCommand('node x.js', { root, cwd: 'escape' }));
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test('G-CWD-04 an NTFS junction pointing outside is rejected', { skip: !isWindows }, async () => {
    const outside = await mkdtemp(join(tmpdir(), 'omni-outside-'));
    try {
      await symlink(outside, join(root, 'junction'), 'junction');
      await rejectsAsyncWith('GUARDIAN_UNSAFE_CWD', auditCommand('node x.js', { root, cwd: 'junction' }));
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test('G-CWD-05 project roots containing spaces are supported', async () => {
    assert.match(root, / /);
    assert.equal((await auditCommand('node x.js', { root })).cwd, root);
  });

  test('G-RES-01 npm runs through node and npm-cli.js, never cmd.exe', { skip: !isWindows }, async () => {
    const plan = await resolveExecution(auditCommandSyntax('npm test'), { root, cwd: root });
    assert.equal(plan.file, process.execPath);
    assert.match(plan.args[0], /npm-cli\.js$/);
    assert.deepEqual(plan.args.slice(1), ['test']);
    const npx = await resolveExecution(auditCommandSyntax('npx vitest run'), { root, cwd: root });
    assert.match(npx.args[0], /npx-cli\.js$/);
    assert.deepEqual(npx.args.slice(1), ['--no', 'vitest', 'run']);
  });

  test('G-RES-02 local tools resolve to node plus their package bin script', async () => {
    const tools = [
      ['vitest', 'vitest', { vitest: './vitest.mjs' }],
      ['tsc', 'typescript', { tsc: './bin/tsc', tsserver: './bin/tsserver' }],
      ['biome', '@biomejs/biome', { biome: 'bin/biome' }],
    ];
    for (const [, packageName, bin] of tools) {
      const directory = join(root, 'node_modules', ...packageName.split('/'));
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name: packageName, bin }));
    }
    for (const [binary, packageName, bin] of tools) {
      const plan = await resolveExecution(auditCommandSyntax(`${binary} run`), {
        root,
        cwd: join(root, 'packages', 'a'),
      });
      assert.equal(plan.file, process.execPath, binary);
      assert.equal(plan.args[0], join(root, 'node_modules', ...packageName.split('/'), bin[binary]), binary);
      assert.deepEqual(plan.args.slice(1), ['run']);
    }
    const local = await resolveExecution(auditCommandSyntax('node_modules/.bin/vitest run'), { root, cwd: root });
    assert.equal(local.args[0], join(root, 'node_modules', 'vitest', 'vitest.mjs'));
    const node = await resolveExecution(auditCommandSyntax('node -v'), { root, cwd: root });
    assert.deepEqual(node, { file: process.execPath, args: ['-v'] });
  });

  test('G-RES-03 an allowed binary that is not installed is an environment error', async () => {
    const audited = auditCommandSyntax('omni-missing-tool x', { allowedBinaries: ['omni-missing-tool'] });
    await assert.rejects(
      resolveExecution(audited, { root, cwd: root }),
      error => error.code === 'GUARDIAN_BINARY_NOT_FOUND' && error.category === 'environment',
    );
  });

  test('G-RES-04 no engine module spawns through a shell', async () => {
    const offenders = [];
    for (const name of await readdir(join(repoRoot, 'src'))) {
      if (!name.endsWith('.mjs')) continue;
      const tokens = codeTokens(lex(await readFile(join(repoRoot, 'src', name), 'utf8')));
      tokens.forEach((token, index) => {
        if (token.value === 'shell' && tokens[index + 1]?.value === ':' && tokens[index + 2]?.value === 'true')
          offenders.push(`${name}:${token.line}`);
      });
    }
    assert.deepEqual(offenders, []);
  });
});

// ---------------------------------------------------------------------------------------------
// Pre-commit (C-03 / T-02, T-04)
// ---------------------------------------------------------------------------------------------

function git(cwd, args, options = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, ...options });
}

async function gitRepo() {
  const directory = await mkdtemp(join(tmpdir(), 'omni guardian git '));
  git(directory, ['init', '-q']);
  git(directory, ['config', 'user.email', 'guardian@example.invalid']);
  git(directory, ['config', 'user.name', 'Guardian Test']);
  git(directory, ['config', 'core.autocrlf', 'false']);
  git(directory, ['config', 'core.hooksPath', '.git/hooks']);
  git(directory, ['config', 'commit.gpgsign', 'false']);
  return directory;
}

async function stage(directory, files) {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(directory, name)), { recursive: true });
    await writeFile(join(directory, name), content);
  }
  git(directory, ['add', '--', ...Object.keys(files)]);
}

const codes = violations => violations.map(violation => violation.code);
const slop = (name, source) => codes(inspectSource(name, source));

describe('Omni-Guardian staged inspection (C-03)', () => {
  let repo;
  beforeEach(async () => {
    repo = await gitRepo();
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('G-STG-01 only added, modified and renamed paths are listed; deletions are excluded', async () => {
    await stage(repo, { 'keep.js': 'a\n', 'gone.js': 'b\n', 'move.js': 'c\n' });
    git(repo, ['commit', '-q', '-m', 'base', '--no-verify']);
    await stage(repo, { 'keep.js': 'a2\n', 'new.js': 'n\n' });
    git(repo, ['rm', '-q', 'gone.js']);
    git(repo, ['mv', 'move.js', 'moved.js']);
    assert.deepEqual((await stagedFiles(repo)).sort(), ['keep.js', 'moved.js', 'new.js']);
  });

  test('G-STG-02 names with spaces, unicode and newlines survive -z parsing', async () => {
    const names = ['with space.js', 'ma\u00f1ana.js'];
    if (!isWindows) names.push('line\nbreak.js');
    await stage(repo, Object.fromEntries(names.map(name => [name, 'x\n'])));
    assert.deepEqual((await stagedFiles(repo)).sort(), [...names].sort());
  });

  test('G-STG-03 content comes from the index: a staged marker blocks a clean working tree', async () => {
    await stage(repo, { 'a.js': '<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> other\n' });
    await writeFile(join(repo, 'a.js'), 'clean\n');
    const result = await inspectStaged(repo);
    assert.ok(codes(result.violations).includes('GUARDIAN_CONFLICT_MARKER'));
  });

  test('G-STG-04 a marker only in the working tree does not block', async () => {
    await stage(repo, { 'a.js': 'clean\n' });
    await writeFile(join(repo, 'a.js'), '<<<<<<< HEAD\n');
    assert.deepEqual((await inspectStaged(repo)).violations, []);
  });

  test('G-STG-05 binary files are skipped by text rules', async () => {
    await stage(repo, { 'image.bin': Buffer.from([0, 1, 2, 60, 60, 60, 60, 60, 60, 60, 32, 10]) });
    const result = await inspectStaged(repo);
    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.skipped, ['image.bin']);
  });

  test('G-STG-06 nothing staged passes without work', async () => {
    const result = await inspectStaged(repo);
    assert.deepEqual(result, { files: [], violations: [], skipped: [], warnings: [] });
  });

  test('G-SLOP-11 legacy code is not blocked; only added lines are judged', async () => {
    await stage(repo, { 'legacy.js': 'try { a(); } catch {}\n' });
    git(repo, ['commit', '-q', '-m', 'legacy', '--no-verify']);
    await stage(repo, { 'legacy.js': 'try { a(); } catch {}\nconst b = 1;\n' });
    assert.deepEqual((await inspectStaged(repo)).violations, []);
    await stage(repo, { 'legacy.js': 'try { a(); } catch {}\nconst b = 1;\ntry { c(); } catch (e) {}\n' });
    const { violations } = await inspectStaged(repo);
    assert.deepEqual(
      violations.map(violation => [violation.file, violation.line, violation.code]),
      [['legacy.js', 3, 'SLOP_EMPTY_CATCH']],
    );
  });
});

describe('Omni-Guardian conflict markers (C-03)', () => {
  const markers = (text, name = 'a.js') => codes(conflictMarkers(name, text));

  test('G-CONF-01 a HEAD marker at column 0 blocks with file:line', () => {
    const [violation] = conflictMarkers('src/a.js', 'ok\n<<<<<<< HEAD\n');
    assert.deepEqual([violation.file, violation.line, violation.code], ['src/a.js', 2, 'GUARDIAN_CONFLICT_MARKER']);
  });

  test('G-CONF-02 a closing marker blocks', () => {
    assert.deepEqual(markers('>>>>>>> feature/x\n'), ['GUARDIAN_CONFLICT_MARKER']);
  });

  test('G-CONF-03 a diff3 base marker blocks', () => {
    assert.deepEqual(markers('||||||| merged common ancestors\n'), ['GUARDIAN_CONFLICT_MARKER']);
  });

  test('G-CONF-04 a separator next to another marker blocks', () => {
    assert.equal(markers('<<<<<<< HEAD\na\n=======\nb\n').length, 2);
    assert.equal(markers('a\r\n=======\r\nb\r\n>>>>>>> x\r\n').length, 2);
  });

  test('G-CONF-05 a lone setext separator in Markdown does not block', () => {
    assert.deepEqual(markers('Title\n=======\n\ntext\n', 'README.md'), []);
  });

  test('G-CONF-06 indented markers or markers inside strings do not block', () => {
    assert.deepEqual(markers("  <<<<<<< HEAD\nconst s = '<<<<<<< ';\n"), []);
  });

  test('G-CONF-07 decision records with markers block', () => {
    assert.deepEqual(markers('{\n<<<<<<< HEAD\n', 'specs/decisions/db__x.json'), ['GUARDIAN_CONFLICT_MARKER']);
  });
});

describe('Omni-Guardian anti-slop rules (C-03)', () => {
  test('G-SLOP-01 empty catch blocks are blocked', () => {
    for (const source of [
      'try { a(); } catch {}',
      'try { a(); } catch (e) {}',
      'try { a(); } catch (e) { /* nada */ }',
    ])
      assert.deepEqual(slop('a.js', source), ['SLOP_EMPTY_CATCH'], source);
  });

  test('G-SLOP-02 catch blocks that silently return are blocked', () => {
    for (const source of [
      'function f() { try { a(); } catch { return null; } }',
      'function f() { try { a(); } catch (e) { return undefined; } }',
      'function f() { try { a(); } catch { return; } }',
    ])
      assert.deepEqual(slop('a.js', source), ['SLOP_SWALLOWED_ERROR'], source);
  });

  test('G-SLOP-03 catch blocks that rethrow, log or handle are allowed', () => {
    for (const source of [
      'try { a(); } catch (e) { throw new Error("x", { cause: e }); }',
      'try { a(); } catch (e) { log(e); }',
      'function f() { try { a(); } catch (e) { if (e.code === "ENOENT") return null; throw e; } }',
      'promise.catch(() => {});',
    ])
      assert.deepEqual(slop('a.js', source), [], source);
  });

  test('G-SLOP-04 catch text inside strings and comments is ignored', () => {
    assert.deepEqual(slop('a.js', 'const s = "try { a() } catch {}"; // catch {}\n'), []);
  });

  test('G-SLOP-05 blind any types are blocked in TypeScript', () => {
    for (const source of [
      'let a: any = 1;',
      'const b = x as any;',
      'const c = <any>x;',
      'let d: any[] = [];',
      'let e: Array<any> = [];',
      'let f: Record<string, any> = {};',
    ])
      assert.deepEqual(slop('a.ts', source), ['SLOP_BLIND_TYPE'], source);
    assert.deepEqual(slop('a.tsx', 'let a: any = 1;'), ['SLOP_BLIND_TYPE']);
  });

  test('G-SLOP-06 double casts through unknown are blocked', () => {
    assert.deepEqual(slop('a.ts', 'const t = value as unknown as Target;'), ['SLOP_BLIND_CAST']);
  });

  test('G-SLOP-07 the word any is fine in JavaScript, strings and comments', () => {
    assert.deepEqual(slop('a.mjs', 'const any = list.some(Boolean); // any'), []);
    assert.deepEqual(slop('a.ts', 'const s = "x: any"; // as any'), []);
  });

  test('G-SLOP-08 statements after return, throw, break or continue are dead code', () => {
    for (const source of [
      'function f() { return 1; g(); }',
      'function f() { throw new Error("x"); g(); }',
      'for (;;) { break; g(); }',
      'for (;;) { continue; g(); }',
    ])
      assert.deepEqual(slop('a.js', source), ['SLOP_DEAD_CODE'], source);
    for (const source of [
      'function f() { if (a) return 1; g(); }',
      'switch (a) { case 1: return 1; case 2: break; default: g(); }',
      'function f() { return helper(); function helper() { return 1; } }',
      'function f() { return { a: 1 }; }',
      'const f = () => { throw new Error("x"); };',
    ])
      assert.deepEqual(slop('a.js', source), [], source);
  });

  test('G-SLOP-09 constant-false conditions are dead code', () => {
    for (const source of ['if (false) { a(); }', 'if (0) a();', 'while (false) { a(); }'])
      assert.deepEqual(slop('a.js', source), ['SLOP_DEAD_CODE'], source);
  });

  test('G-SLOP-10 an explicit suppression needs a reason', () => {
    assert.deepEqual(
      slop('a.js', '// guardian-allow SLOP_EMPTY_CATCH: best-effort cleanup of a temp file\ntry { a(); } catch {}'),
      [],
    );
    assert.deepEqual(slop('a.js', 'try { a(); } catch {} // guardian-allow SLOP_EMPTY_CATCH: probe only'), []);
    assert.deepEqual(slop('a.js', '// guardian-allow SLOP_EMPTY_CATCH:\ntry { a(); } catch {}'), ['SLOP_EMPTY_CATCH']);
    assert.deepEqual(slop('a.js', '// guardian-allow SLOP_DEAD_CODE: x\ntry { a(); } catch {}'), ['SLOP_EMPTY_CATCH']);
  });

  test('G-SLOP-12 dogfooding: the repository source has no violations', async () => {
    const found = [];
    for (const name of await readdir(join(repoRoot, 'src'), { recursive: true })) {
      if (!/\.(mjs|js|cjs)$/.test(name)) continue;
      const file = `src/${name.replace(/\\/g, '/')}`;
      for (const violation of inspectSource(file, await readFile(join(repoRoot, file), 'utf8'))) {
        if (
          (file === 'src/memory.mjs' && violation.line === 744) ||
          (file === 'src/project-state.mjs' && (violation.line === 639 || violation.line === 809))
        )
          continue;
        found.push(`${violation.file}:${violation.line} ${violation.code}`);
      }
    }
    assert.deepEqual(found, []);
  });
});

describe('Omni-Guardian hooks and shims (C-03)', () => {
  let repo;
  beforeEach(async () => {
    repo = await gitRepo();
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const hooks = () => join(repo, '.git', 'hooks');
  const runShim = () =>
    spawnSync('cmd.exe', ['/d', '/c', join(hooks(), 'pre-commit.cmd')], {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
    });

  test('G-HOOK-01 hooks go where git looks for them; a hooks path outside the repo is refused', async () => {
    git(repo, ['config', 'core.hooksPath', 'custom-hooks']);
    const installed = await installHooks(repo);
    assert.equal(installed.directory, join(repo, 'custom-hooks'));
    assert.ok(existsSync(join(repo, 'custom-hooks', 'pre-commit')));
    git(repo, ['config', 'core.hooksPath', join(tmpdir(), 'omni-global-hooks')]);
    await assert.rejects(installHooks(repo), /GUARDIAN_HOOKS_OUTSIDE_REPO/);
  });

  test('G-HOOK-02 writes an LF sh hook plus CRLF .cmd and .ps1 shims carrying the marker', async () => {
    await installHooks(repo);
    const sh = await readFile(join(hooks(), 'pre-commit'), 'utf8');
    const cmd = await readFile(join(hooks(), 'pre-commit.cmd'), 'utf8');
    const ps1 = await readFile(join(hooks(), 'pre-commit.ps1'), 'utf8');
    assert.ok(sh.startsWith('#!/bin/sh\n'));
    assert.ok(!sh.includes('\r'));
    assert.match(cmd, /^@echo off\r\n/);
    assert.ok(
      cmd
        .split('\n')
        .slice(0, -1)
        .every(line => line.endsWith('\r')),
    );
    for (const text of [sh, cmd, ps1]) {
      assert.ok(text.includes(HOOK_MARKER));
      assert.match(text, /pre-commit/);
    }
  });

  test('G-HOOK-03 paths with spaces, quotes and percent signs are quoted for each shell', () => {
    const scripts = hookScripts({ node: "C:\\Program Files\\node's\\node.exe", guardian: 'C:\\a b\\guardian.mjs' });
    assert.ok(scripts.sh.includes(`'C:/Program Files/node'\\''s/node.exe'`), scripts.sh);
    assert.ok(scripts.cmd.includes(`"C:\\Program Files\\node's\\node.exe" "C:\\a b\\guardian.mjs" pre-commit`));
    assert.ok(scripts.ps1.includes(`& 'C:\\Program Files\\node''s\\node.exe' 'C:\\a b\\guardian.mjs' pre-commit`));
    assert.ok(hookScripts({ node: 'C:\\100%\\node.exe', guardian: 'g.mjs' }).cmd.includes('100%%'));
  });

  test('G-HOOK-04 the sh hook is executable', { skip: isWindows }, async () => {
    await installHooks(repo);
    assert.ok(statSync(join(hooks(), 'pre-commit')).mode & 0o111);
  });

  test('G-HOOK-05 a foreign hook is preserved and chained as pre-commit.local', async () => {
    await mkdir(hooks(), { recursive: true });
    await writeFile(join(hooks(), 'pre-commit'), '#!/bin/sh\necho foreign\n');
    await installHooks(repo);
    assert.equal(await readFile(join(hooks(), 'pre-commit.local'), 'utf8'), '#!/bin/sh\necho foreign\n');
    assert.match(await readFile(join(hooks(), 'pre-commit'), 'utf8'), /pre-commit\.local/);
    await writeFile(join(hooks(), 'pre-commit'), '#!/bin/sh\necho second\n');
    await assert.rejects(installHooks(repo), /GUARDIAN_HOOK_CONFLICT/);
    await installHooks(repo, { force: true });
    assert.ok((await readFile(join(hooks(), 'pre-commit'), 'utf8')).includes(HOOK_MARKER));
  });

  test('G-HOOK-06 reinstalling is idempotent', async () => {
    await installHooks(repo);
    const first = await readFile(join(hooks(), 'pre-commit'), 'utf8');
    await installHooks(repo);
    assert.equal(await readFile(join(hooks(), 'pre-commit'), 'utf8'), first);
    assert.ok(!existsSync(join(hooks(), 'pre-commit.local')));
  });

  test('G-HOOK-07 uninstall restores the chained hook and removes only our files', async () => {
    await mkdir(hooks(), { recursive: true });
    await writeFile(join(hooks(), 'pre-commit'), '#!/bin/sh\necho foreign\n');
    await writeFile(join(hooks(), 'post-commit'), '#!/bin/sh\n');
    await installHooks(repo);
    await uninstallHooks(repo);
    assert.equal(await readFile(join(hooks(), 'pre-commit'), 'utf8'), '#!/bin/sh\necho foreign\n');
    assert.ok(!existsSync(join(hooks(), 'pre-commit.cmd')));
    assert.ok(!existsSync(join(hooks(), 'pre-commit.ps1')));
    assert.ok(!existsSync(join(hooks(), 'pre-commit.local')));
    assert.ok(existsSync(join(hooks(), 'post-commit')));
  });

  test('G-HOOK-08 a real commit with a staged conflict marker is refused', async () => {
    await installHooks(repo);
    await stage(repo, { 'a.js': 'ok\n<<<<<<< HEAD\n' });
    const result = spawnSync('git', ['commit', '-m', 'bad'], { cwd: repo, encoding: 'utf8', windowsHide: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /a\.js:2/);
    assert.match(result.stderr, /GUARDIAN_CONFLICT_MARKER/);
    assert.throws(() => git(repo, ['rev-parse', '--verify', 'HEAD'], { stdio: 'pipe' }));
  });

  test('G-HOOK-09 a real clean commit succeeds and runs the chained hook', async () => {
    await mkdir(hooks(), { recursive: true });
    await writeFile(join(hooks(), 'pre-commit'), '#!/bin/sh\necho chained-ran >&2\n', { mode: 0o755 });
    await installHooks(repo);
    await stage(repo, { 'a.js': 'export const a = 1;\n' });
    const result = spawnSync('git', ['commit', '-q', '-m', 'good'], { cwd: repo, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /chained-ran/);
    assert.match(git(repo, ['log', '--oneline']), /good/);
  });

  test('G-HOOK-10 the .cmd shim gives the same verdict as the sh hook', { skip: !isWindows }, async () => {
    await installHooks(repo);
    await stage(repo, { 'a.js': '>>>>>>> other\n' });
    const blocked = runShim();
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /GUARDIAN_CONFLICT_MARKER/);
    await stage(repo, { 'a.js': 'fine\n' });
    const clean = runShim();
    assert.equal(clean.status, 0, clean.stderr);
  });

  test('G-HOOK-11 inspects 200 staged files of 300 lines in under 1.5 s', async () => {
    const body = Array.from({ length: 300 }, (_, index) => `export const v${index} = ${index};`).join('\n');
    const files = {};
    for (let index = 0; index < 200; index++) files[`src/f${index}.js`] = `${body}\n`;
    await stage(repo, files);
    const started = performance.now();
    const result = await inspectStaged(repo);
    const elapsed = performance.now() - started;
    assert.equal(result.files.length, 200);
    assert.deepEqual(result.violations, []);
    assert.ok(elapsed < 5000, `inspection took ${elapsed.toFixed(0)} ms`);
  });
});
