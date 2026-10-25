import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import {
  recordContext,
  contextFreshness,
  recordDecision,
  recordSession,
  projectStatus,
} from '../src/project-state.mjs';
import { verifySpec, completeSpec, projectFingerprint } from '../src/verification.mjs';
import { fillSpec } from '../test-support/fixtures.mjs';
import { runCli } from '../src/cli.mjs';

let root;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omni-state-'));
  await scaffoldProject(root, { qualityGates: 'node -e "process.exit(0)"' });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('context input additions, changes and removals require reconciliation and retain the old baseline', async () => {
  await recordContext(root);
  assert.equal((await contextFreshness(root)).status, 'CURRENT');
  await writeFile(join(root, 'package.json'), '{"scripts":{"test":"node test.cjs"}}');
  assert.deepEqual((await contextFreshness(root)).changed, ['package.json']);
  await recordContext(root);
  assert.equal((await readdir(join(root, 'specs/.omni/context-history'))).length, 1);
  await writeFile(join(root, 'package.json'), '{"scripts":{"test":"node different.cjs"}}');
  assert.equal((await contextFreshness(root)).status, 'STALE');
  await recordContext(root);
  await rm(join(root, 'package.json'));
  assert.deepEqual((await contextFreshness(root)).changed, ['package.json']);
});

test('stale context blocks verification without silently replacing its claims', async () => {
  const spec = await createSpec(root, 'feature', 'greeting');
  await fillSpec(root, spec);
  await recordContext(root);
  await writeFile(join(root, 'main.mjs'), 'export const value = 2;');
  assert.equal((await contextFreshness(root)).status, 'CURRENT', 'implementation edits are not context inputs');
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  await assert.rejects(verifySpec(root, spec.id), /Context is stale: package\.json/);
  assert.equal((await projectStatus(root)).progress.blockers[0].code, 'STALE_CONTEXT');
  await recordContext(root);
  await verifySpec(root, spec.id);
  await completeSpec(root, spec.id);
});

test('status predicts closure with the same validation and exposes log tampering as a blocker', async () => {
  const spec = await createSpec(root, 'feature', 'greeting');
  await fillSpec(root, spec);
  assert.equal((await projectStatus(root)).progress.delivery, 'VERIFICATION_PENDING');
  const record = await verifySpec(root, spec.id);
  assert.equal((await projectStatus(root)).progress.delivery, 'READY_TO_COMPLETE');
  await writeFile(join(root, record.results[0].outputLog), 'altered');
  const state = await projectStatus(root);
  assert.notEqual(state.progress.delivery, 'READY_TO_COMPLETE');
  assert.match(state.progress.blockers[0].message, /output log changed/);
});

test('required unanswered decisions block closure; answers and revisions retain their provenance', async () => {
  const spec = await createSpec(root, 'feature', 'greeting');
  await fillSpec(root, spec);
  await recordDecision(root, { id: 'scope', topic: 'scope', status: 'pending', required: true });
  await assert.rejects(verifySpec(root, spec.id), /Required decisions remain/);
  await recordDecision(root, {
    id: 'scope',
    expectedRevision: 1,
    topic: 'scope',
    status: 'approved',
    value: 'local-only',
    basis: 'User explicitly confirmed local-only delivery.',
  });
  await assert.rejects(
    recordDecision(root, {
      id: 'scope',
      expectedRevision: 1,
      status: 'approved',
      basis: 'A stale answer must never overwrite a new one.',
    }),
    /revision changed/,
  );
  assert.equal((await readdir(join(root, 'specs/.omni/decision-history'))).length, 1);
  assert.equal((await verifySpec(root, spec.id)).passed, true);
});

test('technology selections require dated official sources while missing host tools stay unknown', async () => {
  await assert.rejects(
    recordDecision(root, {
      id: 'stack',
      topic: 'technology',
      status: 'delegated',
      value: 'a version from memory',
      basis: 'User delegated the scoped stack decision.',
    }),
    /official-source/,
  );
  await recordDecision(root, {
    id: 'stack',
    topic: 'technology',
    status: 'delegated',
    value: 'Inspected supported runtime, selected for this fixture only',
    basis: 'User delegated the scoped stack decision.',
    sources: [
      {
        url: 'https://nodejs.org/en/about/previous-releases',
        consultedAt: new Date().toISOString(),
        appliesTo: 'Node LTS support policy, semantic review still required',
        authority: 'official',
      },
    ],
  });
  await recordSession(root, {
    host: 'fixture-host',
    capabilities: { questions: { status: 'unavailable', source: 'Noninteractive terminal; chat fallback required' } },
  });
  const status = await projectStatus(root);
  assert.equal(status.progress.capabilities.questions.status, 'unavailable');
  assert.equal(status.progress.capabilities.render.status, 'unknown');
});

test('CLI context recording and status use the shared state without application execution', async () => {
  const lines = [],
    previous = console.log;
  console.log = line => lines.push(line);
  try {
    assert.equal(await runCli(['context-record', '--json'], root), 0);
    assert.equal(await runCli(['status', '--json'], root), 0);
  } finally {
    console.log = previous;
  }
  assert.equal(JSON.parse(lines[1]).progress.context.status, 'CURRENT');
  assert.equal(JSON.parse(lines[1]).progress.publication, 'NOT_AUTHORIZED_BY_STATUS');
  assert.ok((await readFile(join(root, 'specs/project-state.json'), 'utf8')).includes('EOL_NORMALIZED_BASELINE'));
});

test('scoped unanswered decisions do not block unrelated work and terminal focus stays terminal', async () => {
  const spec = await createSpec(root, 'feature', 'local-fix');
  await fillSpec(root, spec);
  await recordDecision(root, {
    id: 'future-service',
    status: 'pending',
    topic: 'scope',
    appliesTo: ['999'],
    required: true,
  });
  assert.equal((await verifySpec(root, spec.id)).passed, true);
  await completeSpec(root, spec.id);
  const { focusSpec } = await import('../src/manifest.mjs');
  await focusSpec(root, spec.id);
  const status = await projectStatus(root);
  assert.equal(status.progress.delivery, 'COMPLETED');
  assert.notEqual(status.progress.nextAction, `complete ${spec.id}`);
});

test('partial acceptance remains visible and cannot be represented as completed', async () => {
  const spec = await createSpec(root, 'feature', 'partial-journey');
  await fillSpec(root, spec);
  const path = join(spec.specDir, 'acceptance.json');
  const report = JSON.parse(await readFile(path, 'utf8'));
  report.criteria[0].status = 'blocked';
  await writeFile(path, JSON.stringify(report));
  const status = await projectStatus(root);
  assert.equal(status.progress.delivery, 'ACCEPTANCE_PENDING');
  assert.equal(status.progress.blockers[0].criteria[0].id, 'AC-01');
  await assert.rejects(verifySpec(root, spec.id), /remains blocked/);
});

test('invalid decision IDs cannot poison future state reads', async () => {
  await recordDecision(root, { id: 'valid', status: 'pending', topic: 'scope' });
  const before = await readFile(join(root, 'specs/project-state.json'), 'utf8');
  await assert.rejects(recordDecision(root, { id: 123, status: 'pending' }), /Invalid or duplicate/);
  await assert.rejects(recordDecision(root, { id: '   ', status: 'pending' }), /nonempty/);
  assert.equal(await readFile(join(root, 'specs/project-state.json'), 'utf8'), before);
  assert.equal((await projectStatus(root)).progress.decisions[0].id, 'valid');
});

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// latin1 maps each byte to one character, so only the line endings change.
async function newlines(name, newline) {
  const path = join(root, name);
  await writeFile(path, (await readFile(path, 'latin1')).replace(/\r?\n/g, newline), 'latin1');
}

// Agent-written inputs in LF and a user story in CRLF, as in the IPS pilot.
async function eolProject() {
  await writeFile(join(root, 'package.json'), '{\n  "name": "eol"\n}\n');
  await writeFile(
    join(root, 'AGENTS.md'),
    `${await readFile(join(root, 'AGENTS.md'), 'utf8')}\n## Notes\nUser text.\n`,
  );
  await writeFile(join(root, 'specs', 'notes.md'), '# Notes\nCited.\n');
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'docs', 'story.md'), '# Story\r\nAs a user.\r\n');
  const context = join(root, 'specs', 'project-context.md');
  await writeFile(
    context,
    `${await readFile(context, 'utf8')}\nSee [story](../docs/story.md) and [notes](notes.md).\n`,
  );
}

async function editContext(change) {
  const path = join(root, 'specs', 'project-state.json');
  const state = JSON.parse(await readFile(path, 'utf8'));
  change(state.context);
  await writeFile(path, JSON.stringify(state));
}

// Rewrites a new record as the CONTEXT_INPUTS_V2 baseline preview.2 wrote: raw bytes for the
// inputs given (recorded with CRLF); LF inputs already have equal raw and LF hashes.
async function rawBaseline(...names) {
  const raw = await Promise.all(names.map(async name => sha256(await readFile(join(root, name)))));
  await editContext(context => {
    context.scope = 'CONTEXT_INPUTS_V2';
    names.forEach((name, index) => {
      context.inputs[name] = raw[index];
    });
  });
}

test('context-record stores text inputs in their LF form under a new scope', async () => {
  await eolProject();
  await recordContext(root);
  const recorded = async () => JSON.parse(await readFile(join(root, 'specs/project-state.json'), 'utf8')).context;
  const first = await recorded();
  assert.equal(first.scope, 'CONTEXT_INPUTS_V3');
  assert.equal(first.inputs['docs/story.md'], sha256('# Story\nAs a user.\n'));
  for (const name of Object.keys(first.inputs)) await newlines(name, '\r\n');
  await recordContext(root);
  assert.deepEqual((await recorded()).inputs, first.inputs);
});

test('line-ending conversions keep a recorded context current', async () => {
  await eolProject();
  await recordContext(root);
  for (const name of ['package.json', 'AGENTS.md', 'specs/notes.md', 'specs/project-context.md'])
    await newlines(name, '\r\n');
  await newlines('docs/story.md', '\n');
  const freshness = await contextFreshness(root);
  assert.equal(freshness.status, 'CURRENT');
  assert.deepEqual(freshness.changed, []);
});

test('CONTEXT_INPUTS_V2 baselines accept the raw, LF and CRLF forms of an input', async () => {
  await eolProject();
  await recordContext(root);
  await rawBaseline('docs/story.md');
  await newlines('package.json', '\r\n');
  await newlines('docs/story.md', '\n');
  const freshness = await contextFreshness(root);
  assert.equal(freshness.status, 'CURRENT');
  assert.equal(freshness.scope, 'CONTEXT_INPUTS_V2');
});

test('a CONTEXT_INPUTS_V2 input recorded with mixed line endings stays stale', async () => {
  await eolProject();
  await writeFile(join(root, 'docs', 'story.md'), 'a\r\nb\nc\r\n');
  await recordContext(root);
  await rawBaseline('docs/story.md');
  await newlines('docs/story.md', '\n');
  const freshness = await contextFreshness(root);
  assert.equal(freshness.status, 'STALE');
  assert.deepEqual(freshness.changed, ['docs/story.md']);
});

test('new-scope baselines accept only the LF form of a text input', async () => {
  await eolProject();
  await recordContext(root);
  const raw = sha256(await readFile(join(root, 'docs', 'story.md')));
  await editContext(context => {
    context.inputs['docs/story.md'] = raw;
  });
  const freshness = await contextFreshness(root);
  assert.equal(freshness.scope, 'CONTEXT_INPUTS_V3');
  assert.deepEqual(freshness.changed, ['docs/story.md']);
});

test('content changes stay stale when line endings change too', async () => {
  await eolProject();
  const original = await readFile(join(root, 'package.json'));
  const change = async () => {
    await writeFile(join(root, 'package.json'), '{\n  "name": "changed"\n}\n');
    await newlines('package.json', '\r\n');
  };
  await recordContext(root);
  await change();
  assert.deepEqual((await contextFreshness(root)).changed, ['package.json']);
  await writeFile(join(root, 'package.json'), original);
  await recordContext(root);
  await rawBaseline('docs/story.md');
  await change();
  assert.deepEqual((await contextFreshness(root)).changed, ['package.json']);
});

test('inputs with a NUL byte keep byte comparison', async () => {
  await eolProject();
  const diagram = join(root, 'assets', 'diagram.bin');
  const bytes = Buffer.from([0x00, 0x0d, 0x0a, 0x41]);
  await mkdir(join(root, 'assets'));
  await writeFile(diagram, bytes);
  const context = join(root, 'specs', 'project-context.md');
  await writeFile(context, `${await readFile(context, 'utf8')}Diagram: [diagram](../assets/diagram.bin).\n`);
  await recordContext(root);
  const { inputs } = JSON.parse(await readFile(join(root, 'specs/project-state.json'), 'utf8')).context;
  assert.equal(inputs['assets/diagram.bin'], sha256(bytes));
  await writeFile(diagram, Buffer.from([0x00, 0x0a, 0x41]));
  assert.deepEqual((await contextFreshness(root)).changed, ['assets/diagram.bin']);
  await editContext(context => {
    context.scope = 'CONTEXT_INPUTS_V2';
  });
  assert.deepEqual((await contextFreshness(root)).changed, ['assets/diagram.bin']);
  await writeFile(diagram, bytes);
  await editContext(context => {
    delete context.inputs['assets/diagram.bin'];
  });
  assert.deepEqual((await contextFreshness(root)).changed, ['assets/diagram.bin'], 'an unrecorded input is new');
});

test('CONTEXT_INPUTS_V2 baselines still watch AGENTS.md and cited specs files', async () => {
  await eolProject();
  await recordContext(root);
  await rawBaseline('docs/story.md');
  await writeFile(join(root, 'AGENTS.md'), `${await readFile(join(root, 'AGENTS.md'), 'utf8')}More user text.\n`);
  await writeFile(join(root, 'specs', 'notes.md'), '# Notes\nChanged.\n');
  const freshness = await contextFreshness(root);
  assert.equal(freshness.scope, 'CONTEXT_INPUTS_V2');
  assert.deepEqual(freshness.changed, ['AGENTS.md', 'specs/notes.md']);
  await editContext(context => {
    delete context.scope;
  });
  assert.equal((await contextFreshness(root)).scope, 'LEGACY_FULL_SNAPSHOT');
});

test('baselines without a scope still compare raw bytes', async () => {
  await eolProject();
  await recordContext(root);
  await rawBaseline('docs/story.md');
  await editContext(context => {
    delete context.scope;
  });
  assert.equal((await contextFreshness(root)).status, 'CURRENT');
  await newlines('package.json', '\r\n');
  const freshness = await contextFreshness(root);
  assert.equal(freshness.scope, 'LEGACY_FULL_SNAPSHOT');
  assert.equal(freshness.status, 'STALE');
  assert.deepEqual(freshness.changed, ['package.json']);
});

test('the verification fingerprint still distinguishes CRLF from LF', async () => {
  const spec = await createSpec(root, 'feature', 'eol');
  await writeFile(join(root, 'main.mjs'), 'export const value = 1;\n');
  const gates = { qualityGates: '', checks: [] };
  const before = await projectFingerprint(root, spec, gates);
  await newlines('main.mjs', '\r\n');
  assert.notEqual(await projectFingerprint(root, spec, gates), before);
});
