import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const MANIFEST_FILE = 'manifest.json';

export async function getManifestPath(baseDir) {
  return join(baseDir, 'specs', MANIFEST_FILE);
}

export async function loadManifest(baseDir) {
  const filePath = await getManifestPath(baseDir);
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw new Error(`Failed to parse ${MANIFEST_FILE}: ${err.message}`);
  }
}

export async function saveManifest(baseDir, manifest) {
  const specsDir = join(baseDir, 'specs');
  await mkdir(specsDir, { recursive: true });
  const filePath = join(specsDir, MANIFEST_FILE);
  const content = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(filePath, content, 'utf-8');
  return manifest;
}

export async function initManifest(baseDir, options = {}) {
  const manifest = {
    $schema: 'https://raw.githubusercontent.com/omni-spec/omni-spec/main/schema/manifest.schema.json',
    project: options.projectName || 'MyProject',
    version: '0.2.0',
    profile: options.profile || 'general',
    stack: options.stack || options.techStack || 'Node.js',
    documentationStandard: options.docStandard || options.documentationStandard || 'JSDoc',
    active_spec: null,
    active_archetype: null,
    specs: []
  };

  return saveManifest(baseDir, manifest);
}

export async function addSpec(baseDir, specEntry) {
  let manifest = await loadManifest(baseDir);
  if (!manifest) {
    manifest = await initManifest(baseDir);
  }

  const entry = {
    status: 'IN_PROGRESS',
    created_at: new Date().toISOString(),
    ...specEntry
  };

  // Set active spec
  manifest.active_spec = entry.slug;
  manifest.active_archetype = entry.type;

  // Add or update entry in specs array
  const existingIdx = manifest.specs.findIndex(s => s.id === entry.id);
  if (existingIdx >= 0) {
    manifest.specs[existingIdx] = { ...manifest.specs[existingIdx], ...entry };
  } else {
    manifest.specs.push(entry);
  }

  await saveManifest(baseDir, manifest);
  return entry;
}

export async function updateSpecStatus(baseDir, id, newStatus) {
  const manifest = await loadManifest(baseDir);
  if (!manifest) {
    throw new Error('No OmniSpec manifest found. Run `omni-spec init` first.');
  }

  const spec = manifest.specs.find(s => s.id === id || s.slug === id);
  if (!spec) {
    throw new Error(`Spec with identifier "${id}" not found in manifest.`);
  }

  spec.status = newStatus;
  spec.updated_at = new Date().toISOString();
  if (newStatus === 'COMPLETED') {
    spec.completed_at = spec.updated_at;
  }

  if (manifest.active_spec === spec.slug && ['COMPLETED', 'CLOSED', 'SUPERSEDED'].includes(newStatus)) {
    manifest.active_spec = null;
    manifest.active_archetype = null;
  }

  await saveManifest(baseDir, manifest);
  return spec;
}

export async function getActiveSpec(baseDir) {
  const manifest = await loadManifest(baseDir);
  if (!manifest || !manifest.active_spec) {
    return null;
  }

  return manifest.specs.find(s => s.slug === manifest.active_spec) || null;
}
