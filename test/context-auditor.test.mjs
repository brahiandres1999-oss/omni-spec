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

async function contextCheck() {
  const lines = [],
    log = console.log;
  console.log = line => lines.push(line);
  try {
    return { code: await runCli(['context-check', '--json'], root), report: JSON.parse(lines.join('\n')) };
  } finally {
    console.log = log;
  }
}

test('context-check warns above 24000 characters, counted without BOM and with CRLF as one break', async () => {
  await scaffoldProject(root);
  const base = report('[Policy](../CONSTITUTION.md)');
  const sized = length => base + 'x'.repeat(length - base.length - 1) + '\n';
  const size = /specs\/project-context\.md has (\d+) characters, above the 24000 \(about 6,000 tokens\)/;
  for (const [length, warned] of [
    [24000, false],
    [24001, true],
  ]) {
    const lf = sized(length);
    assert.equal(lf.length, length);
    for (const text of [lf, lf.replace(/\n/g, '\r\n'), `\uFEFF${lf}`]) {
      await writeFile(join(root, 'specs/project-context.md'), text);
      const checked = await auditProjectContext(root);
      assert.equal(checked.valid, true);
      const warning = checked.warnings.find(item => size.test(item));
      assert.equal(Boolean(warning), warned, JSON.stringify({ length, crlf: text.includes('\r'), warning }));
      if (warned) assert.equal(size.exec(warning)[1], String(length));
      const { code, report: cli } = await contextCheck();
      assert.equal(code, 0);
      assert.deepEqual(cli.warnings, checked.warnings);
    }
  }
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

test('auditProjectContext exposes deterministic context budget metrics', async () => {
  await scaffoldProject(root);
  const sample = report('[Policy](../CONSTITUTION.md)');
  await writeFile(join(root, 'specs/project-context.md'), sample);
  const checked = await auditProjectContext(root);
  assert.equal(checked.valid, true);
  assert.equal(typeof checked.characters, 'number');
  assert.equal(checked.characterLimit, 24000);
  assert.equal(checked.tokensEstimated, Math.round(checked.characters / 4));
  assert.equal(checked.withinBudget, true);

  const { code, report: cli } = await contextCheck();
  assert.equal(code, 0);
  assert.equal(cli.characters, checked.characters);
  assert.equal(cli.characterLimit, 24000);
  assert.equal(cli.tokensEstimated, checked.tokensEstimated);
  assert.equal(cli.withinBudget, true);
});
