import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { runCli } from '../src/cli.mjs';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { loadManifest, MANIFEST_SCHEMA_URL } from '../src/manifest.mjs';
import { detectProjectEnvironment } from '../src/detector.mjs';
import { updateProject } from '../src/updater.mjs';

const BIN_PATH = fileURLToPath(new URL('../bin/omni-spec.mjs', import.meta.url));
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

describe('Regression R14-R21: Real-World Field Adoption', () => {
  let tempDir;
  let origLog;
  let origError;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omnispec-field-test-'));
    origLog = console.log;
    origError = console.error;
    console.log = () => {};
    console.error = () => {};
  });

  afterEach(async () => {
    if (origLog) console.log = origLog;
    if (origError) console.error = origError;
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // Safe temp dir cleanup
      }
    }
  });

  test('R14: commands run from a subdirectory operate on the discovered project root', async () => {
    await scaffoldProject(tempDir, { projectName: 'RootProject' });
    const subDir = join(tempDir, 'src', 'components');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(subDir, { recursive: true });

    const code = await runCli(['create', 'feature', 'subdir-created'], subDir);
    assert.equal(code, 0);

    // The spec must land in the ROOT project, not in a nested structure.
    const manifest = await loadManifest(tempDir);
    assert.equal(manifest.specs.length, 1);
    assert.equal(manifest.specs[0].slug, '001-subdir-created');
    assert.equal(await pathExists(join(tempDir, 'specs', '001-subdir-created', 'spec.md')), true);
    assert.equal(await pathExists(join(subDir, 'specs')), false, 'no nested specs folder may be created');

    // status must also resolve the root instead of claiming no manifest exists.
    const statusCode = await runCli(['status'], subDir);
    assert.equal(statusCode, 0);
  });

  test('R15: create without any OmniSpec project fails loudly and leaves the directory clean', async () => {
    const code = await runCli(['create', 'feature', 'ghost-spec'], tempDir);
    assert.equal(code, 1);
    assert.equal(await pathExists(join(tempDir, 'CONSTITUTION.md')), false);
    assert.equal(await pathExists(join(tempDir, 'specs')), false, 'no manifest.lock or specs scaffold may silently appear');
  });

  test('R16: init inside an existing OmniSpec project is blocked to prevent nested universes', async () => {
    await scaffoldProject(tempDir, { projectName: 'ParentProject' });
    const subDir = join(tempDir, 'packages', 'api');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(subDir, { recursive: true });

    const code = await runCli(['init', '--yes'], subDir);
    assert.equal(code, 1);
    assert.equal(await pathExists(join(subDir, 'CONSTITUTION.md')), false);

    // The parent project must remain untouched.
    const manifest = await loadManifest(tempDir);
    assert.equal(manifest.project, 'ParentProject');
  });

  test('R17: interactive wizard with closed stdin fails loudly instead of exiting 0 silently', { timeout: 30000 }, async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'omnispec-eof-test-'));
    try {
      const child = spawn(process.execPath, [BIN_PATH, 'init'], {
        cwd: emptyDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stderr = '';
      child.stderr.on('data', data => { stderr += data; });
      const timer = setTimeout(() => child.kill(), 20000);
      const [code] = await once(child, 'close');
      clearTimeout(timer);

      assert.notEqual(code, 0, 'EOF during the wizard must never exit with a success code');
      assert.match(stderr, /--yes/);
      assert.equal(await pathExists(join(emptyDir, 'CONSTITUTION.md')), false, 'nothing may be half-initialized');
      assert.equal(await pathExists(join(emptyDir, 'specs')), false);
    } finally {
      await rm(emptyDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test('R18: UTF-8 BOM in package.json no longer breaks stack and gate detection', async () => {
    const pkg = JSON.stringify({
      name: 'bom-app',
      scripts: { test: 'vitest run', lint: 'eslint .' },
      devDependencies: { typescript: '^5.4.0' }
    });
    await writeFile(join(tempDir, 'package.json'), Buffer.concat([BOM, Buffer.from(pkg, 'utf-8')]));

    const detected = await detectProjectEnvironment(tempDir);
    assert.equal(detected.detectedStack, 'Node.js / TypeScript');
    assert.equal(detected.docStandard, 'TSDoc');
    assert.match(detected.qualityGates, /npm run lint/);
    assert.equal(detected.warnings.length, 0);
  });

  test('R18b: invalid package.json warns instead of silently misconfiguring the project', async () => {
    await writeFile(join(tempDir, 'package.json'), '{ broken json', 'utf-8');
    const detected = await detectProjectEnvironment(tempDir);
    assert.equal(detected.detectedStack, 'Unknown / existing project');
    assert.ok(detected.warnings.length >= 1);
    assert.match(detected.warnings[0], /package\.json/);
  });

  test('R18c: manifest.json saved with a BOM still loads correctly', async () => {
    await scaffoldProject(tempDir, { projectName: 'BomManifest' });
    const manifestPath = join(tempDir, 'specs', 'manifest.json');
    const raw = await readFile(manifestPath, 'utf-8');
    await writeFile(manifestPath, Buffer.concat([BOM, Buffer.from(raw, 'utf-8')]));

    const manifest = await loadManifest(tempDir);
    assert.equal(manifest.project, 'BomManifest');
  });

  test('R19: Spanish diacritics are transliterated into readable slugs', async () => {
    await scaffoldProject(tempDir, { projectName: 'SlugProject' });
    const spec = await createSpec(tempDir, 'feature', 'Gestión Usuarios Ñandú');
    assert.equal(spec.slug, '001-gestion-usuarios-nandu');

    // Names with no ASCII survivors fall back instead of producing an empty slug.
    const fallback = await createSpec(tempDir, 'feature', '日本語');
    assert.match(fallback.slug, /^002-spec$/);
  });

  test('R20: manifest $schema points at a schema that actually exists in the repository', async () => {
    await scaffoldProject(tempDir, { projectName: 'SchemaProject' });
    const manifest = await loadManifest(tempDir);
    assert.equal(manifest.$schema, MANIFEST_SCHEMA_URL);

    const schemaPath = fileURLToPath(new URL('../schema/manifest.schema.json', import.meta.url));
    const schema = JSON.parse(await readFile(schemaPath, 'utf-8'));
    const installedSchema = JSON.parse(await readFile(join(tempDir, 'specs', manifest.$schema), 'utf8'));
    assert.deepEqual(installedSchema, schema);
    assert.ok(schema.required.includes('specs'));
    assert.ok(schema.required.includes('project'));
  });

  test('R21: omni-spec update genuinely refreshes project templates from the CLI source', async () => {
    await scaffoldProject(tempDir, { projectName: 'TemplateProject' });
    const templateSpecPath = join(tempDir, 'specs', '_templates', '01-feature', 'spec.md');
    await writeFile(templateSpecPath, '<!-- STALE MARKER R21 -->\n' + await readFile(templateSpecPath, 'utf-8'));

    await assert.rejects(updateProject(tempDir), /Local changes preserved/);
    await updateProject(tempDir, { acceptUpdates: true });

    const refreshed = await readFile(templateSpecPath, 'utf-8');
    assert.equal(refreshed.includes('STALE MARKER R21'), false, 'stale template content must be replaced on update');
    assert.match(refreshed, /Fase de Clarificaci/);

    // Templates for all four archetypes must be present after the copy.
    const templates = await readdir(join(tempDir, 'specs', '_templates'));
    assert.ok(templates.includes('01-feature'));
    assert.ok(templates.includes('02-bugfix'));
    assert.ok(templates.includes('03-tech-debt'));
    assert.ok(templates.includes('04-rfc-idea'));
  });
});
