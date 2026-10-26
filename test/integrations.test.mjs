import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AGENTS, installAgentIntegrations, integrationEntries, OMNI_SKILLS } from '../src/integrations.mjs';
let root;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omnispec-adapter-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// Explicit paths are the externally documented contract, independent of the implementation registry.
const adapters = {
  antigravity: '.agents/skills/omni-init/SKILL.md',
  codex: '.agents/skills/omni-init/SKILL.md',
  claude: '.claude/skills/omni-init/SKILL.md',
  cursor: '.cursor/skills/omni-init/SKILL.md',
  copilot: '.agents/skills/omni-init/SKILL.md',
  kilo: '.kilo/skills/omni-init/SKILL.md',
  opencode: '.opencode/skills/omni-init/SKILL.md',
  gemini: '.gemini/skills/omni-init/SKILL.md',
  generic: 'specs/commands/omni-init.md',
};

// Hosts that document a slash-command surface their skills do not already expose.
const commandSurfaces = {
  kilo: '.kilo/commands/omni-init.md',
  gemini: '.gemini/commands/omni-init.toml',
};

for (const [agent, path] of Object.entries(adapters))
  test(`${agent} creates invocable onboarding and exploration using its documented format`, async () => {
    const result = await installAgentIntegrations(root, { version: '0.5.0' }, { agent });
    const content = await readFile(join(root, path), 'utf8');
    assert.match(content, /inspect --json/);
    assert.match(content, /project-context/);
    assert.ok(result.created.some(p => p.includes('omni-discuss')));
    if (agent === 'generic') assert.match(content, /^---\nname: omni-init\ndescription: /);
    else assert.match(content, /^---\nname: omni-init\ndescription: /);
    if (agent === 'antigravity') {
      const auditor = await readFile(join(root, '.agents/agents/omni-auditor.md'), 'utf8');
      assert.match(auditor, /subagent: true/);
      assert.match(auditor, /commandExecutionPolicy: sandbox/);
      assert.ok((await readFile(join(root, 'specs/commands/omni-init.md'), 'utf8')).length < 1000);
      for (const name of ['.cursor', '.claude', '.github', '.kilo', '.opencode', '.gemini'])
        await assert.rejects(access(join(root, name)), { code: 'ENOENT' });
    }
  });

test('every supported host receives AGENTS.md and its own skill tree', async () => {
  for (const agent of Object.keys(adapters).filter(a => a !== 'generic')) {
    const scope = await mkdtemp(join(tmpdir(), 'omnispec-agents-'));
    try {
      await installAgentIntegrations(scope, { version: '0.5.0' }, { agent });
      const instructions = await readFile(join(scope, 'AGENTS.md'), 'utf8');
      assert.match(instructions, /OMNI-SPEC-START/);
      assert.match(instructions, /OmniSpec 0\.5\.0/);
    } finally {
      await rm(scope, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
});

test('legacy slash-command surfaces survive only where the host documents them', async () => {
  for (const [agent, path] of Object.entries(commandSurfaces)) {
    const scope = await mkdtemp(join(tmpdir(), 'omnispec-commands-'));
    try {
      await installAgentIntegrations(scope, { version: '0.5.0' }, { agent });
      const content = await readFile(join(scope, path), 'utf8');
      if (path.endsWith('.toml')) {
        const prompt = content
          .split('\n')
          .find(l => l.startsWith('prompt = '))
          .slice('prompt = '.length);
        assert.match(JSON.parse(prompt), /User request: \{\{args\}\}/);
      } else assert.match(content, /User request: \$ARGUMENTS/);
    } finally {
      await rm(scope, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
});

test('OpenCode skills expose a slash invocation through Agent Skills metadata', async () => {
  await installAgentIntegrations(root, { version: '0.5.0' }, { agent: 'opencode' });
  const content = await readFile(join(root, adapters.opencode), 'utf8');
  assert.match(content, /opencode\/slash: "true"/);
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

const LINK_RULE =
  'Use document-relative Markdown links that resolve inside the project in durable documents, never file:// URLs or machine-specific absolute paths. For example, a link from specs/project-context.md to the root README is ../README.md.';
const FINAL_RESPONSE =
  'The final chat response must retain the same evidence category and uncertainty as the saved context: summarizing cannot turn a declared policy into a proven guarantee.';
const commonBlock = skill =>
  skill.instructions.slice(
    skill.instructions.indexOf('## Project protocol'),
    skill.instructions.indexOf('## Workflow'),
  );

test('the common block bounds the base reading and pins npx to the manifest version', async () => {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const common = commonBlock(OMNI_SKILLS[0]);
  assert.ok(common.startsWith('## Project protocol'));
  for (const skill of OMNI_SKILLS) {
    assert.equal(commonBlock(skill), common, skill.name);
    assert.ok(!skill.instructions.includes(version), skill.name);
    assert.doesNotMatch(skill.instructions, /npx omni-spec(?!@)/, skill.name);
  }
  assert.ok(common.includes('"npx omni-spec@<version in specs/manifest.json> <command>"'));
  assert.ok(common.includes('specs/.omni/runtime/bin/omni-spec.mjs'));
  assert.ok(
    common.includes(
      'Read specs/manifest.json only to locate the root and its version, then run status --json before reading other project files.',
    ),
  );
  assert.ok(
    common.includes(
      'Outside onboarding, read CONSTITUTION.md, specs/project-context.md, progress.readSet.files, the files you will change and only the cited passages the task needs; do not open progress.readSet.avoid unless this workflow or the user requires it or a decision or contract cites it.',
    ),
  );
  assert.ok(
    common.includes(
      'Use contracts --active, or contracts <id> for a pending proposal, when the task changes a previously recorded capability.',
    ),
  );
  assert.doesNotMatch(common, /Read CONSTITUTION\.md, specs\/project-context\.md and CLI status --json before acting/);
  assert.ok(
    common
      .split('\n')
      .includes('For every factual citation, read the exact supporting passage and cite the file that contains it.'),
  );
  assert.ok(!common.includes('document-relative'));
  assert.ok(!common.includes(FINAL_RESPONSE));
});

test('omni-init and omni-converge carry the link rule and the final-response rule', () => {
  for (const name of ['omni-init', 'omni-converge']) {
    const workflow = OMNI_SKILLS.find(s => s.name === name).instructions.split('## Workflow\n')[1];
    assert.ok(workflow.includes(LINK_RULE), name);
    assert.ok(workflow.includes(FINAL_RESPONSE), name);
  }
});

test('host rules pin npx to the generated version and no adapter emits an unpinned npx', () => {
  const rules = ['AGENTS.md', '.cursor/rules/omni-spec.mdc', '.github/copilot-instructions.md'];
  const seen = new Set();
  for (const agent of Object.keys(AGENTS)) {
    for (const entry of integrationEntries({ version: '1.2.3' }, { agent })) {
      assert.doesNotMatch(entry.content, /npx omni-spec(?!@)/, `${agent}: ${entry.path}`);
      if (!rules.includes(entry.path)) continue;
      seen.add(entry.path);
      assert.ok(entry.content.includes('npx omni-spec@1.2.3'), `${agent}: ${entry.path}`);
    }
  }
  assert.deepEqual([...seen].sort(), [...rules].sort());
});

test('preserves user instructions outside the managed section across repeated upgrades', async () => {
  await writeFile(join(root, 'AGENTS.md'), '# User rules\nNever alter my application without a requested task.\n');
  await mkdir(join(root, '.github'));
  await writeFile(join(root, '.github', 'copilot-instructions.md'), '# Copilot rules\nCustom policy.\n');
  await installAgentIntegrations(root, { version: '0.5.0' }, { agent: 'all' });
  await writeFile(
    join(root, 'AGENTS.md'),
    (await readFile(join(root, 'AGENTS.md'), 'utf8')) + '\nAdditional user policy.\n',
  );
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
