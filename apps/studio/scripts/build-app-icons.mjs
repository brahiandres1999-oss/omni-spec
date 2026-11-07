// Generates application icons for Omni Studio across desktop and web formats.
// Reads the canonical OmniSpec icon from assets/omni-spec-icon.svg, invokes Tauri's
// icon pipeline to produce platform binaries in src-tauri/icons/ (preserving tray icons),
// and populates public/ for browser and webview usage.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const studioRoot = resolve(__dirname, '..');
const repoRoot = resolve(studioRoot, '../..');
const sourceSvg = resolve(repoRoot, 'assets/omni-spec-icon.svg');
const targetIconsDir = resolve(studioRoot, 'src-tauri/icons');
const stagingDir = resolve(studioRoot, '.staging-icons');
const publicDir = resolve(studioRoot, 'public');

if (!existsSync(sourceSvg)) {
  console.error(`Source icon not found at: ${sourceSvg}`);
  process.exit(1);
}

// 1. Prepare staging directory
if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });

// 2. Run tauri icon via npx / local CLI
console.log('Generating platform icons with Tauri CLI...');
execSync('npx tauri icon -o .staging-icons ../../assets/omni-spec-icon.svg', {
  cwd: studioRoot,
  stdio: 'inherit',
});

// 3. Copy generated app icons into src-tauri/icons (without touching tray-*.ico)
console.log('Installing desktop icons into src-tauri/icons/ ...');
const generatedFiles = readdirSync(stagingDir);
for (const file of generatedFiles) {
  if (file.startsWith('tray-')) continue; // never overwrite system tray icons
  const src = join(stagingDir, file);
  if (!statSync(src).isFile()) continue; // copy desktop platform files only
  const dst = join(targetIconsDir, file);
  copyFileSync(src, dst);
}

// 4. Ensure public/ directory exists and copy web assets
if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true });
copyFileSync(sourceSvg, join(publicDir, 'favicon.svg'));
if (existsSync(join(stagingDir, '32x32.png'))) {
  copyFileSync(join(stagingDir, '32x32.png'), join(publicDir, 'icon.png'));
}

// 5. Clean up staging directory
rmSync(stagingDir, { recursive: true, force: true });
console.log('Omni Studio application icons generated and installed successfully.');
