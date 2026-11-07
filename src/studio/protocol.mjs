import { createHmac } from 'node:crypto';

/**
 * Omni Studio IPC (docs/NEXTGEN-PHASE4-TEST-PLAN.md §4): JSON-RPC 2.0 messages in frames made of a
 * 4-byte little-endian byte length followed by UTF-8 JSON. The method registry below is the single
 * source of truth: schema/studio-ipc.schema.json and the frontend types are generated from it.
 */

export const STUDIO_PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

const HEADER_BYTES = 4;
const HANDSHAKE_DOMAIN = 'omnispec-studio-v1';

export const RPC_ERRORS = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  DOMAIN_ERROR: -32000,
});

export class ProtocolError extends Error {
  /**
   * @param {'FRAME_TOO_LARGE'|'EMPTY_FRAME'|'INVALID_UTF8'|'DECODER_FAILED'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

/**
 * Domain failure answered to the host with a typed code (EN-12). Anything that is not a StudioError
 * escaping a handler is a bug: the dispatcher reports it through onFatal instead of answering it as
 * an ordinary error.
 */
export class StudioError extends Error {
  /**
   * @param {string} code SCREAMING_CASE identifier the UI maps to its states.
   * @param {string} message Human-readable explanation without the code.
   * @param {{retryable?: boolean}} [options]
   */
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = 'StudioError';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * @param {unknown} message JSON-serializable value.
 * @param {{maxFrameBytes?: number}} [options]
 * @returns {Buffer} Header + body.
 */
export function encodeFrame(message, { maxFrameBytes = MAX_FRAME_BYTES } = {}) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > maxFrameBytes)
    throw new ProtocolError('FRAME_TOO_LARGE', `frame of ${body.length} bytes exceeds ${maxFrameBytes}`);
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

/**
 * Incremental decoder. A frame's declared length is checked before any payload is buffered, and
 * after the first error the decoder refuses further input: a byte stream cannot be resynchronized,
 * so the connection must be closed.
 * @param {{maxFrameBytes?: number}} [options]
 */
export function createFrameDecoder({ maxFrameBytes = MAX_FRAME_BYTES } = {}) {
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let chunks = [];
  let buffered = 0;
  let expected = null;
  let failed = false;

  const take = count => {
    const joined = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, buffered);
    const head = joined.subarray(0, count);
    const rest = joined.subarray(count);
    chunks = rest.length ? [rest] : [];
    buffered = rest.length;
    return head;
  };
  const fail = error => {
    failed = true;
    chunks = [];
    buffered = 0;
    throw error;
  };

  return {
    /**
     * @param {Buffer|Uint8Array} chunk
     * @returns {string[]} Complete frame bodies, decoded as UTF-8 text.
     */
    push(chunk) {
      if (failed) throw new ProtocolError('DECODER_FAILED', 'the decoder already failed; close the connection');
      if (chunk.length) {
        chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length));
        buffered += chunk.length;
      }
      const out = [];
      for (;;) {
        if (expected === null) {
          if (buffered < HEADER_BYTES) break;
          const length = take(HEADER_BYTES).readUInt32LE(0);
          if (length === 0) fail(new ProtocolError('EMPTY_FRAME', 'zero-length frame'));
          if (length > maxFrameBytes)
            fail(new ProtocolError('FRAME_TOO_LARGE', `frame of ${length} bytes exceeds ${maxFrameBytes}`));
          expected = length;
        }
        if (buffered < expected) break;
        const body = take(expected);
        expected = null;
        let text;
        try {
          text = utf8.decode(body);
        } catch {
          fail(new ProtocolError('INVALID_UTF8', 'frame body is not valid UTF-8'));
        }
        out.push(text);
      }
      return out;
    },
  };
}

/**
 * HMAC-SHA256 proof used by both sides of the handshake (plan §5).
 * @param {string} secretHex 64 hex characters (256-bit secret).
 * @param {'engine'|'host'} role
 * @param {string} nonceHex
 */
export function handshakeProof(secretHex, role, nonceHex) {
  return createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(`${HANDSHAKE_DOMAIN}:${role}:${nonceHex}`, 'utf8')
    .digest('hex');
}

// --- Method registry -------------------------------------------------------------------------

const HEX64 = '^[0-9a-f]{64}$';
const string = (extra = {}) => ({ type: 'string', ...extra });
const strings = { type: 'array', items: { type: 'string' } };
const object = (properties = {}, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const anyObject = { type: 'object' };
const specRef = string({ minLength: 1, description: 'Spec id or slug; defaults to the active spec.' });

const method = (direction, paramsSchema, resultSchema, description) =>
  Object.freeze(
    resultSchema === null
      ? { direction, description, paramsSchema, notification: true }
      : { direction, description, paramsSchema, resultSchema },
  );
const HOST = 'host->engine';
const ENGINE = 'engine->host';

/** Every Studio IPC method, frozen. Sorted by name so the generated schema is stable. */
export const STUDIO_METHODS = Object.freeze({
  'agent.cancel': method(HOST, object(), anyObject, 'Interrupt the running agent turn.'),
  'agent.event': method(ENGINE, anyObject, null, 'Provider-independent agent event (text, tool, permission, result).'),
  'agent.permission': method(
    HOST,
    object(
      {
        requestId: string({ minLength: 1 }),
        decision: { enum: ['allow', 'deny'] },
        message: string(),
      },
      ['requestId', 'decision'],
    ),
    anyObject,
    'Answer one permission request of the agent.',
  ),
  'agent.prompt': method(
    HOST,
    object(
      {
        text: string({ minLength: 1 }),
        model: string({ minLength: 1 }),
        effort: { enum: ['low', 'medium', 'high', 'xhigh', 'max'] },
      },
      ['text'],
    ),
    anyObject,
    'Send one user message to the agent; the answer arrives as agent.event notifications.',
  ),
  'agent.reset': method(HOST, object(), anyObject, 'End the conversation and start a new one on the next prompt.'),
  'agent.resume': method(
    HOST,
    object({ sessionId: string({ pattern: '^[0-9a-fA-F-]{36}$' }) }, ['sessionId']),
    anyObject,
    'Load an earlier conversation of this folder; the next prompt continues it.',
  ),
  'agent.sessions': method(HOST, object(), anyObject, 'Earlier agent conversations of this folder, newest first.'),
  'agent.status': method(HOST, object(), anyObject, 'Available agents, conversation state and workspace mode.'),
  'blastRadius.heat': method(
    HOST,
    object(
      { target: string({ minLength: 1 }), symbols: strings, depth: { type: 'integer', minimum: 1, maximum: 10 } },
      ['target'],
    ),
    anyObject,
    'Blast radius of one target, per impacted node (heatmap).',
  ),
  'board.get': method(
    HOST,
    object({
      route: { enum: ['light', 'standard', 'full'] },
      filters: object({ tags: strings, risk: strings, owner: strings }),
    }),
    anyObject,
    'Specification board: lanes for one ceremony route, unrouted specs and counts.',
  ),
  'cartography.graph': method(HOST, object(), anyObject, 'Module graph projection with compact integer ids.'),
  'conversations.archive': method(
    HOST,
    object(
      {
        root: string({ minLength: 1 }),
        agent: string({ minLength: 1 }),
        sessionId: string({ minLength: 1 }),
        archived: { type: 'boolean' },
      },
      ['agent', 'sessionId', 'archived'],
    ),
    anyObject,
    'Archive or restore a Studio conversation of any listed project (its agent history is never touched).',
  ),
  'conversations.list': method(
    HOST,
    object({ roots: strings, includeArchived: { type: 'boolean' } }),
    anyObject,
    'Studio conversations of each project, newest activity first.',
  ),
  'conversations.rename': method(
    HOST,
    object(
      {
        root: string({ minLength: 1 }),
        agent: string({ minLength: 1 }),
        sessionId: string({ minLength: 1 }),
        title: string({ minLength: 1 }),
      },
      ['agent', 'sessionId', 'title'],
    ),
    anyObject,
    'Rename a Studio conversation of any listed project.',
  ),
  'diff.get': method(
    HOST,
    object({ maxBytes: { type: 'integer', minimum: 1024 } }),
    anyObject,
    'Working tree diff (tracked and untracked); paged by file above maxBytes.',
  ),
  'diff.getFile': method(HOST, object({ path: string({ minLength: 1 }) }, ['path']), anyObject, 'Diff of one file.'),
  'files.tree': method(HOST, object({ under: string() }), anyObject, 'Project file tree with Git status.'),
  'finops.snapshot': method(HOST, object(), anyObject, 'Token usage, rate and circuit breaker budgets.'),
  'finops.tick': method(ENGINE, anyObject, null, 'Live FinOps update pushed by the engine.'),
  'fs.changed': method(HOST, object({ paths: strings }, ['paths']), null, 'Debounced batch of changed paths.'),
  'fs.rescan': method(HOST, object(), null, 'The OS watcher overflowed: refresh everything.'),
  'gate.approve': method(
    HOST,
    object({ spec: specRef, gate: { enum: [1, 2] }, actor: string({ minLength: 1 }) }, ['gate']),
    anyObject,
    'Approve human gate 1 or 2 when its governance conditions hold.',
  ),
  'memory.summary': method(
    HOST,
    object(),
    anyObject,
    'What the project memory holds: counts, recent learnings and decisions.',
  ),
  'project.changed': method(
    ENGINE,
    object({ areas: { type: 'array', items: { enum: ['board', 'graph', 'diff', 'files', 'finops', 'skills'] } } }, [
      'areas',
    ]),
    null,
    'Areas whose data changed since the last request.',
  ),
  'project.snapshot': method(HOST, object(), anyObject, 'Whole shell state for the first paint.'),
  'review.addRemark': method(
    HOST,
    object(
      {
        spec: specRef,
        file: string({ minLength: 1 }),
        line: { type: 'integer', minimum: 1 },
        side: { enum: ['old', 'new'] },
        text: string(),
      },
      ['file', 'line', 'side', 'text'],
    ),
    anyObject,
    'Store an inline correction for the next agent turn.',
  ),
  'review.decideHunk': method(
    HOST,
    object(
      {
        spec: specRef,
        hunkId: string({ minLength: 1 }),
        decision: { enum: ['approve', 'reject'] },
        actor: string({ minLength: 1 }),
      },
      ['hunkId', 'decision'],
    ),
    anyObject,
    'Approve or reject one hunk.',
  ),
  'review.stageApproved': method(HOST, object({ spec: specRef }), anyObject, 'Stage exactly the approved hunks.'),
  'skills.list': method(HOST, object(), anyObject, 'Installed and project skills with estimated weight.'),
  'skills.toggle': method(
    HOST,
    object({ name: string({ minLength: 1 }), enabled: { type: 'boolean' } }, ['name', 'enabled']),
    anyObject,
    'Enable or disable one skill.',
  ),
  'studio.challenge': method(
    HOST,
    object({ protocolVersion: { type: 'integer' }, nonce: string({ pattern: HEX64 }) }, ['protocolVersion', 'nonce']),
    object(
      {
        protocolVersion: { type: 'integer' },
        proof: string({ pattern: HEX64 }),
        nonce: string({ pattern: HEX64 }),
        pid: { type: 'integer' },
        versions: anyObject,
      },
      ['protocolVersion', 'proof', 'nonce', 'pid', 'versions'],
    ),
    'Handshake step 1: the host challenges the engine.',
  ),
  'studio.hello': method(
    HOST,
    object({ proof: string({ pattern: HEX64 }) }, ['proof']),
    null,
    'Handshake step 3: the host proves it knows the secret.',
  ),
});

/** JSON Schema of the protocol, written to schema/studio-ipc.schema.json by npm run build:studio-schema. */
export function studioIpcSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://omnispec.dev/schema/studio-ipc.schema.json',
    title: 'Omni Studio IPC',
    description:
      'Generated from STUDIO_METHODS in src/studio/protocol.mjs. Frames: uint32 little-endian byte length + UTF-8 JSON-RPC 2.0.',
    type: 'object',
    properties: {
      protocolVersion: { const: STUDIO_PROTOCOL_VERSION },
      maxFrameBytes: { const: MAX_FRAME_BYTES },
    },
    methods: Object.fromEntries(Object.entries(STUDIO_METHODS).map(([name, entry]) => [name, { ...entry }])),
  };
}

// --- Validation and dispatch -------------------------------------------------------------------

function typeMatches(type, value) {
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isSafeInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

/** Minimal JSON Schema subset used by the registry. @returns {string[]} Problems, empty when valid. */
export function schemaProblems(schema, value, path = 'params') {
  if (schema.enum && !schema.enum.includes(value)) return [`${path} must be one of ${schema.enum.join(', ')}`];
  if (schema.type && !typeMatches(schema.type, value)) return [`${path} must be ${schema.type}`];
  const problems = [];
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      problems.push(`${path} must have at least ${schema.minLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      problems.push(`${path} must match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${path} must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${path} must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value) && schema.items)
    for (const [index, item] of value.entries())
      problems.push(...schemaProblems(schema.items, item, `${path}[${index}]`));
  if (schema.type === 'object' && value) {
    for (const key of schema.required ?? []) if (value[key] === undefined) problems.push(`${path}.${key} is required`);
    for (const [key, item] of Object.entries(value)) {
      const property = schema.properties?.[key];
      if (property) problems.push(...schemaProblems(property, item, `${path}.${key}`));
      else if (schema.additionalProperties === false) problems.push(`${path}.${key} is not allowed`);
    }
  }
  return problems;
}

const reply = (id, payload) => ({ jsonrpc: '2.0', id, ...payload });
const failure = (id, code, message, data) => reply(id, { error: data ? { code, message, data } : { code, message } });

/**
 * @param {{
 *   direction: 'host->engine'|'engine->host',
 *   handlers: Record<string, (params: object) => unknown>,
 *   onFatal?: (error: Error, method: string) => void,
 * }} options onFatal receives errors that are not StudioError (bugs); the reply is still -32603.
 */
export function createRpcDispatcher({
  direction,
  handlers,
  onFatal = error => {
    throw error;
  },
}) {
  const inFlight = new Set();
  return {
    /**
     * @param {string} text One decoded frame.
     * @returns {Promise<object|null>} The reply, or null for notifications.
     */
    async dispatch(text) {
      let message;
      try {
        message = JSON.parse(text);
      } catch (error) {
        return failure(null, RPC_ERRORS.PARSE_ERROR, `Parse error: ${error.message}`);
      }
      if (!message || typeof message !== 'object' || Array.isArray(message))
        return failure(null, RPC_ERRORS.INVALID_REQUEST, 'Invalid request: batches are not supported');
      const hasId = message.id !== undefined;
      const id = hasId && (typeof message.id === 'number' || typeof message.id === 'string') ? message.id : null;
      if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || (hasId && id === null))
        return failure(id, RPC_ERRORS.INVALID_REQUEST, 'Invalid request');
      const entry = Object.hasOwn(STUDIO_METHODS, message.method) ? STUDIO_METHODS[message.method] : null;
      const handler = entry?.direction === direction ? handlers[message.method] : undefined;
      if (!handler)
        return hasId ? failure(id, RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${message.method}`) : null;
      const params = message.params ?? {};
      const problems = schemaProblems(entry.paramsSchema, params);
      if (problems.length) return hasId ? failure(id, RPC_ERRORS.INVALID_PARAMS, 'Invalid params', { problems }) : null;
      if (hasId && inFlight.has(id)) return failure(id, RPC_ERRORS.INVALID_REQUEST, `Duplicate in-flight id ${id}`);
      if (hasId) inFlight.add(id);
      try {
        const result = await handler(params);
        return hasId ? reply(id, { result: result ?? null }) : null;
      } catch (error) {
        if (error instanceof StudioError)
          return hasId
            ? failure(id, RPC_ERRORS.DOMAIN_ERROR, error.message, {
                code: error.code,
                detail: error.message,
                retryable: error.retryable,
              })
            : null;
        onFatal(error, message.method);
        return hasId ? failure(id, RPC_ERRORS.INTERNAL_ERROR, `Internal error in ${message.method}`) : null;
      } finally {
        inFlight.delete(id);
      }
    },
  };
}
