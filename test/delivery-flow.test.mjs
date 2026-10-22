import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { auditSpec } from '../src/auditor.mjs';
import { verifySpec, completeSpec } from '../src/verification.mjs';
import { runCli } from '../src/cli.mjs';
import { fillSpec } from '../test-support/fixtures.mjs';

let root;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omni-delivery-'));
  await scaffoldProject(root, { agent: 'generic' });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('risk-aware light bugfix closes without deleting optional templates and escalates again on risk', async () => {
  const spec = await createSpec(root, 'bugfix', 'small-regression');
  const directory = join(root, 'specs', spec.slug);
  await writeFile(
    join(directory, 'bug.md'),
    '# Reproduction and resolution\nAC-01: the local deterministic greeting returns Hello Ada. The reproduction and missing return root cause are confirmed; review the exact regression before closure.\n',
  );
  const fit = {
    schemaVersion: 2,
    reasoning: 'done',
    files: 1,
    modules: 1,
    crossesContract: false,
    ambiguity: 'none',
    existingTests: true,
    risk: 'low',
    uncertainty: 'clear',
    reversibility: 'easy',
  };
  await writeFile(join(directory, 'fit.json'), JSON.stringify(fit));
  await writeFile(
    join(directory, 'verification.md'),
    '# Evidence\nThe fixture manual review compares the requested deterministic greeting with its scoped expected result. This exercises the lightweight bugfix delivery contract only.\n',
  );
  await writeFile(
    join(directory, 'acceptance.json'),
    JSON.stringify({
      schemaVersion: 2,
      criteria: [
        {
          id: 'AC-01',
          kind: 'functional',
          status: 'passed',
          method: 'manual',
          evidence:
            'The explicit fixture review confirms the deterministic greeting contract; no remote behavior is claimed.',
        },
      ],
    }),
  );
  assert.equal((await auditSpec(root, spec.id)).valid, true);
  assert.match(await readFile(join(directory, 'rca.md'), 'utf8'), /\[TODO\]|BUG-XXX/);
  assert.equal(
    (await verifySpec(root, spec.id, { manual: 'Scoped fixture review confirms the local deterministic result.' }))
      .passed,
    true,
  );
  assert.equal((await completeSpec(root, spec.id)).status, 'COMPLETED');
  await writeFile(join(directory, 'fit.json'), JSON.stringify({ ...fit, risk: 'critical' }));
  assert.equal((await auditSpec(root, spec.id)).valid, false);
});

test('CLI module checks, closure, contract activation and reinitialization preserve effective decisions', async () => {
  await mkdir(join(root, 'api'));
  await writeFile(join(root, 'api/value.cjs'), 'module.exports = 42;');
  const spec = await createSpec(root, 'feature', 'module-contract');
  await fillSpec(root, spec);
  await mkdir(join(root, 'specs/.omni/requests'), { recursive: true });
  await writeFile(
    join(root, 'specs/.omni/requests/checks.json'),
    JSON.stringify({
      schemaVersion: 1,
      checks: [
        {
          id: 'module-answer',
          command: "node -e \"require('node:assert/strict').equal(require('./value.cjs'),42)\"",
          cwd: 'api',
        },
      ],
    }),
  );
  await writeFile(
    join(spec.specDir, 'acceptance.json'),
    JSON.stringify({
      schemaVersion: 2,
      criteria: [
        {
          id: 'AC-01',
          kind: 'functional',
          status: 'passed',
          method: 'automated',
          checkIds: ['module-answer'],
          evidence: 'The configured module assertion checks that the exported value remains exactly 42.',
        },
      ],
    }),
  );
  const lines = [],
    previous = console.log;
  console.log = value => lines.push(value);
  try {
    assert.equal(await runCli(['checks', '--from', 'specs/.omni/requests/checks.json', '--json'], root), 0);
    assert.equal(await runCli(['verify', spec.id, '--json'], root), 0);
    assert.equal(await runCli(['complete', spec.id, '--json'], root), 0);
    await writeFile(
      join(root, 'specs/.omni/requests/contract.json'),
      JSON.stringify({
        expectedRevision: 0,
        capability: 'Module answer',
        scope: 'Fixture exported result only',
        status: 'active',
        sourceSpec: spec.id,
        decision: 'Preserve the reviewed module return contract after its assertion passed.',
        evidence: [`specs/${spec.slug}/verification.json`],
      }),
    );
    assert.equal(
      await runCli(
        ['contract-record', 'module-answer', '--from', 'specs/.omni/requests/contract.json', '--json'],
        root,
      ),
      0,
    );
  } finally {
    console.log = previous;
  }
  const before = await readFile(join(root, 'specs/contracts.json'), 'utf8');
  await scaffoldProject(root, { agent: 'generic' });
  assert.equal(await readFile(join(root, 'specs/contracts.json'), 'utf8'), before);
  assert.equal(await readFile(join(root, 'api/value.cjs'), 'utf8'), 'module.exports = 42;');
  assert.equal(JSON.parse(lines[3]).effectiveRevision, 1);
});

test('standard bugfix requires a fix design but does not inflate it with a task checklist', async () => {
  const spec = await createSpec(root, 'bugfix', 'new-regression-design');
  const directory = join(root, 'specs', spec.slug);
  await writeFile(
    join(directory, 'bug.md'),
    '# Reproduction\nAC-01: greeting should return Hello Ada; the observed missing return causes the deterministic failure.\n',
  );
  await writeFile(
    join(directory, 'fit.json'),
    JSON.stringify({
      schemaVersion: 2,
      reasoning: 'done',
      files: 1,
      modules: 1,
      crossesContract: false,
      ambiguity: 'none',
      existingTests: false,
      risk: 'low',
      uncertainty: 'clear',
      reversibility: 'easy',
    }),
  );
  await writeFile(
    join(directory, 'rca.md'),
    '# Root cause\nThe inspected function lacks a return; capture this in an independent regression assertion.\n',
  );
  assert.equal((await auditSpec(root, spec.id)).valid, false);
  await writeFile(
    join(directory, 'fix.md'),
    '# Scoped fix and regression\nRestore the direct return, assert exact output before and after, and roll back the local edit if it regresses.\n',
  );
  const audit = await auditSpec(root, spec.id);
  assert.equal(audit.valid, true, audit.errors.join('; '));
  assert.equal(audit.tasks.total, 0);
});
