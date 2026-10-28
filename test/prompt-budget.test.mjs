import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildConstitutionContent } from '../src/generator.mjs';
import { OMNI_SKILLS } from '../src/workflows.mjs';
import { HOST_RULE } from '../src/protocols.mjs';
import { integrationEntries } from '../src/integrations.mjs';
import { profiles } from '../src/profiles/index.mjs';

// Character caps. The constitution, the common block and omni-plan use the 0.8.0 targets of
// docs/AUDIT-HEXAGON-REPORT.md §4.4; every other text is its size after the context-economy
// change plus 5 %. Shorten a text that exceeds its cap instead of raising the cap.
const CAPS = {
  constitution: 6000,
  common: 6600,
  'omni-plan': 11000,
  'omni-init': 24227,
  'omni-discuss': 8722,
  'omni-specify': 8748,
  'omni-clarify': 7317,
  'omni-tasks': 7876,
  'omni-audit': 7825,
  'omni-implement': 8739,
  'omni-converge': 11367,
  HOST_RULE: 1442,
  'AGENTS.md': 1670,
  '.gemini/commands/omni-init.toml': 24524,
  '.gemini/commands/omni-discuss.toml': 8961,
  '.gemini/commands/omni-specify.toml': 8968,
  '.gemini/commands/omni-clarify.toml': 7523,
  '.gemini/commands/omni-plan.toml': 10936,
  '.gemini/commands/omni-tasks.toml': 8101,
  '.gemini/commands/omni-audit.toml': 8022,
  '.gemini/commands/omni-implement.toml': 8959,
  '.gemini/commands/omni-converge.toml': 11564,
};

async function agentTexts() {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const first = OMNI_SKILLS[0].instructions;
  return [
    ...Object.keys(profiles).map(profile => [
      `constitution (${profile})`,
      'constitution',
      buildConstitutionContent({ profile }),
    ]),
    ['common block', 'common', first.slice(first.indexOf('## Project protocol'), first.indexOf('## Workflow'))],
    ...OMNI_SKILLS.map(skill => [skill.name, skill.name, skill.instructions]),
    ['HOST_RULE', 'HOST_RULE', HOST_RULE],
    [
      'AGENTS.md section',
      'AGENTS.md',
      integrationEntries({ version }, { agent: 'antigravity' }).find(entry => entry.path === 'AGENTS.md').content,
    ],
    ...integrationEntries({ version }, { agent: 'gemini' })
      .filter(entry => entry.path.endsWith('.toml'))
      .map(entry => [entry.path, entry.path, entry.content]),
  ];
}

test('agent-facing prompts stay within their character caps', async () => {
  const texts = await agentTexts();
  assert.equal(texts.length, 5 + 1 + 9 + 1 + 1 + 9);
  assert.ok(texts[5][2].startsWith('## Project protocol'));
  assert.deepEqual([...new Set(texts.map(([, cap]) => cap))].sort(), Object.keys(CAPS).sort());
  for (const [label, cap, text] of texts)
    assert.ok(text.length <= CAPS[cap], `${label}: ${text.length} characters, cap ${CAPS[cap]}`);
});
