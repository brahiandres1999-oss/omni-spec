/**
 * Module graph for brownfield cartography (blueprint §4.3.3-§4.3.5): single-threaded streaming
 * indexer into specs/.omni/memory.db (batched BEGIN IMMEDIATE writes, mtime/size/hash incremental
 * cache), recursive SQLite CTE with a cycle guard, and lexical barrel unwinding.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { listProjectFiles } from './files.mjs';
import { detectLanguage, scanModule } from './lexer.mjs';
import { createResolver, globToRegExp, isResolutionConfig } from './resolver.mjs';

export const CARTOGRAPHY_DEFAULTS = Object.freeze({
  batchSize: 250,
  maxFileBytes: 1024 * 1024,
  maxDepth: 3,
  rowBudget: 200_000,
});

const ORM_CLIENTS = ['@prisma/client', 'drizzle-orm', 'knex', 'typeorm', 'sequelize', 'kysely', '@mikro-orm/core'];
/** Non-JS assets connected to the modules that consume them through generated clients. */
export const DEFAULT_BRIDGES = Object.freeze([
  Object.freeze({ asset: '**/*.prisma', consumers: Object.freeze(['@prisma/client']) }),
  Object.freeze({ asset: '**/migrations/**/*.sql', consumers: Object.freeze(ORM_CLIENTS) }),
]);

const UNREADABLE = new Set(['EACCES', 'EPERM', 'EBUSY', 'ENOENT', 'EISDIR']);
const SEPARATOR = '\u001f';
const sha256 = data => createHash('sha256').update(data).digest('hex');
const countLines = text => {
  if (!text) return 0;
  let lines = 1;
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) lines++;
  return lines;
};

function readManifestBridges(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(join(root, 'specs', 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
    const bridges = manifest?.cartography?.bridges;
    if (!Array.isArray(bridges)) return [];
    return bridges
      .filter(bridge => bridge && typeof bridge.asset === 'string')
      .map(bridge => ({
        asset: bridge.asset,
        consumers: (Array.isArray(bridge.consumers) ? bridge.consumers : [bridge.consumers]).filter(
          consumer => typeof consumer === 'string' && consumer,
        ),
      }));
  } catch {
    return [];
  }
}

/**
 * Compact storage of import records in modules_graph.dependencies_json: defaults are omitted,
 * identity bindings are implied by the symbols, and duplicate records collapse. Rows stay small,
 * so rewriting a node (classification, re-resolution) does not rewrite kilobytes of JSON.
 */
function encodeImports(records) {
  const seen = new Map();
  for (const record of records) {
    const item = { s: record.specifier, k: record.kind, y: record.symbols };
    if (record.edgeType !== 'value') item.e = record.edgeType;
    if (record.typeOnlySymbols?.length) item.t = record.typeOnlySymbols;
    const renamed = (record.bindings ?? []).filter(binding => binding.local !== binding.imported);
    if (renamed.length) item.b = renamed.map(binding => [binding.imported, binding.local]);
    if (record.level) item.l = record.level;
    if (record.wildcard) item.w = 1;
    if (record.static) item.st = 1;
    if (record.resolved?.length) item.r = record.resolved;
    const key = JSON.stringify(item);
    if (!seen.has(key)) seen.set(key, item);
  }
  return JSON.stringify([...seen.values()]);
}

function decodeImports(json) {
  return JSON.parse(json ?? '[]').map(item => {
    const renamed = new Map((item.b ?? []).map(([imported, local]) => [imported, local]));
    const bindings = item.y
      .filter(symbol => symbol !== '*' || renamed.has('*'))
      .map(symbol => ({ imported: symbol, local: renamed.get(symbol) ?? symbol }));
    return {
      specifier: item.s,
      kind: item.k,
      edgeType: item.e ?? 'value',
      symbols: item.y,
      typeOnlySymbols: item.t ?? [],
      bindings,
      level: item.l ?? 0,
      wildcard: Boolean(item.w),
      static: Boolean(item.st),
      resolved: item.r ?? [],
    };
  });
}

const encodeExports = scan =>
  JSON.stringify({
    exports: scan.exports.map(item =>
      item.local && item.local !== item.name ? [item.name, item.kind, item.local] : [item.name, item.kind],
    ),
    reexports: scan.reexports.map(({ specifier, symbols, namespace }) => ({ specifier, symbols, namespace })),
  });

function decodeExports(json) {
  const { exports = [], reexports = [] } = JSON.parse(json ?? '{}');
  return { exports: exports.map(([name, kind, local]) => ({ name, kind, local: local ?? name })), reexports };
}

/** Groups resolved imports of one module into typed edges keyed by (target, edge type). */
function buildEdges(path, language, imports, resolver) {
  const edges = new Map();
  const resolvedImports = [];
  const add = (target, kind, edgeType, symbols) => {
    const key = `${target}\u0000${edgeType}`;
    const edge = edges.get(key) ?? { target, kind, edgeType, symbols: new Set() };
    for (const symbol of symbols) edge.symbols.add(symbol);
    edges.set(key, edge);
  };
  for (const record of imports) {
    const results = resolver.resolveImport(record, path, language);
    const internalTargets = [];
    for (const result of results) {
      const target =
        result.kind === 'internal' ? result.path : result.kind === 'external' ? result.name : result.specifier;
      if (result.kind === 'internal') {
        if (target === path) continue;
        internalTargets.push(target);
      }
      const typeOnly = new Set(record.typeOnlySymbols);
      if (record.edgeType === 'type_only') add(target, result.kind, 'type_only', record.symbols);
      else {
        const value = record.symbols.filter(symbol => !typeOnly.has(symbol));
        add(target, result.kind, 'value', value.length ? value : ['*']);
        if (typeOnly.size) add(target, result.kind, 'type_only', [...typeOnly]);
      }
    }
    resolvedImports.push({ ...record, resolved: internalTargets });
  }
  return {
    resolvedImports,
    edges: [...edges.values()]
      .map(edge => ({ ...edge, symbols: [...edge.symbols].sort() }))
      .sort((a, b) => (a.target === b.target ? a.edgeType.localeCompare(b.edgeType) : a.target < b.target ? -1 : 1)),
  };
}

/**
 * Indexes (or incrementally refreshes) the module graph of `root` into `memory`.
 * @param {string} root
 * @param {import('../memory.mjs').Memory} memory
 * @param {{batchSize?: number, maxFileBytes?: number, readFile?: (path: string) => Buffer,
 *   onBatch?: (info: {batch: number, committed: number}) => void, bridges?: {asset: string, consumers: string[]}[]}} [options]
 */
export function indexRepository(root, memory, options = {}) {
  const started = performance.now();
  const batchSize = options.batchSize ?? CARTOGRAPHY_DEFAULTS.batchSize;
  const maxFileBytes = options.maxFileBytes ?? CARTOGRAPHY_DEFAULTS.maxFileBytes;
  const customRead = options.readFile;
  // A file with no row yet is opened once: fstat on the descriptor replaces a separate stat call,
  // which matters on Windows where every path lookup pays the antivirus filter.
  const readNew = absolute => {
    const fd = fs.openSync(absolute, 'r');
    try {
      const stat = fs.fstatSync(fd);
      const meta = { mtime: Math.floor(stat.mtimeMs), size: stat.size };
      if (stat.size > maxFileBytes) return { ...meta, tooLarge: true };
      const buffer = Buffer.allocUnsafe(stat.size);
      let offset = 0;
      while (offset < stat.size) {
        const read = fs.readSync(fd, buffer, offset, stat.size - offset, offset);
        if (!read) break;
        offset += read;
      }
      return { ...meta, buffer: offset === stat.size ? buffer : buffer.subarray(0, offset) };
    } finally {
      fs.closeSync(fd);
    }
  };
  const { db } = memory;

  const files = listProjectFiles(root);
  const sources = files.filter(path => detectLanguage(path));
  const bridges = [...DEFAULT_BRIDGES, ...(options.bridges ?? readManifestBridges(root))];
  const bridgeRules = bridges.map(bridge => ({ regex: globToRegExp(bridge.asset), consumers: bridge.consumers }));
  const assets = files.filter(path => !detectLanguage(path) && bridgeRules.some(rule => rule.regex.test(path)));
  const resolver = createResolver(root, { files });

  // Re-resolve every module when the file set or any resolution config changes.
  const fingerprint = createHash('sha256');
  fingerprint.update(files.join('\n'));
  for (const path of files)
    if (isResolutionConfig(path)) {
      try {
        fingerprint.update(`\n${path}\n`).update(fs.readFileSync(join(root, ...path.split('/'))));
      } catch {
        fingerprint.update(`\n${path}\nunreadable`);
      }
    }
  fingerprint.update(JSON.stringify(bridges));
  const resolution = fingerprint.digest('hex');
  const previousResolution = db.prepare("SELECT value FROM cartography_state WHERE key = 'resolution'").get()?.value;
  const reresolveAll = previousResolution !== resolution;

  const existing = new Map(
    db
      .prepare('SELECT module_path, language, mtime_ms, size_bytes, content_hash FROM modules_graph')
      .all()
      .map(row => [row.module_path, row]),
  );
  const storedImports = db.prepare('SELECT dependencies_json FROM modules_graph WHERE module_path = ?');
  const upsertNode =
    db.prepare(`INSERT INTO modules_graph (module_path, framework, loc, exports_json, dependencies_json,
      last_analyzed_at, language, node_type, content_hash, mtime_ms, size_bytes, has_opaque_deps)
    VALUES (?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    ON CONFLICT(module_path) DO UPDATE SET loc = excluded.loc, exports_json = excluded.exports_json,
      dependencies_json = excluded.dependencies_json, last_analyzed_at = excluded.last_analyzed_at,
      language = excluded.language, content_hash = excluded.content_hash, mtime_ms = excluded.mtime_ms,
      size_bytes = excluded.size_bytes, has_opaque_deps = excluded.has_opaque_deps`);
  const touchNode = db.prepare('UPDATE modules_graph SET mtime_ms = ?, size_bytes = ? WHERE module_path = ?');
  const updateImports = db.prepare('UPDATE modules_graph SET dependencies_json = ? WHERE module_path = ?');
  const deleteEdges = db.prepare(
    "DELETE FROM module_dependencies WHERE source_module = ? AND edge_type <> 'synthetic'",
  );
  // One statement per module: json_each expands its edges, so a 4,000-file index runs ~4,000
  // inserts instead of one per edge.
  const insertEdges = db.prepare(`INSERT OR REPLACE INTO module_dependencies
    (source_module, target_module, edge_type, target_kind, symbols_json)
    SELECT ?, value ->> '$[0]', value ->> '$[1]', value ->> '$[2]', value ->> '$[3]' FROM json_each(?)`);
  const deleteNode = db.prepare('DELETE FROM modules_graph WHERE module_path = ?');

  const report = {
    files: sources.length,
    parsed: 0,
    rehashed: 0,
    unchanged: 0,
    removed: 0,
    skipped: [],
    batches: 0,
    incremental: existing.size > 0,
    warnings: resolver.warnings,
  };
  const seen = new Set();
  const now = new Date().toISOString();
  let committed = 0;
  let graphChanged = reresolveAll;

  const writeEdges = (path, edges, isNew = false) => {
    if (!isNew) deleteEdges.run(path);
    if (edges.length)
      insertEdges.run(
        path,
        JSON.stringify(edges.map(edge => [edge.target, edge.edgeType, edge.kind, JSON.stringify(edge.symbols)])),
      );
  };

  // Each file is read, parsed and written inside its batch transaction, so parse results never
  // accumulate across files (they die young, which keeps the V8 heap and the RSS flat).
  const processFile = (item, outcome) => {
    const { path, absolute, language, previous } = item;
    let { mtime, size } = item;
    if (item.unchanged) {
      reresolve(path, language);
      return;
    }
    let buffer;
    try {
      if (item.fresh) {
        const read = readNew(absolute);
        ({ mtime, size } = read);
        if (read.tooLarge) {
          outcome.skipped.push({ path, reason: 'too-large' });
          return;
        }
        buffer = read.buffer;
      } else buffer = customRead ? customRead(absolute) : fs.readFileSync(absolute);
    } catch (error) {
      if (!UNREADABLE.has(error.code)) throw error;
      outcome.skipped.push({ path, reason: 'unreadable' });
      return;
    }
    if (buffer.includes(0)) {
      outcome.skipped.push({ path, reason: 'binary' });
      return;
    }
    outcome.seen.push(path);
    const hash = sha256(buffer);
    if (previous && previous.content_hash === hash && previous.language === language) {
      outcome.rehashed++;
      touchNode.run(mtime, size, path);
      if (reresolveAll) reresolve(path, language);
      return;
    }
    const text = buffer.toString('utf8');
    const scan = scanModule(text, { language });
    outcome.parsed++;
    const { edges, resolvedImports } = buildEdges(path, language, scan.imports, resolver);
    upsertNode.run(
      path,
      countLines(text),
      encodeExports(scan),
      encodeImports(resolvedImports),
      now,
      language,
      hash,
      mtime,
      size,
      scan.hasOpaqueDependencies ? 1 : 0,
    );
    writeEdges(path, edges, !previous);
  };
  const reresolve = (path, language) => {
    const imports = decodeImports(storedImports.get(path)?.dependencies_json);
    const { edges, resolvedImports } = buildEdges(path, language, imports, resolver);
    updateImports.run(encodeImports(resolvedImports), path);
    writeEdges(path, edges);
  };

  for (let offset = 0; offset < sources.length; offset += batchSize) {
    const work = [];
    for (const path of sources.slice(offset, offset + batchSize)) {
      const absolute = join(root, ...path.split('/'));
      const language = detectLanguage(path);
      const previous = existing.get(path);
      if (!previous && !customRead) {
        work.push({ path, absolute, language, previous, fresh: true });
        continue;
      }
      let stat;
      try {
        stat = fs.statSync(absolute);
      } catch (error) {
        if (!UNREADABLE.has(error.code)) throw error;
        report.skipped.push({ path, reason: 'unreadable' });
        continue;
      }
      if (stat.size > maxFileBytes) {
        report.skipped.push({ path, reason: 'too-large' });
        continue;
      }
      const mtime = Math.floor(stat.mtimeMs);
      const unchanged =
        previous && previous.mtime_ms === mtime && previous.size_bytes === stat.size && previous.language === language;
      if (unchanged) {
        seen.add(path);
        report.unchanged++;
        if (!reresolveAll) continue;
      }
      work.push({ path, absolute, language, previous, mtime, size: stat.size, unchanged });
    }
    if (!work.length) continue;
    graphChanged = true;
    // Counters are merged only after COMMIT, so a retried transaction never double-counts.
    const outcome = memory.write(() => {
      const result = { parsed: 0, rehashed: 0, skipped: [], seen: [] };
      for (const item of work) processFile(item, result);
      return result;
    });
    report.parsed += outcome.parsed;
    report.rehashed += outcome.rehashed;
    report.skipped.push(...outcome.skipped);
    for (const path of outcome.seen) seen.add(path);
    report.batches++;
    committed = db.prepare('SELECT count(*) AS n FROM modules_graph').get().n;
    options.onBatch?.({ batch: report.batches, committed });
  }
  report.skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const removed = [...existing.keys()].filter(path => !seen.has(path) && !assets.includes(path));
  report.removed = removed.filter(path => existing.get(path).language !== 'asset').length;
  if (removed.length || graphChanged || assets.length) {
    memory.write(() => {
      for (const path of removed) deleteNode.run(path);
      refreshBridges(db, assets, bridgeRules, now);
      classifyNodes(db);
      rebuildBarrelRoutes(db);
      db.prepare(
        "INSERT INTO cartography_state (key, value) VALUES ('resolution', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(resolution);
    });
  }
  report.nodes = db.prepare('SELECT count(*) AS n FROM modules_graph').get().n;
  report.edges = db.prepare('SELECT count(*) AS n FROM module_dependencies').get().n;
  report.durationMs = performance.now() - started;
  return report;
}

/** Asset nodes plus synthetic edges from every module that imports one of the bridge's clients. */
function refreshBridges(db, assets, bridgeRules, now) {
  db.exec("DELETE FROM module_dependencies WHERE edge_type = 'synthetic'");
  const upsertAsset = db.prepare(`INSERT INTO modules_graph (module_path, last_analyzed_at, language, has_opaque_deps)
    VALUES (?, ?, 'asset', 0) ON CONFLICT(module_path) DO NOTHING`);
  const consumersOf = db.prepare(`SELECT DISTINCT source_module FROM module_dependencies
    WHERE target_kind = 'external' AND (target_module = ? OR target_module LIKE ? ESCAPE '\\') ORDER BY source_module`);
  const insert = db.prepare(`INSERT OR IGNORE INTO module_dependencies
    (source_module, target_module, edge_type, target_kind, symbols_json) VALUES (?, ?, 'synthetic', 'internal', '["*"]')`);
  db.exec("DELETE FROM modules_graph WHERE language = 'asset'");
  for (const asset of assets) {
    upsertAsset.run(asset, now);
    for (const rule of bridgeRules) {
      if (!rule.regex.test(asset)) continue;
      for (const client of rule.consumers) {
        const like = `${client.replace(/[\\%_]/g, '\\$&')}/%`;
        for (const { source_module: source } of consumersOf.all(client, like)) insert.run(source, asset);
      }
    }
  }
}

/** Core (d_in >= 20, d_out <= 3), leaf (d_in <= 1) or domain, over distinct internal neighbours. */
function classifyNodes(db) {
  db.exec(`WITH edges AS MATERIALIZED (
      SELECT DISTINCT source_module, target_module FROM module_dependencies
      WHERE target_kind = 'internal' AND source_module <> target_module
    ),
    degrees AS (
      SELECT path, sum(din) AS din, sum(dout) AS dout FROM (
        SELECT target_module AS path, 1 AS din, 0 AS dout FROM edges
        UNION ALL SELECT source_module, 0, 1 FROM edges
      ) GROUP BY path
    ),
    desired AS (
      SELECT m.module_path AS path, CASE
        WHEN coalesce(d.din, 0) >= 20 AND coalesce(d.dout, 0) <= 3 THEN 'core'
        WHEN coalesce(d.din, 0) <= 1 THEN 'leaf'
        ELSE 'domain' END AS node_type
      FROM modules_graph m LEFT JOIN degrees d ON d.path = m.module_path
    )
    UPDATE modules_graph SET node_type = desired.node_type FROM desired
    WHERE desired.path = modules_graph.module_path AND modules_graph.node_type IS NOT desired.node_type;`);
}

/**
 * Lexical barrel unwinding: for every module that re-exports, the real origin of each exported
 * symbol, following chained barrels and `export *` (cycle-safe; local exports shadow stars;
 * conflicting stars are kept as ambiguous routes to every origin).
 */
function rebuildBarrelRoutes(db) {
  // Only re-exporting modules are loaded eagerly; the modules they point at load on demand, so a
  // large repository never materialises every module's import list at once.
  const select = db.prepare('SELECT exports_json, dependencies_json FROM modules_graph WHERE module_path = ?');
  const cache = new Map();
  const load = path => {
    if (cache.has(path)) return cache.get(path);
    const row = select.get(path);
    let module = null;
    if (row) {
      const { exports, reexports } = decodeExports(row.exports_json);
      const imports = decodeImports(row.dependencies_json);
      const targetOf = specifier =>
        imports.find(item => item.specifier === specifier && item.resolved?.length)?.resolved[0] ?? null;
      const bindings = new Map();
      for (const item of imports)
        if (item.resolved?.length)
          for (const binding of item.bindings ?? [])
            bindings.set(binding.local, { source: item.resolved[0], imported: binding.imported });
      module = {
        local: new Set(
          exports.filter(item => item.kind !== 'named' || !bindings.has(item.local)).map(item => item.name),
        ),
        forwarded: exports
          .filter(item => item.kind === 'named' && bindings.has(item.local))
          .map(item => ({ exported: item.name, ...bindings.get(item.local) })),
        named: reexports
          .filter(item => Array.isArray(item.symbols))
          .flatMap(item =>
            item.symbols.map(symbol => ({
              exported: symbol.exported,
              imported: symbol.imported,
              source: targetOf(item.specifier),
            })),
          )
          .filter(item => item.source),
        namespaces: reexports
          .filter(item => item.symbols === '*' && item.namespace)
          .map(item => ({ exported: item.namespace, source: targetOf(item.specifier) }))
          .filter(item => item.source),
        stars: reexports
          .filter(item => item.symbols === '*' && !item.namespace)
          .map(item => targetOf(item.specifier))
          .filter(Boolean),
      };
    }
    cache.set(path, module);
    return module;
  };
  const modules = { get: load };
  const barrels = db
    .prepare(
      `SELECT module_path FROM modules_graph WHERE language <> 'asset'
        AND (exports_json LIKE '%"reexports":[{%' OR exports_json LIKE '%,"named"%') ORDER BY module_path`,
    )
    .all()
    .map(row => row.module_path);

  /** Names a module exports, expanding stars (never `default`). */
  const exportedNames = (path, visiting = new Set()) => {
    const module = modules.get(path);
    if (!module || visiting.has(path)) return new Set();
    visiting.add(path);
    const names = new Set([
      ...module.local,
      ...module.forwarded.map(item => item.exported),
      ...module.named.map(item => item.exported),
    ]);
    for (const item of module.namespaces) names.add(item.exported);
    for (const star of module.stars)
      for (const name of exportedNames(star, visiting)) if (name !== 'default') names.add(name);
    visiting.delete(path);
    return names;
  };
  /** Origins of `name` exported by `path`: [{source, symbol}] (several when ambiguous). */
  const origins = (path, name, visiting = new Set()) => {
    const module = modules.get(path);
    const key = `${path}${SEPARATOR}${name}`;
    if (!module || visiting.has(key)) return [];
    visiting.add(key);
    try {
      if (module.local.has(name)) return [{ source: path, symbol: name }];
      const forwarded = [...module.forwarded, ...module.named].find(item => item.exported === name);
      if (forwarded) {
        const deeper = origins(forwarded.source, forwarded.imported, visiting);
        return deeper.length ? deeper : [{ source: forwarded.source, symbol: forwarded.imported }];
      }
      const namespace = module.namespaces.find(item => item.exported === name);
      if (namespace) return [{ source: namespace.source, symbol: '*' }];
      if (name === 'default') return [];
      const found = new Map();
      for (const star of module.stars)
        for (const origin of origins(star, name, visiting))
          found.set(`${origin.source}${SEPARATOR}${origin.symbol}`, origin);
      return [...found.values()];
    } finally {
      visiting.delete(key);
    }
  };

  db.exec('DELETE FROM barrel_symbol_routes');
  const insert = db.prepare(`INSERT OR IGNORE INTO barrel_symbol_routes
    (barrel_path, exported_symbol, source_module, source_symbol, is_reexport, ambiguous) VALUES (?, ?, ?, ?, 1, ?)`);
  for (const path of barrels) {
    const module = load(path);
    if (!module.forwarded.length && !module.named.length && !module.namespaces.length && !module.stars.length) continue;
    for (const name of exportedNames(path)) {
      if (module.local.has(name)) continue;
      const list = origins(path, name).filter(origin => origin.source !== path);
      for (const origin of list) insert.run(path, name, origin.source, origin.symbol, list.length > 1 ? 1 : 0);
    }
  }
}

const RECURSIVE_STEP = `
  UNION ALL
  SELECT md.source_module, br.depth + 1,
    CASE WHEN br.edge_class = 'type_only' OR md.edge_type = 'type_only' THEN 'type_only' ELSE 'value' END,
    br.visited_path || md.source_module || char(31)
  FROM br JOIN module_dependencies md ON md.target_module = br.file_path AND md.target_kind = 'internal'
  WHERE br.depth < :maxDepth
    AND instr(br.visited_path, char(31) || md.source_module || char(31)) = 0
  LIMIT :budget
)
SELECT file_path AS path, min(depth) AS distance,
  CASE WHEN max(edge_class = 'value') = 1 THEN 'value' ELSE 'type_only' END AS edgeClass,
  count(*) AS rowCount
FROM br GROUP BY file_path ORDER BY distance, path`;

// Cycle guard (D-1): the blueprint's visited_path accumulator, checked with instr() instead of
// LIKE so `_` and `%` in paths are not wildcards, and delimited by U+001F instead of commas.
const REVERSE_SQL = `WITH RECURSIVE br(file_path, depth, edge_class, visited_path) AS (
  SELECT source_module, 1, CASE WHEN edge_type = 'type_only' THEN 'type_only' ELSE 'value' END,
    char(31) || :target || char(31) || source_module || char(31)
  FROM module_dependencies
  WHERE target_module = :target AND target_kind = 'internal' AND source_module <> :target
  ${RECURSIVE_STEP}`;

const SEEDED_SQL = `WITH RECURSIVE br(file_path, depth, edge_class, visited_path) AS (
  SELECT json_extract(value, '$.path'), json_extract(value, '$.distance'), json_extract(value, '$.edgeClass'),
    char(31) || :target || char(31) || json_extract(value, '$.path') || char(31)
  FROM json_each(:seeds)
  ${RECURSIVE_STEP}`;

function checkDepth(maxDepth) {
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 64)
    throw new RangeError('maxDepth must be an integer from 1 to 64.');
}
const collect = (rows, budget) => ({
  consumers: rows.map(({ path, distance, edgeClass }) => ({ path, distance, edgeClass })),
  truncated: rows.reduce((sum, row) => sum + row.rowCount, 0) >= budget,
});

/**
 * Transitive importers of `target` (reverse dependencies) through internal edges.
 * @returns {{consumers: {path: string, distance: number, edgeClass: 'value'|'type_only'}[], truncated: boolean}}
 */
export function reverseDependencies(
  memory,
  target,
  { maxDepth = CARTOGRAPHY_DEFAULTS.maxDepth, rowBudget = CARTOGRAPHY_DEFAULTS.rowBudget } = {},
) {
  checkDepth(maxDepth);
  return collect(memory.db.prepare(REVERSE_SQL).all({ target, maxDepth, budget: rowBudget }), rowBudget);
}

/** Like reverseDependencies, but the walk starts from given seeds instead of every direct importer. */
export function propagateFrom(
  memory,
  target,
  seeds,
  { maxDepth = CARTOGRAPHY_DEFAULTS.maxDepth, rowBudget = CARTOGRAPHY_DEFAULTS.rowBudget } = {},
) {
  checkDepth(maxDepth);
  if (!seeds.length) return { consumers: [], truncated: false };
  return collect(
    memory.db.prepare(SEEDED_SQL).all({ target, seeds: JSON.stringify(seeds), maxDepth, budget: rowBudget }),
    rowBudget,
  );
}

/** Barrel routes of one module, ordered by exported symbol and origin. */
export function barrelRoutes(memory, barrel) {
  return memory.db
    .prepare(`SELECT exported_symbol, source_module, source_symbol, is_reexport, ambiguous FROM barrel_symbol_routes
      WHERE barrel_path = ? ORDER BY exported_symbol, source_module`)
    .all(barrel)
    .map(row => ({
      exported: row.exported_symbol,
      source: row.source_module,
      sourceSymbol: row.source_symbol,
      isReexport: row.is_reexport === 1,
      ambiguous: row.ambiguous === 1,
    }));
}

/**
 * Strongly connected components with more than one module (Tarjan, iterative).
 * @param {{limit?: number}} [options] How many components to return as samples.
 */
export function findCycles(memory, { limit = 10 } = {}) {
  const adjacency = new Map();
  for (const { source_module: source, target_module: target } of memory.db
    .prepare(`SELECT DISTINCT source_module, target_module FROM module_dependencies
      WHERE target_kind = 'internal' AND source_module <> target_module ORDER BY 1, 2`)
    .all()) {
    if (!adjacency.has(source)) adjacency.set(source, []);
    adjacency.get(source).push(target);
  }
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let counter = 0;
  for (const start of [...adjacency.keys()].sort()) {
    if (index.has(start)) continue;
    const work = [{ node: start, next: 0 }];
    index.set(start, counter);
    low.set(start, counter++);
    stack.push(start);
    onStack.add(start);
    while (work.length) {
      const frame = work[work.length - 1];
      const neighbours = adjacency.get(frame.node) ?? [];
      if (frame.next < neighbours.length) {
        const next = neighbours[frame.next++];
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter++);
          stack.push(next);
          onStack.add(next);
          work.push({ node: next, next: 0 });
        } else if (onStack.has(next)) low.set(frame.node, Math.min(low.get(frame.node), index.get(next)));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent), low.get(frame.node)));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        if (component.length > 1) components.push(component.sort());
      }
    }
  }
  components.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { count: components.length, samples: components.slice(0, limit) };
}

/** Aggregate figures for `omni-spec cartography`. */
export function summarizeGraph(memory) {
  const { db } = memory;
  const languages = {};
  for (const row of db
    .prepare(
      "SELECT language, count(*) AS n FROM modules_graph WHERE language <> 'asset' GROUP BY language ORDER BY language",
    )
    .all())
    languages[row.language] = row.n;
  const nodeTypes = { core: 0, domain: 0, leaf: 0 };
  for (const row of db
    .prepare("SELECT node_type, count(*) AS n FROM modules_graph WHERE language <> 'asset' GROUP BY node_type")
    .all())
    if (row.node_type in nodeTypes) nodeTypes[row.node_type] = row.n;
  return {
    nodes: db.prepare('SELECT count(*) AS n FROM modules_graph').get().n,
    edges: db.prepare('SELECT count(*) AS n FROM module_dependencies').get().n,
    languages,
    nodeTypes,
    core: db
      .prepare(
        "SELECT module_path FROM modules_graph WHERE node_type = 'core' AND language <> 'asset' ORDER BY module_path",
      )
      .all()
      .map(row => row.module_path),
    cycles: findCycles(memory),
  };
}
