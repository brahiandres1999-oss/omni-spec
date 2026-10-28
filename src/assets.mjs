import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Machine-local OmniSpec state and the portable runtime, which update restores with the
// manifest's version. Specifications, acceptance/verification records, context, decisions
// and contracts stay versioned.
export const SPECS_GITIGNORE = `# OMNI-SPEC-START
# OmniSpec local state and restorable runtime (managed section). Specs and their records remain versioned.
manifest.lock/
*.tmp
manifest.json.tmp.*
.omni/verify.lock/
.omni/verification-logs/
.omni/backups/
.omni/inputs/
.omni/runtime/
# OMNI-SPEC-END`;

export const UI_COMPANIONS = ['better', 'frontend-design', 'none'];
export const COMPANIONS_PREFIX = 'specs/.omni/companions/';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
async function files(directory, destination) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const target = `${destination}/${entry.name}`;
    if (entry.isDirectory()) result.push(...(await files(path, target)));
    else if (entry.isFile()) result.push({ path: target, content: await readFile(path, 'utf8') });
  }
  return result;
}

/**
 * Whether the bundled companion catalog is available in this package distribution.
 * Returns false for a missing or empty catalog, including the isolated local runtime.
 * @returns {Promise<boolean>}
 * @throws {Error} Filesystem errors other than a missing catalog.
 */
export async function companionCatalogAvailable() {
  try {
    const entries = await readdir(join(packageRoot, 'companions'));
    return Array.isArray(entries) && entries.length > 0;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return false;
  }
}

/**
 * Return companion files to install under specs/.omni/companions/<name>/.
 * Returns [] for 'none' or undefined.
 * @param {string|undefined} name Companion name (better, frontend-design, none).
 * @returns {Promise<Array<{path: string, content: string}>>}
 * @throws {Error} Invalid name, missing catalog, unreadable package metadata or filesystem error.
 */
export async function companionEntries(name) {
  if (name === undefined || name === 'none') return [];
  if (!UI_COMPANIONS.includes(name))
    throw new Error(`Invalid UI companion "${name}". Valid values: ${UI_COMPANIONS.join(', ')}`);
  const catalogDir = join(packageRoot, 'companions', name);
  try {
    await readdir(catalogDir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const { version } = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    if (typeof version !== 'string' || !version.trim()) throw new Error('OmniSpec package.json has no version.');
    throw new Error(
      `Companion catalog for "${name}" is not available in the current OmniSpec distribution. Run npx omni-spec@${version} init or npx omni-spec@${version} update to install or update companions.`,
    );
  }
  const destination = `specs/.omni/companions/${name}`;
  return files(catalogDir, destination);
}

export async function packageEntries() {
  const entries = await files(join(packageRoot, 'src', 'templates'), 'specs/_templates');
  for (const directory of ['src', 'bin', 'schema', 'agents']) {
    entries.push(...(await files(join(packageRoot, directory), `specs/.omni/runtime/${directory}`)));
  }
  entries.push({
    path: 'specs/.omni/runtime/package.json',
    content: await readFile(join(packageRoot, 'package.json'), 'utf8'),
  });
  entries.push({ path: 'specs/.omni/runtime/LICENSE', content: await readFile(join(packageRoot, 'LICENSE'), 'utf8') });
  entries.push({ path: 'specs/.gitignore', content: SPECS_GITIGNORE, section: 'hash' });
  return entries;
}
