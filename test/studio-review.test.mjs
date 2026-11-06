import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { approveGate, gateStatus } from '../src/gates.mjs';
import { openProjectMemory } from '../src/memory.mjs';
import { verifySpec } from '../src/verification.mjs';
import { addRemark, approveGate2, decideHunk, getDiff, getDiffFile, stageApproved } from '../src/studio/review.mjs';
import { fillSpec } from '../test-support/fixtures.mjs';
import { CLI, makeStudioProject, numberedLines } from '../test-support/studio-fixtures.mjs';

let project;
let memory;

beforeEach(async () => {
  project = makeStudioProject();
  ({ memory } = await openProjectMemory(project.root));
});

afterEach(() => {
  memory.close();
  project.cleanup();
});

const SPEC = '001';
const rejectsCode = (promise, code) =>
  assert.rejects(promise, error => {
    assert.equal(error.code, code, error.message);
    return true;
  });

/** Base file committed, then edited in three separated places → three hunks. */
function threeHunks(path = 'src/app.txt') {
  project.write(path, numberedLines(60));
  project.commit('base');
  const lines = numberedLines(60).split('\n');
  lines[4] = 'changed 5';
  lines[29] = 'changed 30';
  lines[54] = 'changed 55';
  project.write(path, lines.join('\n'));
  return path;
}

describe('RV diff', () => {
  test('RV-01 diff.get returns unified hunks and stats; binaries are flagged', async () => {
    // The empty binary is committed with the text base, so both changes below stay uncommitted.
    project.write('assets/logo.bin', '');
    const path = threeHunks();
    const binary = Buffer.from([0, 1, 2, 3, 0, 255]);
    project.write('assets/logo.bin', binary.toString('latin1'));
    const diff = await getDiff(project.root);
    const file = diff.files.find(entry => entry.path === path);
    assert.equal(file.hunks.length, 3);
    assert.equal(file.additions, 3);
    assert.equal(file.deletions, 3);
    assert.match(file.hunks[0].header, /^@@ -\d+,\d+ \+\d+,\d+ @@/);
    assert.equal(diff.files.find(entry => entry.path === 'assets/logo.bin').binary, true);
  });

  test('RV-02 untracked files appear as additions and the index is untouched', async () => {
    project.write('src/new.ts', 'export const fresh = true;\n');
    const before = project.git('diff', '--cached', '--name-only');
    const diff = await getDiff(project.root);
    const file = diff.files.find(entry => entry.path === 'src/new.ts');
    assert.equal(file.status, 'untracked');
    assert.equal(file.additions, 1);
    assert.equal(project.git('diff', '--cached', '--name-only'), before);
    assert.equal(project.git('ls-files', 'src/new.ts'), '', 'no git add -N');
  });

  test('RV-03 a rename with edits is one file with old and new paths', async () => {
    project.write('src/old-name.ts', numberedLines(40));
    project.commit('base');
    project.git('mv', 'src/old-name.ts', 'src/new-name.ts');
    project.write('src/new-name.ts', numberedLines(40).replace('line 20', 'line twenty'));
    const diff = await getDiff(project.root);
    const renamed = diff.files.filter(entry => entry.path === 'src/new-name.ts' || entry.path === 'src/old-name.ts');
    assert.equal(renamed.length, 1);
    assert.equal(renamed[0].status, 'renamed');
    assert.equal(renamed[0].oldPath, 'src/old-name.ts');
  });

  test('RV-04 CRLF hunks keep their carriage returns and still apply', async () => {
    project.write('src/win.txt', 'a\r\nb\r\nc\r\n');
    project.commit('crlf base');
    project.write('src/win.txt', 'a\r\nB\r\nc\r\n');
    const diff = await getDiff(project.root);
    const [hunk] = diff.files.find(entry => entry.path === 'src/win.txt').hunks;
    assert.match(hunk.text, /\r\n/);
    await decideHunk(project.root, memory, { spec: SPEC, hunkId: hunk.id, decision: 'approve', actor: 'tester' });
    await stageApproved(project.root, memory, { spec: SPEC });
    assert.equal(project.git('show', ':src/win.txt'), 'a\r\nB\r\nc');
  });

  test('RV-05 hunk ids are stable across refreshes and change with content', async () => {
    threeHunks();
    const first = (await getDiff(project.root)).files[0].hunks.map(hunk => hunk.id);
    const second = (await getDiff(project.root)).files[0].hunks.map(hunk => hunk.id);
    assert.deepEqual(first, second);
    assert.ok(first.every(id => /^[0-9a-f]{64}$/.test(id)));
    project.write('src/app.txt', project.read('src/app.txt').replace('changed 30', 'changed thirty'));
    const third = (await getDiff(project.root)).files[0].hunks.map(hunk => hunk.id);
    assert.equal(third[0], first[0]);
    assert.notEqual(third[1], first[1]);
  });

  test('RV-15 a 10.000-line diff is served under 500 ms or paginated by file', async () => {
    project.write('src/big.txt', numberedLines(10_000));
    project.commit('big base');
    project.write('src/big.txt', numberedLines(10_000, 'edited'));
    const startedAt = performance.now();
    const diff = await getDiff(project.root);
    const elapsed = performance.now() - startedAt;
    assert.ok(elapsed < 500, `${elapsed.toFixed(0)} ms`);
    const file = diff.files.find(entry => entry.path === 'src/big.txt');
    assert.equal(file.additions, 10_000);
    const paged = await getDiff(project.root, { maxBytes: 64 * 1024 });
    assert.equal(paged.paged, true);
    assert.equal(paged.files.find(entry => entry.path === 'src/big.txt').hunks, null);
    const single = await getDiffFile(project.root, 'src/big.txt');
    assert.equal(single.additions, 10_000);
  });
});

describe('RV review decisions', () => {
  test('RV-06 decisions persist in review_decisions with actor and date', async () => {
    threeHunks();
    const [hunk] = (await getDiff(project.root)).files[0].hunks;
    await decideHunk(project.root, memory, { spec: SPEC, hunkId: hunk.id, decision: 'reject', actor: 'ana' });
    const row = memory.db.prepare('SELECT spec_id, hunk_id, decision, actor, decided_at FROM review_decisions').get();
    assert.equal(row.spec_id, SPEC);
    assert.equal(row.hunk_id, hunk.id);
    assert.equal(row.decision, 'reject');
    assert.equal(row.actor, 'ana');
    assert.ok(!Number.isNaN(Date.parse(row.decided_at)));
  });

  test('RV-07 a hunk id that no longer exists is HUNK_STALE', async () => {
    threeHunks();
    const [hunk] = (await getDiff(project.root)).files[0].hunks;
    project.write('src/app.txt', project.read('src/app.txt').replace('changed 5', 'changed five'));
    await rejectsCode(
      decideHunk(project.root, memory, { spec: SPEC, hunkId: hunk.id, decision: 'approve', actor: 'ana' }),
      'HUNK_STALE',
    );
  });

  test('RV-08 staging puts exactly the approved hunks in the index and never touches the tree', async () => {
    const path = threeHunks();
    const worktree = readFileSync(join(project.root, path));
    const hunks = (await getDiff(project.root)).files[0].hunks;
    const decide = (hunk, decision) =>
      decideHunk(project.root, memory, { spec: SPEC, hunkId: hunk.id, decision, actor: 'ana' });
    await decide(hunks[0], 'approve');
    await decide(hunks[1], 'reject');
    await decide(hunks[2], 'approve');
    const result = await stageApproved(project.root, memory, { spec: SPEC });
    assert.equal(result.staged, 2);
    const cached = project.git('diff', '--cached', '-U0', '--', path);
    assert.match(cached, /\+changed 5/);
    assert.match(cached, /\+changed 55/);
    assert.doesNotMatch(cached, /changed 30/);
    assert.ok(readFileSync(join(project.root, path)).equals(worktree), 'working tree byte-identical');
  });

  test('RV-09 rejected hunks stay in the working tree and are never reverted', async () => {
    const path = threeHunks();
    const hunks = (await getDiff(project.root)).files[0].hunks;
    for (const hunk of hunks)
      await decideHunk(project.root, memory, { spec: SPEC, hunkId: hunk.id, decision: 'reject', actor: 'ana' });
    const result = await stageApproved(project.root, memory, { spec: SPEC });
    assert.equal(result.staged, 0);
    assert.equal(project.git('diff', '--cached', '--name-only'), '');
    const unstaged = project.git('diff', '-U0', '--', path);
    for (const line of ['changed 5', 'changed 30', 'changed 55']) assert.ok(unstaged.includes(`+${line}`), line);
  });

  test('RV-10 staging refuses while hunks are undecided', async () => {
    threeHunks();
    const [hunk] = (await getDiff(project.root)).files[0].hunks;
    await decideHunk(project.root, memory, { spec: SPEC, hunkId: hunk.id, decision: 'approve', actor: 'ana' });
    await rejectsCode(stageApproved(project.root, memory, { spec: SPEC }), 'REVIEW_INCOMPLETE');
    assert.equal(project.git('diff', '--cached', '--name-only'), '');
  });

  test('RV-11 gate 2 opens only with every hunk decided and a valid attested verification', async () => {
    project.cli('create', 'feature', 'greeting', '--full');
    const manifest = project.readJson('specs/manifest.json');
    manifest.governance = { ...manifest.governance, humanGates: 'full' };
    project.writeJson('specs/manifest.json', manifest);
    await fillSpec(project.root, { slug: '001-greeting', type: 'feature' });
    project.write('src/greet.cjs', "module.exports = name => 'Hello ' + name;\n");
    project.commit('spec and base code');
    await approveGate(project.root, SPEC, 1, { actor: 'ana' });
    project.write('src/greet.cjs', "module.exports = name => ['Hello', name].join(' ');\n");
    const [hunk] = (await getDiff(project.root)).files.find(entry => entry.path === 'src/greet.cjs').hunks;
    await assert.rejects(approveGate2(project.root, memory, { spec: SPEC, actor: 'ana' }), error => {
      assert.equal(error.code, 'GATE_LOCKED');
      assert.match(error.message, /review/i);
      return true;
    });
    await decideHunk(project.root, memory, { spec: SPEC, hunkId: hunk.id, decision: 'approve', actor: 'ana' });
    await assert.rejects(approveGate2(project.root, memory, { spec: SPEC, actor: 'ana' }), error => {
      assert.equal(error.code, 'GATE_LOCKED');
      assert.match(error.message, /HMAC|attest/i);
      return true;
    });
    const verified = await verifySpec(project.root, SPEC, {
      manual: 'Scoped fixture review confirms the deterministic greeting locally.',
    });
    assert.equal(verified.passed, true);
    await approveGate2(project.root, memory, { spec: SPEC, actor: 'ana' });
    assert.equal((await gateStatus(project.root, SPEC)).gates[2], 'approved');
  });

  test('RV-14 paths outside the root are refused before any read', async () => {
    await rejectsCode(getDiffFile(project.root, '../../etc/passwd'), 'PATH_OUTSIDE_ROOT');
    await rejectsCode(
      addRemark(project.root, memory, { spec: SPEC, file: '..\\outside.ts', line: 1, side: 'new', text: 'x' }),
      'PATH_OUTSIDE_ROOT',
    );
  });
});

describe('RV inline remarks', () => {
  test('RV-12 a remark is stored as a review-remark observation that MCP search returns', async () => {
    threeHunks();
    const text = 'Extrae esta logica a un helper puro antes de seguir';
    const id = await addRemark(project.root, memory, { spec: SPEC, file: 'src/app.txt', line: 30, side: 'new', text });
    const row = memory.db.prepare('SELECT category, scope, summary FROM observations WHERE id = ?').get(id);
    assert.equal(row.category, 'review-remark');
    assert.equal(row.scope, 'src/app.txt');
    assert.equal(row.summary, text);
    memory.close();

    const child = spawn(process.execPath, [CLI, 'mcp'], { cwd: project.root, stdio: ['pipe', 'pipe', 'pipe'] });
    const replies = new Map();
    createInterface({ input: child.stdout }).on('line', line => {
      const message = JSON.parse(line);
      replies.get(message.id)?.(message);
    });
    const request = (id, method, params) =>
      new Promise(resolve => {
        replies.set(id, resolve);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    await request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {} });
    const reply = await request(2, 'tools/call', { name: 'omni_search_context', arguments: { query: 'helper puro' } });
    child.stdin.end();
    await new Promise(resolve => child.on('close', resolve));
    const { results } = JSON.parse(reply.result.content[0].text);
    assert.ok(
      results.some(result => JSON.stringify(result).includes('helper puro')),
      JSON.stringify(results),
    );
    ({ memory } = await openProjectMemory(project.root));
  });

  test('RV-13 remark text must be 1 to 2.000 characters', async () => {
    const remark = text =>
      addRemark(project.root, memory, { spec: SPEC, file: 'src/a.ts', line: 1, side: 'new', text });
    await rejectsCode(remark('   '), 'REMARK_INVALID');
    await rejectsCode(remark('x'.repeat(2001)), 'REMARK_INVALID');
    assert.ok(await remark('x'.repeat(2000)));
  });
});
