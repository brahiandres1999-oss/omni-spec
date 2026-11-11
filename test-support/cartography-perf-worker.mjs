// Indexes a repository in a fresh process and prints timings and memory as JSON on stdout.
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { openMemory } from '../src/memory.mjs';
import { indexRepository } from '../src/cartography/graph.mjs';

const [root] = process.argv.slice(2);
const memory = openMemory(join(root, 'specs', '.omni', 'memory.db'));
const baselineRss = process.resourceUsage().maxRSS * 1024;
let start = performance.now();
const cold = indexRepository(root, memory);
const coldMs = performance.now() - start;
const coldMaxRss = process.resourceUsage().maxRSS * 1024;
start = performance.now();
const warm = indexRepository(root, memory);
const warmMs = performance.now() - start;
const nodes = memory.db.prepare('SELECT count(*) AS n FROM modules_graph').get().n;
const edges = memory.db.prepare('SELECT count(*) AS n FROM module_dependencies').get().n;
memory.close();
process.stdout.write(
  JSON.stringify({
    coldMs,
    warmMs,
    baselineRss,
    coldMaxRss,
    files: cold.files,
    parsed: cold.parsed,
    warmParsed: warm.parsed,
    nodes,
    edges,
    skipped: cold.skipped,
  }),
);
