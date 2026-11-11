import { DatabaseSync } from 'node:sqlite';
import { openMemory, writeFileAtomicSync } from '../src/memory.mjs';

const [mode, target, ...rest] = process.argv.slice(2);
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

if (mode === 'write') {
  const [count, tag] = rest;
  const memory = openMemory(target);
  for (let index = 0; index < Number(count); index++) {
    memory.addObservations([{ category: 'pattern', scope: `worker/${tag}`, summary: `write ${tag}-${index}` }]);
  }
  memory.close();
} else if (mode === 'hold') {
  const db = new DatabaseSync(target);
  db.exec('BEGIN IMMEDIATE');
  db.exec(
    "INSERT INTO observations (id, category, scope, summary, created_at) VALUES ('held', 'pattern', 'hold', 'held lock', '2026-01-01T00:00:00.000Z')",
  );
  process.stdout.write('locked\n');
  pause(Number(rest[0]));
  db.exec('COMMIT');
  db.close();
} else if (mode === 'atomic-write') {
  const [iterations, tag] = rest;
  for (let index = 0; index < Number(iterations); index++) {
    writeFileAtomicSync(target, JSON.stringify({ tag, index, payload: 'x'.repeat(65536) }));
  }
} else {
  throw new Error(`Unknown worker mode: ${mode}`);
}
