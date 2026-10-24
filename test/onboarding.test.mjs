import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectProjectEnvironment } from '../src/detector.mjs';
import { scaffoldProject } from '../src/generator.mjs';
import { seedOnboardingFixture } from '../test-support/onboarding-fixtures.mjs';
import { loadManifest } from '../src/manifest.mjs';
import { integrationEntries } from '../src/integrations.mjs';
import { QUESTIONS, TECHNOLOGY, SETUP } from '../src/protocols.mjs';

let root;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omni-onboarding-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

for (const scenario of ['empty', 'existing', 'broken', 'noncode'])
  test(`${scenario}: bootstrap preserves application and seeds an explicitly unvalidated context`, async () => {
    const original = await seedOnboardingFixture(root, scenario);
    await scaffoldProject(root, { projectName: 'Fixture', agent: 'antigravity' });
    for (const [path, content] of Object.entries(original))
      assert.equal(await readFile(join(root, path), 'utf8'), content);
    const context = await readFile(join(root, 'specs/project-context.md'), 'utf8');
    assert.match(context, /State: CONTEXT_PENDING/);
    assert.match(context, /APPLICATION_NOT_VALIDATED/);
    assert.match(context, /No project scripts were executed/);
    assert.match(context, /Existing-work baseline: UNKNOWN/);
    assert.deepEqual((await loadManifest(root)).specs, []);
    assert.match(context, /Publication.*NOT_GRANTED/);
    await assert.rejects(access(join(root, '.git')), { code: 'ENOENT' });
    const inventory = await detectProjectEnvironment(root);
    assert.equal(inventory.isGreenfield, scenario === 'empty');
    assert.equal(inventory.assessment.projectScriptsExecuted, false);
    assert.equal(inventory.assessment.policyCompliance, 'NOT_ASSESSED');
    if (scenario === 'existing') {
      await assert.rejects(access(join(root, 'api/UNAUTHORIZED_EXECUTION')), { code: 'ENOENT' });
      const api = inventory.modules.find(m => m.directory === 'api');
      assert.deepEqual(api.declaredRuntime, {
        tool: 'node',
        constraint: '>=22',
        source: 'api/package.json',
        state: 'DECLARED',
        compatibilityTested: false,
      });
      assert.deepEqual(api.commandCandidates[0], {
        command: 'npm test',
        cwd: 'api',
        source: 'api/package.json',
        basis: 'declared-script',
        definition: 'node check.cjs',
        execution: 'NOT_RUN',
        prerequisites: 'NOT_ASSESSED',
        gateSelection: 'REVIEW_REQUIRED',
      });
      assert.equal(inventory.modules.find(m => m.directory === 'worker').commandCandidates[0].basis, 'tool-convention');
      assert.match(context, /\| `npm test` \| `api` \| `api\/package.json`/);
      assert.match(context, /\| `python -m pytest` \| `worker`/);
      assert.doesNotMatch(context, /WCAG.*compliant|fully adapted|State: CONTEXT_RECORDED/);
    } else {
      assert.equal(inventory.qualityGates, '');
      assert.match(context, /None detected/);
      if (scenario === 'broken') assert.ok(inventory.warnings.some(w => w.includes('could not be parsed')));
    }
  });

test('repeated initialization preserves authored context and decisions', async () => {
  await scaffoldProject(root);
  const path = join(root, 'specs/project-context.md');
  const authored = '# User context\nConfirmed decision: retain spreadsheet delivery.\n';
  await writeFile(path, authored);
  await scaffoldProject(root);
  assert.equal(await readFile(path, 'utf8'), authored);
});

for (const scenario of ['conflicting', 'conflicting-python'])
  test(`${scenario}: bootstrap preserves competing declarations for conversational reconciliation`, async () => {
    const original = await seedOnboardingFixture(root, scenario);
    await scaffoldProject(root);
    for (const [path, content] of Object.entries(original))
      assert.equal(await readFile(join(root, path), 'utf8'), content);
    const context = await readFile(join(root, 'specs/project-context.md'), 'utf8');
    assert.match(context, /<!-- omni:source-conflicts -->/);
    assert.match(context, /No conflict has been ruled out by bootstrap/);
    assert.match(context, /APPLICATION_NOT_VALIDATED/);
    if (scenario === 'conflicting')
      await assert.rejects(access(join(root, 'api/UNAUTHORIZED_EXECUTION')), { code: 'ENOENT' });
  });

test('every adapter carries the bare-command evidence and bounded onboarding contract', () => {
  const entries = integrationEntries({ version: '0.5.0' }, { agent: 'all' }).filter(
    e => e.path.includes('omni-init') && e.path !== 'specs/commands/omni-init.md',
  );
  // One entry per adapter output: eight concrete adapters, three of which share the
  // .agents/skills path, plus the documented slash-command surfaces of Kilo and Gemini.
  assert.equal(entries.length, 10);
  for (const entry of entries) {
    const content = entry.path.endsWith('.toml')
      ? JSON.parse(
          entry.content
            .split('\n')
            .find(l => l.startsWith('prompt = '))
            .slice(9),
        )
      : entry.content;
    assert.match(content, /bare command \/omni-init is sufficient/);
    assert.match(
      content,
      /Only edit specs\/project-context.md and associated project-state\/context-history records by default/,
    );
    assert.match(content, /CONTEXT_PENDING/);
    assert.match(content, /CONTEXT_RECORDED/);
    assert.match(content, /APPLICATION_NOT_VALIDATED/);
    assert.match(content, /timestamp, exit code/);
    assert.match(content, /UNKNOWN\/MIXED\/NON-CODE/);
    assert.match(content, /do not replace missing evidence with a success claim/);
    assert.match(content, /context-check --json/);
    assert.match(content, /Carry that reconciliation into EACH command/);
    assert.match(content, /final response against the saved context sentence by sentence/);
    assert.match(content, /document-relative Markdown links/);
    for (const policy of [QUESTIONS, TECHNOLOGY, SETUP]) assert.ok(content.includes(policy));
  }
});
