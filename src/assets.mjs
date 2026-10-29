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
