// Writes apps/studio/protocol-vectors.json: golden frames, decoder rejections and handshake proofs
// produced by the Node side of the Omni Studio IPC (src/studio/protocol.mjs). The Rust host checks
// its own encoder, decoder and HMAC against these bytes (PP-07, docs/NEXTGEN-PHASE4-TEST-PLAN.md).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MAX_FRAME_BYTES,
  STUDIO_PROTOCOL_VERSION,
  createFrameDecoder,
  encodeFrame,
  handshakeProof,
} from '../src/studio/protocol.mjs';

const messages = [
  ['request', { jsonrpc: '2.0', id: 1, method: 'project.snapshot', params: {} }],
  ['notification', { jsonrpc: '2.0', method: 'fs.changed', params: { paths: ['src/a.ts', 'specs/manifest.json'] } }],
  ['result-multibyte', { jsonrpc: '2.0', id: 2, result: { title: 'Revisión ñ ✓ 漢字 🚀', lanes: [] } }],
  [
    'error',
    { jsonrpc: '2.0', id: 3, error: { code: -32000, message: 'Spec not found', data: { code: 'SPEC_NOT_FOUND' } } },
  ],
  ['escapes', { jsonrpc: '2.0', id: 'str-id', result: { text: 'line\nbreak "quoted" \\ back\u0001' } }],
];

const frames = messages.map(([name, message]) => {
  const frame = encodeFrame(message);
  return { name, json: frame.subarray(4).toString('utf8'), frameHex: frame.toString('hex') };
});

const header = length => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(length);
  return bytes;
};
const rejectCases = [
  { name: 'empty-frame', chunk: header(0) },
  { name: 'oversized-header', chunk: header(MAX_FRAME_BYTES + 1) },
  { name: 'over-custom-limit', chunk: Buffer.concat([header(17), Buffer.alloc(17, 0x20)]), maxFrameBytes: 16 },
  { name: 'invalid-utf8', chunk: Buffer.concat([header(3), Buffer.from([0x22, 0xc3, 0x22])]) },
];
const rejects = rejectCases.map(({ name, chunk, maxFrameBytes }) => {
  const decoder = createFrameDecoder(maxFrameBytes === undefined ? {} : { maxFrameBytes });
  try {
    decoder.push(chunk);
  } catch (error) {
    return {
      name,
      code: error.code,
      chunkHex: chunk.toString('hex'),
      ...(maxFrameBytes === undefined ? {} : { maxFrameBytes }),
    };
  }
  throw new Error(`reject vector ${name} was accepted by the Node decoder`);
});

const secret = '4f6d6e6953706563537475646f2d746573742d7365637265742d3235362d6269';
const nonces = ['00'.repeat(32), 'e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff00'];
const handshake = nonces.flatMap(nonce =>
  ['engine', 'host'].map(role => ({ secret, role, nonce, proof: handshakeProof(secret, role, nonce) })),
);

const vectors = {
  protocolVersion: STUDIO_PROTOCOL_VERSION,
  maxFrameBytes: MAX_FRAME_BYTES,
  frames,
  rejects,
  handshake,
};
const target = fileURLToPath(new URL('../apps/studio/protocol-vectors.json', import.meta.url));
writeFileSync(target, JSON.stringify(vectors, null, 2) + '\n');
console.log(`Wrote ${target}`);
