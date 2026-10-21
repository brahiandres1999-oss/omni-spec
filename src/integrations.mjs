import { syncManagedFiles } from './managed.mjs';
import { OMNI_SKILLS } from './workflows.mjs';
export { OMNI_SKILLS } from './workflows.mjs';

export const AGENTS = {
  plugin: { directory: null, format: 'plugin', invocation: '/omni-init (Antigravity Plugin)' },
  antigravity: { directory: '.agents/skills', format: 'skill', invocation: '/omni-init' },
  cursor: { directory: '.cursor/commands', format: 'markdown', invocation: '/omni-init' },
  claude: { directory: '.claude/skills', format: 'skill', invocation: '/omni-init' },
  copilot: { directory: '.github/prompts', format: 'prompt', invocation: '/omni-init (VS Code Chat)' },
  kilo: { directory: '.kilo/commands', format: 'markdown', invocation: '/omni-init' },
  opencode: { directory: '.opencode/commands', format: 'markdown', invocation: '/omni-init' },
  gemini: { directory: '.gemini/commands', format: 'toml', invocation: '/omni-init' },
  codex: { directory: '.agents/skills', format: 'skill', invocation: '$omni-init (skill picker)' },
  generic: { directory: 'specs/commands', format: 'markdown', invocation: 'Read specs/commands/omni-init.md and follow it' }
};

export function normalizeAgents(raw = 'antigravity') {
  const parts = (Array.isArray(raw) ? raw : String(raw).split(',')).map(s => String(s).trim().toLowerCase());
  const aliases = { github: 'copilot', 'claude-code': 'claude', 'antigravity-plugin': 'plugin' };
  const normalized = parts.map(s => aliases[s] || s);
  const invalid = normalized.filter(s => s !== 'all' && !Object.hasOwn(AGENTS, s));
  if (invalid.length) throw new Error(`Invalid agent "${invalid.join(',')}". Valid agents: ${Object.keys(AGENTS).join(', ')}, all.`);
  return [...new Set(normalized.includes('all') ? Object.keys(AGENTS).filter(s => s !== 'generic' && s !== 'plugin') : normalized)];
}

export function integrationEntries(manifest, options = {}) {
  const targets = normalizeAgents(options.agent || options.ai || manifest?.agent || 'antigravity');
  const entries = [];
  const version = manifest?.version || 'unknown';
  const rule = `<!-- OMNI-SPEC-START -->\n## OmniSpec ${version}\nUse the project's OmniSpec workflows for requested engineering work. Start with omni-init to understand this repository or omni-discuss for exploration. Read CONSTITUTION.md and specs/project-context.md. Deliver first-pass precision: zero code slop (no trivial comments, no premature layers, fail-fast), zero spec fluff, and high-craft UI (anti-cliché, 4 mandatory states). Run the OmniSpec CLI with \`node specs/.omni/runtime/bin/omni-spec.mjs\` (or global plugin CLI \`omni-spec\` / \`npx omni-spec\`). Inspect status before resuming work. Documentary audit is not code verification.\n<!-- OMNI-SPEC-END -->`;
  for (const target of targets) {
    const adapter = AGENTS[target];
    if (adapter.format === 'plugin') continue;
    for (const skill of OMNI_SKILLS) {
      const metadata = `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n`;
      let path, content;
      if (adapter.format === 'skill') {
        path = `${adapter.directory}/${skill.name}/SKILL.md`;
        content = metadata + skill.instructions;
      } else if (adapter.format === 'toml') {
        path = `${adapter.directory}/${skill.name}.toml`;
        content = `description = ${JSON.stringify(skill.description)}\nprompt = ${JSON.stringify(skill.instructions + '\nUser request: {{args}}')}\n`;
      } else {
        path = `${adapter.directory}/${skill.name}${adapter.format === 'prompt' ? '.prompt' : ''}.md`;
        content = metadata + skill.instructions;
        if (['opencode', 'kilo'].includes(target)) content += '\nUser request: $ARGUMENTS\n';
      }
      entries.push({ path, content });
    }
    if (target === 'cursor') entries.push({ path: '.cursor/rules/omni-spec.mdc', content: `---\ndescription: OmniSpec project workflow\nglobs: "**/*"\nalwaysApply: true\n---\n${rule}\n` });
    if (target === 'copilot') entries.push({ path: '.github/copilot-instructions.md', content: rule, section: true });
    if (['kilo', 'opencode', 'codex'].includes(target)) entries.push({ path: 'AGENTS.md', content: rule, section: true });
  }
  return entries;
}

export async function installAgentIntegrations(projectDir, manifest, options = {}) {
  return syncManagedFiles(projectDir, integrationEntries(manifest, options), options);
}

export function agentInstructions(raw) {
  return normalizeAgents(raw).map(name => `${name}: ${AGENTS[name].invocation}`).join('\n');
}
