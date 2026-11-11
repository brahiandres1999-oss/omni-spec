// Compare component versions written in project documents with the versions their build manifests
// declare. A declaration is not an installed version; this only catches text that contradicts it.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const PACKAGES = {
  react: 'React',
  vite: 'Vite',
  typescript: 'TypeScript',
  next: 'Next.js',
  vue: 'Vue',
  '@angular/core': 'Angular',
  tailwindcss: 'Tailwind CSS',
  express: 'Express',
};
const SKIP = new Set(['node_modules', 'specs', 'target', 'dist', 'build', 'coverage']);

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) return null;
    throw error;
  }
}

function fromPom(text, source) {
  const found = [];
  const parent = text.match(/<parent>[\s\S]*?<\/parent>/)?.[0] || '';
  if (/<artifactId>\s*spring-boot-starter-parent\s*<\/artifactId>/.test(parent)) {
    const version = parent.match(/<version>\s*([^<\s]+)\s*<\/version>/)?.[1];
    if (version) found.push({ component: 'Spring Boot', version, source });
  }
  const java = text.match(/<java\.version>\s*([^<\s]+)\s*<\/java\.version>/)?.[1];
  if (java) found.push({ component: 'Java', version: java, source });
  return found;
}

function fromPackage(text, source) {
  let pkg;
  try {
    pkg = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return [];
  }
  const dependencies = { ...pkg.devDependencies, ...pkg.dependencies };
  return Object.entries(PACKAGES).flatMap(([name, component]) => {
    const version = String(dependencies[name] ?? '').match(/\d+(?:\.\d+){0,2}/)?.[0];
    return version ? [{ component, version, source }] : [];
  });
}

/**
 * Versions declared by pom.xml and package.json at the project root and in its first-level folders.
 * @param {string} root Project root.
 * @returns {Promise<{component: string, version: string, source: string}[]>} source is project-relative.
 * @throws {Error} A manifest exists but cannot be read for a reason other than absence.
 */
export async function declaredVersions(root) {
  const folders = [''];
  for (const entry of await readdir(root, { withFileTypes: true }))
    if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIP.has(entry.name)) folders.push(entry.name);
  const found = [];
  for (const folder of folders) {
    const prefix = folder ? `${folder}/` : '';
    const pom = await readOptional(join(root, folder, 'pom.xml'));
    if (pom) found.push(...fromPom(pom, `${prefix}pom.xml`));
    const pkg = await readOptional(join(root, folder, 'package.json'));
    if (pkg) found.push(...fromPackage(pkg, `${prefix}package.json`));
  }
  return found;
}

const segments = version => version.split('.').map(Number);
// "18" or "18.3" is consistent with a declared 18.3.1; "3.4.1" is not consistent with 4.1.2.
const consistent = (mentioned, declared) =>
  segments(mentioned).every((part, index) => index >= segments(declared).length || part === segments(declared)[index]);

/**
 * Mentions of a declared component whose version contradicts every declaration of that component.
 * @param {string} text Document text, such as specs/project-context.md or plan.md.
 * @param {{component: string, version: string, source: string}[]} declared From declaredVersions.
 * @returns {{component: string, mentioned: string, declared: string[], sources: string[]}[]} One entry
 *   per contradicting version, deduplicated.
 */
export function contradictedVersions(text, declared) {
  const byComponent = new Map();
  for (const item of declared) byComponent.set(item.component, [...(byComponent.get(item.component) || []), item]);
  const result = [];
  for (const [component, items] of byComponent) {
    const name = component.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*');
    const seen = new Set();
    for (const match of text.matchAll(new RegExp(`\\b${name}\\s*v?(\\d+(?:\\.\\d+){0,2})\\b`, 'gi'))) {
      const mentioned = match[1];
      if (seen.has(mentioned) || items.some(item => consistent(mentioned, item.version))) continue;
      seen.add(mentioned);
      result.push({
        component,
        mentioned,
        declared: items.map(item => item.version),
        sources: items.map(item => item.source),
      });
    }
  }
  return result;
}

/** One readable line per contradiction, naming the document and the manifest to re-check. */
export function describeContradiction(document, item) {
  return `${document} mentions ${item.component} ${item.mentioned}, but ${item.sources.join(', ')} declares ${item.declared.join(', ')}. Re-check against the manifest before relying on it.`;
}
