import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildConstitutionContent,
  buildSpecsReadmeContent,
  scaffoldProject,
  createSpec,
  ARCHETYPES
} from '../src/generator.mjs';
import { loadManifest } from '../src/manifest.mjs';

describe('Project & Spec Generator', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omnispec-gen-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // Safe temp dir cleanup
      }
    }
  });

  describe('buildConstitutionContent', () => {
    test('renders fintech regulatory invariants', () => {
      const content = buildConstitutionContent({
        projectName: 'NeoBank',
        profile: 'fintech',
        stack: 'PostgreSQL / Node.js',
        docStandard: 'TSDoc'
      });

      assert.match(content, /# CONSTITUTION — NeoBank/);
      assert.match(content, /PCI-DSS/);
      assert.match(content, /Double-Entry Ledger/i);
      assert.match(content, /TSDoc/);
    });

    test('renders bpo regulatory invariants', () => {
      const content = buildConstitutionContent({
        projectName: 'Pulso360',
        profile: 'bpo',
        stack: 'React / Node.js',
        docStandard: 'JSDoc'
      });

      assert.match(content, /# CONSTITUTION — Pulso360/);
      assert.match(content, /k-Anonymity/i);
      assert.match(content, /Anti-Slop/i);
      assert.match(content, /Ley 1581/i);
    });
  });

  describe('scaffoldProject', () => {
    test('creates CONSTITUTION.md, specs/README.md, specs/manifest.json and templates', async () => {
      const res = await scaffoldProject(tempDir, {
        projectName: 'AcmeApp',
        profile: 'general',
        stack: 'Node / Express',
        docStandard: 'JSDoc'
      });

      assert.ok(res.constitutionPath);
      assert.ok(res.specsDir);

      const constContent = await readFile(res.constitutionPath, 'utf-8');
      assert.match(constContent, /AcmeApp/);

      const readmeContent = await readFile(join(tempDir, 'specs', 'README.md'), 'utf-8');
      assert.match(readmeContent, /AcmeApp — Spec-Driven Development/);

      const manifest = await loadManifest(tempDir);
      assert.equal(manifest.project, 'AcmeApp');

      const templateDirs = await readdir(join(tempDir, 'specs', '_templates'));
      assert.deepEqual(templateDirs.sort(), ['01-feature', '02-bugfix', '03-tech-debt', '04-rfc-idea'].sort());
    });
  });

  describe('createSpec', () => {
    beforeEach(async () => {
      await scaffoldProject(tempDir, {
        projectName: 'TestApp',
        profile: 'general'
      });
    });

    test('creates a feature spec with correct files and variable substitution', async () => {
      const spec = await createSpec(tempDir, 'feature', 'user-onboarding');

      assert.equal(spec.id, '001');
      assert.equal(spec.slug, '001-user-onboarding');
      assert.equal(spec.branch, 'feat/001-user-onboarding');

      const files = await readdir(spec.specDir);
      assert.deepEqual(files.sort(), ['plan.md', 'spec.md', 'tasks.md'].sort());

      const specContent = await readFile(join(spec.specDir, 'spec.md'), 'utf-8');
      assert.match(specContent, /SPEC-001/);
      assert.match(specContent, /User Onboarding/);
      assert.doesNotMatch(specContent, /XXX/);

      const manifest = await loadManifest(tempDir);
      assert.equal(manifest.active_spec, '001-user-onboarding');
      assert.equal(manifest.specs.length, 1);
    });

    test('creates consecutive specs with incrementing IDs and proper archetypes', async () => {
      const s1 = await createSpec(tempDir, 'feature', 'billing-checkout');
      assert.equal(s1.id, '001');

      const s2 = await createSpec(tempDir, 'bugfix', 'stripe-webhook-timeout');
      assert.equal(s2.id, '002');
      assert.equal(s2.branch, 'fix/002-stripe-webhook-timeout');
      const s2Files = await readdir(s2.specDir);
      assert.deepEqual(s2Files.sort(), ['bug.md', 'fix.md', 'rca.md'].sort());

      const s3 = await createSpec(tempDir, 'debt', 'upgrade-node-22');
      assert.equal(s3.id, '003');
      assert.equal(s3.branch, 'debt/003-upgrade-node-22');
      const s3Files = await readdir(s3.specDir);
      assert.deepEqual(s3Files.sort(), ['audit.md', 'migration-plan.md', 'tasks.md'].sort());

      const s4 = await createSpec(tempDir, 'rfc', 'graphql-vs-trpc');
      assert.equal(s4.id, '004');
      assert.equal(s4.branch, 'rfc/004-graphql-vs-trpc');
      const s4Files = await readdir(s4.specDir);
      assert.deepEqual(s4Files, ['rfc.md']);

      const manifest = await loadManifest(tempDir);
      assert.equal(manifest.specs.length, 4);
      assert.equal(manifest.active_spec, '004-graphql-vs-trpc');
    });

    test('throws an error if archetype is invalid', async () => {
      await assert.rejects(
        async () => {
          await createSpec(tempDir, 'invalid-type', 'some-name');
        },
        /Invalid archetype "invalid-type"/
      );
    });
  });
});
