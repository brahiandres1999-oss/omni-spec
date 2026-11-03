import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { auditSpec } from '../src/auditor.mjs';
import { projectStatus, recordContext } from '../src/project-state.mjs';
import { declaredVersions, contradictedVersions } from '../src/version-claims.mjs';
import { OMNI_SKILLS } from '../src/workflows.mjs';

let root;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omni-adequacy-'));
  await scaffoldProject(root, { projectName: 'Bank' });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const spec = `# [SPEC-001] Transfers\n## 0. Clarification\nThe user confirmed transfers must be atomic and idempotent under concurrent requests.\n## Acceptance Criteria\nAC-01 [functional]: rollback. AC-02 [functional]: no overdraft under concurrency.\n## Non-Goals\nNo distributed transactions.\n`;
const tasks = '# Tasks\n- [ ] TASK-01 / AC-01, AC-02: implement and test.\n';

async function fullSpec(verification, criteria) {
  const created = await createSpec(root, 'feature', 'transfers', { full: true });
  const dir = join(root, 'specs', created.slug);
  await writeFile(join(dir, 'spec.md'), spec);
  await writeFile(join(dir, 'tasks.md'), tasks);
  await writeFile(
    join(dir, 'plan.md'),
    `# Plan\n## Proposed change\nLock both accounts in a fixed order.\n## Contracts and compatibility\nPOST /transfers keeps its request and adds an optional idempotency key.\n${verification}\n## Rollback / recovery\nRevert the change.\n`,
  );
  await writeFile(join(dir, 'acceptance.json'), JSON.stringify({ schemaVersion: 2, criteria }));
  return { created, dir };
}

const automated = id => ({ id, kind: 'functional', status: 'pending', method: 'automated', checkIds: ['unit'] });

test('AC-02: audit blocks an automated criterion the plan Verification section does not name', async () => {
  const { created } = await fullSpec('## 7. Verification\n- `rollbackOnFailure` covers AC-01.', [
    automated('AC-01'),
    automated('AC-02'),
  ]);
  const report = await auditSpec(root, created.id);
  assert.equal(report.valid, false);
  assert.deepEqual(
    report.errors.filter(error => error.includes('Verification section')),
    [
      'AC-02 is automated in acceptance.json but the Verification section of plan.md names no test for it; add a test that exercises it or change its method.',
    ],
  );
});

test('AC-02: naming every automated criterion, or leaving a criterion manual, satisfies the rule', async () => {
  const traced = await fullSpec(
    '## Verification\n- AC-01: `rollbackOnFailure`.\n- AC-02: `concurrentTransfersNeverOverdraw`.',
    [automated('AC-01'), automated('AC-02')],
  );
  assert.deepEqual((await auditSpec(root, traced.created.id)).errors, []);
  await rm(join(root, 'specs', traced.created.slug), { recursive: true });

  const manual = await fullSpec('## Verification\n- AC-01: `rollbackOnFailure`.', [
    automated('AC-01'),
    { id: 'AC-02', kind: 'functional', status: 'pending', method: 'manual' },
  ]);
  assert.deepEqual((await auditSpec(root, manual.created.id)).errors, []);
});

test('AC-02: a plan without a Verification section is reported once with the automated criteria', async () => {
  const { created } = await fullSpec('## Notes\nAC-01 and AC-02 are tested.', [automated('AC-01'), automated('AC-02')]);
  const errors = (await auditSpec(root, created.id)).errors;
  assert.ok(
    errors.includes(
      'plan.md has no Verification section; map each automated criterion (AC-01, AC-02) to the test that exercises it.',
    ),
    errors.join('\n'),
  );
});

test('AC-02: the light route has no design document and is not checked', async () => {
  const created = await createSpec(root, 'feature', 'small', { light: true });
  const dir = join(root, 'specs', created.slug);
  await writeFile(join(dir, 'spec.md'), spec);
  await writeFile(join(dir, 'acceptance.json'), JSON.stringify({ schemaVersion: 2, criteria: [automated('AC-01')] }));
  assert.ok(!(await auditSpec(root, created.id)).errors.some(error => error.includes('Verification section')));
});

test('AC-03: declared versions come from pom.xml and package.json; contradictions are reported, prefixes are not', async () => {
  await mkdir(join(root, 'backend'));
  await mkdir(join(root, 'frontend'));
  await writeFile(
    join(root, 'backend/pom.xml'),
    '<project><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>4.1.2</version></parent><properties><java.version>25</java.version></properties></project>',
  );
  await writeFile(
    join(root, 'frontend/package.json'),
    JSON.stringify({ dependencies: { react: '^18.3.1' }, devDependencies: { vite: '~6.0.7' } }),
  );
  const declared = await declaredVersions(root);
  assert.deepEqual(declared.map(item => `${item.component} ${item.version} ${item.source}`).sort(), [
    'Java 25 backend/pom.xml',
    'React 18.3.1 frontend/package.json',
    'Spring Boot 4.1.2 backend/pom.xml',
    'Vite 6.0.7 frontend/package.json',
  ]);
  const text = 'Backend: Java 25 with Spring Boot 3.4.1 (release 21). Frontend: React 18, Vite 6.0.7, SpringBoot 4.1.';
  assert.deepEqual(
    contradictedVersions(text, declared).map(item => `${item.component} ${item.mentioned}`),
    ['Spring Boot 3.4.1'],
  );

  await recordContext(root);
  const context = join(root, 'specs/project-context.md');
  await writeFile(context, `${await readFile(context, 'utf8')}\n- Backend on Spring Boot 3.4.1.\n`);
  const warning = (await projectStatus(root)).progress.warnings.find(item => item.code === 'VERSION_CLAIM_MISMATCH');
  assert.ok(warning);
  assert.equal(warning.mentioned, '3.4.1');
  assert.deepEqual(warning.sources, ['backend/pom.xml']);
  assert.match(
    warning.message,
    /specs\/project-context\.md mentions Spring Boot 3\.4\.1, but backend\/pom\.xml declares 4\.1\.2/,
  );

  const { created, dir } = await fullSpec('## Verification\n- AC-01, AC-02: unit tests on Spring Boot 3.4.1.', [
    automated('AC-01'),
    automated('AC-02'),
  ]);
  assert.ok(dir);
  const report = await auditSpec(root, created.id);
  assert.ok(
    report.warnings.some(item => item.includes('plan.md mentions Spring Boot 3.4.1')),
    report.warnings.join('\n'),
  );
  assert.equal(report.valid, true);
});

test('AC-04: the auditor role and omni-audit require test adequacy, consistency and failure modes', async () => {
  const auditor = await readFile(new URL('../agents/omni-auditor.md', import.meta.url), 'utf8');
  for (const text of [
    'a concurrency criterion needs a concurrent test',
    'Any contradiction is a blocker naming both locations',
    'check-then-act races',
    'Never report `AUDIT_PASSED` while a blocker above is open.',
  ])
    assert.ok(auditor.includes(text), text);
  const { instructions } = OMNI_SKILLS.find(skill => skill.name === 'omni-audit');
  assert.ok(
    instructions.includes(
      'a failing test per criterion, no plan/task contradictions, failure modes for high-risk changes',
    ),
  );
});
