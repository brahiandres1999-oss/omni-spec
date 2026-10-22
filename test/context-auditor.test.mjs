import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auditProjectContext } from '../src/context-auditor.mjs';
import { scaffoldProject } from '../src/generator.mjs';
import { runCli } from '../src/cli.mjs';
let root;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omni-context-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const report = link =>
  `# Context\nCONTEXT_RECORDED; APPLICATION_NOT_VALIDATED\n## Sources compared\n<!-- omni:source-conflicts -->\nNo conflicts observed in README; other sources not assessed.\n${link}\n`;

test('context check is read-only and works from a project subdirectory', async () => {
  assert.equal(await runCli(['context-check'], root), 1);
  await scaffoldProject(root);
  await mkdir(join(root, 'module'));
  const before = await readFile(join(root, 'specs/project-context.md'), 'utf8');
  assert.equal(await runCli(['context-check', '--json'], join(root, 'module')), 0);
  assert.equal(await readFile(join(root, 'specs/project-context.md'), 'utf8'), before);
});

test('portable document-relative citations and real line references resolve after installation', async () => {
  await scaffoldProject(root);
  await writeFile(join(root, 'README with spaces.md'), '# Product\nDeclared intent only.\n');
  await writeFile(
    join(root, 'specs/project-context.md'),
    report(
      '[Source](<../README with spaces.md#L1-L2>)\n[Policy](../CONSTITUTION.md#L3)\n[External](https://example.org/docs)',
    ),
  );
  const checked = await auditProjectContext(root);
  assert.equal(checked.valid, true);
  assert.equal(checked.linksChecked, 2);
  assert.equal(checked.semanticReview, 'REQUIRED');
});

test('rejects machine-specific citations in inline, reference and autolink forms', async () => {
  await scaffoldProject(root);
  await writeFile(
    join(root, 'specs/project-context.md'),
    report('[A](file:///C:/Users/user/README.md)\n[B]: C:/work/policy.md\n<file:///tmp/source.md>'),
  );
  const checked = await auditProjectContext(root);
  assert.equal(checked.valid, false);
  assert.equal(checked.errors.length, 3);
  assert.equal(await runCli(['context-check', '--json'], root), 1);
});

test('rejects missing files, escaped project paths and nonexistent source lines', async () => {
  await scaffoldProject(root);
  await writeFile(
    join(root, 'specs/project-context.md'),
    report('[Missing](../nonexistent.md)\n[Outside](../../outside.md)\n[Wrong line](../CONSTITUTION.md#L9999)'),
  );
  const checked = await auditProjectContext(root);
  assert.equal(checked.valid, false);
  assert.equal(checked.errors.length, 3);
  assert.ok(checked.errors.some(e => e.includes('Line 9999')));
});

test('requires explicit states and source-conflict review without requiring English headings', async () => {
  await scaffoldProject(root);
  await writeFile(join(root, 'specs/project-context.md'), '# Contexte\nTout est prêt.\n');
  assert.equal((await auditProjectContext(root)).errors.length, 3);
  await writeFile(join(root, 'specs/project-context.md'), report('[Policy](../CONSTITUTION.md)'));
  assert.equal((await auditProjectContext(root)).valid, true);
});

test('existing citation is never treated as proof of a source claim', async () => {
  await scaffoldProject(root);
  await writeFile(
    join(root, 'specs/project-context.md'),
    report('Unsubstantiated assertion: every route is isolated. [Policy](../CONSTITUTION.md)'),
  );
  const checked = await auditProjectContext(root);
  assert.equal(checked.valid, true);
  assert.equal(checked.scope, 'STRUCTURE_AND_LOCAL_LINKS_ONLY');
  assert.equal(checked.semanticReview, 'REQUIRED');
  assert.match(checked.warnings.join(' '), /does not prove claim attribution/);
});
