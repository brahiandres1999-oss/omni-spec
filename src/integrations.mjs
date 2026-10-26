import { syncManagedFiles } from './managed.mjs';
import { OMNI_SKILLS } from './workflows.mjs';
import { HOST_RULE } from './protocols.mjs';
import { readFileSync } from 'node:fs';
const auditorDefinition = readFileSync(new URL('../agents/omni-auditor.md', import.meta.url), 'utf8');
export { OMNI_SKILLS } from './workflows.mjs';

// One canonical skill body, one renderer, one table.
//
// Every supported host reads AGENTS.md, and every host that supports Agent Skills reads
// SKILL.md. `skills` is therefore the host's documented skill directory; `commands` exists
// only where a host documents a slash-command surface that its skills do not already
// expose. The command form is legacy: Claude Code merged commands into skills, Cursor
// ships /migrate-to-skills, Codex deprecated custom prompts and Antigravity retired IDE
// workflows, so skills are the only command-like format with a future.
//
// `.agents/skills/` is the interop path read by Antigravity, Copilot, Codex, Cursor, Kilo
// and OpenCode. The `antigravity` adapter therefore yields the most portable tree.
export const AGENTS = {
  plugin: { skills: null, commands: null, commandFormat: 'markdown', invocation: '/omni-init (Antigravity Plugin)' },
  antigravity: {
    skills: '.agents/skills',
    commands: null,
    agents: '.agents/agents',
    commandFormat: 'markdown',
    invocation: '/omni-init',
  },
  codex: {
    skills: '.agents/skills',
    commands: null,
    commandFormat: 'markdown',
    invocation: '$omni-init (skill picker)',
  },
  cursor: { skills: '.cursor/skills', commands: null, commandFormat: 'markdown', invocation: '/omni-init' },
  copilot: {
    skills: '.agents/skills',
    commands: null,
    commandFormat: 'markdown',
    invocation: '/omni-init (Agent Skills)',
  },
  claude: { skills: '.claude/skills', commands: null, commandFormat: 'markdown', invocation: '/omni-init' },
  kilo: { skills: '.kilo/skills', commands: '.kilo/commands', commandFormat: 'markdown', invocation: '/omni-init' },
  opencode: { skills: '.opencode/skills', commands: null, commandFormat: 'markdown', invocation: '/omni-init' },
  gemini: { skills: '.gemini/skills', commands: '.gemini/commands', commandFormat: 'toml', invocation: '/omni-init' },
  generic: {
    skills: null,
    commands: 'specs/commands',
    commandFormat: 'markdown',
    invocation: 'Read specs/commands/omni-init.md and follow it',
  },
};

export function normalizeAgents(raw = 'antigravity') {
  const parts = (Array.isArray(raw) ? raw : String(raw).split(',')).map(s => String(s).trim().toLowerCase());
  const aliases = { github: 'copilot', 'claude-code': 'claude', 'antigravity-plugin': 'plugin' };
  const normalized = parts.map(s => aliases[s] || s);
  const invalid = normalized.filter(s => s !== 'all' && !Object.hasOwn(AGENTS, s));
  if (invalid.length)
    throw new Error(`Invalid agent "${invalid.join(',')}". Valid agents: ${Object.keys(AGENTS).join(', ')}, all.`);
  return [
    ...new Set(
      normalized.includes('all') ? Object.keys(AGENTS).filter(s => s !== 'generic' && s !== 'plugin') : normalized,
    ),
  ];
}

// Agent Skills frontmatter is the portable subset: name and description. Host extensions
// are opt-in and ignored elsewhere, so they stay in metadata and never change the body.
function skillFrontmatter(target, skill) {
  const base = `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n`;
  if (target === 'opencode') return `${base}metadata:\n  opencode/slash: "true"\n---\n`;
  return `${base}---\n`;
}

export function integrationEntries(manifest, options = {}) {
  const targets = normalizeAgents(options.agent || options.ai || manifest?.agent || 'antigravity');
  const entries = [];
  const version = manifest?.version || 'unknown';
  const rule = `<!-- OMNI-SPEC-START -->\n## OmniSpec ${version}\n${HOST_RULE}\nRun the OmniSpec CLI with \`node specs/.omni/runtime/bin/omni-spec.mjs\` (or global plugin CLI \`omni-spec\` / \`npx omni-spec@${version}\`).\n<!-- OMNI-SPEC-END -->`;
  for (const target of targets) {
    const adapter = AGENTS[target];
    if (!adapter.skills && !adapter.commands) {
      if (target === 'plugin')
        entries.push({
          path: 'specs/commands/omni-init.md',
          content:
            '# OmniSpec plugin onboarding\n\nRead the installed plugin skill at `~/.gemini/config/plugins/omni-spec/skills/omni-init/SKILL.md` and follow it. Confirm its CLI version matches specs/manifest.json. If the plugin is absent, install/select the intended plugin or run setup-agent with a workspace integration before continuing.\n',
        });
      continue;
    }
    if (adapter.agents) entries.push({ path: `${adapter.agents}/omni-auditor.md`, content: auditorDefinition });

    if (adapter.skills)
      for (const skill of OMNI_SKILLS)
        entries.push({
          path: `${adapter.skills}/${skill.name}/SKILL.md`,
          content: skillFrontmatter(target, skill) + skill.instructions,
        });

    if (adapter.commands)
      for (const skill of OMNI_SKILLS) {
        if (adapter.commandFormat === 'toml')
          entries.push({
            path: `${adapter.commands}/${skill.name}.toml`,
            content: `description = ${JSON.stringify(skill.description)}\nprompt = ${JSON.stringify(skill.instructions + '\nUser request: {{args}}')}\n`,
          });
        else
          entries.push({
            path: `${adapter.commands}/${skill.name}.md`,
            content: skillFrontmatter(target, skill) + skill.instructions + '\nUser request: $ARGUMENTS\n',
          });
      }

    if (target === 'cursor')
      entries.push({
        path: '.cursor/rules/omni-spec.mdc',
        content: `---\ndescription: OmniSpec project workflow\nglobs: "**/*"\nalwaysApply: true\n---\n${rule}\n`,
      });
    if (target === 'copilot') entries.push({ path: '.github/copilot-instructions.md', content: rule, section: true });

    // AGENTS.md is the only file every supported host reads.
    entries.push({ path: 'AGENTS.md', content: rule, section: true });
  }
  if (!targets.includes('generic') && !targets.includes('plugin'))
    entries.push({
      path: 'specs/commands/omni-init.md',
      content:
        '# OmniSpec onboarding entry\n\nRead one of the installed skills below and follow its instructions. These are the same workflows discovered by the host; this entry does not duplicate them. Confirm the local CLI version before starting.\n\n' +
        [...new Set(targets.map(target => `${AGENTS[target].skills}/omni-init/SKILL.md`))]
          .map(path => `- \`${path}\``)
          .join('\n') +
        '\n',
    });
  return entries;
}

/** File a user can explicitly ask the host to read when skill discovery is unavailable. */
export function onboardingPath(agent) {
  const target = normalizeAgents(agent)[0];
  return AGENTS[target].skills ? `${AGENTS[target].skills}/omni-init/SKILL.md` : 'specs/commands/omni-init.md';
}

export async function installAgentIntegrations(projectDir, manifest, options = {}) {
  return syncManagedFiles(projectDir, integrationEntries(manifest, options), options);
}

export function agentInstructions(raw) {
  return normalizeAgents(raw)
    .map(name => `${name}: ${AGENTS[name].invocation}`)
    .join('\n');
}
