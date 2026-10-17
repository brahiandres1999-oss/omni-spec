import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installAgentIntegrations, OMNI_SKILLS } from '../src/integrations.mjs';

describe('Multi-Agent Integrations & Slash Commands Generator', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omnispec-agents-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // Safe cleanup
      }
    }
  });

  test('installs 7 Antigravity skills with frontmatter and descriptions', async () => {
    const manifest = { project: 'TestApp', version: '0.4.0' };
    const result = await installAgentIntegrations(tempDir, manifest);

    assert.equal(OMNI_SKILLS.length, 7);
    for (const skill of OMNI_SKILLS) {
      const skillPath = join(tempDir, '.agents', 'skills', skill.name, 'SKILL.md');
      const content = await readFile(skillPath, 'utf-8');
      assert.match(content, new RegExp(`name: ${skill.name}`));
      assert.match(content, /allowed-tools:/);
      assert.match(content, /# \/omni-/);
    }
    assert.ok(result.created.some(f => f.includes('omni-specify')));
    assert.ok(result.created.some(f => f.includes('omni-clarify')));
    assert.ok(result.created.some(f => f.includes('omni-plan')));
    assert.ok(result.created.some(f => f.includes('omni-tasks')));
    assert.ok(result.created.some(f => f.includes('omni-audit')));
    assert.ok(result.created.some(f => f.includes('omni-implement')));
    assert.ok(result.created.some(f => f.includes('omni-converge')));
  });

  test('creates Cursor rule, Claude commands, and Kilo configuration', async () => {
    const manifest = { project: 'TestApp', version: '0.4.0' };
    await installAgentIntegrations(tempDir, manifest);

    const cursorRule = await readFile(join(tempDir, '.cursor', 'rules', 'omni-spec.mdc'), 'utf-8');
    assert.match(cursorRule, /alwaysApply: true/);
    assert.match(cursorRule, /\/omni-specify/);

    const claudeSpecify = await readFile(join(tempDir, '.claude', 'commands', 'omni-specify.md'), 'utf-8');
    assert.match(claudeSpecify, /omni-spec create feature/);

    const kiloRule = await readFile(join(tempDir, '.kilo', 'rules', 'omni-spec.md'), 'utf-8');
    assert.match(kiloRule, /OmniSpec/);

    const kiloConfig = await readFile(join(tempDir, 'kilo.jsonc'), 'utf-8');
    assert.match(kiloConfig, /app\.kilo\.ai/);
  });

  test('preserves existing AGENTS.md and copilot-instructions.md content non-destructively', async () => {
    const originalAgents = '# Existing AGENTS.md\n\nCustom rules that must not be deleted.\n';
    await writeFile(join(tempDir, 'AGENTS.md'), originalAgents, 'utf-8');

    const manifest = { project: 'TestApp', version: '0.4.0' };
    const result = await installAgentIntegrations(tempDir, manifest);

    const updatedAgents = await readFile(join(tempDir, 'AGENTS.md'), 'utf-8');
    assert.ok(updatedAgents.includes('Custom rules that must not be deleted.'));
    assert.ok(updatedAgents.includes('<!-- OMNI-SPEC-START -->'));
    assert.ok(updatedAgents.includes('/omni-specify'));
    assert.ok(result.updated.includes('AGENTS.md'));

    // Second run should update section without duplicating
    await installAgentIntegrations(tempDir, manifest);
    const secondUpdate = await readFile(join(tempDir, 'AGENTS.md'), 'utf-8');
    const matches = secondUpdate.match(/<!-- OMNI-SPEC-START -->/g);
    assert.equal(matches.length, 1);
  });
});
