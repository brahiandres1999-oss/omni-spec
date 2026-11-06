// Writes the system tray icons of Omni Studio (docs/NEXTGEN-PHASE4-TEST-PLAN.md TR-02) to
// src-tauri/icons: one ICO per tray state plus the frames of the cyan "busy" pulse, each with
// 16, 20, 24, 32 and 48 px images (32-bit BMP entries with alpha). Colours are the canonical
// palette of STUDIO-DESIGN-SYSTEM.md §2.1 (reconciliation §1.17.9). No dependencies.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SIZES = [16, 20, 24, 32, 48];
const STATES = {
  emerald: '#10b981',
  cyan: '#06b6d4',
  amber: '#f59e0b',
  crimson: '#f43f5e',
};
// Pulse frames: a halo that grows and fades around the cyan dot.
const PULSE = [
  { halo: 0.39, alpha: 0.55 },
  { halo: 0.44, alpha: 0.35 },
  { halo: 0.49, alpha: 0.18 },
];

const rgb = hex => [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
const clamp01 = value => Math.min(1, Math.max(0, value));

/** BGRA pixels, top-down, of a dot with an optional halo, anti-aliased by distance. */
function draw(size, color, halo) {
  const [r, g, b] = rgb(color);
  const centre = size / 2;
  const core = size * 0.32;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
      let alpha = clamp01(core + 0.5 - distance);
      if (halo) {
        const ring = clamp01(size * halo.halo + 0.5 - distance) * clamp01(distance - core + 0.5);
        alpha = Math.max(alpha, ring * halo.alpha);
      }
      const offset = (y * size + x) * 4;
      pixels[offset] = b;
      pixels[offset + 1] = g;
      pixels[offset + 2] = r;
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

/** One ICO image entry: BITMAPINFOHEADER + bottom-up BGRA + empty AND mask. */
function bitmap(size, pixels) {
  const maskStride = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND masks
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16); // BI_RGB
  header.writeUInt32LE(size * size * 4 + maskStride * size, 20);
  const rows = [];
  for (let y = size - 1; y >= 0; y--) rows.push(pixels.subarray(y * size * 4, (y + 1) * size * 4));
  return Buffer.concat([header, ...rows, Buffer.alloc(maskStride * size)]);
}

function ico(color, halo) {
  const images = SIZES.map(size => bitmap(size, draw(size, color, halo)));
  const directory = Buffer.alloc(6 + 16 * images.length);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    directory.writeUInt8(SIZES[index], entry);
    directory.writeUInt8(SIZES[index], entry + 1);
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(image.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([directory, ...images]);
}

const target = name => fileURLToPath(new URL(`../src-tauri/icons/${name}`, import.meta.url));
for (const [state, color] of Object.entries(STATES)) writeFileSync(target(`tray-${state}.ico`), ico(color));
for (const [index, halo] of PULSE.entries())
  writeFileSync(target(`tray-cyan-pulse-${index + 1}.ico`), ico(STATES.cyan, halo));
console.log(`Wrote ${Object.keys(STATES).length + PULSE.length} tray icons to ${target('')}`);
