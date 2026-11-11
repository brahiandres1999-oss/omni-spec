import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

const pageRoot = process.env.OMNI_PAGE_DIR || resolve('..', 'OmniPage');
const fallbackPageRoot = 'C:\\dev\\OmniPage';

const targetDir = existsSync(pageRoot) ? pageRoot : existsSync(fallbackPageRoot) ? fallbackPageRoot : null;

if (!targetDir) {
  console.error('[ERROR] OmniPage directory not found at', pageRoot, 'or', fallbackPageRoot);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const version = pkg.version;
const today = new Date().toISOString().split('T')[0];

console.log(`[INFO] Syncing OmniSpec v${version} to OmniPage at ${targetDir}...`);

// 1. Update src/data/omnispec.ts
const omnispecTsPath = join(targetDir, 'src', 'data', 'omnispec.ts');
if (existsSync(omnispecTsPath)) {
  let content = readFileSync(omnispecTsPath, 'utf8');
  content = content.replace(/version:\s*'[^']+'/, `version: '${version}'`);
  content = content.replace(/badge:\s*'[^']+'/, `badge: '${version} Oficial'`);
  content = content.replace(/date:\s*'[^']+'/, `date: '${today}'`);
  writeFileSync(omnispecTsPath, content, 'utf8');
  console.log(`[OK] Updated ${omnispecTsPath}`);
}

// 2. Update src/i18n/translations.ts version label
const translationsPath = join(targetDir, 'src', 'i18n', 'translations.ts');
if (existsSync(translationsPath)) {
  let content = readFileSync(translationsPath, 'utf8');
  content = content.replace(/'hero\.version_label':\s*'[^']+'/, `'hero.version_label': '${version}'`);
  writeFileSync(translationsPath, content, 'utf8');
  console.log(`[OK] Updated ${translationsPath}`);
}

// 3. Verify ProductCanvas terminal version
const productCanvasPath = join(targetDir, 'src', 'components', 'ProductCanvas.astro');
if (existsSync(productCanvasPath)) {
  let content = readFileSync(productCanvasPath, 'utf8');
  content = content.replace(/v\d+\.\d+\.\d+/g, `v${version}`);
  writeFileSync(productCanvasPath, content, 'utf8');
  console.log(`[OK] Verified ${productCanvasPath}`);
}

// 4. Validate OmniPage build and tests
console.log('[INFO] Running OmniPage tests...');
try {
  execSync(`npm --prefix "${targetDir}" test`, { stdio: 'inherit' });
  console.log(`[SUCCESS] OmniPage is completely synchronized with OmniSpec v${version}!`);
} catch (err) {
  console.error('[ERROR] OmniPage tests failed:', err.message);
  process.exit(1);
}
