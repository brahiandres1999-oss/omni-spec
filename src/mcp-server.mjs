import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { openMemory, openProjectMemory, startCheckpointSupervisor, syncFromGit } from './memory.mjs';
import { getActiveSpec } from './manifest.mjs';
import { checkBlastRadius, normalizeTargets } from './cartography/blast-radius.mjs';
import { resolveWorkspace } from './studio/workspace.mjs';
import { ASK_ENV, CONVERSATION_ENV, askThroughChannel } from './studio/ask-channel.mjs';

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

const stringArray = { type: 'array', items: { type: 'string' } };
const OBSERVATION_CATEGORIES = new Set(['pattern', 'gotcha', 'convention', 'constraint']);

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
  {
    name: 'omni_record_observation',
    description:
      'Registra un aprendizaje del proyecto (patrón, trampa, convención o restricción) en la memoria compartida para otros agentes.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['pattern', 'gotcha', 'convention', 'constraint'],
          description: 'Tipo de aprendizaje: pattern, gotcha, convention o constraint',
        },
        scope: { type: 'string', description: 'Archivo, directorio o módulo al que aplica' },
        summary: { type: 'string', description: 'Descripción clara del aprendizaje' },
        evidence: { type: 'string', description: 'Evidencia opcional (archivo, comando o prueba)' },
      },
      required: ['category', 'scope', 'summary'],
    },
  },
  {
    name: 'omni_active_work',
    description:
      'Muestra quién trabaja en qué dentro de este proyecto: conversaciones vivas, su agente y los archivos que tocaron.',
    inputSchema: { type: 'object', properties: {} },
  },
];

/**
 * Only inside Omni Studio (it sets OMNI_STUDIO_ASK): the person answers in a question panel of the chat, the same
 * for every agent, instead of reading questions written as text.
 */
export const ASK_TOOL = {
  name: 'omni_ask_user',
  description:
    'Pregunta a la persona en el panel nativo de Omni Studio y espera su respuesta. Úsalo siempre que necesites que elija o confirme algo (1 a 4 preguntas, 2 a 4 opciones cada una; pon primero la recomendada y termina su etiqueta en "(Recomendado)"). La persona también puede escribir otra respuesta. No escribas las preguntas como texto en el chat.',
  inputSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'La pregunta completa, terminada en signo de interrogación' },
            header: { type: 'string', description: 'Etiqueta corta (máx. 12 caracteres)' },
            options: {
              type: 'array',
              minItems: 2,
              maxItems: 4,
              items: {
                type: 'object',
                properties: { label: { type: 'string' }, description: { type: 'string' } },
                required: ['label'],
              },
            },
            multiSelect: { type: 'boolean', description: 'Permite elegir varias opciones' },
          },
          required: ['question', 'options'],
        },
      },
    },
    required: ['questions'],
  },
};

const TOOLS_BY_NAME = new Map([...TOOLS, ASK_TOOL].map(tool => [tool.name, tool]));
const toolsFor = env => (env[ASK_ENV] ? [...TOOLS, ASK_TOOL] : TOOLS);

/** The questions as Studio shows them; anything malformed is refused with a message the agent can act on. */
export function cleanQuestions(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4) throw new Error('questions must hold 1 to 4 questions.');
  return raw.map((entry, index) => {
    const question = typeof entry?.question === 'string' ? entry.question.trim() : '';
    if (!question) throw new Error(`questions[${index}].question must not be empty.`);
    const options = Array.isArray(entry.options) ? entry.options : [];
    if (options.length < 2 || options.length > 4) throw new Error(`questions[${index}] needs 2 to 4 options.`);
    return {
      question,
      header: typeof entry.header === 'string' ? entry.header.trim().slice(0, 24) : '',
      multiSelect: entry.multiSelect === true,
      options: options.map((option, at) => {
        const label = typeof option?.label === 'string' ? option.label.trim() : '';
        if (!label) throw new Error(`questions[${index}].options[${at}].label must not be empty.`);
        return { label, description: typeof option.description === 'string' ? option.description.trim() : '' };
      }),
    };
  });
}

function argumentProblems({ inputSchema }, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ['arguments must be an object'];
  const problems = (inputSchema.required ?? []).filter(key => args[key] === undefined).map(key => `${key} is required`);
  for (const [key, schema] of Object.entries(inputSchema.properties)) {
    const value = args[key];
    if (value === undefined) continue;
    // Arrays of objects (omni_ask_user) are checked by their handler.
    const valid =
      schema.type === 'string'
        ? typeof value === 'string'
        : schema.items?.type === 'object'
          ? Array.isArray(value)
          : Array.isArray(value) && value.every(item => typeof item === 'string');
    if (!valid) problems.push(`${key} must be ${schema.type === 'string' ? 'a string' : 'an array of strings'}`);
  }
  return problems;
}

function readAcceptance(root, spec) {
  const path = join(root, 'specs', spec.slug, 'acceptance.json');
  return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8').replace(/^﻿/, '')) : null;
}

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function toolHandlers(root, memory, { studio = false, env = process.env } = {}) {
  return {
    async omni_ask_user({ questions }) {
      if (!env[ASK_ENV]) throw new Error('omni_ask_user only works inside Omni Studio.');
      const reply = await askThroughChannel(env[ASK_ENV], {
        conversationId: env[CONVERSATION_ENV] ?? null,
        questions: cleanQuestions(questions),
      });
      if (reply.error) throw new Error(reply.error);
      return reply;
    },
    async omni_search_context({ query, scope }) {
      if (!studio) await syncFromGit(memory, root);
      return { results: memory.searchContext(query, { scope: scope ?? null }) };
    },
    async omni_get_active_spec() {
      if (studio) return { activeSpec: null, acceptance: null, mode: 'studio' };
      const activeSpec = await getActiveSpec(root);
      return { activeSpec, acceptance: activeSpec ? readAcceptance(root, activeSpec) : null };
    },
    async omni_check_blast_radius({ files }) {
      // Paths are project-relative (or absolute inside the project); `path#sym` limits symbols (D-4).
      return checkBlastRadius(root, memory, normalizeTargets(root, root, files));
    },
    async omni_record_decision({ topic, basis, sources }) {
      return memory.recordDecision(root, { topic, basis, sources, studio });
    },
    async omni_record_observation({ category, scope, summary, evidence }) {
      if (!OBSERVATION_CATEGORIES.has(category))
        throw new Error(`Invalid observation category "${category}": use pattern, gotcha, convention or constraint.`);
      if (!scope?.trim()) throw new Error('Observation scope must not be empty.');
      if (!summary?.trim()) throw new Error('Observation summary must not be empty.');
      const [id] = memory.addObservations([
        { category, scope: scope.trim(), summary: summary.trim(), evidence: evidence?.trim() || null },
      ]);
      return { id, category, scope: scope.trim(), summary: summary.trim() };
    },
    async omni_active_work() {
      const live = hasTable(memory.db, 'studio_active_work')
        ? memory.db
            .prepare(
              'SELECT conversation_id, agent, session_id, title, state, files_json, updated_at FROM studio_active_work ORDER BY updated_at DESC',
            )
            .all()
            .map(row => ({
              conversationId: row.conversation_id,
              agent: row.agent,
              sessionId: row.session_id,
              title: row.title,
              state: row.state,
              files: JSON.parse(row.files_json || '[]'),
              updatedAt: row.updated_at,
            }))
        : [];
      const recent = hasTable(memory.db, 'studio_conversations')
        ? memory.db
            .prepare(
              'SELECT agent, session_id AS sessionId, title, updated_at AS updatedAt FROM studio_conversations WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT 10',
            )
            .all()
        : [];
      return { live, recent };
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

async function dispatch(message, { handlers, version, log, env = process.env }) {
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
      return response(id, { tools: toolsFor(env) });
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
  studio = false,
  input = process.stdin,
  output = process.stdout,
  log = console.error,
}) {
  let memory;
  let isStudio = false;
  if (studio) {
    const workspace = await resolveWorkspace(root);
    isStudio = workspace.mode === 'studio';
    if (isStudio) {
      memory = openMemory(workspace.memoryPath);
    } else {
      const opened = await openProjectMemory(root);
      memory = opened.memory;
      if (opened.quarantined)
        log(`[omni-spec mcp] corrupt memory quarantined in ${opened.quarantined}; rebuilt from Git.`);
    }
  } else {
    const opened = await openProjectMemory(root);
    memory = opened.memory;
    if (opened.quarantined)
      log(`[omni-spec mcp] corrupt memory quarantined in ${opened.quarantined}; rebuilt from Git.`);
  }
  const supervisor = startCheckpointSupervisor(memory);
  const context = { handlers: toolHandlers(root, memory, { studio: isStudio }), version, log };
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
