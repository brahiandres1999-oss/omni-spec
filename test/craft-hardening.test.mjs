import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildConstitutionContent, scaffoldProject } from '../src/generator.mjs';
import { OMNI_SKILLS } from '../src/workflows.mjs';
import { integrationEntries } from '../src/integrations.mjs';
import { DESIGN, DOCUMENTATION, QUESTIONS, TECHNOLOGY, SETUP, HOST_RULE } from '../src/protocols.mjs';

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

  test('constitution distributes contextual design and accurate documentation instead of universal recipes', () => {
    const content = buildConstitutionContent({ projectName: 'CraftApp', profile: 'general' });
    assert.match(content, /UI Ergonomics & Frontend Craft/);
    for (const policy of [DESIGN, DOCUMENTATION, QUESTIONS, TECHNOLOGY, SETUP]) assert.ok(content.includes(policy));
    assert.doesNotMatch(content, /4 Mandatory Interface States|CLS=0|scale-\[0\.98\]/);
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
    assert.ok(planSkill.instructions.includes(DESIGN));
    assert.ok(implementSkill.instructions.includes(DOCUMENTATION));
    assert.ok(tasksSkill.instructions.includes(QUESTIONS));
    assert.ok(!tasksSkill.instructions.includes(DESIGN));
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
