import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openMemory } from '../src/memory.mjs';
import { getAttestationKey, signRecord } from '../src/attestation.mjs';
import { indexRepository } from '../src/cartography/graph.mjs';
import {
  RISK_THRESHOLDS,
  RISK_WEIGHTS,
  checkBlastRadius,
  evaluateBlastRadius,
  isTestModule,
  parseTarget,
  phi,
  riskLevel,
  scoreRisk,
} from '../src/cartography/blast-radius.mjs';
import { makeRepo, seededRandom } from '../test-support/cartography-fixtures.mjs';

const close = (actual, expected, digits = 6) =>
  assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} != ${expected}`);
const inputs = overrides => ({
  impactedConsumers: 10,
  edgeClass: 'value',
  centrality: 0.25,
  testCoverage: 0,
  contractLevel: 0,
  ...overrides,
});

let repo;
let memory;
beforeEach(() => {
  repo = makeRepo('omni-blast-');
  memory = null;
});
afterEach(() => {
  if (memory?.db.isOpen) memory.close();
  repo.cleanup();
});

async function evaluate(files, targets, options) {
  repo.tree(files);
  memory = openMemory(join(repo.root, 'specs', '.omni', 'memory.db'));
  indexRepository(repo.root, memory);
  return evaluateBlastRadius(repo.root, memory, targets, options);
}
const impacted = file => file.impactedConsumers.map(item => item.path);

const UTILS = {
  'src/utils.ts':
    'export const slugify = (s) => s;\nexport const formatDate = (d) => d;\nexport const calculateTax = (n) => n;',
  'src/a.ts': "import { slugify } from './utils';\nexport const a = slugify('x');",
  'src/b.ts': "import { formatDate } from './utils';",
  'src/c.ts': "import * as u from './utils';",
  'src/barrel/index.ts': "export { formatDate, calculateTax } from '../utils';",
  'src/d.ts': "import { formatDate } from './barrel/index';",
  'src/e.ts': "import { calculateTax } from './barrel';",
  'src/f.ts': "import { a } from './a';",
};

describe('BR-PHI logarithmic saturation', () => {
  test('BR-PHI-01 phi(0) is 0', () => {
    assert.equal(phi(0), 0);
  });

  test('BR-PHI-02 reference values', () => {
    close(phi(1), 0.201849);
    close(phi(5), 0.521772);
    close(phi(10), 0.698283);
  });

  test('BR-PHI-03 saturates at K = 30', () => {
    assert.equal(phi(30), 1);
    assert.equal(phi(1000), 1);
  });

  test('BR-PHI-04 monotonic', () => {
    for (let k = 1; k <= 100; k++) assert.ok(phi(k) >= phi(k - 1), String(k));
  });

  test('BR-PHI-05 rejects invalid K', () => {
    for (const value of [-1, Number.NaN, 1.5, '3']) assert.throws(() => phi(value), TypeError, String(value));
  });
});

describe('BR-FX canonical formula', () => {
  test('BR-FX-01 runtime impact without tests or contract', () => {
    assert.equal(scoreRisk(inputs()).toFixed(2), '39.91');
  });

  test('BR-FX-02 test coverage damps impact and centrality', () => {
    assert.equal(scoreRisk(inputs({ testCoverage: 1 })).toFixed(2), '23.95');
  });

  test('BR-FX-03 an active contract adds 30 after damping', () => {
    assert.equal(scoreRisk(inputs({ testCoverage: 1, contractLevel: 1 })).toFixed(2), '53.95');
  });

  test('BR-FX-04 the contract term is outside the test damper', () => {
    assert.equal(scoreRisk(inputs({ impactedConsumers: 0, centrality: 0, testCoverage: 1, contractLevel: 1 })), 30);
  });

  test('BR-FX-05 type-only edges weigh 0.1', () => {
    assert.equal(scoreRisk(inputs({ edgeClass: 'type_only' })).toFixed(2), '8.49');
  });

  test('BR-FX-06 proposed contracts weigh half', () => {
    const none = scoreRisk(inputs());
    close(scoreRisk(inputs({ contractLevel: 0.5 })) - none, 15);
    assert.equal(scoreRisk(inputs({ contractLevel: 0 })), none);
  });

  test('BR-FX-07 maximum is 100', () => {
    assert.equal(scoreRisk(inputs({ impactedConsumers: 30, centrality: 1, contractLevel: 1 })), 100);
  });

  test('BR-FX-08 minimum is 0', () => {
    assert.equal(scoreRisk(inputs({ impactedConsumers: 0, centrality: 0 })), 0);
  });

  test('BR-FX-09 weights sum to one and scores stay in range', () => {
    close(RISK_WEIGHTS.alpha + RISK_WEIGHTS.beta + RISK_WEIGHTS.gamma, 1, 12);
    const random = seededRandom(42);
    for (let round = 0; round < 10_000; round++) {
      const score = scoreRisk({
        impactedConsumers: Math.floor(random() * 200),
        edgeClass: random() < 0.5 ? 'value' : 'type_only',
        centrality: random(),
        testCoverage: [0, 0.5, 1][Math.floor(random() * 3)],
        contractLevel: [0, 0.5, 1][Math.floor(random() * 3)],
      });
      assert.ok(score >= 0 && score <= 100, String(score));
    }
  });

  test('BR-FX-10 weights are frozen', () => {
    assert.deepEqual(
      { ...RISK_WEIGHTS },
      { alpha: 0.5, beta: 0.2, gamma: 0.3, delta: 0.4, kSat: 30, omegaTypeOnly: 0.1, omegaValue: 1 },
    );
    assert.throws(() => {
      RISK_WEIGHTS.alpha = 1;
    }, TypeError);
  });

  test('BR-FX-11 out-of-range inputs are rejected, not clamped', () => {
    assert.throws(() => scoreRisk(inputs({ centrality: 1.2 })), RangeError);
    assert.throws(() => scoreRisk(inputs({ testCoverage: -0.1 })), RangeError);
    assert.throws(() => scoreRisk(inputs({ contractLevel: 2 })), RangeError);
    assert.throws(() => scoreRisk(inputs({ edgeClass: 'maybe' })), RangeError);
    assert.throws(() => scoreRisk(inputs({ impactedConsumers: -1 })), TypeError);
  });
});

describe('BR-LVL governance levels', () => {
  test('BR-LVL-01 thresholds', () => {
    assert.deepEqual({ ...RISK_THRESHOLDS }, { medium: 25, high: 70 });
    assert.deepEqual(
      [24.99, 25, 69.99, 70].map(score => riskLevel(score).level),
      ['low', 'medium', 'medium', 'high'],
    );
  });

  test('BR-LVL-02 gates', () => {
    assert.equal(riskLevel(10).gate, 'proceed');
    assert.equal(riskLevel(30).gate, 'confirm');
    assert.equal(riskLevel(80).gate, 'CONTRACT_BREACH_BLOCKER');
  });

  test('BR-LVL-03 levels use the unrounded score', () => {
    assert.equal(riskLevel(69.996).level, 'medium');
  });
});

describe('BR inputs derived from the graph', () => {
  test('BR-SYM-01 only consumers of the changed symbol count', async () => {
    const report = await evaluate(UTILS, ['src/utils.ts#slugify']);
    assert.deepEqual(impacted(report.files[0]), ['src/a.ts', 'src/c.ts', 'src/f.ts']);
    assert.deepEqual(report.files[0].symbols, ['slugify']);
  });

  test('BR-SYM-02 a barrel consumer of another symbol is not impacted', async () => {
    const report = await evaluate(UTILS, ['src/utils.ts#calculateTax']);
    const file = report.files[0];
    assert.deepEqual(impacted(file), ['src/barrel/index.ts', 'src/c.ts', 'src/e.ts']);
    assert.ok(!impacted(file).includes('src/d.ts'));
    assert.equal(file.impactedConsumers.find(item => item.path === 'src/e.ts').distance, 2);
  });

  test('BR-SYM-03 namespace, side-effect and require consumers count for any symbol', async () => {
    const report = await evaluate(
      {
        'src/utils.ts': 'export const one = 1;\nexport const two = 2;',
        'src/ns.ts': "import * as u from './utils';",
        'src/side.ts': "import './utils';",
        'src/cjs.js': "const u = require('./utils');",
        'src/named.ts': "import { two } from './utils';",
      },
      ['src/utils.ts#one'],
    );
    assert.deepEqual(impacted(report.files[0]), ['src/cjs.js', 'src/ns.ts', 'src/side.ts']);
  });

  test('BR-SYM-04 without symbols every export is in scope', async () => {
    const report = await evaluate(UTILS, ['src/utils.ts']);
    assert.equal(report.files[0].symbols, null);
    assert.deepEqual(impacted(report.files[0]), [
      'src/a.ts',
      'src/b.ts',
      'src/barrel/index.ts',
      'src/c.ts',
      'src/d.ts',
      'src/e.ts',
      'src/f.ts',
    ]);
  });

  test('BR-SYM-05 later hops are file level', async () => {
    const report = await evaluate({ ...UTILS, 'src/g.ts': "import { unrelated } from './a';" }, [
      'src/utils.ts#slugify',
    ]);
    assert.ok(impacted(report.files[0]).includes('src/g.ts'));
  });

  test('BR-SYM-06 omega follows the edge class of the impacted consumers', async () => {
    const typeOnly = await evaluate(
      { 'src/shapes.ts': 'export interface Shape { a: 1 }', 'src/t.ts': "import type { Shape } from './shapes';" },
      ['src/shapes.ts'],
    );
    assert.equal(typeOnly.files[0].inputs.omega, 0.1);
    memory.close();
    repo.cleanup();
    repo = makeRepo('omni-blast-');
    const runtime = await evaluate(
      {
        'src/shapes.ts': 'export const make = 1;',
        'src/t.ts': "import type { Shape } from './shapes';",
        'src/v.ts': "import { make } from './shapes';",
      },
      ['src/shapes.ts'],
    );
    assert.equal(runtime.files[0].inputs.omega, 1);
  });

  test('BR-CEN-01 centrality is runtime in-degree over N - 1', async () => {
    const report = await evaluate(
      {
        'src/hub.ts': 'export const h = 1;',
        'src/r1.ts': "import { h } from './hub';",
        'src/r2.ts': "import { h } from './hub';",
        'src/r3.ts': "import { h } from './hub';",
        'src/t1.ts': "import type { h } from './hub';",
      },
      ['src/hub.ts', 'src/r1.ts'],
    );
    assert.equal(report.files[0].inputs.centrality, 0.75);
    assert.equal(report.files[1].inputs.centrality, 0);
    memory.close();
    repo.cleanup();
    repo = makeRepo('omni-blast-');
    const single = await evaluate({ 'src/only.ts': 'export const o = 1;' }, ['src/only.ts']);
    assert.equal(single.files[0].inputs.centrality, 0);
  });

  test('BR-COV-01 attested coverage levels', async () => {
    const spec = { id: '001', slug: '001-core', type: 'feature', status: 'IN_PROGRESS' };
    const files = {
      'specs/manifest.json': { specs: [spec], active_spec: spec.slug },
      'src/f.ts': 'export const f = 1;',
      'src/g.ts': 'export const g = 1;',
      'src/use.ts': "import { f } from './f';\nimport { g } from './g';",
      'test/f.test.ts': "import { f } from '../src/f';",
    };
    const unattested = await evaluate(files, ['src/f.ts', 'src/g.ts']);
    assert.equal(unattested.files[0].inputs.testCoverage, 0.5);
    assert.equal(unattested.files[1].inputs.testCoverage, 0);
    assert.deepEqual(unattested.files[0].tests, ['test/f.test.ts']);
    const record = signRecord(await getAttestationKey(), {
      version: 4,
      id: '001',
      mode: 'automated',
      passed: true,
      fingerprint: 'fingerprint',
      verifiedAt: '2026-11-05T00:00:00.000Z',
      reason: null,
      timeoutOverride: null,
      checks: [{ id: 'unit', command: 'node --test' }],
      results: [{ checkId: 'unit', command: 'node --test', exitCode: 0, startedAt: '2026-11-05T00:00:00.000Z' }],
    });
    repo.write('specs/001-core/verification.json', JSON.stringify(record));
    const attested = await evaluateBlastRadius(repo.root, memory, ['src/f.ts']);
    assert.equal(attested.files[0].inputs.testCoverage, 1);
    record.passed = false;
    repo.write('specs/001-core/verification.json', JSON.stringify(record));
    const forged = await evaluateBlastRadius(repo.root, memory, ['src/f.ts']);
    assert.equal(forged.files[0].inputs.testCoverage, 0.5);
  });

  test('BR-COV-02 test module detection', () => {
    for (const path of [
      'src/a.test.ts',
      'src/a.spec.tsx',
      'src/__tests__/a.ts',
      'test/a.mjs',
      'tests/a.py',
      'app/test_models.py',
      'pkg/auth_test.go',
      'src/test/java/com/x/AT.java',
    ])
      assert.equal(isTestModule(path), true, path);
    for (const path of ['src/testing-utils.ts', 'src/latest.ts', 'src/contest/a.ts'])
      assert.equal(isTestModule(path), false, path);
  });

  const contracts = (status, evidence) => ({
    schemaVersion: 1,
    revision: 1,
    contracts: [
      {
        id: 'api.users',
        revision: 1,
        current: { capability: 'Users API', scope: 'Prose scope.', status, sourceSpec: '001', decision: 'd', evidence },
        history: [],
      },
    ],
  });

  test('BR-CON-01 contract level from evidence paths', async () => {
    const base = {
      'src/api/users.ts': 'export const u = 1;',
      'src/api/routes.ts': 'export const r = 1;',
      'src/other.ts': 'export const o = 1;',
    };
    const levels = async status => {
      const report = await evaluate(
        { ...base, 'specs/contracts.json': contracts(status, ['src/api/users.ts#L4', './src/api/routes.ts:12']) },
        ['src/api/users.ts', 'src/api/routes.ts', 'src/other.ts'],
      );
      memory.close();
      repo.cleanup();
      repo = makeRepo('omni-blast-');
      return report.files.map(file => file.inputs.contractLevel);
    };
    assert.deepEqual(await levels('active'), [1, 1, 0]);
    assert.deepEqual(await levels('proposed'), [0.5, 0.5, 0]);
    assert.deepEqual(await levels('retired'), [0, 0, 0]);
    const directory = await evaluate({ ...base, 'specs/contracts.json': contracts('active', ['src/api/']) }, [
      'src/api/routes.ts',
    ]);
    assert.equal(directory.files[0].inputs.contractLevel, 1);
  });

  test('BR-CON-02 unreadable contracts warn and count as none', async () => {
    const report = await evaluate({ 'src/a.ts': 'export const a = 1;', 'specs/contracts.json': '{ not json' }, [
      'src/a.ts',
    ]);
    assert.equal(report.files[0].inputs.contractLevel, 0);
    assert.ok(report.warnings.includes('CONTRACTS_UNREADABLE'));
  });
});

describe('BR anchors and synthetic bridges', () => {
  test('BR-ANC-01 root configuration files are ROOT_ANCHOR', async () => {
    const anchors = [
      'package.json',
      'tsconfig.json',
      'jsconfig.json',
      'pnpm-workspace.yaml',
      '.env.example',
      'go.mod',
      'Cargo.toml',
      'pyproject.toml',
    ];
    const files = { 'src/a.ts': 'export const a = 1;' };
    for (const anchor of anchors) files[anchor] = anchor.endsWith('.json') ? '{}' : '';
    const report = await evaluate(files, anchors);
    for (const file of report.files) {
      assert.equal(file.rootAnchor, true, file.file);
      assert.equal(file.score, 100, file.file);
      assert.equal(file.level, 'high', file.file);
    }
  });

  test('BR-ANC-02 package manifests anchor only packages with workspace consumers', async () => {
    const report = await evaluate(
      {
        'package.json': { workspaces: ['packages/*'] },
        'packages/ui/package.json': { name: '@org/ui', exports: './src/index.ts' },
        'packages/ui/src/index.ts': 'export const ui = 1;',
        'packages/lonely/package.json': { name: '@org/lonely' },
        'packages/lonely/index.ts': 'export const l = 1;',
        'apps/web/main.ts': "import { ui } from '@org/ui';",
      },
      ['packages/ui/package.json', 'packages/lonely/package.json'],
    );
    assert.equal(report.files[0].rootAnchor, true);
    assert.equal(report.files[0].score, 100);
    assert.equal(report.files[1].rootAnchor, false);
    assert.ok(report.files[1].score < 100);
  });

  test('BR-ANC-03 configs in the root extends chain are anchors', async () => {
    const report = await evaluate(
      {
        'tsconfig.json': { extends: './config/tsconfig.base.json' },
        'config/tsconfig.base.json': { compilerOptions: { strict: true } },
        'config/unrelated.json': '{}',
        'src/a.ts': '',
      },
      ['config/tsconfig.base.json', 'config/unrelated.json'],
    );
    assert.equal(report.files[0].rootAnchor, true);
    assert.equal(report.files[1].rootAnchor, false);
  });

  test('BR-BRG-01 prisma schema bridges to @prisma/client importers', async () => {
    const report = await evaluate(
      {
        'prisma/schema.prisma': 'model User { id Int @id }',
        'src/db.ts': "import { PrismaClient } from '@prisma/client';",
        'src/users.ts': "import { db } from './db';",
      },
      ['prisma/schema.prisma'],
    );
    assert.deepEqual(impacted(report.files[0]), ['src/db.ts', 'src/users.ts']);
    assert.equal(report.files[0].impactedConsumers[0].edgeType, 'synthetic');
  });

  test('BR-BRG-02 SQL migrations bridge to ORM clients or are reported unbridged', async () => {
    const bridged = await evaluate(
      {
        'db/migrations/001_init.sql': 'create table t (id int);',
        'src/db.ts': "import { drizzle } from 'drizzle-orm';",
      },
      ['db/migrations/001_init.sql'],
    );
    assert.deepEqual(impacted(bridged.files[0]), ['src/db.ts']);
    memory.close();
    repo.cleanup();
    repo = makeRepo('omni-blast-');
    const lonely = await evaluate({ 'migrations/001.sql': 'select 1;', 'src/a.ts': '' }, ['migrations/001.sql']);
    assert.ok(lonely.files[0].warnings.includes('UNBRIDGED_ASSET'));
  });

  test('BR-BRG-03 manifest bridges are honoured', async () => {
    const report = await evaluate(
      {
        'specs/manifest.json': {
          specs: [],
          cartography: { bridges: [{ asset: 'contracts/*.graphql', consumers: ['@apollo/client'] }] },
        },
        'contracts/user.graphql': 'type User { id: ID }',
        'src/client.ts': "import { gql } from '@apollo/client';",
      },
      ['contracts/user.graphql'],
    );
    assert.deepEqual(impacted(report.files[0]), ['src/client.ts']);
  });

  test('BR-BRG-04 synthetic edges count as runtime', async () => {
    const report = await evaluate(
      {
        'prisma/schema.prisma': 'model A { id Int @id }',
        'src/db.ts': "import { PrismaClient } from '@prisma/client';",
      },
      ['prisma/schema.prisma'],
    );
    assert.equal(report.files[0].inputs.omega, 1);
    assert.equal(report.files[0].impactedConsumers[0].edgeClass, 'value');
  });
});

describe('BR report and edge cases', () => {
  test('BR-RPT-01 unindexed files are reported, not guessed', async () => {
    const report = await evaluate({ 'src/a.ts': '' }, ['src/new-file.ts']);
    assert.deepEqual([report.files[0].indexed, report.files[0].score, report.files[0].level], [false, 0, 'low']);
    assert.ok(report.files[0].warnings.includes('NOT_INDEXED'));
  });

  test('BR-RPT-02 opaque loading raises an uncertainty warning without changing the score', async () => {
    const report = await evaluate(
      {
        'src/target.ts': 'export const t = 1;',
        'src/user.ts': "import { t } from './target';\nexport const load = (n) => import(n);",
      },
      ['src/target.ts'],
    );
    assert.ok(report.files[0].warnings.includes('UNCERTAIN_DEPENDENCY_RISK'));
    const { impactedConsumers, edgeClass, centrality, testCoverage, contractLevel } = {
      ...report.files[0].inputs,
      impactedConsumers: report.files[0].inputs.k,
      edgeClass: report.files[0].inputs.omega === 1 ? 'value' : 'type_only',
    };
    assert.equal(
      report.files[0].score,
      Number(scoreRisk({ impactedConsumers, edgeClass, centrality, testCoverage, contractLevel }).toFixed(2)),
    );
  });

  test('BR-RPT-03 several files: per-file reports, overall maximum, deduplicated consumers', async () => {
    const report = await evaluate(UTILS, ['src/utils.ts#slugify', 'src/a.ts']);
    assert.equal(report.files.length, 2);
    assert.equal(report.overall.score, Math.max(...report.files.map(file => file.score)));
    assert.deepEqual(report.consumers, ['src/a.ts', 'src/c.ts', 'src/f.ts']);
  });

  test('BR-RPT-04 report shape', async () => {
    const report = await evaluate(UTILS, ['src/utils.ts']);
    assert.deepEqual(Object.keys(report), [
      'schemaVersion',
      'maxDepth',
      'overall',
      'consumers',
      'warnings',
      'truncated',
      'files',
    ]);
    assert.equal(report.schemaVersion, 1);
    assert.deepEqual(Object.keys(report.overall), ['score', 'level', 'gate']);
    assert.deepEqual(Object.keys(report.files[0]), [
      'file',
      'symbols',
      'indexed',
      'rootAnchor',
      'nodeType',
      'score',
      'level',
      'gate',
      'inputs',
      'impactedConsumers',
      'tests',
      'warnings',
    ]);
    assert.deepEqual(Object.keys(report.files[0].inputs), [
      'k',
      'omega',
      'centrality',
      'testCoverage',
      'contractLevel',
    ]);
  });

  test('BR-RPT-05 deterministic output', async () => {
    const first = await evaluate(UTILS, ['src/utils.ts', 'src/a.ts#a']);
    const second = await evaluateBlastRadius(repo.root, memory, ['src/utils.ts', 'src/a.ts#a']);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  test('parseTarget splits symbols', () => {
    assert.deepEqual(parseTarget('src/a.ts#x, y'), { path: 'src/a.ts', symbols: ['x', 'y'] });
    assert.deepEqual(parseTarget('src/a.ts'), { path: 'src/a.ts', symbols: null });
    assert.throws(() => parseTarget('src/a.ts#'), /symbol/);
  });

  test('checkBlastRadius indexes before evaluating', async () => {
    repo.tree(UTILS);
    memory = openMemory(join(repo.root, 'specs', '.omni', 'memory.db'));
    const report = await checkBlastRadius(repo.root, memory, ['src/utils.ts#slugify']);
    assert.deepEqual(impacted(report.files[0]), ['src/a.ts', 'src/c.ts', 'src/f.ts']);
    repo.write('src/late.ts', "import { slugify } from './utils';");
    const again = await checkBlastRadius(repo.root, memory, ['src/utils.ts#slugify']);
    assert.ok(impacted(again.files[0]).includes('src/late.ts'));
  });
});
