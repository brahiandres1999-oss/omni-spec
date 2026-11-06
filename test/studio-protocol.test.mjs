import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MAX_FRAME_BYTES,
  ProtocolError,
  STUDIO_METHODS,
  STUDIO_PROTOCOL_VERSION,
  createFrameDecoder,
  createRpcDispatcher,
  encodeFrame,
  studioIpcSchema,
} from '../src/studio/protocol.mjs';

const SCHEMA_FILE = fileURLToPath(new URL('../schema/studio-ipc.schema.json', import.meta.url));

const header = length => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(length);
  return buffer;
};
const throwsCode = (code, fn) =>
  assert.throws(fn, error => error instanceof ProtocolError && error.code === code, `expected ${code}`);
const request = (id, method, params = {}) => JSON.stringify({ jsonrpc: '2.0', id, method, params });

function dispatcher(handlers = {}) {
  return createRpcDispatcher({
    direction: 'host->engine',
    handlers: {
      'project.snapshot': async () => ({ ok: true }),
      'review.decideHunk': async params => ({ decided: params.hunkId }),
      ...handlers,
    },
  });
}

describe('PR frame codec', () => {
  test('PR-01 the length header counts UTF-8 bytes, not characters', () => {
    const message = {
      jsonrpc: '2.0',
      method: 'fs.changed',
      params: { paths: ['src/ñandú.ts', '源/文件.ts', 'emoji/🚀.md'] },
    };
    const frame = encodeFrame(message);
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    assert.equal(STUDIO_PROTOCOL_VERSION, 1);
    assert.equal(frame.readUInt32LE(0), body.length);
    assert.notEqual(body.length, JSON.stringify(message).length);
    assert.deepEqual(
      createFrameDecoder()
        .push(frame)
        .map(text => JSON.parse(text)),
      [message],
    );
  });

  test('PR-02 a frame delivered one byte at a time decodes exactly once', () => {
    const message = { jsonrpc: '2.0', id: 7, result: { text: 'héllo' } };
    const frame = encodeFrame(message);
    const decoder = createFrameDecoder();
    const out = [];
    for (const byte of frame) out.push(...decoder.push(Buffer.from([byte])));
    assert.deepEqual(
      out.map(text => JSON.parse(text)),
      [message],
    );
  });

  test('PR-03 three frames in a single chunk decode in order', () => {
    const messages = [1, 2, 3].map(id => ({ jsonrpc: '2.0', id, result: id }));
    const chunk = Buffer.concat(messages.map(encodeFrame));
    assert.deepEqual(
      createFrameDecoder()
        .push(chunk)
        .map(text => JSON.parse(text)),
      messages,
    );
  });

  test('PR-04 a header split 2 + 2 bytes is reassembled', () => {
    const frame = encodeFrame({ jsonrpc: '2.0', id: 1, result: null });
    const decoder = createFrameDecoder();
    assert.deepEqual(decoder.push(frame.subarray(0, 2)), []);
    assert.deepEqual(decoder.push(frame.subarray(2, 4)), []);
    assert.equal(decoder.push(frame.subarray(4)).length, 1);
  });

  test('PR-05 an oversized header fails before buffering and poisons the decoder', () => {
    assert.equal(MAX_FRAME_BYTES, 8 * 1024 * 1024);
    const decoder = createFrameDecoder({ maxFrameBytes: 1024 });
    const before = process.memoryUsage().arrayBuffers;
    throwsCode('FRAME_TOO_LARGE', () => decoder.push(header(0xfffffff0)));
    assert.ok(process.memoryUsage().arrayBuffers - before < 1024 * 1024, 'payload must not be preallocated');
    throwsCode('DECODER_FAILED', () => decoder.push(encodeFrame({ jsonrpc: '2.0', id: 1, result: 1 })));
    throwsCode('FRAME_TOO_LARGE', () => encodeFrame({ blob: 'x'.repeat(2048) }, { maxFrameBytes: 1024 }));
  });

  test('PR-06 a zero-length frame is a protocol error', () => {
    throwsCode('EMPTY_FRAME', () => createFrameDecoder().push(header(0)));
  });

  test('PR-07 invalid UTF-8 is rejected instead of being replaced with U+FFFD', () => {
    const body = Buffer.from([0x7b, 0xc3, 0x28, 0x7d]);
    throwsCode('INVALID_UTF8', () => createFrameDecoder().push(Buffer.concat([header(body.length), body])));
  });
});

describe('PR JSON-RPC dispatch', () => {
  test('PR-08 invalid JSON answers -32700 with a null id', async () => {
    const reply = await dispatcher().dispatch('{"jsonrpc":"2.0",');
    assert.equal(reply.id, null);
    assert.equal(reply.error.code, -32700);
  });

  test('PR-09 a missing jsonrpc version or method answers -32600', async () => {
    const rpc = dispatcher();
    assert.equal((await rpc.dispatch(JSON.stringify({ id: 1, method: 'project.snapshot' }))).error.code, -32600);
    assert.equal((await rpc.dispatch(JSON.stringify({ jsonrpc: '2.0', id: 2 }))).error.code, -32600);
  });

  test('PR-10 unknown methods and methods of the opposite direction answer -32601', async () => {
    const rpc = dispatcher();
    assert.equal((await rpc.dispatch(request(1, 'project.delete'))).error.code, -32601);
    assert.equal((await rpc.dispatch(request(2, 'project.changed', { areas: ['board'] }))).error.code, -32601);
  });

  test('PR-11 params that violate the schema answer -32602 naming the offending path', async () => {
    const reply = await dispatcher().dispatch(request(3, 'review.decideHunk', { hunkId: 'h1', decision: 'maybe' }));
    assert.equal(reply.error.code, -32602);
    assert.ok(
      reply.error.data.problems.some(problem => problem.startsWith('params.decision')),
      reply.error.data.problems.join('; '),
    );
  });

  test('PR-12 notifications run their handler and produce no reply', async () => {
    const seen = [];
    const rpc = dispatcher({ 'fs.changed': async params => seen.push(params.paths) });
    const reply = await rpc.dispatch(
      JSON.stringify({ jsonrpc: '2.0', method: 'fs.changed', params: { paths: ['a.ts'] } }),
    );
    assert.equal(reply, null);
    assert.deepEqual(seen, [['a.ts']]);
  });

  test('PR-13 batch arrays are not supported', async () => {
    const reply = await dispatcher().dispatch(`[${request(1, 'project.snapshot')}]`);
    assert.equal(reply.error.code, -32600);
  });

  test('PR-14 a duplicate id while the first request is in flight answers -32600', async () => {
    let release;
    const gate = new Promise(resolve => (release = resolve));
    const rpc = dispatcher({ 'project.snapshot': () => gate.then(() => ({ ok: true })) });
    const first = rpc.dispatch(request(9, 'project.snapshot'));
    const duplicate = await rpc.dispatch(request(9, 'project.snapshot'));
    assert.equal(duplicate.error.code, -32600);
    release();
    assert.deepEqual((await first).result, { ok: true });
    assert.deepEqual((await rpc.dispatch(request(9, 'project.snapshot'))).result, { ok: true }, 'id reusable after');
  });
});

describe('PR method registry and schema', () => {
  test('PR-15 STUDIO_METHODS is frozen and every entry declares direction and schemas', () => {
    assert.ok(Object.isFrozen(STUDIO_METHODS));
    const expected = [
      'agent.cancel',
      'agent.event',
      'agent.permission',
      'agent.prompt',
      'agent.reset',
      'agent.status',
      'blastRadius.heat',
      'board.get',
      'cartography.graph',
      'diff.get',
      'diff.getFile',
      'files.tree',
      'finops.snapshot',
      'finops.tick',
      'fs.changed',
      'fs.rescan',
      'gate.approve',
      'project.changed',
      'project.snapshot',
      'review.addRemark',
      'review.decideHunk',
      'review.stageApproved',
      'skills.list',
      'skills.toggle',
      'studio.challenge',
      'studio.hello',
    ];
    assert.deepEqual(Object.keys(STUDIO_METHODS).sort(), expected);
    for (const [name, method] of Object.entries(STUDIO_METHODS)) {
      assert.ok(Object.isFrozen(method), name);
      assert.ok(['host->engine', 'engine->host'].includes(method.direction), name);
      assert.equal(method.paramsSchema.type, 'object', name);
      assert.ok(method.notification === true || typeof method.resultSchema === 'object', name);
    }
    assert.throws(() => {
      STUDIO_METHODS['x.y'] = {};
    }, TypeError);
  });

  test('PR-16 schema/studio-ipc.schema.json matches the registry (run npm run build:studio-schema)', () => {
    const committed = readFileSync(SCHEMA_FILE, 'utf8');
    assert.equal(committed, JSON.stringify(studioIpcSchema(), null, 2) + '\n');
    assert.equal(JSON.parse(committed).properties.protocolVersion.const, STUDIO_PROTOCOL_VERSION);
  });
});
