import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildConstitutionContent, scaffoldProject } from '../src/generator.mjs';
import { OMNI_SKILLS } from '../src/workflows.mjs';
import { integrationEntries } from '../src/integrations.mjs';
import { updateProject } from '../src/updater.mjs';
import { loadManifest } from '../src/manifest.mjs';
import { profiles } from '../src/profiles/index.mjs';
import { DOCUMENTATION, QUESTIONS, TECHNOLOGY, SETUP, HOST_RULE } from '../src/protocols.mjs';

// One sentence from each paragraph of the former DESIGN policy, now served only by guide design.
const DESIGN_FRAGMENTS = [
  'Distinguish a landing page from an operational tool',
  'research a small set of relevant real interfaces or official design-system examples',
  'No blanket prohibition or mandatory recipe for cards',
  'build a representative rendered surface or interactive prototype',
  'Review applicable normal, focus, loading, empty, error/recovery',
  'Without a suitable inspection tool, mark those checks NOT_VERIFIED',
];
const TECHNOLOGY_INVARIANT =
  'Never select or pin a dependency or runtime version from memory: consult current official sources and the package registry, record the dated sources with the approval or delegation (decision-record), and prefer runtime-native APIs when they suffice. Without web access the choice stays provisional.';

function section(content, number) {
  const start = content.indexOf(`\n## ${number}. `);
  assert.ok(start >= 0, `section ${number}`);
  const end = content.indexOf('\n## ', start + 1);
  return content.slice(start, end < 0 ? undefined : end);
}

describe('Delivery protocol distribution (not a generated-product quality evaluation)', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omnispec-craft-'));
  });

  afterEach(async () => {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {}
    }
  });

  test('buildConstitutionContent includes Backend Craft and Zero Code Slop clauses', () => {
    const content = buildConstitutionContent({ projectName: 'CraftApp', profile: 'general' });
    assert.match(content, /Backend Pragmatic Craft & Zero Code Slop/);
    assert.match(content, /Strict YAGNI & Direct Implementation/);
    assert.match(content, /Zero Comment Slop/);
    assert.match(content, /Fail-Fast & Transparent Failures/);
    assert.match(content, /Zero Spec & Plan Slop/);
  });

  test('every profile constitution keeps its sections and drops the policies served by guides', () => {
    for (const [id, profile] of Object.entries(profiles)) {
      const content = buildConstitutionContent({ profile: id });
      assert.match(
        section(content, 1),
        /Governance & Code Surgery[\s\S]*Pre-Execution Diagnostic[\s\S]*Zero Spec & Plan Slop/,
        id,
      );
      assert.ok(section(content, 2).includes(profile.constitutionInvariants), id);
      assert.match(section(content, 4), /Delivery Quality Gates[\s\S]*# Not configured/, id);
      assert.ok(content.includes('* **Primary Tech Stack:** `Undecided`'), id);
      assert.ok(content.includes('* **Documentation Standard:** `Project conventions`'), id);
      assert.ok(content.includes(DOCUMENTATION), id);
      assert.ok(content.includes(QUESTIONS), id);
      assert.ok(content.includes('## 5. UI Ergonomics & Frontend Craft (Anti-Slop)'), id);
      for (const line of [...TECHNOLOGY.split('\n'), ...SETUP.split('\n')]) assert.ok(!content.includes(line), line);
      for (const fragment of DESIGN_FRAGMENTS) assert.ok(!content.includes(fragment), fragment);
      assert.doesNotMatch(content, /4 Mandatory Interface States|CLS=0|scale-\[0\.98\]/);
    }
  });

  test('constitution keeps a technology invariant and points setup and interface work to guides', () => {
    for (const id of Object.keys(profiles)) {
      const content = buildConstitutionContent({ profile: id });
      const technology = section(content, 3);
      assert.ok(technology.includes(TECHNOLOGY_INVARIANT), id);
      assert.match(technology, /Setup, Git, the commit convention and session capabilities follow guide setup\./, id);
      const ui = section(content, 5);
      assert.match(ui, /Interface work follows guide design/, id);
      assert.match(ui, /Changes without an interface do not load it\./, id);
      assert.doesNotMatch(ui, /scope/i, id);
      assert.ok(!content.includes('specs/.omni/runtime'), id);
    }
  });

  test('update preserves a different constitution and writes the light one as reference', async () => {
    await scaffoldProject(tempDir, { projectName: 'RefApp', profile: 'fintech' });
    const constitution = join(tempDir, 'CONSTITUTION.md');
    const own = '# Our constitution\r\n\r\nKept byte for byte.\r\n';
    await writeFile(constitution, own);
    const result = await updateProject(tempDir, {});
    assert.equal(result.constitution.status, 'PRESERVED_REVIEW_RECOMMENDED');
    assert.equal(result.constitution.reference, 'specs/.omni/reference/CONSTITUTION.md');
    assert.equal(await readFile(constitution, 'utf8'), own);
    const manifest = await loadManifest(tempDir);
    assert.equal(
      await readFile(join(tempDir, result.constitution.reference), 'utf8'),
      buildConstitutionContent({
        projectName: manifest.project,
        profile: manifest.profile,
        stack: manifest.stack,
        docStandard: manifest.documentationStandard,
        qualityGates: manifest.qualityGates,
      }),
    );
  });

  test('scaffoldProject outputs constitution with both backend and frontend craft invariants on disk', async () => {
    const res = await scaffoldProject(tempDir, {
      projectName: 'TestCraftDisk',
      profile: 'general',
    });
    const constitution = await readFile(res.constitutionPath, 'utf-8');
    assert.match(constitution, /Backend Pragmatic Craft & Zero Code Slop/);
    assert.match(constitution, /UI Ergonomics & Frontend Craft/);
  });

  test('workflows distribute relevant policies without making every change repeat full discovery', () => {
    const planSkill = OMNI_SKILLS.find(s => s.name === 'omni-plan');
    const tasksSkill = OMNI_SKILLS.find(s => s.name === 'omni-tasks');
    const implementSkill = OMNI_SKILLS.find(s => s.name === 'omni-implement');

    assert.ok(planSkill);
    assert.ok(tasksSkill);
    assert.ok(implementSkill);

    // Common protocol check
    assert.ok(planSkill.instructions.includes(TECHNOLOGY));
    assert.match(planSkill.instructions, /For interface work run guide design/);
    for (const skill of OMNI_SKILLS)
      for (const fragment of DESIGN_FRAGMENTS)
        assert.ok(!skill.instructions.includes(fragment), `${skill.name}: ${fragment}`);
    assert.ok(implementSkill.instructions.includes(DOCUMENTATION));
    assert.ok(tasksSkill.instructions.includes(QUESTIONS));
    assert.match(planSkill.instructions, /Code craft:/i);
    assert.match(planSkill.instructions, /Spec and plan craft:/i);
    assert.match(planSkill.instructions, /UI craft/i);

    // Specific workflow additions
    assert.match(planSkill.instructions, /speculative architecture or unrequested abstraction layers/i);
    assert.match(tasksSkill.instructions, /Avoid task inflation/i);
    assert.match(implementSkill.instructions, /without parrot comments or speculative fallbacks/i);
  });

  test('integrationEntries distributes the same project contract into agent configurations', () => {
    const entries = integrationEntries({ version: '0.5.1' }, { agent: 'cursor' });
    const cursorRule = entries.find(e => e.path.endsWith('.cursor/rules/omni-spec.mdc'));
    assert.ok(cursorRule);
    assert.ok(cursorRule.content.includes(HOST_RULE));
    assert.doesNotMatch(cursorRule.content, /Deliver first-pass precision|4 mandatory states/i);
  });
});
