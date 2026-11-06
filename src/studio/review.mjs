import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { GateError, approveGate } from '../gates.mjs';
import { loadManifest } from '../manifest.mjs';
import { inspectVerification } from '../verification.mjs';
import { MAX_FRAME_BYTES, StudioError } from './protocol.mjs';

/**
 * Unified Reviewer (blueprint §4.7.2.3, plan §7). The reviewed diff is HEAD → working tree, tracked
 * and untracked. Approving a hunk stages it; rejecting leaves it in the working tree. Nothing here
 * reverts code or commits (D-10).
 */

const execFileAsync = promisify(execFile);
const REMARK_MAX = 2000;
const DEFAULT_PAGE_BYTES = MAX_FRAME_BYTES / 2;
/** Machine-written governance records: reviewing them as code would make gate 2 unreachable. */
const EXCLUDED = ['specs/*/verification.json', 'specs/*/approvals.json'];
const EXCLUDED_PATTERNS = [/^specs\/[^/]+\/verification\.json$/, /^specs\/[^/]+\/approvals\.json$/];
const sha256 = text => createHash('sha256').update(text).digest('hex');

async function git(root, args) {
  const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

function gitWithInput(root, args, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => (stderr += chunk));
    child.on('error', reject);
    child.on('close', code =>
      code === 0 ? resolvePromise() : reject(new Error(`git ${args.join(' ')} failed (${code}): ${stderr.trim()}`)),
    );
    child.stdin.end(input);
  });
}

/** Project-relative POSIX path, or PATH_OUTSIDE_ROOT. Backslashes are separators on every OS. */
export function projectPath(root, path) {
  const rel = relative(root, resolve(root, path.replaceAll('\\', '/')));
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new StudioError('PATH_OUTSIDE_ROOT', `${path} is not inside the project.`);
  return rel.split(sep).join('/');
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function finishHunk(file, hunk) {
  const text = hunk.lines.join('\n') + '\n';
  file.hunks.push({
    id: sha256(`${file.path}\0${hunk.header}\0${text}`),
    header: hunk.header,
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    text,
  });
}

/** Parses `git diff` output into files with headers (kept to rebuild patches) and hunks. */
export function parseUnifiedDiff(output) {
  const files = [];
  let file = null;
  let hunk = null;
  const close = () => {
    if (hunk) finishHunk(file, hunk);
    hunk = null;
  };
  for (const line of output.split('\n')) {
    if (line.startsWith('diff --git ')) {
      close();
      const paths = /^diff --git a\/(.+) b\/(.+)$/.exec(line.replace(/\r$/, ''));
      file = {
        path: paths?.[2] ?? '',
        oldPath: paths?.[1] ?? null,
        status: 'modified',
        binary: false,
        additions: 0,
        deletions: 0,
        header: [line],
        hunks: [],
      };
      files.push(file);
      continue;
    }
    if (!file) continue;
    if (hunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line.startsWith('\\'))) {
      if (line.startsWith('+')) file.additions++;
      else if (line.startsWith('-')) file.deletions++;
      hunk.lines.push(line);
      continue;
    }
    const header = HUNK_HEADER.exec(line);
    if (header) {
      close();
      hunk = {
        header: line,
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      continue;
    }
    if (line === '') continue;
    file.header.push(line);
    if (line.startsWith('new file mode')) file.status = 'added';
    else if (line.startsWith('deleted file mode')) file.status = 'deleted';
    else if (line.startsWith('rename from ')) {
      file.status = 'renamed';
      file.oldPath = line.slice('rename from '.length);
    } else if (line.startsWith('rename to ')) file.path = line.slice('rename to '.length);
    else if (line.startsWith('Binary files ')) file.binary = true;
    else if (line.startsWith('+++ b/')) file.path = line.slice(6);
  }
  close();
  for (const entry of files) if (entry.status !== 'renamed') entry.oldPath = null;
  return files;
}

async function untrackedFiles(root) {
  const listed = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z']))
    .split('\0')
    .filter(path => path && !EXCLUDED_PATTERNS.some(pattern => pattern.test(path)));
  const files = [];
  for (const path of listed.sort()) {
    const content = await readFile(join(root, path));
    const header = [`diff --git a/${path} b/${path}`, 'new file mode 100644'];
    const entry = {
      path,
      oldPath: null,
      status: 'untracked',
      binary: false,
      additions: 0,
      deletions: 0,
      header,
      hunks: [],
    };
    if (content.includes(0)) entry.binary = true;
    else if (content.length) {
      const text = content.toString('utf8');
      const lines = text.split('\n');
      const trailingNewline = text.endsWith('\n');
      if (trailingNewline) lines.pop();
      const body = lines.map(line => `+${line}`);
      if (!trailingNewline) body.push('\\ No newline at end of file');
      header.push('--- /dev/null', `+++ b/${path}`);
      entry.additions = lines.length;
      finishHunk(entry, {
        header: `@@ -0,0 +1,${lines.length} @@`,
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: lines.length,
        lines: body,
      });
    }
    files.push(entry);
  }
  return files;
}

async function fullDiff(root) {
  const tracked = parseUnifiedDiff(
    await git(root, [
      'diff',
      'HEAD',
      '--no-color',
      '--no-ext-diff',
      '-M',
      '-U3',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--',
      '.',
      ...EXCLUDED.map(pattern => `:(exclude,glob)${pattern}`),
    ]),
  );
  return [...tracked, ...(await untrackedFiles(root))];
}

const publicFile = ({ header, ...file }) => file;

/**
 * @param {string} root
 * @param {{maxBytes?: number}} [options] Above maxBytes of hunk text the files come without hunks
 *   (`paged: true`) and each one is fetched with getDiffFile.
 */
export async function getDiff(root, { maxBytes = DEFAULT_PAGE_BYTES } = {}) {
  const files = await fullDiff(root);
  const bytes = files.reduce((sum, file) => sum + file.hunks.reduce((total, hunk) => total + hunk.text.length, 0), 0);
  if (bytes <= maxBytes) return { paged: false, files: files.map(publicFile) };
  return { paged: true, files: files.map(file => ({ ...publicFile(file), hunks: null })) };
}

/** @throws {StudioError} PATH_OUTSIDE_ROOT, FILE_NOT_CHANGED */
export async function getDiffFile(root, path) {
  const target = projectPath(root, path);
  const file = (await fullDiff(root)).find(entry => entry.path === target);
  if (!file) throw new StudioError('FILE_NOT_CHANGED', `${target} has no changes to review.`);
  return publicFile(file);
}

function decisionsFor(memory, spec) {
  return new Map(
    memory.db
      .prepare('SELECT hunk_id, decision FROM review_decisions WHERE spec_id = ?')
      .all(spec)
      .map(row => [row.hunk_id, row.decision]),
  );
}

/** @throws {StudioError} HUNK_STALE when the hunk is no longer in the working tree diff. */
export async function decideHunk(root, memory, { spec, hunkId, decision, actor }) {
  if (!['approve', 'reject'].includes(decision))
    throw new StudioError('DECISION_INVALID', `Decision must be approve or reject, not ${decision}.`);
  const files = await fullDiff(root);
  if (!files.some(file => file.hunks.some(hunk => hunk.id === hunkId)))
    throw new StudioError('HUNK_STALE', 'The hunk changed or disappeared since it was shown. Refresh the diff.', {
      retryable: true,
    });
  memory.write(() =>
    memory.db
      .prepare(
        `INSERT INTO review_decisions (spec_id, hunk_id, decision, actor, decided_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(spec_id, hunk_id) DO UPDATE SET decision = excluded.decision, actor = excluded.actor,
         decided_at = excluded.decided_at`,
      )
      .run(spec, hunkId, decision, actor, new Date().toISOString()),
  );
  return { hunkId, decision };
}

function undecided(files, decisions) {
  return files.flatMap(file => file.hunks).filter(hunk => !decisions.has(hunk.id)).length;
}

/**
 * Rebuilds the index of every reviewed file from HEAD, then applies exactly the approved hunks to
 * the index. The working tree is never written.
 * @throws {StudioError} REVIEW_INCOMPLETE
 */
export async function stageApproved(root, memory, { spec }) {
  const files = await fullDiff(root);
  const decisions = decisionsFor(memory, spec);
  const pending = undecided(files, decisions);
  if (pending)
    throw new StudioError('REVIEW_INCOMPLETE', `Review incomplete: ${pending} hunk(s) have no decision yet.`);
  const reviewed = files.filter(file => !file.binary);
  const paths = [...new Set(reviewed.flatMap(file => [file.path, file.oldPath].filter(Boolean)))];
  if (paths.length) await git(root, ['reset', '-q', 'HEAD', '--', ...paths]);
  let staged = 0;
  const patch = [];
  for (const file of reviewed) {
    const approved = file.hunks.filter(hunk => decisions.get(hunk.id) === 'approve');
    if (!approved.length) continue;
    staged += approved.length;
    patch.push(file.header.join('\n'), ...approved.map(hunk => `${hunk.header}\n${hunk.text}`.replace(/\n$/, '')));
  }
  if (patch.length)
    await gitWithInput(root, ['apply', '--cached', '--whitespace=nowarn', '-'], `${patch.join('\n')}\n`);
  return { staged };
}

async function specEntry(root, identifier) {
  const manifest = await loadManifest(root);
  const spec = manifest?.specs.find(entry => entry.id === identifier || entry.slug === identifier);
  if (!spec) throw new StudioError('SPEC_NOT_FOUND', `Specification ${identifier} is not in the manifest.`);
  return { manifest, spec };
}

/**
 * Gate 2 (blueprint §4.7.3): every hunk decided and a valid HMAC-attested verification.
 * @throws {StudioError} GATE_LOCKED with the exact reason the Protected state shows.
 */
export async function approveGate2(root, memory, { spec, actor }) {
  const { manifest, spec: entry } = await specEntry(root, spec);
  const pending = undecided(await fullDiff(root), decisionsFor(memory, entry.id));
  if (pending)
    throw new StudioError('GATE_LOCKED', `Gate 2 locked: review incomplete, ${pending} hunk(s) have no decision yet.`);
  try {
    await inspectVerification(root, entry, manifest);
  } catch (error) {
    if (error.constructor !== Error && error.name !== 'AttestationError') throw error;
    throw new StudioError(
      'GATE_LOCKED',
      `Gate 2 locked: the HMAC attestation of the verification is missing or invalid (${error.message})`,
    );
  }
  try {
    return await approveGate(root, entry.id, 2, { actor });
  } catch (error) {
    if (error instanceof GateError) throw new StudioError('GATE_LOCKED', `Gate 2 locked: ${error.message}`);
    throw error;
  }
}

/**
 * Inline correction (D-8): stored as a review-remark observation that MCP omni_search_context returns.
 * @throws {StudioError} PATH_OUTSIDE_ROOT, REMARK_INVALID
 */
export async function addRemark(root, memory, { spec, file, line, side, text }) {
  const path = projectPath(root, file);
  if (typeof text !== 'string' || !text.trim() || text.length > REMARK_MAX)
    throw new StudioError('REMARK_INVALID', `A correction needs 1 to ${REMARK_MAX} characters.`);
  if (!Number.isSafeInteger(line) || line < 1 || !['old', 'new'].includes(side))
    throw new StudioError('REMARK_INVALID', 'A correction needs a line number and the side (old or new).');
  const [id] = memory.addObservations([
    { category: 'review-remark', scope: path, summary: text, evidence: `spec ${spec} · ${path}:${line} (${side})` },
  ]);
  return id;
}
