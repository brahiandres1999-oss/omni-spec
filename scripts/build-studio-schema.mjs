// Writes schema/studio-ipc.schema.json from STUDIO_METHODS (src/studio/protocol.mjs), the single
// source of truth of the Omni Studio IPC. PR-16 fails when the committed file drifts.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { studioIpcSchema } from '../src/studio/protocol.mjs';

const target = fileURLToPath(new URL('../schema/studio-ipc.schema.json', import.meta.url));
writeFileSync(target, JSON.stringify(studioIpcSchema(), null, 2) + '\n');
console.log(`Wrote ${target}`);
