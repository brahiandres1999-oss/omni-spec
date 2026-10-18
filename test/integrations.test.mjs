import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installAgentIntegrations, OMNI_SKILLS } from '../src/integrations.mjs';
let root;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'omnispec-adapter-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

// Explicit paths are the externally documented contract, independent of the implementation registry.
const adapters = {
  antigravity: '.agents/skills/omni-init/SKILL.md',
  codex: '.agents/skills/omni-init/SKILL.md',
  claude: '.claude/skills/omni-init/SKILL.md',
  cursor: '.cursor/commands/omni-init.md',
  copilot: '.github/prompts/omni-init.prompt.md',
  kilo: '.kilo/commands/omni-init.md',
  opencode: '.opencode/commands/omni-init.md',
  gemini: '.gemini/commands/omni-init.toml',
  generic: 'specs/commands/omni-init.md'
};
for (const [agent, path] of Object.entries(adapters)) test(`${agent} creates invocable onboarding and exploration using its documented format`, async () => {
  const result = await installAgentIntegrations(root, { version: '0.5.0' }, { agent });
  const content = await readFile(join(root, path), 'utf8');
  assert.match(content, /inspect --json/);
  assert.match(content, /project-context/);
  assert.ok(result.created.some(p => p.includes('omni-discuss')));
  if (agent === 'gemini') {
    const prompt = content.split('\n').find(l => l.startsWith('prompt = ')).slice('prompt = '.length);
    assert.match(JSON.parse(prompt), /User request: \{\{args\}\}/);
  } else assert.match(content, /^---\nname: omni-init\ndescription: /);
  if (agent === 'antigravity') {
    for (const name of ['.cursor', '.claude', '.github', '.kilo', 'AGENTS.md']) await assert.rejects(access(join(root, name)), { code: 'ENOENT' });
  }
});

test('all adapters share the nine workflows without hard-coded npm test or tool permissions', async () => {
  assert.equal(OMNI_SKILLS.length, 9);
  await installAgentIntegrations(root, { version: '0.5.0' }, { agent: 'all' });
  for (const [agent, path] of Object.entries(adapters)) if (agent !== 'generic') await access(join(root, path));
  for (const skill of OMNI_SKILLS) {
    assert.doesNotMatch(skill.instructions, /npm test|allowed-tools:/);
    assert.match(skill.instructions, /bug\.md/);
    assert.match(skill.instructions, /rfc\.md/);
    assert.match(skill.instructions, /specs\/\.omni\/runtime/);
  }
});

test('preserves user instructions outside the managed section across repeated upgrades', async () => {
  await writeFile(join(root, 'AGENTS.md'), '# User rules\nNever alter my application without a requested task.\n');
  await mkdir(join(root, '.github'));
  await writeFile(join(root, '.github', 'copilot-instructions.md'), '# Copilot rules\nCustom policy.\n');
  await installAgentIntegrations(root, { version: '0.5.0' }, { agent: 'all' });
  await writeFile(join(root, 'AGENTS.md'), (await readFile(join(root, 'AGENTS.md'), 'utf8')) + '\nAdditional user policy.\n');
  await installAgentIntegrations(root, { version: '0.5.1' }, { agent: 'all' });
  const content = await readFile(join(root, 'AGENTS.md'), 'utf8');
  assert.match(content, /Additional user policy/);
  assert.match(content, /Never alter my application/);
  assert.equal((content.match(/<!-- OMNI-SPEC-START -->/g) || []).length, 1);
  assert.match(await readFile(join(root, '.github', 'copilot-instructions.md'), 'utf8'), /Custom policy/);
});

test('edited skills and malformed instruction blocks are preserved and reported', async () => {
  await installAgentIntegrations(root, {}, { agent: 'claude' });
  const path = join(root, adapters.claude);
  await writeFile(path, '# User customized onboarding');
  await assert.rejects(installAgentIntegrations(root, {}, { agent: 'claude' }), /Local changes preserved/);
  assert.equal(await readFile(path, 'utf8'), '# User customized onboarding');
  await writeFile(join(root, 'AGENTS.md'), '<!-- OMNI-SPEC-START --> incomplete');
  await assert.rejects(installAgentIntegrations(root, {}, { agent: 'kilo' }), /Malformed/);
});
