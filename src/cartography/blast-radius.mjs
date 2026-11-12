/**
 * Blast radius evaluator (blueprint §4.3.6). Symbol-level impact over the cartography graph, scored
 * with the canonical logarithmic-saturation formula:
 *   Φ(K) = min(1, ln(1 + K) / ln(1 + K_sat))
 *   S = min(100, 100 · [(α·Φ(K)·ω + β·Centrality) · (1 − δ·TestCoverage) + γ·ContractLevel])
 * The contract term sits outside the test damper. Root configuration files are ROOT_ANCHOR (S = 100).
 */
import fs from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { getAttestationKey, verifyRecord } from '../attestation.mjs';
import { CARTOGRAPHY_DEFAULTS, indexRepository, propagateFrom } from './graph.mjs';
import { createResolver } from './resolver.mjs';

export const RISK_WEIGHTS = Object.freeze({
  alpha: 0.5,
  beta: 0.2,
  gamma: 0.3,
  delta: 0.4,
  kSat: 30,
  omegaTypeOnly: 0.1,
  omegaValue: 1,
});
export const RISK_THRESHOLDS = Object.freeze({ medium: 25, high: 70 });
/** Project-root files whose change forces Gate 1 (S = 100). */
export const ROOT_ANCHOR_FILES = Object.freeze([
  'package.json',
  'tsconfig.json',
  'jsconfig.json',
  'pnpm-workspace.yaml',
  '.env.example',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
]);

// Weights in percentage points, so 100·γ is exactly 30 rather than 30.000000000000004.
const POINTS = Object.freeze({
  alpha: Math.round(RISK_WEIGHTS.alpha * 1000) / 10,
  beta: Math.round(RISK_WEIGHTS.beta * 1000) / 10,
  gamma: Math.round(RISK_WEIGHTS.gamma * 1000) / 10,
});
const LOG_SATURATION = Math.log(1 + RISK_WEIGHTS.kSat);

/** Logarithmic saturation of the impacted-consumer count. */
export function phi(k) {
  if (typeof k !== 'number' || !Number.isInteger(k) || k < 0)
    throw new TypeError(`K must be a non-negative integer, got ${String(k)}.`);
  return Math.min(1, Math.log(1 + k) / LOG_SATURATION);
}

const unit = (name, value) => {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1)
    throw new RangeError(`${name} must be a number in [0, 1], got ${String(value)}.`);
  return value;
};

/**
 * Canonical S_risk in [0, 100], unrounded.
 * @param {{impactedConsumers: number, edgeClass: 'value'|'type_only', centrality: number,
 *   testCoverage: number, contractLevel: number, rootAnchor?: boolean}} inputs
 */
export function scoreRisk({
  impactedConsumers,
  edgeClass,
  centrality,
  testCoverage,
  contractLevel,
  rootAnchor = false,
}) {
  const saturation = phi(impactedConsumers);
  if (edgeClass !== 'value' && edgeClass !== 'type_only')
    throw new RangeError(`edgeClass must be value or type_only, got ${String(edgeClass)}.`);
  const omega = edgeClass === 'type_only' ? RISK_WEIGHTS.omegaTypeOnly : RISK_WEIGHTS.omegaValue;
  const damped =
    (POINTS.alpha * saturation * omega + POINTS.beta * unit('centrality', centrality)) *
    (1 - RISK_WEIGHTS.delta * unit('testCoverage', testCoverage));
  const score = damped + POINTS.gamma * unit('contractLevel', contractLevel);
  return rootAnchor ? 100 : Math.min(100, score);
}

/** Governance level of an unrounded score (stress test §5.3). */
export function riskLevel(score) {
  if (score >= RISK_THRESHOLDS.high) return { level: 'high', gate: 'CONTRACT_BREACH_BLOCKER' };
  if (score >= RISK_THRESHOLDS.medium) return { level: 'medium', gate: 'confirm' };
  return { level: 'low', gate: 'proceed' };
}

/** `path#sym1,sym2` (D-4); no `#` means every export of the file is in scope. */
export function parseTarget(target) {
  if (typeof target === 'object' && target !== null) return { path: target.path, symbols: target.symbols ?? null };
  const hash = target.lastIndexOf('#');
  if (hash === -1) return { path: target, symbols: null };
  const symbols = target
    .slice(hash + 1)
    .split(',')
    .map(symbol => symbol.trim())
    .filter(Boolean);
  if (!symbols.length) throw new Error(`Empty symbol list in ${target}: use path#symbol[,symbol].`);
  return { path: target.slice(0, hash), symbols };
}

/**
 * Normalises user-supplied targets to POSIX project-relative paths, refusing anything outside `root`.
 * @param {string} root Project root.
 * @param {string} base Directory relative paths are resolved from (the caller's working directory).
 * @param {string[]} targets
 */
export function normalizeTargets(root, base, targets) {
  return targets.map(target => {
    const { path, symbols } = parseTarget(target);
    const absolute = resolve(base, path.replaceAll('\\', sep === '\\' ? '\\' : '/'));
    const projectPath = relative(root, absolute);
    if (!projectPath || projectPath === '..' || projectPath.startsWith(`..${sep}`) || isAbsolute(projectPath))
      throw Object.assign(new Error(`PATH_OUTSIDE_ROOT: ${path} is not inside the project ${root}.`), {
        code: 'PATH_OUTSIDE_ROOT',
      });
    return { path: projectPath.split(sep).join('/'), symbols };
  });
}

const TEST_PATTERNS = [
  /(^|\/)(__tests__|tests?)\//,
  /\.(test|spec)\.[^/]+$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.(py|go)$/,
];
/** Test modules are reported separately: they drive TestCoverage, not ImpactedConsumers. */
export function isTestModule(path) {
  return TEST_PATTERNS.some(pattern => pattern.test(path));
}

function readJson(root, path) {
  try {
    return { value: JSON.parse(fs.readFileSync(join(root, ...path.split('/')), 'utf8').replace(/^﻿/, '')) };
  } catch (error) {
    return error.code === 'ENOENT' ? { missing: true } : { error };
  }
}

/** D-2: a contract covers F when its evidence cites F or a directory containing F. */
/**
 * ContractLevel(F) lookup from specs/contracts.json (D-2); unreadable registries add CONTRACTS_UNREADABLE.
 * @returns {(file: string) => number}
 */
export function contractLevels(root, warnings) {
  const read = readJson(root, 'specs/contracts.json');
  if (read.missing) return () => 0;
  if (read.error || !Array.isArray(read.value?.contracts)) {
    warnings.add('CONTRACTS_UNREADABLE');
    return () => 0;
  }
  const covering = [];
  for (const contract of read.value.contracts) {
    const current = contract?.current;
    const level = current?.status === 'active' ? 1 : current?.status === 'proposed' ? 0.5 : 0;
    if (!level || !Array.isArray(current.evidence)) continue;
    for (const reference of current.evidence) {
      if (typeof reference !== 'string') continue;
      const clean = reference
        .replaceAll('\\', '/')
        .replace(/#.*$/, '')
        .replace(/:\d+(?::\d+)?$/, '')
        .replace(/^\.\//, '');
      if (clean) covering.push({ path: clean.replace(/\/+$/, ''), directory: clean.endsWith('/'), level });
    }
  }
  return file =>
    covering.reduce(
      (best, item) => (file === item.path || file.startsWith(`${item.path}/`) ? Math.max(best, item.level) : best),
      0,
    );
}

/** D-3: true when the active spec's latest verification passed and its HMAC attestation verifies. */
async function attestedPass(root) {
  const manifest = readJson(root, 'specs/manifest.json').value;
  const slug = manifest?.active_spec;
  if (typeof slug !== 'string' || !/^\d+-[a-z0-9_-]+$/.test(slug)) return false;
  const record = readJson(root, `specs/${slug}/verification.json`).value;
  if (record?.version !== 4 || record.passed !== true || record.mode !== 'automated') return false;
  try {
    verifyRecord(await getAttestationKey(), record);
    return true;
  } catch {
    return false;
  }
}

const round = value => Number(value.toFixed(2));
const byDistanceThenPath = (a, b) => a.distance - b.distance || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * Evaluates the blast radius of `targets` over an indexed graph.
 * @param {string} root
 * @param {import('../memory.mjs').Memory} memory
 * @param {(string|{path: string, symbols?: string[]|null})[]} targets Project-relative POSIX paths.
 * @param {{maxDepth?: number, rowBudget?: number}} [options]
 */
export async function evaluateBlastRadius(root, memory, targets, options = {}) {
  const maxDepth = options.maxDepth ?? CARTOGRAPHY_DEFAULTS.maxDepth;
  const rowBudget = options.rowBudget ?? CARTOGRAPHY_DEFAULTS.rowBudget;
  const { db } = memory;
  const globalWarnings = new Set();
  const contractLevel = contractLevels(root, globalWarnings);
  let attested = null;
  const resolver = createResolver(root);
  const rootChain = new Set(resolver.rootConfigChain());
  const totalNodes = db.prepare('SELECT count(*) AS n FROM modules_graph').get().n;

  const nodeOf = db.prepare('SELECT language, node_type, has_opaque_deps FROM modules_graph WHERE module_path = ?');
  const importersOf = db.prepare(`SELECT source_module, edge_type, symbols_json FROM module_dependencies
    WHERE target_module = ? AND target_kind = 'internal' AND source_module <> target_module ORDER BY source_module`);
  const routesFrom = db.prepare(`SELECT barrel_path, exported_symbol, source_symbol FROM barrel_symbol_routes
    WHERE source_module = ? ORDER BY barrel_path, exported_symbol`);
  const packageConsumer = db.prepare(`SELECT 1 FROM module_dependencies WHERE target_kind = 'internal'
    AND substr(target_module, 1, length(:prefix)) = :prefix AND substr(source_module, 1, length(:prefix)) <> :prefix LIMIT 1`);
  const opaque = path => nodeOf.get(path)?.has_opaque_deps === 1;

  const isRootAnchor = path => {
    if (ROOT_ANCHOR_FILES.includes(path) || rootChain.has(path)) return true;
    if (!path.endsWith('/package.json')) return false;
    return Boolean(packageConsumer.get({ prefix: path.slice(0, -'package.json'.length) }));
  };

  const files = [];
  const union = new Set();
  let truncatedAny = false;
  let overallRaw = 0;
  for (const target of targets) {
    const { path, symbols } = parseTarget(target);
    const delta = symbols ? new Set(symbols) : null;
    const node = nodeOf.get(path);
    const warnings = new Set();
    const consumes = list => delta === null || list.includes('*') || list.some(symbol => delta.has(symbol));
    const impacted = new Map();
    const record = (consumer, distance, edgeType) => {
      if (consumer === path) return;
      const edgeClass = edgeType === 'type_only' ? 'type_only' : 'value';
      const known = impacted.get(consumer);
      if (!known) impacted.set(consumer, { path: consumer, distance, edgeClass, edgeType });
      else {
        if (distance < known.distance) Object.assign(known, { distance, edgeType });
        if (edgeClass === 'value') known.edgeClass = 'value';
      }
    };

    // 1. Direct importers that consume a changed symbol.
    const direct = importersOf.all(path);
    for (const edge of direct)
      if (consumes(JSON.parse(edge.symbols_json))) record(edge.source_module, 1, edge.edge_type);

    // 2. Barrels that re-export a changed symbol, and the importers of those re-exported names.
    const exposed = new Map();
    for (const route of routesFrom.all(path))
      if (delta === null || route.source_symbol === '*' || delta.has(route.source_symbol)) {
        if (!exposed.has(route.barrel_path)) exposed.set(route.barrel_path, new Set());
        exposed.get(route.barrel_path).add(route.exported_symbol);
      }
    const barrelDistance = new Map();
    const distanceOf = (barrel, visiting = new Set()) => {
      if (barrelDistance.has(barrel)) return barrelDistance.get(barrel);
      if (visiting.has(barrel)) return Number.POSITIVE_INFINITY;
      visiting.add(barrel);
      let best = direct.some(edge => edge.source_module === barrel) ? 1 : Number.POSITIVE_INFINITY;
      for (const other of exposed.keys())
        if (other !== barrel && importersOf.all(other).some(edge => edge.source_module === barrel))
          best = Math.min(best, distanceOf(other, visiting) + 1);
      visiting.delete(barrel);
      barrelDistance.set(barrel, best);
      return best;
    };
    for (const [barrel, names] of exposed) {
      const distance = Number.isFinite(distanceOf(barrel)) ? distanceOf(barrel) : 1;
      record(barrel, distance, 'value');
      for (const edge of importersOf.all(barrel)) {
        const list = JSON.parse(edge.symbols_json);
        if (list.includes('*') || list.some(symbol => names.has(symbol)))
          record(edge.source_module, distance + 1, edge.edge_type);
      }
    }

    // 3. File-level propagation from every impacted non-barrel module.
    const seeds = [...impacted.values()]
      .filter(item => !exposed.has(item.path))
      .map(({ path: seedPath, distance, edgeClass }) => ({ path: seedPath, distance, edgeClass }));
    const walk = propagateFrom(memory, path, seeds, { maxDepth, rowBudget });
    for (const consumer of walk.consumers)
      record(consumer.path, consumer.distance, consumer.edgeClass === 'value' ? 'transitive' : 'type_only');
    for (const consumer of walk.consumers) {
      const item = impacted.get(consumer.path);
      if (item && consumer.edgeClass === 'value') item.edgeClass = 'value';
    }
    if (walk.truncated) {
      warnings.add('TRUNCATED');
      truncatedAny = true;
    }

    const all = [...impacted.values()].sort(byDistanceThenPath);
    const consumers = all.filter(item => !isTestModule(item.path));
    const tests = all.filter(item => isTestModule(item.path)).map(item => item.path);
    const directTests = direct.filter(edge => isTestModule(edge.source_module));
    const runtimeImporters = new Set(
      direct
        .filter(edge => edge.edge_type !== 'type_only' && !isTestModule(edge.source_module))
        .map(edge => edge.source_module),
    );
    const centrality = totalNodes > 1 ? runtimeImporters.size / (totalNodes - 1) : 0;
    if (directTests.length && attested === null) attested = await attestedPass(root);
    const testCoverage = directTests.length ? (attested ? 1 : 0.5) : 0;
    const edgeClass = consumers.some(item => item.edgeClass === 'value') || !consumers.length ? 'value' : 'type_only';
    const inputs = {
      k: consumers.length,
      omega: edgeClass === 'value' ? RISK_WEIGHTS.omegaValue : RISK_WEIGHTS.omegaTypeOnly,
      centrality,
      testCoverage,
      contractLevel: contractLevel(path),
    };

    const rootAnchor = isRootAnchor(path);
    const indexed = Boolean(node);
    const notIndexed = !indexed && !direct.length && !rootAnchor;
    if (notIndexed) warnings.add('NOT_INDEXED');
    if (node?.language === 'asset' && !direct.length) warnings.add('UNBRIDGED_ASSET');
    if (opaque(path) || consumers.some(item => opaque(item.path))) warnings.add('UNCERTAIN_DEPENDENCY_RISK');
    const raw = notIndexed
      ? 0
      : scoreRisk({
          impactedConsumers: inputs.k,
          edgeClass,
          centrality: inputs.centrality,
          testCoverage: inputs.testCoverage,
          contractLevel: inputs.contractLevel,
          rootAnchor,
        });
    overallRaw = Math.max(overallRaw, raw);
    for (const item of consumers) union.add(item.path);
    files.push({
      file: path,
      symbols: symbols ?? null,
      indexed,
      rootAnchor,
      nodeType: node?.node_type ?? null,
      score: round(raw),
      ...riskLevel(raw),
      inputs,
      impactedConsumers: consumers,
      tests,
      warnings: [...warnings].sort(),
    });
  }
  return {
    schemaVersion: 1,
    maxDepth,
    overall: { score: round(overallRaw), ...riskLevel(overallRaw) },
    consumers: [...union].sort(),
    warnings: [...globalWarnings].sort(),
    truncated: truncatedAny,
    files,
  };
}

/** D-6: refreshes the index incrementally (about one stat per file), then evaluates. */
export async function checkBlastRadius(root, memory, targets, options = {}) {
  indexRepository(root, memory);
  return evaluateBlastRadius(root, memory, targets, options);
}
