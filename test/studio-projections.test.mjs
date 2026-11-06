import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BREAKER_DEFAULTS, openBreakerStore } from '../src/circuit-breaker.mjs';
import { auditProjectContext, estimateTokens } from '../src/context-auditor.mjs';
import { indexRepository } from '../src/cartography/graph.mjs';
import { openProjectMemory } from '../src/memory.mjs';
import { verifySpec } from '../src/verification.mjs';
import { BOARD_LANES, collectBoardInputs, placeCard, projectBoard } from '../src/studio/projections/board.mjs';
import { heatFromTarget, projectGraph } from '../src/studio/projections/graph.mjs';
import { pruneTokenEvents, projectFinops, tokenRate } from '../src/studio/projections/finops.mjs';
import { listSkills, toggleSkill } from '../src/studio/projections/skills.mjs';
import { fileTree } from '../src/studio/projections/files.mjs';
import { fillSpec } from '../test-support/fixtures.mjs';
import { makeStudioProject, writeTasks } from '../test-support/studio-fixtures.mjs';

const SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url));

let project;
let memories;

beforeEach(() => {
  project = makeStudioProject();
  memories = [];
});

afterEach(() => {
  for (const memory of memories) memory.close();
  project.cleanup();
});

async function memory() {
  const { memory: opened } = await openProjectMemory(project.root);
  memories.push(opened);
  return opened;
}

/** Normalized board input; every field the projection reads is explicit. */
function card(overrides = {}) {
  return {
    id: '001',
    slug: '001-change',
    title: 'Change',
    type: 'feature',
    status: 'IN_PROGRESS',
    route: 'standard',
    tags: [],
    owner: null,
    risk: null,
    updatedAt: '2026-11-01T00:00:00.000Z',
    tasks: null,
    verification: 'none',
    gates: { required: false, 1: 'missing', 2: 'missing' },
    ...overrides,
  };
}
const tasks = (pending, inProgress, done) => ({ total: pending + inProgress + done, pending, inProgress, done });
const gatesOn = (one, two) => ({ required: true, 1: one, 2: two });

describe('PJ-BRD board', () => {
  test('PJ-BRD-01 light route lanes', () => {
    assert.deepEqual(BOARD_LANES.light, ['backlog', 'running', 'verified']);
  });

  test('PJ-BRD-02 standard route lanes', () => {
    assert.deepEqual(BOARD_LANES.standard, ['specification', 'tasks', 'implementation', 'verification']);
  });

  test('PJ-BRD-03 full route lanes and frozen registry', () => {
    assert.deepEqual(BOARD_LANES.full, ['specification', 'gate-1', 'tasks', 'implementation', 'gate-2', 'closed']);
    assert.ok(Object.isFrozen(BOARD_LANES) && Object.values(BOARD_LANES).every(Object.isFrozen));
  });

  test('PJ-BRD-04 lane placement table', () => {
    const rows = [
      // light
      [{ route: 'light' }, 'backlog'],
      [{ route: 'light', tasks: tasks(2, 1, 0) }, 'running'],
      [{ route: 'light', tasks: tasks(1, 0, 1) }, 'running'],
      [{ route: 'light', verification: 'failed' }, 'running'],
      [{ route: 'light', verification: 'stale' }, 'running'],
      [{ route: 'light', verification: 'passed' }, 'verified'],
      [{ route: 'light', status: 'COMPLETED', verification: 'passed' }, 'verified'],
      // standard
      [{ route: 'standard' }, 'specification'],
      [{ route: 'standard', tasks: tasks(3, 0, 0) }, 'tasks'],
      [{ route: 'standard', tasks: tasks(2, 1, 0) }, 'implementation'],
      [{ route: 'standard', tasks: tasks(0, 0, 3) }, 'implementation'],
      [{ route: 'standard', tasks: tasks(0, 0, 3), verification: 'failed' }, 'verification'],
      [{ route: 'standard', tasks: tasks(0, 0, 3), verification: 'passed' }, 'verification'],
      [{ route: 'standard', status: 'COMPLETED', verification: 'passed' }, 'verification'],
      // full with human gates required
      [{ route: 'full', gates: gatesOn('missing', 'missing') }, 'specification'],
      [{ route: 'full', tasks: tasks(3, 0, 0), gates: gatesOn('missing', 'missing') }, 'gate-1'],
      [{ route: 'full', tasks: tasks(3, 0, 0), gates: gatesOn('stale', 'missing') }, 'gate-1'],
      [{ route: 'full', tasks: tasks(3, 0, 0), gates: gatesOn('approved', 'missing') }, 'tasks'],
      [{ route: 'full', tasks: tasks(1, 1, 1), gates: gatesOn('approved', 'missing') }, 'implementation'],
      [
        { route: 'full', tasks: tasks(0, 0, 3), verification: 'passed', gates: gatesOn('approved', 'missing') },
        'gate-2',
      ],
      [
        { route: 'full', tasks: tasks(0, 0, 3), verification: 'passed', gates: gatesOn('approved', 'approved') },
        'gate-2',
      ],
      [
        { route: 'full', status: 'COMPLETED', verification: 'passed', gates: gatesOn('approved', 'approved') },
        'closed',
      ],
      // full without human gates: gate lanes are passed through
      [{ route: 'full', tasks: tasks(3, 0, 0) }, 'tasks'],
      // unrouted
      [{ route: null }, 'unrouted'],
      [{ route: 'invalid' }, 'unrouted'],
      [{ route: null, type: 'rfc' }, 'backlog'],
    ];
    for (const [overrides, lane] of rows)
      assert.equal(placeCard(card(overrides)).lane, lane, JSON.stringify(overrides));
  });

  test('PJ-BRD-05 a spec without a fit route is never defaulted to standard', () => {
    const board = projectBoard([card({ route: null, slug: '002-x', id: '002' })], { route: 'standard' });
    assert.equal(board.lanes.flatMap(lane => lane.cards).length, 0);
    assert.equal(board.unrouted.length, 1);
    assert.deepEqual(board.unrouted[0].suggestedAction, { command: 'fit', spec: '002' });
  });

  test('PJ-BRD-06 a tampered attestation is flagged and never reaches the verified lane', async () => {
    project.cli('create', 'feature', 'login-flow', '--light');
    await fillSpec(project.root, { slug: '001-login-flow', type: 'feature' });
    const verified = await verifySpec(project.root, '001', {
      manual: 'Scoped fixture review confirms the deterministic greeting locally.',
    });
    assert.equal(verified.passed, true);
    const passed = (await collectBoardInputs(project.root)).find(input => input.id === '001');
    assert.equal(passed.verification, 'passed');
    assert.equal(placeCard(passed).lane, 'verified');

    const record = project.readJson('specs/001-login-flow/verification.json');
    record.recordSignature = '0'.repeat(64);
    project.writeJson('specs/001-login-flow/verification.json', record);
    const tampered = (await collectBoardInputs(project.root)).find(input => input.id === '001');
    assert.equal(tampered.verification, 'invalid-attestation');
    const placed = placeCard(tampered);
    assert.equal(placed.lane, 'running');
    assert.equal(placed.attestation, 'invalid');
    assert.equal(placed.protected, true);
  });

  test('PJ-BRD-07 card fields come from the real manifest, fit and tasks.json', async () => {
    project.cli('create', 'feature', 'login-flow', '--standard');
    writeTasks(project, '001-login-flow', ['done', 'in_progress', 'pending']);
    const [input] = await collectBoardInputs(project.root);
    const placed = placeCard(input);
    assert.deepEqual(Object.keys(placed).sort(), [
      'attestation',
      'gates',
      'id',
      'lane',
      'owner',
      'protected',
      'risk',
      'route',
      'slug',
      'tags',
      'tasks',
      'title',
      'updatedAt',
    ]);
    assert.equal(placed.title, 'Login Flow');
    assert.equal(placed.route, 'standard');
    assert.deepEqual(placed.tasks, { done: 1, total: 3 });
    assert.equal(placed.lane, 'implementation');
  });

  test('PJ-BRD-08 tag, risk and owner filters combine with AND', () => {
    const inputs = [
      card({ id: '001', slug: '001-a', tags: ['ui'], risk: 'high', owner: 'ana' }),
      card({ id: '002', slug: '002-b', tags: ['ui', 'db'], risk: 'low', owner: 'ana' }),
      card({ id: '003', slug: '003-c', tags: ['db'], risk: 'high', owner: 'luis' }),
    ];
    const ids = filters =>
      projectBoard(inputs, { route: 'standard', filters })
        .lanes.flatMap(lane => lane.cards)
        .map(placed => placed.id)
        .sort();
    assert.deepEqual(ids({}), ['001', '002', '003']);
    assert.deepEqual(ids({ tags: ['ui'] }), ['001', '002']);
    assert.deepEqual(ids({ tags: ['ui'], risk: ['high'] }), ['001']);
    assert.deepEqual(ids({ owner: ['ana'], risk: ['low'] }), ['002']);
    assert.deepEqual(ids({ tags: ['nonexistent'] }), []);
  });

  test('PJ-BRD-09 cards are ordered by updatedAt descending, then id', () => {
    const inputs = [
      card({ id: '003', slug: '003-c', updatedAt: '2026-11-02T00:00:00.000Z' }),
      card({ id: '001', slug: '001-a', updatedAt: '2026-11-03T00:00:00.000Z' }),
      card({ id: '002', slug: '002-b', updatedAt: '2026-11-02T00:00:00.000Z' }),
    ];
    const lane = projectBoard(inputs, { route: 'standard' }).lanes.find(entry => entry.id === 'specification');
    assert.deepEqual(
      lane.cards.map(placed => placed.id),
      ['001', '002', '003'],
    );
    const board = projectBoard(inputs, { route: 'standard' });
    assert.deepEqual(board.counts, { light: 0, standard: 3, full: 0, unrouted: 0 });
  });

  test('PJ-BRD-10 owner is projected when present, null when absent, rejected when invalid', async () => {
    project.cli('create', 'feature', 'login-flow', '--light');
    project.cli('create', 'feature', 'search', '--light');
    const manifest = project.readJson('specs/manifest.json');
    manifest.specs[0].owner = 'ana';
    project.writeJson('specs/manifest.json', manifest);
    const inputs = await collectBoardInputs(project.root);
    assert.equal(inputs.find(input => input.id === '001').owner, 'ana');
    assert.equal(inputs.find(input => input.id === '002').owner, null);
    manifest.specs[1].owner = 'x'.repeat(101);
    project.writeJson('specs/manifest.json', manifest);
    await assert.rejects(collectBoardInputs(project.root), /owner/);
  });
});

async function indexedProject() {
  project.write('src/core.ts', 'export const core = 1;\nexport type Core = number;\n');
  project.write('src/a.ts', "import { core } from './core';\nexport const a = core;\n");
  project.write('src/b.ts', "import type { Core } from './core';\nexport const b: Core = 2;\n");
  project.write('src/index.ts', "export { a } from './a';\nexport { b } from './b';\n");
  project.write('src/app.ts', "import { a } from './index';\nimport React from 'react';\nimport x from './missing';\n");
  const opened = await memory();
  indexRepository(project.root, opened);
  return opened;
}

describe('PJ-GRF graph', () => {
  test('PJ-GRF-01 nodes and edges use compact integer ids', async () => {
    const graph = projectGraph(await indexedProject());
    assert.equal(graph.indexed, true);
    const byPath = new Map(graph.nodes.map(node => [node.path, node]));
    assert.deepEqual([...byPath.keys()].sort(), ['src/a.ts', 'src/app.ts', 'src/b.ts', 'src/core.ts', 'src/index.ts']);
    for (const node of graph.nodes) {
      assert.ok(Number.isInteger(node.id));
      for (const key of ['language', 'nodeType', 'dIn', 'dOut', 'contractLevel', 'isBarrel'])
        assert.ok(key in node, key);
    }
    const edge = (source, target) =>
      graph.edges.find(entry => entry.s === byPath.get(source).id && entry.t === byPath.get(target).id);
    assert.equal(edge('src/a.ts', 'src/core.ts').type, 'value');
    assert.equal(edge('src/b.ts', 'src/core.ts').type, 'type_only');
    assert.equal(byPath.get('src/index.ts').isBarrel, true);
  });

  test('PJ-GRF-02 external and unresolved targets are counted, not drawn', async () => {
    const graph = projectGraph(await indexedProject());
    const app = graph.nodes.find(node => node.path === 'src/app.ts');
    assert.equal(app.externalCount, 1);
    assert.equal(app.unresolvedCount, 1);
    const ids = new Set(graph.nodes.map(node => node.id));
    assert.ok(graph.edges.every(edge => ids.has(edge.s) && ids.has(edge.t)));
  });

  test('PJ-GRF-03 the projection is byte-identical after reopening memory.db', async () => {
    const before = JSON.stringify(projectGraph(await indexedProject()));
    for (const opened of memories.splice(0)) opened.close();
    const reopened = await memory();
    const after = JSON.stringify(projectGraph(reopened));
    assert.ok(before.length > 2, 'the indexed graph is not empty');
    assert.equal(after, before);
  });

  test('PJ-GRF-04 4.000 nodes and 20.000 edges project under 2 MB and 150 ms', async () => {
    const opened = await memory();
    const insertNode = opened.db.prepare(
      "INSERT INTO modules_graph (module_path, language, node_type, has_opaque_deps, last_analyzed_at) VALUES (?, 'typescript', 'leaf', 0, '2026-11-06')",
    );
    const insertEdge = opened.db.prepare("INSERT INTO module_dependencies VALUES (?, ?, 'value', 'internal', '[]')");
    opened.db.exec('BEGIN IMMEDIATE');
    for (let index = 0; index < 4000; index++) insertNode.run(`src/m${index}.ts`);
    for (let index = 0; index < 4000; index++)
      for (let step = 1; step <= 5; step++) insertEdge.run(`src/m${index}.ts`, `src/m${(index + step * 7) % 4000}.ts`);
    opened.db.exec('COMMIT');
    const startedAt = performance.now();
    const graph = projectGraph(opened);
    const elapsed = performance.now() - startedAt;
    assert.equal(graph.nodes.length, 4000);
    assert.equal(graph.edges.length, 20000);
    assert.ok(Buffer.byteLength(JSON.stringify(graph)) < 2 * 1024 * 1024);
    assert.ok(elapsed < 150, `${elapsed.toFixed(1)} ms`);
  });

  test('PJ-GRF-05 heat for a target lists only impacted nodes with distance, score and edge class', async () => {
    const opened = await indexedProject();
    const heat = await heatFromTarget(project.root, opened, { target: 'src/core.ts', symbols: ['core'] });
    const byPath = Object.fromEntries(heat.nodes.map(node => [node.path, node]));
    assert.equal(byPath['src/a.ts'].distance, 1);
    assert.equal(byPath['src/a.ts'].edgeClass, 'value');
    assert.equal(byPath['src/b.ts'], undefined, 'b imports only the Core type, not the core symbol');
    for (const node of heat.nodes) assert.ok(node.score >= 0 && node.score <= 100);
    assert.equal(typeof heat.level, 'string');
  });

  test('PJ-GRF-06 contract barriers and barrel routes are marked', async () => {
    // Same registry shape the blast-radius engine reads (cartography-blast-radius.test.mjs BR-CON).
    project.writeJson('specs/contracts.json', {
      schemaVersion: 1,
      revision: 1,
      contracts: [
        {
          id: 'core.value',
          revision: 1,
          current: {
            capability: 'Core value',
            scope: 'Core module.',
            status: 'active',
            sourceSpec: '001',
            decision: 'The core value is a public contract.',
            evidence: ['src/core.ts'],
          },
          history: [],
        },
      ],
    });
    const opened = await indexedProject();
    const graph = projectGraph(opened, { root: project.root });
    assert.equal(graph.nodes.find(node => node.path === 'src/core.ts').contractLevel, 1);
    const heat = await heatFromTarget(project.root, opened, { target: 'src/a.ts' });
    assert.equal(heat.nodes.find(node => node.path === 'src/app.ts').viaBarrel, 'src/index.ts');
  });

  test('PJ-GRF-07 an empty index projects as not indexed', async () => {
    const graph = projectGraph(await memory());
    assert.deepEqual(graph, { indexed: false, nodes: [], edges: [], cycles: [], cyclesTruncated: false });
  });

  test('PJ-GRF-08 cycles are listed and capped at 100', async () => {
    const opened = await memory();
    const insertNode = opened.db.prepare(
      "INSERT INTO modules_graph (module_path, has_opaque_deps, last_analyzed_at) VALUES (?, 0, '2026-11-06')",
    );
    const insertEdge = opened.db.prepare("INSERT INTO module_dependencies VALUES (?, ?, 'value', 'internal', '[]')");
    opened.db.exec('BEGIN IMMEDIATE');
    for (let index = 0; index < 150; index++) {
      insertNode.run(`c${index}/a.ts`);
      insertNode.run(`c${index}/b.ts`);
      insertEdge.run(`c${index}/a.ts`, `c${index}/b.ts`);
      insertEdge.run(`c${index}/b.ts`, `c${index}/a.ts`);
    }
    opened.db.exec('COMMIT');
    const graph = projectGraph(opened);
    assert.equal(graph.cycles.length, 100);
    assert.equal(graph.cyclesTruncated, true);
  });
});

describe('PJ-FIN finops', () => {
  test('PJ-FIN-01 token usage events are written in the same transaction as the breaker snapshot', async () => {
    const opened = await memory();
    const store = openBreakerStore(opened, { now: () => 1_000 });
    store.update('T-1', breaker => breaker.recordTokenUsage(500), {}, { source: 'passthrough', provider: 'claude' });
    const rows = opened.db
      .prepare('SELECT task_id, tokens, source, provider, recorded_at_ms FROM token_usage_events')
      .all();
    assert.deepEqual(
      rows.map(row => ({ ...row })),
      [{ task_id: 'T-1', tokens: 500, source: 'passthrough', provider: 'claude', recorded_at_ms: 1000 }],
    );
    assert.throws(() =>
      store.update('T-1', breaker => {
        breaker.recordTokenUsage(300);
        throw new Error('caller failure after recording');
      }),
    );
    assert.equal(opened.db.prepare('SELECT count(*) AS n FROM token_usage_events').get().n, 1);
    assert.equal(store.load('T-1').consumedTokens, 500);
  });

  test('PJ-FIN-02 tokens per second over a sliding 10 s window', () => {
    const events = [
      { tokens: 1000, recordedAtMs: 0 },
      { tokens: 500, recordedAtMs: 9_000 },
      { tokens: 250, recordedAtMs: 12_000 },
    ];
    assert.equal(tokenRate(events, 10_000), 50);
    assert.equal(tokenRate(events, 12_000), 75);
    assert.equal(tokenRate(events, 30_000), 0);
  });

  async function threeTasks() {
    const opened = await memory();
    const now = 600_000;
    const store = openBreakerStore(opened, { now: () => now });
    store.update('T-1', breaker => breaker.recordTokenUsage(20_000));
    store.update('T-2', breaker => breaker.recordTokenUsage(1_000));
    assert.throws(() => store.update('T-3', breaker => breaker.recordTokenUsage(BREAKER_DEFAULTS.tokenBudget + 1)));
    return projectFinops(opened, { now, credentialSource: { kind: 'passthrough', provider: 'claude' } });
  }

  test('PJ-FIN-03 the session total adds every recorded event', async () => {
    const finops = await threeTasks();
    assert.equal(finops.session.tokens, 21_000 + BREAKER_DEFAULTS.tokenBudget + 1);
  });

  test('PJ-FIN-04 remaining budget and rate headroom derive from BREAKER_DEFAULTS', async () => {
    const t1 = (await threeTasks()).tasks.find(task => task.taskId === 'T-1');
    assert.equal(t1.remainingBudget, BREAKER_DEFAULTS.tokenBudget - 20_000);
    assert.equal(t1.rateHeadroom, BREAKER_DEFAULTS.maxTokensPerWindow - 20_000);
  });

  test('PJ-FIN-05 breaker state per task, with the reason when OPEN', async () => {
    const { tasks: rows } = await threeTasks();
    assert.equal(rows.find(task => task.taskId === 'T-1').state, 'CLOSED');
    const t3 = rows.find(task => task.taskId === 'T-3');
    assert.equal(t3.state, 'OPEN');
    assert.equal(t3.reason, 'TOKEN_BUDGET_EXCEEDED');
  });

  test('PJ-FIN-06 the credential source is labelled; local inference costs 0', async () => {
    const opened = await memory();
    const passthrough = projectFinops(opened, {
      now: 0,
      credentialSource: { kind: 'passthrough', provider: 'claude' },
    });
    assert.deepEqual(passthrough.credentialSource, { kind: 'passthrough', provider: 'claude' });
    const local = projectFinops(opened, { now: 0, credentialSource: { kind: 'local', provider: 'ollama' } });
    assert.equal(local.credentialSource.costPerToken, 0);
  });

  test('PJ-FIN-07 no secret reaches the payload', async () => {
    const finops = projectFinops(await memory(), {
      now: 0,
      credentialSource: { kind: 'byok', provider: 'anthropic', key: 'sk-ant-api03-SECRETVALUE1234567890' },
    });
    assert.deepEqual(finops.credentialSource, { kind: 'byok', provider: 'anthropic' });
    assert.doesNotMatch(JSON.stringify(finops), /SECRETVALUE/);
  });

  test('PJ-FIN-08 no events is an explicit idle stream', async () => {
    const finops = projectFinops(await memory(), { now: 0, credentialSource: null });
    assert.equal(finops.stream, 'idle');
    assert.equal(finops.tokensPerSecond, 0);
    assert.deepEqual(finops.tasks, []);
  });

  test('PJ-FIN-09 events older than 30 days are pruned, recent ones kept', async () => {
    const opened = await memory();
    const day = 86_400_000;
    const insert = opened.db.prepare(
      "INSERT INTO token_usage_events (task_id, tokens, source, provider, recorded_at_ms) VALUES ('T', 1, 'local', 'ollama', ?)",
    );
    for (const at of [0, 10 * day, 31 * day, 40 * day]) insert.run(at);
    assert.equal(pruneTokenEvents(opened, { now: 41 * day }), 2);
    assert.deepEqual(
      opened.db
        .prepare('SELECT recorded_at_ms FROM token_usage_events ORDER BY 1')
        .all()
        .map(row => row.recorded_at_ms),
      [31 * day, 40 * day],
    );
  });
});

describe('PJ-SKL skills', () => {
  const bundledNames = readdirSync(SKILLS_DIR)
    .filter(name => name.startsWith('omni-'))
    .sort();

  test('PJ-SKL-01 the bundled catalogue lists the omni-* skills with their frontmatter description', async () => {
    const skills = await listSkills(project.root, { bundledDir: SKILLS_DIR });
    const bundled = skills.items.filter(skill => skill.origin === 'bundled');
    assert.deepEqual(bundled.map(skill => skill.name).sort(), bundledNames);
    assert.equal(bundledNames.length, 9);
    const specify = bundled.find(skill => skill.name === 'omni-specify');
    const text = readFileSync(join(SKILLS_DIR, 'omni-specify', 'SKILL.md'), 'utf8');
    assert.ok(text.includes(specify.description), 'description comes from SKILL.md frontmatter');
  });

  test('PJ-SKL-02 project skills are discovered in the host skill directories', async () => {
    project.write(
      '.claude/skills/house-style/SKILL.md',
      '---\nname: house-style\ndescription: Team writing rules.\n---\nBody.\n',
    );
    project.write(
      '.agents/skills/db-review/SKILL.md',
      '---\nname: db-review\ndescription: Review migrations.\n---\nBody.\n',
    );
    const skills = await listSkills(project.root, { bundledDir: SKILLS_DIR });
    const projectSkills = skills.items.filter(skill => skill.origin === 'project');
    assert.deepEqual(projectSkills.map(skill => [skill.name, skill.path]).sort(), [
      ['db-review', '.agents/skills/db-review/SKILL.md'],
      ['house-style', '.claude/skills/house-style/SKILL.md'],
    ]);
  });

  test('PJ-SKL-03 weight reuses the context auditor estimator unchanged', async () => {
    const body = 'x'.repeat(4000);
    project.write('.claude/skills/heavy/SKILL.md', `---\nname: heavy\ndescription: Heavy.\n---\n${body}\n`);
    const skills = await listSkills(project.root, { bundledDir: SKILLS_DIR });
    const heavy = skills.items.find(skill => skill.name === 'heavy');
    assert.equal(heavy.weight.estimated, true);
    assert.equal(heavy.weight.tokens, estimateTokens(project.read('.claude/skills/heavy/SKILL.md')));
    assert.equal(estimateTokens('abcd'.repeat(10)), 10);
    const audit = await auditProjectContext(project.root);
    assert.equal(typeof audit, 'object', 'context auditor keeps working after the extraction');
  });

  test('PJ-SKL-04 active weight total and budget share', async () => {
    const manifest = project.readJson('specs/manifest.json');
    manifest.studio = { contextBudgetTokens: 10_000 };
    project.writeJson('specs/manifest.json', manifest);
    const skills = await listSkills(project.root, { bundledDir: SKILLS_DIR });
    const active = skills.items.filter(skill => skill.enabled).reduce((sum, skill) => sum + skill.weight.tokens, 0);
    assert.equal(skills.activeTokens, active);
    assert.equal(skills.budgetTokens, 10_000);
    assert.equal(skills.budgetShare, active / 10_000);
    project.writeJson('specs/manifest.json', { ...manifest, studio: undefined });
    assert.equal((await listSkills(project.root, { bundledDir: SKILLS_DIR })).budgetTokens, 200_000);
  });

  test('PJ-SKL-05 toggling persists atomically in the manifest and is idempotent', async () => {
    await toggleSkill(project.root, 'omni-audit', false, { bundledDir: SKILLS_DIR });
    await toggleSkill(project.root, 'omni-audit', false, { bundledDir: SKILLS_DIR });
    assert.deepEqual(project.readJson('specs/manifest.json').studio.skills.disabled, ['omni-audit']);
    const skills = await listSkills(project.root, { bundledDir: SKILLS_DIR });
    assert.equal(skills.items.find(skill => skill.name === 'omni-audit').enabled, false);
    await toggleSkill(project.root, 'omni-audit', true, { bundledDir: SKILLS_DIR });
    assert.deepEqual(project.readJson('specs/manifest.json').studio.skills.disabled, []);
  });

  test('PJ-SKL-06 a SKILL.md without frontmatter is listed with its problem', async () => {
    project.write('.claude/skills/broken/SKILL.md', 'No frontmatter here.\n');
    const skills = await listSkills(project.root, { bundledDir: SKILLS_DIR });
    const broken = skills.items.find(skill => skill.path === '.claude/skills/broken/SKILL.md');
    assert.equal(broken.problem, 'FRONTMATTER_MISSING');
  });

  test('PJ-SKL-07 toggling an unknown skill fails with SKILL_NOT_FOUND', async () => {
    await assert.rejects(toggleSkill(project.root, 'ghost', false, { bundledDir: SKILLS_DIR }), error => {
      assert.equal(error.code, 'SKILL_NOT_FOUND');
      return true;
    });
  });
});

describe('PJ-FIL file tree', () => {
  test('PJ-FIL-01 the tree respects ignores and sorts directories first', async () => {
    project.write('.gitignore', 'dist/\n');
    project.write('src/z.ts', '');
    project.write('src/lib/a.ts', '');
    project.write('README.md', '');
    project.write('dist/out.js', '');
    project.write('node_modules/pkg/index.js', '');
    const tree = await fileTree(project.root);
    const top = tree.children.map(node => node.name);
    assert.ok(!top.includes('dist') && !top.includes('node_modules') && !top.includes('.git'));
    const src = tree.children.find(node => node.name === 'src');
    assert.deepEqual(
      src.children.map(node => [node.name, node.kind]),
      [
        ['lib', 'dir'],
        ['z.ts', 'file'],
      ],
    );
    assert.equal(src.children[1].path, 'src/z.ts');
  });

  test('PJ-FIL-02 git status is attached per file', async () => {
    project.write('src/tracked.ts', 'a\n');
    project.write('src/renamed-from.ts', 'same content for rename detection\n'.repeat(5));
    project.commit('base');
    project.write('src/tracked.ts', 'b\n');
    project.write('src/new.ts', 'n\n');
    project.git('mv', 'src/renamed-from.ts', 'src/renamed-to.ts');
    project.write('src/staged.ts', 's\n');
    project.git('add', 'src/staged.ts');
    const tree = await fileTree(project.root);
    const src = tree.children.find(node => node.name === 'src');
    const status = Object.fromEntries(src.children.map(node => [node.name, node.git]));
    assert.equal(status['tracked.ts'], 'modified');
    assert.equal(status['new.ts'], 'untracked');
    assert.equal(status['renamed-to.ts'], 'renamed');
    assert.equal(status['staged.ts'], 'added');
  });

  test('PJ-FIL-03 a subtree outside the root is refused', async () => {
    await assert.rejects(fileTree(project.root, { under: '../' }), error => error.code === 'PATH_OUTSIDE_ROOT');
  });
});
