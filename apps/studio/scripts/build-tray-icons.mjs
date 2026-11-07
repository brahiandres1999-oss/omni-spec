// Generates system tray icons for Omni Studio (docs/NEXTGEN-PHASE4-TEST-PLAN.md TR-02)
// in src-tauri/icons/ using the authentic OmniSpec brand emblem (assets/omni-spec-icon.svg).
// Generates multi-resolution ICO files containing 16, 20, 24, 32 and 48 px entries.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZES = [16, 20, 24, 32, 48];
const TRAY_FILES = [
  'tray-emerald.ico',
  'tray-cyan.ico',
  'tray-amber.ico',
  'tray-crimson.ico',
  'tray-cyan-pulse-1.ico',
  'tray-cyan-pulse-2.ico',
  'tray-cyan-pulse-3.ico',
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const studioRoot = resolve(__dirname, '..');
const repoRoot = resolve(studioRoot, '../..');
const sourceSvg = resolve(repoRoot, 'assets/omni-spec-icon.svg');
const targetIconsDir = resolve(studioRoot, 'src-tauri/icons');
const stagingDir = resolve(studioRoot, '.staging-tray-icons');

if (!existsSync(sourceSvg)) {
  console.error(`Source icon not found at: ${sourceSvg}`);
  process.exit(1);
}

// 1. Prepare staging directory
if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });

// 2. Generate crisp raster PNGs for each tray size via Tauri CLI
console.log('Generating tray resolution PNGs with Tauri CLI...');
execSync(`npx tauri icon -p ${SIZES.join(',')} -o .staging-tray-icons ../../assets/omni-spec-icon.svg`, {
  cwd: studioRoot,
  stdio: 'inherit',
});

// 3. Read PNG buffers for all sizes
const pngBuffers = SIZES.map(size => {
  const filePath = join(stagingDir, `${size}x${size}.png`);
  if (!existsSync(filePath)) {
    throw new Error(`Expected tray PNG size not found: ${filePath}`);
  }
  return readFileSync(filePath);
});

/** Packs PNG image buffers into a multi-resolution Windows ICO binary. */
function packIco(buffers, sizes) {
  const count = buffers.length;
  const dirSize = 6 + 16 * count;
  let offset = dirSize;
  const dir = Buffer.alloc(dirSize);

  // ICONDIR header: reserved=0, type=1 (icon), image count
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(count, 4);

  // ICONDIRENTRY descriptors
  buffers.forEach((buf, i) => {
    const size = sizes[i];
    const entry = 6 + i * 16;
    dir.writeUInt8(size === 256 ? 0 : size, entry);
    dir.writeUInt8(size === 256 ? 0 : size, entry + 1);
    dir.writeUInt8(0, entry + 2); // color count (0 for >=8bpp)
    dir.writeUInt8(0, entry + 3); // reserved
    dir.writeUInt16LE(1, entry + 4); // color planes
    dir.writeUInt16LE(32, entry + 6); // bits per pixel
    dir.writeUInt32LE(buf.length, entry + 8); // image byte size
    dir.writeUInt32LE(offset, entry + 12); // image offset in file
    offset += buf.length;
  });

  return Buffer.concat([dir, ...buffers]);
}

// 4. Pack and write authentic Omni icons for all tray states
const icoBuffer = packIco(pngBuffers, SIZES);
if (!existsSync(targetIconsDir)) mkdirSync(targetIconsDir, { recursive: true });

for (const fileName of TRAY_FILES) {
  writeFileSync(join(targetIconsDir, fileName), icoBuffer);
}

// 5. Clean up staging directory
rmSync(stagingDir, { recursive: true, force: true });
console.log(`Successfully generated and installed ${TRAY_FILES.length} Omni tray icons (${SIZES.join(', ')} px).`);
