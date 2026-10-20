import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildConstitutionContent, scaffoldProject } from '../src/generator.mjs';
import { OMNI_SKILLS } from '../src/workflows.mjs';
import { integrationEntries } from '../src/integrations.mjs';

describe('OmniSpec 0.5.1: First-Pass Anti-Slop & Craft Invariants', () => {
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

  test('buildConstitutionContent includes Frontend Craft and Impeccable-grade UI clauses', () => {
    const content = buildConstitutionContent({ projectName: 'CraftApp', profile: 'general' });
    assert.match(content, /UI Ergonomics & Frontend Craft/);
    assert.match(content, /Zero Visual Slop/);
    assert.match(content, /card-itis/);
    assert.match(content, /Intentional Typography & Whitespace/);
    assert.match(content, /Interactive Polish & Micro-Interactions/);
    assert.match(content, /4 Mandatory Interface States/);
    assert.match(content, /Accessibility \(WCAG AA\)/);
  });

  test('scaffoldProject outputs constitution with both backend and frontend craft invariants on disk', async () => {
    const res = await scaffoldProject(tempDir, {
      projectName: 'TestCraftDisk',
      profile: 'general'
    });
    const constitution = await readFile(res.constitutionPath, 'utf-8');
    assert.match(constitution, /Backend Pragmatic Craft & Zero Code Slop/);
    assert.match(constitution, /UI Ergonomics & Frontend Craft/);
  });

  test('OMNI_SKILLS common protocol and specific workflows enforce first-pass precision', () => {
    const planSkill = OMNI_SKILLS.find(s => s.name === 'omni-plan');
    const tasksSkill = OMNI_SKILLS.find(s => s.name === 'omni-tasks');
    const implementSkill = OMNI_SKILLS.find(s => s.name === 'omni-implement');

    assert.ok(planSkill);
    assert.ok(tasksSkill);
    assert.ok(implementSkill);

    // Common protocol check
    assert.match(planSkill.instructions, /first-pass precision/i);
    assert.match(planSkill.instructions, /Code craft:/i);
    assert.match(planSkill.instructions, /Spec and plan craft:/i);
    assert.match(planSkill.instructions, /UI craft/i);

    // Specific workflow additions
    assert.match(planSkill.instructions, /speculative architecture or unrequested abstraction layers/i);
    assert.match(tasksSkill.instructions, /Avoid task inflation/i);
    assert.match(implementSkill.instructions, /without parrot comments or speculative fallbacks/i);
  });

  test('integrationEntries injects first-pass precision mandate into agent configurations', () => {
    const entries = integrationEntries({ version: '0.5.1' }, { agent: 'cursor' });
    const cursorRule = entries.find(e => e.path.endsWith('.cursor/rules/omni-spec.mdc'));
    assert.ok(cursorRule);
    assert.match(cursorRule.content, /Deliver first-pass precision: zero code slop/i);
    assert.match(cursorRule.content, /high-craft UI/i);
  });
});
