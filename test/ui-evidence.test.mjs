import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { verifySpec, completeSpec } from '../src/verification.mjs';
import { recordSession } from '../src/project-state.mjs';
import { fillSpec } from '../test-support/fixtures.mjs';

let root, spec, criterion;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omni-ui-evidence-'));
  await scaffoldProject(root);
  spec = await createSpec(root, 'feature', 'interface');
  await fillSpec(root, spec);
  criterion = {
    id: 'AC-01',
    kind: 'visual',
    status: 'passed',
    method: 'inspection',
    evidence: 'Source CSS was read; no rendered observation exists yet.',
  };
  await writeFile(
    join(spec.specDir, 'spec.md'),
    '# UI\n## 0. Clarification\nThe approved identity is preserved; mobile layout is required.\n## Acceptance Criteria\nAC-01 [visual]: content reflows without horizontal overflow.\n## Non-Goals\nNo identity redesign.\n',
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
async function report() {
  await writeFile(join(spec.specDir, 'acceptance.json'), JSON.stringify({ schemaVersion: 2, criteria: [criterion] }));
}
const manual = { manual: 'Observed the declared UI case in an isolated test environment.' };

test('CSS inspection, screenshot-only prose and generic build checks cannot close a visual criterion', async () => {
  await report();
  await assert.rejects(verifySpec(root, spec.id, manual), /source inspection is insufficient/);
  criterion.method = 'manual';
  await report();
  await assert.rejects(verifySpec(root, spec.id, manual), /needs observations/);
  criterion.method = 'automated';
  criterion.checkCommands = ['node -e "process.exit(0)"'];
  const manifest = JSON.parse(
    await (await import('node:fs/promises')).readFile(join(root, 'specs/manifest.json'), 'utf8'),
  );
  manifest.qualityGates = criterion.checkCommands[0];
  await writeFile(join(root, 'specs/manifest.json'), JSON.stringify(manifest));
  await report();
  await assert.rejects(verifySpec(root, spec.id), /generic build/);
});

test('observed UI evidence requires actual session capability and a local artifact bound to the result', async () => {
  criterion.method = 'manual';
  await recordSession(root, {
    host: 'test-browser',
    capabilities: {
      render: { status: 'available', source: 'Render inspection tool actually exposed for this test session.' },
    },
  });
  criterion.observations = [
    {
      actor: 'agent',
      observer: 'fixture observer',
      surface: '/catalog',
      environment: 'isolated browser test fixture',
      steps: ['Open catalog at the recorded viewport and inspect long content'],
      expected: 'No overflow',
      actual: 'No overflow observed in this test fixture',
      result: 'passed',
      observedAt: new Date().toISOString(),
      viewport: { width: 375, height: 812 },
      artifact: 'evidence/render.json',
    },
  ];
  await report();
  await assert.rejects(verifySpec(root, spec.id, manual), /ENOENT/);
  await mkdir(join(spec.specDir, 'evidence'));
  await writeFile(join(spec.specDir, 'evidence/render.json'), '{"fixtureOnly":true,"overflow":false}');
  assert.equal((await verifySpec(root, spec.id, manual)).passed, true);
  await writeFile(join(spec.specDir, 'evidence/render.json'), '{"fixtureOnly":true,"overflow":true}');
  await assert.rejects(completeSpec(root, spec.id), /changed after verification/);
});

test('a host without render capability cannot claim agent UI observation', async () => {
  criterion.method = 'manual';
  criterion.observations = [
    {
      actor: 'agent',
      observer: 'fixture observer',
      surface: '/catalog',
      environment: 'CLI without browser',
      steps: ['Read CSS'],
      expected: 'No overflow',
      actual: 'Assumed from source',
      result: 'passed',
      observedAt: new Date().toISOString(),
      viewport: { width: 375, height: 812 },
      artifact: 'screenshot.png',
    },
  ];
  await recordSession(root, {
    host: 'CLI',
    capabilities: { render: { status: 'unavailable', source: 'No render tool exposed' } },
  });
  await report();
  await assert.rejects(verifySpec(root, spec.id, manual), /render capability/);
});

test('a stable UI classification in the contract cannot be downgraded by a legacy report', async () => {
  await writeFile(
    join(spec.specDir, 'acceptance.json'),
    JSON.stringify({
      schemaVersion: 1,
      criteria: [
        {
          id: 'AC-01',
          status: 'passed',
          method: 'inspection',
          evidence: 'A claimed inspection tries to drop the visual classification.',
        },
      ],
    }),
  );
  await assert.rejects(verifySpec(root, spec.id, manual), /kind must match/);
});

test('UI artifacts cannot alias the generated verification record and observation fields must be strings', async () => {
  criterion.method = 'manual';
  const observation = {
    actor: 'human',
    observer: 'Fixture reviewer',
    surface: '/catalog',
    environment: 'Fixture environment',
    steps: ['Review the scoped rendered surface'],
    expected: 'No overflow',
    actual: 'Fixture observed result',
    result: 'passed',
    observedAt: new Date().toISOString(),
    viewport: { width: 375, height: 812 },
    artifact: './verification.json',
  };
  criterion.observations = [observation];
  await writeFile(join(spec.specDir, 'verification.json'), '{"previous":"record"}');
  for (const artifact of ['verification.json', './verification.json', 'evidence/../verification.json']) {
    observation.artifact = artifact;
    await report();
    await assert.rejects(verifySpec(root, spec.id, manual), /generated verification record/);
  }
  observation.actual = {};
  await report();
  await assert.rejects(verifySpec(root, spec.id, manual), /Incomplete observed UI evidence/);
});
