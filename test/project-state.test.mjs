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
import { auditSpec } from '../src/auditor.mjs';
import { focusSpec, loadManifest, saveManifest } from '../src/manifest.mjs';
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

async function cli(args, cwd = root) {
  const stdout = [],
    stderr = [],
    log = console.log,
    error = console.error;
  console.log = line => stdout.push(line);
  console.error = line => stderr.push(line);
  try {
    return { code: await runCli(args, cwd), stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
  }
}

const LIGHT_FIT = {
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
const FITS = {
  light: LIGHT_FIT,
  standard: { ...LIGHT_FIT, existingTests: false },
  full: { ...LIGHT_FIT, crossesContract: true },
};
const ROUTE_FILES = {
  feature: { light: ['spec.md'], standard: ['spec.md', 'plan.md'], full: ['spec.md', 'plan.md', 'tasks.md'] },
  bugfix: { light: ['bug.md'], standard: ['bug.md', 'rca.md', 'fix.md'], full: ['bug.md', 'rca.md', 'fix.md'] },
  debt: {
    light: ['audit.md'],
    standard: ['audit.md', 'migration-plan.md'],
    full: ['audit.md', 'migration-plan.md', 'tasks.md'],
  },
  rfc: { light: ['rfc.md'], standard: ['rfc.md'], full: ['rfc.md'] },
};
const TOOL_PATHS = ['specs/.omni/', 'specs/_templates/', 'specs/project-state.json', 'specs/contracts.json'];

test('readSet lists the route artifacts of each type and auditSpec requires exactly those', async () => {
  for (const [type, routes] of Object.entries(ROUTE_FILES)) {
    const spec = await createSpec(root, type, `${type}-reading`);
    await fillSpec(root, spec);
    const fit = join(spec.specDir, 'fit.json');
    const cases = [
      ...Object.entries(FITS).map(([route, answers]) => [route, JSON.stringify(answers)]),
      ['full', null],
      ['full', '{'],
      ['full', '{"schemaVersion":2}'],
    ];
    for (const [route, content] of cases) {
      if (content === null) await rm(fit, { force: true });
      else await writeFile(fit, content);
      const label = `${type}, ${route}, fit.json ${content}`;
      assert.deepEqual(
        (await projectStatus(root)).progress.readSet.files,
        [...routes[route], 'acceptance.json', 'verification.md'].map(name => `specs/${spec.slug}/${name}`),
        label,
      );
      for (const name of routes.full) {
        const path = join(spec.specDir, name);
        const text = await readFile(path, 'utf8');
        await rm(path);
        const { errors } = await auditSpec(root, spec.id);
        await writeFile(path, text);
        const missing = errors.some(item => item.startsWith('Missing mandatory') && item.endsWith(`: ${name}`));
        assert.equal(missing, routes[route].includes(name), `${label}: ${name}`);
      }
    }
  }
});

test('readSet avoids other specs, the verification record and tool state, never a listed file', async () => {
  assert.deepEqual((await projectStatus(root)).progress.readSet, { files: [], avoid: TOOL_PATHS });
  const first = await createSpec(root, 'feature', 'first');
  await fillSpec(root, first);
  await verifySpec(root, first.id);
  await completeSpec(root, first.id);
  assert.deepEqual((await projectStatus(root)).progress.readSet, {
    files: [],
    avoid: [`specs/${first.slug}/`, ...TOOL_PATHS],
  });
  const second = await createSpec(root, 'bugfix', 'second');
  await fillSpec(root, second);
  const { files, avoid } = (await projectStatus(root)).progress.readSet;
  assert.deepEqual(avoid, [`specs/${first.slug}/`, `specs/${second.slug}/verification.json`, ...TOOL_PATHS]);
  assert.equal(files.length, 5);
  for (const path of files)
    for (const entry of avoid)
      assert.ok(entry.endsWith('/') ? !path.startsWith(entry) : path !== entry, `${path} is under ${entry}`);
});

test('an unreadable fit.json or unknown type empties readSet with one assessment error, open or closed', async () => {
  const spec = await createSpec(root, 'feature', 'unreadable-fit');
  await fillSpec(root, spec);
  const fit = join(spec.specDir, 'fit.json');
  const assessment = async () => {
    const { code, stdout } = await cli(['status', '--json']);
    assert.equal(code, 0);
    const status = JSON.parse(stdout);
    assert.deepEqual(status.progress.readSet.files, []);
    const errors = status.progress.blockers.filter(item => item.code === 'ASSESSMENT_ERROR');
    assert.equal(errors.length, 1, JSON.stringify(status.progress.blockers));
    return { status, error: errors[0] };
  };
  await mkdir(fit);
  assert.match((await assessment()).error.message, /EISDIR/);
  await rm(fit, { recursive: true });
  const manifest = await loadManifest(root);
  manifest.specs[0].type = 'mystery';
  await saveManifest(root, manifest);
  assert.match((await assessment()).error.message, /Unknown spec type: mystery/);
  manifest.specs[0].type = 'feature';
  await saveManifest(root, manifest);
  await verifySpec(root, spec.id);
  await completeSpec(root, spec.id);
  await focusSpec(root, spec.id);
  await mkdir(fit);
  const closed = await assessment();
  assert.match(closed.error.message, /EISDIR/);
  assert.equal(closed.status.progress.delivery, 'COMPLETED');
  assert.equal(closed.status.progress.nextAction, closed.error.action);
});

async function closedSpec(name) {
  const spec = await createSpec(root, 'feature', name);
  await fillSpec(root, spec);
  await verifySpec(root, spec.id);
  await completeSpec(root, spec.id);
  return spec;
}

test('status --json omits closed work it does not need, counts it and --all returns it; files stay intact', async () => {
  const first = await closedSpec('first');
  const second = await closedSpec('second');
  const open = await createSpec(root, 'feature', 'open');
  const active = await createSpec(root, 'feature', 'active');
  await fillSpec(root, active);
  const decisions = [
    { id: 'global', status: 'approved' },
    { id: 'active', status: 'approved', appliesTo: [active.id] },
    { id: 'first-only', status: 'approved', appliesTo: [first.slug] },
    { id: 'both-closed', status: 'approved', appliesTo: [first.id, second.slug] },
    { id: 'second-only', status: 'approved', appliesTo: [second.id] },
    { id: 'mixed', status: 'approved', appliesTo: [second.id, open.id] },
    { id: 'open', status: 'approved', appliesTo: [open.slug] },
    { id: 'missing', status: 'approved', appliesTo: ['999'] },
    { id: 'pending', status: 'pending', required: true, appliesTo: [active.slug] },
  ];
  for (const decision of decisions)
    await recordDecision(root, { topic: 'scope', basis: 'Fixture decision for status output.', ...decision });
  const manifestPath = join(root, 'specs', 'manifest.json');
  const statePath = join(root, 'specs', 'project-state.json');
  const before = [await readFile(manifestPath), await readFile(statePath)];
  const manifest = JSON.parse(before[0]);
  const state = JSON.parse(before[1]);

  const compact = await projectStatus(root);
  const full = await projectStatus(root, { all: true });
  for (const closed of [first, second]) {
    const { acceptance, ...rest } = manifest.specs.find(item => item.id === closed.id).verification;
    assert.ok(acceptance.criteria.length);
    assert.deepEqual(compact.specs.find(item => item.id === closed.id).verification, rest);
    assert.deepEqual(Object.keys(rest), ['mode', 'verifiedAt', 'fingerprint']);
  }
  assert.deepEqual(
    compact.progress.decisions.map(item => item.id),
    ['global', 'active', 'mixed', 'open', 'missing', 'pending'],
  );
  assert.deepEqual(compact.progress.omitted, { acceptance: 2, decisions: 3, command: 'status --json --all' });
  assert.deepEqual(full.specs, manifest.specs);
  assert.deepEqual(full.progress.decisions, state.decisions);
  assert.deepEqual(full.progress.omitted, { acceptance: 0, decisions: 0, command: 'status --json --all' });
  for (const key of ['blockers', 'nextAction', 'delivery'])
    assert.deepEqual(compact.progress[key], full.progress[key], key);
  assert.ok(compact.progress.blockers.some(item => item.code === 'DECISION_REQUIRED' && item.id === 'pending'));

  await focusSpec(root, first.id);
  const refocused = await projectStatus(root);
  const manifestNow = await loadManifest(root);
  assert.deepEqual(refocused.specs.find(item => item.id === first.id).verification, manifestNow.specs[0].verification);
  assert.equal(refocused.specs.find(item => item.id === second.id).verification.acceptance, undefined);
  assert.deepEqual(
    refocused.progress.decisions.map(item => item.id),
    ['global', 'active', 'first-only', 'both-closed', 'mixed', 'open', 'missing', 'pending'],
  );
  assert.deepEqual(refocused.progress.omitted, { acceptance: 1, decisions: 1, command: 'status --json --all' });
  await focusSpec(root, active.id);

  const { code, stdout } = await cli(['status', '--json']);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout).progress.omitted, compact.progress.omitted);
  const all = await cli(['status', '--json', '--all']);
  assert.equal(all.code, 0);
  assert.deepEqual(JSON.parse(all.stdout).specs, manifest.specs);
  assert.deepEqual(JSON.parse(all.stdout).progress.omitted.decisions, 0);
  assert.deepEqual(await readFile(manifestPath), before[0]);
  assert.deepEqual(await readFile(statePath), before[1]);
});

test('--all is accepted only by status, inside or outside a project, and help still answers', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'omni-outside-'));
  const manifestPath = join(root, 'specs', 'manifest.json');
  const before = await readFile(manifestPath);
  try {
    for (const cwd of [root, outside])
      for (const args of [
        ['list', '--all'],
        ['verify', '--all'],
        ['contracts', '--all', '--json'],
      ]) {
        const result = await cli(args, cwd);
        assert.equal(result.code, 1, args.join(' '));
        assert.match(result.stderr, /--all is supported only by status/, args.join(' '));
      }
    assert.deepEqual(await readdir(outside), []);
    assert.deepEqual(await readFile(manifestPath), before);
    assert.equal((await cli(['help', '--all'])).code, 0);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
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
