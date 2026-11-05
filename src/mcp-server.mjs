import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { openProjectMemory, startCheckpointSupervisor, syncFromGit } from './memory.mjs';
import { getActiveSpec } from './manifest.mjs';

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

const stringArray = { type: 'array', items: { type: 'string' } };

export const TOOLS = [
  {
    name: 'omni_search_context',
    description: 'Busca decisiones, observaciones y contratos relevantes en la memoria FTS5 del proyecto.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        scope: { type: 'string', description: 'Filtro opcional por módulo o directorio' },
      },
      required: ['query'],
    },
  },
  {
    name: 'omni_get_active_spec',
    description: 'Obtiene la especificación activa, sus criterios de aceptación y los límites de archivos autorizados.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'omni_check_blast_radius',
    description: 'Calcula el impacto de modificar una lista de archivos antes de tocarlos.',
    inputSchema: { type: 'object', properties: { files: stringArray }, required: ['files'] },
  },
  {
    name: 'omni_record_decision',
    description: 'Registra formalmente una decisión de arquitectura en la memoria persistente y en Git.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', description: 'Tema en kebab-case' },
        basis: { type: 'string', minLength: 10, description: 'Justificación mínima de 10 caracteres' },
        sources: stringArray,
      },
      required: ['topic', 'basis'],
    },
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map(tool => [tool.name, tool]));

function argumentProblems({ inputSchema }, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ['arguments must be an object'];
  const problems = (inputSchema.required ?? []).filter(key => args[key] === undefined).map(key => `${key} is required`);
  for (const [key, schema] of Object.entries(inputSchema.properties)) {
    const value = args[key];
    if (value === undefined) continue;
    const valid =
      schema.type === 'string'
        ? typeof value === 'string'
        : Array.isArray(value) && value.every(item => typeof item === 'string');
    if (!valid) problems.push(`${key} must be ${schema.type === 'string' ? 'a string' : 'an array of strings'}`);
  }
  return problems;
}

function readAcceptance(root, spec) {
  const path = join(root, 'specs', spec.slug, 'acceptance.json');
  return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8').replace(/^﻿/, '')) : null;
}

function toolHandlers(root, memory) {
  return {
    async omni_search_context({ query, scope }) {
      await syncFromGit(memory, root);
      return { results: memory.searchContext(query, { scope: scope ?? null }) };
    },
    async omni_get_active_spec() {
      const activeSpec = await getActiveSpec(root);
      return { activeSpec, acceptance: activeSpec ? readAcceptance(root, activeSpec) : null };
    },
    async omni_check_blast_radius({ files }) {
      return { files: memory.blastRadius(files) };
    },
    async omni_record_decision({ topic, basis, sources }) {
      return memory.recordDecision(root, { topic, basis, sources });
    },
  };
}

const response = (id, result) => ({ jsonrpc: '2.0', id, result });
const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const toolResult = (value, isError = false) => ({
  content: [{ type: 'text', text: isError ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? {} : { structuredContent: value }),
  isError,
});

async function dispatch(message, { handlers, version, log }) {
  const { id, method, params } = message;
  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      return response(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'omni-spec', version },
      });
    }
    case 'ping':
      return response(id, {});
    case 'tools/list':
      return response(id, { tools: TOOLS });
    case 'tools/call': {
      const tool = TOOLS_BY_NAME.get(params?.name);
      if (!tool) return failure(id, INVALID_PARAMS, `Unknown tool: ${params?.name}`);
      const args = params.arguments ?? {};
      const problems = argumentProblems(tool, args);
      if (problems.length)
        return response(id, toolResult(`Invalid arguments for ${tool.name}: ${problems.join('; ')}`, true));
      try {
        return response(id, toolResult(await handlers[tool.name](args)));
      } catch (error) {
        log(`[${tool.name}] ${error.stack}`);
        return response(id, toolResult(error.message, true));
      }
    }
    default:
      return failure(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

async function handleLine(line, context) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    return failure(null, PARSE_ERROR, `Parse error: ${error.message}`);
  }
  if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string')
    return failure(message?.id ?? null, INVALID_REQUEST, 'Invalid JSON-RPC 2.0 request.');
  if (message.id === undefined) return null;
  return dispatch(message, context);
}

/**
 * Serves the §4.2 tools over newline-delimited JSON-RPC on stdio until `input` ends.
 * stdout carries protocol messages only; diagnostics go to stderr.
 */
export async function runMcpServer({
  root,
  version,
  input = process.stdin,
  output = process.stdout,
  log = console.error,
}) {
  const { memory, quarantined } = await openProjectMemory(root);
  if (quarantined) log(`[omni-spec mcp] corrupt memory quarantined in ${quarantined}; rebuilt from Git.`);
  const supervisor = startCheckpointSupervisor(memory);
  const context = { handlers: toolHandlers(root, memory), version, log };
  try {
    for await (const line of createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })) {
      if (!line.trim()) continue;
      const reply = await handleLine(line, context);
      if (reply) output.write(JSON.stringify(reply) + '\n');
    }
  } finally {
    clearInterval(supervisor);
    memory.close();
  }
}
