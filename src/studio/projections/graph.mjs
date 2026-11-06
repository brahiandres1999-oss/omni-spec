import { contractLevels, evaluateBlastRadius, normalizeTargets } from '../../cartography/blast-radius.mjs';
import { RISK_WEIGHTS } from '../../cartography/blast-radius.mjs';
import { findCycles, indexRepository } from '../../cartography/graph.mjs';
import { StudioError } from '../protocol.mjs';

/**
 * Cartography Explorer projections (blueprint §4.7.2.2): the module graph with compact integer
 * ids for the canvas, and on-demand heat for one target (D-14). Scoring all nodes at once is
 * deliberately avoided: heat is the blast radius of what the user selected.
 */

const CYCLE_LIMIT = 100;

/**
 * @param {{db: import('node:sqlite').DatabaseSync}} memory
 * @param {{root?: string}} [options] With `root`, contract levels come from specs/contracts.json.
 */
export function projectGraph(memory, { root } = {}) {
  const { db } = memory;
  const rows = db.prepare('SELECT module_path, language, node_type FROM modules_graph ORDER BY module_path').all();
  if (!rows.length) return { indexed: false, nodes: [], edges: [], cycles: [], cyclesTruncated: false };

  const ids = new Map(rows.map((row, index) => [row.module_path, index]));
  const nodes = rows.map((row, index) => ({
    id: index,
    path: row.module_path,
    language: row.language ?? null,
    nodeType: row.node_type ?? null,
    dIn: 0,
    dOut: 0,
    externalCount: 0,
    unresolvedCount: 0,
    contractLevel: 0,
    isBarrel: false,
  }));
  const edges = [];
  for (const edge of db
    .prepare(
      'SELECT source_module, target_module, edge_type, target_kind FROM module_dependencies ORDER BY source_module, target_module, edge_type',
    )
    .all()) {
    const source = nodes[ids.get(edge.source_module)];
    if (!source) continue;
    if (edge.target_kind === 'external') source.externalCount++;
    else if (edge.target_kind === 'unresolved') source.unresolvedCount++;
    else if (ids.has(edge.target_module)) {
      const target = nodes[ids.get(edge.target_module)];
      source.dOut++;
      target.dIn++;
      edges.push({ s: source.id, t: target.id, type: edge.edge_type });
    }
  }
  for (const { barrel_path: barrel } of db.prepare('SELECT DISTINCT barrel_path FROM barrel_symbol_routes').all())
    if (ids.has(barrel)) nodes[ids.get(barrel)].isBarrel = true;
  if (root) {
    const levelOf = contractLevels(root, new Set());
    for (const node of nodes) node.contractLevel = levelOf(node.path);
  }
  const cycles = findCycles(memory, { limit: CYCLE_LIMIT });
  return { indexed: true, nodes, edges, cycles: cycles.samples, cyclesTruncated: cycles.count > CYCLE_LIMIT };
}

const round = value => Math.round(value * 100) / 100;

/**
 * Heat of one target: its blast radius report spread over the impacted nodes. A node's score is
 * the target's S_risk weighted by the edge class of its path and damped by distance (score / d).
 * @param {string} root
 * @param {{db: import('node:sqlite').DatabaseSync}} memory
 * @param {{target: string, symbols?: string[], depth?: number, refreshIndex?: boolean}} request With
 *   refreshIndex, the index is refreshed incrementally after the target is validated (D-6).
 */
export async function heatFromTarget(root, memory, { target, symbols, depth, refreshIndex = false }) {
  let normalized;
  try {
    [normalized] = normalizeTargets(root, root, [
      symbols?.length ? { path: target, symbols } : target.replaceAll('\\', '/'),
    ]);
  } catch (error) {
    if (error.code === 'PATH_OUTSIDE_ROOT') throw new StudioError('PATH_OUTSIDE_ROOT', error.message);
    throw error;
  }
  if (refreshIndex) indexRepository(root, memory);
  const report = await evaluateBlastRadius(root, memory, [normalized], depth === undefined ? {} : { maxDepth: depth });
  const [file] = report.files;
  const barrels = new Set(
    memory.db
      .prepare('SELECT DISTINCT barrel_path FROM barrel_symbol_routes WHERE source_module = ?')
      .all(file.file)
      .map(row => row.barrel_path),
  );
  const importsOf = memory.db.prepare(
    "SELECT target_module FROM module_dependencies WHERE source_module = ? AND target_kind = 'internal'",
  );
  const nodes = file.impactedConsumers.map(consumer => {
    const omega = consumer.edgeClass === 'type_only' ? RISK_WEIGHTS.omegaTypeOnly : RISK_WEIGHTS.omegaValue;
    const viaBarrel = barrels.has(consumer.path)
      ? null
      : (importsOf
          .all(consumer.path)
          .map(row => row.target_module)
          .find(path => barrels.has(path)) ?? null);
    return {
      path: consumer.path,
      distance: consumer.distance,
      edgeClass: consumer.edgeClass,
      score: round((file.score * omega) / consumer.distance),
      viaBarrel,
    };
  });
  return {
    target: file.file,
    symbols: file.symbols,
    score: file.score,
    level: file.level,
    nodes,
    warnings: file.warnings,
    truncated: report.truncated,
  };
}
