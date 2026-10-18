import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
async function files(directory, destination) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const target = `${destination}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await files(path, target));
    else if (entry.isFile()) result.push({ path: target, content: await readFile(path, 'utf8') });
  }
  return result;
}

export async function packageEntries() {
  const entries = await files(join(packageRoot, 'src', 'templates'), 'specs/_templates');
  for (const directory of ['src', 'bin', 'schema']) {
    entries.push(...await files(join(packageRoot, directory), `specs/.omni/runtime/${directory}`));
  }
  entries.push({ path: 'specs/.omni/runtime/package.json', content: await readFile(join(packageRoot, 'package.json'), 'utf8') });
  entries.push({ path: 'specs/.omni/runtime/LICENSE', content: await readFile(join(packageRoot, 'LICENSE'), 'utf8') });
  return entries;
}
