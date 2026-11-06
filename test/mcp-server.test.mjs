import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { decisionFileName, memoryPath, uuidv7 } from '../src/memory.mjs';
import { SPECS_GITIGNORE } from '../src/assets.mjs';

const CLI = fileURLToPath(new URL('../bin/omni-spec.mjs', import.meta.url));
const TOOL_NAMES = ['omni_check_blast_radius', 'omni_get_active_spec', 'omni_record_decision', 'omni_search_context'];

let root;
let servers;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'omni-mcp-'));
  servers = [];
});

afterEach(async () => {
  for (const server of servers) if (server.child.exitCode === null) await server.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function createProject(manifest = { specs: [] }) {
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'mcp-test@example.com');
  git('config', 'user.name', 'MCP Test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  mkdirSync(join(root, 'specs', 'decisions'), { recursive: true });
  writeFileSync(join(root, 'specs', '.gitignore'), SPECS_GITIGNORE + '\n');
  writeFileSync(join(root, 'specs', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  commitAll('init');
}

function commitAll(message) {
  git('add', '-A');
  git('commit', '-q', '-m', message);
}

function startServer(cwd = root) {
  const child = spawn(process.execPath, [CLI, 'mcp'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  const pending = new Map();
  let stderr = '';
  let nextId = 1;
  createInterface({ input: child.stdout }).on('line', line => {
    lines.push(line);
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });
  const exited = new Promise(resolve => child.on('close', resolve));
  const server = {
    child,
    lines,
    exited,
    stderr: () => stderr,
    write: text => child.stdin.write(text + '\n'),
    notify: (method, params) => server.write(JSON.stringify({ jsonrpc: '2.0', method, params })),
    request(method, params) {
      const id = nextId++;
      return new Promise(resolve => {
        pending.set(id, resolve);
        server.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      });
    },
    async call(name, args = {}) {
      return (await server.request('tools/call', { name, arguments: args })).result;
    },
    close() {
      child.stdin.end();
      return exited;
    },
  };
  servers.push(server);
  return server;
}

const payload = result => JSON.parse(result.content[0].text);

describe('omni-spec mcp (JSON-RPC over stdio)', () => {
  test('initialize negotiates the protocol version and advertises tools', async () => {
    createProject();
    const server = startServer();
    const accepted = await server.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });
    assert.equal(accepted.result.protocolVersion, '2025-06-18');
    assert.deepEqual(accepted.result.capabilities, { tools: { listChanged: false } });
    assert.equal(accepted.result.serverInfo.name, 'omni-spec');
    const fallback = await server.request('initialize', { protocolVersion: '1999-01-01', capabilities: {} });
    assert.equal(fallback.result.protocolVersion, '2025-11-25');
  });

  test('tools/list exposes the four §4.2 tools with input schemas', async () => {
    createProject();
    const server = startServer();
    const { result } = await server.request('tools/list');
    assert.deepEqual(result.tools.map(tool => tool.name).sort(), TOOL_NAMES);
    const byName = Object.fromEntries(result.tools.map(tool => [tool.name, tool]));
    assert.deepEqual(byName.omni_search_context.inputSchema.required, ['query']);
    assert.deepEqual(byName.omni_check_blast_radius.inputSchema.required, ['files']);
    assert.deepEqual(byName.omni_record_decision.inputSchema.required, ['topic', 'basis']);
    assert.equal(byName.omni_get_active_spec.inputSchema.type, 'object');
  });

  test('stdout carries only JSON-RPC responses and notifications get none', async () => {
    createProject();
    const server = startServer();
    await server.request('initialize', { protocolVersion: '2025-11-25', capabilities: {} });
    server.notify('notifications/initialized');
    await server.request('ping');
    await server.close();
    assert.equal(server.lines.length, 2);
    for (const line of server.lines) assert.equal(JSON.parse(line).jsonrpc, '2.0');
  });

  test('protocol errors: malformed JSON, unknown method and unknown tool', async () => {
    createProject();
    const server = startServer();
    server.write('{not json');
    const unknownMethod = await server.request('resources/list');
    assert.equal(unknownMethod.error.code, -32601);
    assert.deepEqual(JSON.parse(server.lines[0]).error.code, -32700);
    assert.equal(JSON.parse(server.lines[0]).id, null);
    const unknownTool = await server.request('tools/call', { name: 'omni_nope', arguments: {} });
    assert.equal(unknownTool.error.code, -32602);
  });

  test('omni_record_decision writes the decision and omni_search_context finds it', async () => {
    createProject();
    const server = startServer();
    const recorded = await server.call('omni_record_decision', {
      topic: 'retry-policy',
      basis: 'Antivirus minifilters bypass busy_timeout on Windows.',
      sources: ['docs/OMNI-NEXTGEN-BLUEPRINT.md'],
    });
    assert.equal(recorded.isError, false);
    const decision = payload(recorded);
    assert.ok(existsSync(join(root, decision.file_path)));
    const found = payload(await server.call('omni_search_context', { query: 'minifilters' }));
    assert.equal(found.results[0].source_id, decision.id);
  });

  test('invalid tool arguments are reported as tool errors the agent can correct', async () => {
    createProject();
    const server = startServer();
    const short = await server.call('omni_record_decision', { topic: 'retry-policy', basis: 'too short' });
    assert.equal(short.isError, true);
    assert.match(short.content[0].text, /10 characters/);
    const missing = await server.call('omni_search_context', {});
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /query/);
  });

  test('omni_search_context sees decisions committed after startup', async () => {
    createProject();
    const server = startServer();
    await server.request('ping');
    const id = uuidv7();
    writeFileSync(
      join(root, 'specs', 'decisions', decisionFileName('cache-policy', id)),
      JSON.stringify({
        id,
        topic: 'cache-policy',
        status: 'approved',
        basis: 'Keep memory.db as a disposable cache rebuilt from Git.',
        sources: [],
        recorded_at: '2026-11-05T00:00:00.000Z',
      }),
    );
    commitAll('external decision');
    const found = payload(await server.call('omni_search_context', { query: 'disposable cache' }));
    assert.deepEqual(
      found.results.map(row => row.source_id),
      [id],
    );
  });

  test('omni_get_active_spec returns the active manifest entry and its acceptance record', async () => {
    const spec = { id: '001', slug: '001-memory-core', type: 'feature', status: 'IN_PROGRESS' };
    createProject({ specs: [spec], active_spec: spec.slug });
    mkdirSync(join(root, 'specs', spec.slug));
    const acceptance = { schemaVersion: 2, criteria: [{ id: 'AC-01', status: 'pending' }] };
    writeFileSync(join(root, 'specs', spec.slug, 'acceptance.json'), JSON.stringify(acceptance));
    const server = startServer();
    const active = payload(await server.call('omni_get_active_spec'));
    assert.deepEqual(active, { activeSpec: spec, acceptance });
  });

  const BLAST_FILES = {
    'src/utils.ts': 'export const slugify = s => s;\nexport const formatDate = d => d;',
    'src/a.ts': "import { slugify } from './utils';\nexport const a = 1;",
    'src/b.ts': "import { formatDate } from './utils';",
    'src/c.ts': "import { a } from './a';",
  };
  const writeSources = () => {
    for (const [path, content] of Object.entries(BLAST_FILES)) {
      mkdirSync(join(root, ...path.split('/').slice(0, -1)), { recursive: true });
      writeFileSync(join(root, ...path.split('/')), content);
    }
  };

  test('MCP-01 omni_check_blast_radius returns the engine report, identical to the CLI', async () => {
    createProject();
    writeSources();
    const server = startServer();
    const report = payload(await server.call('omni_check_blast_radius', { files: ['src/utils.ts'] }));
    const cli = JSON.parse(
      execFileSync(process.execPath, [CLI, 'blast-radius', 'src/utils.ts', '--json'], { cwd: root, encoding: 'utf8' }),
    );
    assert.deepEqual(report, cli);
    assert.equal(report.schemaVersion, 1);
  });

  test('MCP-02 path#symbols narrows the changed symbols', async () => {
    createProject();
    writeSources();
    const server = startServer();
    const report = payload(await server.call('omni_check_blast_radius', { files: ['src/utils.ts#slugify'] }));
    assert.deepEqual(report.files[0].symbols, ['slugify']);
    assert.deepEqual(
      report.files[0].impactedConsumers.map(item => item.path),
      ['src/a.ts', 'src/c.ts'],
    );
  });

  test('MCP-03 an empty cartography index is built on demand', async () => {
    createProject();
    writeSources();
    const server = startServer();
    const result = await server.call('omni_check_blast_radius', { files: ['src/utils.ts'] });
    assert.equal(result.isError, false);
    assert.equal(payload(result).files[0].indexed, true);
  });

  test('MCP-04 consumers, level and score come from real imports', async () => {
    createProject();
    writeSources();
    const server = startServer();
    const report = payload(await server.call('omni_check_blast_radius', { files: ['src/utils.ts', 'docs/x.md'] }));
    assert.deepEqual(
      report.files[0].impactedConsumers.map(item => [item.path, item.distance]),
      [
        ['src/a.ts', 1],
        ['src/b.ts', 1],
        ['src/c.ts', 2],
      ],
    );
    assert.equal(typeof report.files[0].score, 'number');
    assert.ok(['low', 'medium', 'high'].includes(report.files[0].level));
    assert.deepEqual([report.files[1].indexed, report.files[1].score], [false, 0]);
  });

  test('MCP-05 paths outside the project are refused', async () => {
    createProject();
    const server = startServer();
    const result = await server.call('omni_check_blast_radius', { files: ['../outside.ts'] });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /PATH_OUTSIDE_ROOT/);
  });

  test('stdin EOF truncates the WAL, closes the memory and exits 0', async () => {
    createProject();
    const server = startServer();
    await server.call('omni_record_decision', {
      topic: 'wal-budget',
      basis: 'Truncate the WAL when the server stops.',
    });
    assert.equal(await server.close(), 0, server.stderr());
    const wal = `${memoryPath(root)}-wal`;
    assert.ok(!existsSync(wal) || statSync(wal).size === 0);
    assert.ok(readFileSync(memoryPath(root)).subarray(0, 15).toString() === 'SQLite format 3');
  });

  test('mcp outside an OmniSpec project fails fast with exit 1', async () => {
    const server = startServer(root);
    assert.equal(await server.exited, 1);
    assert.match(server.stderr(), /No OmniSpec project found/);
    assert.equal(server.lines.length, 0);
  });
});
