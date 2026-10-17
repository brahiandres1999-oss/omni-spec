import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Definitions for the 6 core OmniSpec SDD Slash Commands.
 */
export const OMNI_SKILLS = [
  {
    name: 'omni-specify',
    description: 'Crea o redacta una nueva especificación formal (spec.md) a partir de un requerimiento en lenguaje natural.',
    instructions: `# /omni-specify — Specification Authoring

You are an expert Spec-Driven Development (SDD) architect. Your goal is to initialize and author a complete, non-ambiguous specification in \`spec.md\`.

## Instructions:
1. If no active specification exists for this feature, run or request the CLI command:
   \`\`\`bash
   omni-spec create feature <feature-name>
   \`\`\`
   (Or use archetype: \`bugfix\`, \`debt\`, or \`rfc\` as appropriate).
2. Read the project's \`CONSTITUTION.md\` to extract domain invariants, regulatory rules, and architectural constraints.
3. Flesh out the newly created \`spec.md\`:
   - Fill in **User Scenarios & Acceptance Criteria** with testable Given/When/Then conditions.
   - Answer all regulatory / security invariant questions injected by the domain profile (e.g. SST, k-anonymity, data protection).
   - Leave the clarification section (**## 0. Clarification Questions & Answers**) ready for the clarification phase.
4. Conclude by suggesting the user run \`/omni-clarify\` to validate assumptions before technical design.
`
  },
  {
    name: 'omni-clarify',
    description: 'Identifica áreas sub-especificadas y formula hasta 5 preguntas clave de aclaración (Fase 0) antes de diseñar o codificar.',
    instructions: `# /omni-clarify — Phase 0 Zero-Hallucination Gate

You are a rigorous engineering auditor enforcing Phase 0 of Spec-Driven Development.

## Instructions:
1. Read the active \`spec.md\` and \`CONSTITUTION.md\`.
2. Inspect the codebase to check if any technical, business, or data assumptions are unverified.
3. Formulate up to 5 highly targeted clarification questions focusing on:
   - Edge cases and failure modes.
   - Domain invariants (e.g. privacy thresholds, persistence boundaries, concurrency).
   - Ambiguous requirements or missing UX states (Empty, Loading, Error, Restricted).
4. Present these questions directly to the user in the chat or record their verified answers under **## 0. Clarification Questions & Answers** in \`spec.md\`.
5. Once answered, run or request:
   \`\`\`bash
   omni-spec audit
   \`\`\`
   Ensure Phase 0 passes with substantive answers (>30 characters per answered section).
`
  },
  {
    name: 'omni-plan',
    description: 'Genera el plan de diseño arquitectónico (plan.md), contratos de interfaz, diagramas de secuencia y mitigaciones.',
    instructions: `# /omni-plan — Architecture & Implementation Planning

You are a principal software architect. Your goal is to translate the approved \`spec.md\` into a technical blueprint in \`plan.md\`.

## Instructions:
1. Verify that \`spec.md\` has passed Phase 0 clarification.
2. Read \`CONSTITUTION.md\` for tech stack, code surgery rules, and anti-slop guidelines.
3. Author the technical blueprint in \`plan.md\`:
   - **Architectural Diagram**: Include a clear Mermaid diagram visualizing data flow and component boundaries.
   - **Data Contracts & APIs**: Specify exact request/response schemas, database migrations, or endpoint contracts.
   - **Technology Alignment**: Adhere strictly to the detected project stack and quality gates.
   - **Risk Analysis & Mitigations**: Identify performance bottlenecks, race conditions, or breaking changes.
4. Conclude by prompting the user to run \`/omni-tasks\` to decompose this plan into executable work.
`
  },
  {
    name: 'omni-tasks',
    description: 'Desglosa el plan de arquitectura en una lista de tareas atómicas, ordenadas por dependencia, en tasks.md.',
    instructions: `# /omni-tasks — Dependency-Ordered Task Decomposition

You are a lead project manager and technical lead. Your goal is to decompose \`plan.md\` into atomic, actionable steps in \`tasks.md\`.

## Instructions:
1. Read \`plan.md\` and \`spec.md\` for the active specification.
2. Decompose the implementation into sequential, dependency-ordered tasks formatted as markdown checkboxes:
   \`\`\`markdown
   - [ ] [TASK-001] [Core] Create database migration or data schema (File: path/to/file)
   - [ ] [TASK-002] [Backend] Implement API endpoints and contract tests (File: path/to/file)
   - [ ] [TASK-003] [Frontend] Build UI components respecting 4 interface states (File: path/to/file)
   - [ ] [TASK-004] [Audit] Run test suite and verify quality gates
   \`\`\`
3. Ensure tasks are granular (each task should touch 1-3 files maximum).
4. Run \`omni-spec audit\` to ensure task integrity and manifest synchronization.
`
  },
  {
    name: 'omni-audit',
    description: 'Ejecuta la auditoría estricta de OmniSpec validando Fase 0, calidad de especificación y progreso de tareas.',
    instructions: `# /omni-audit — Deterministic Spec & Code Auditor

You are the quality assurance guardian. Your goal is to deterministically audit the active specification.

## Instructions:
1. Execute the native audit command:
   \`\`\`bash
   omni-spec audit
   \`\`\`
2. Check the output against the 3 core gates:
   - **Phase 0 Gate**: Section 0 must exist, be populated with substantive answers, and have no open critical questions.
   - **Specification Completeness**: All required sections in \`spec.md\`, \`plan.md\`, and \`tasks.md\` must be present.
   - **Task Completion Status**: Report count of completed vs total tasks.
3. If errors or warnings are flagged, provide the exact surgical remediation steps needed to turn all checks green.
`
  },
  {
    name: 'omni-implement',
    description: 'Ejecuta las tareas definidas en tasks.md de forma quirúrgica, corriendo quality gates en cada paso.',
    instructions: `# /omni-implement — Surgical Implementation Execution

You are an expert pair programmer. Your goal is to execute the tasks in \`tasks.md\` sequentially with zero technical debt.

## Instructions:
1. Read \`tasks.md\` and identify the first unchecked task (\`- [ ]\`).
2. Follow **Minimal Touch Surgery** (Rule 2): modify exclusively the files required for this task.
3. Respect all rules in \`CONSTITUTION.md\` (e.g. privacy invariants, doc standards, anti-slop).
4. Execute the project's quality gates:
   \`\`\`bash
   npm test
   \`\`\`
   Do not proceed to the next task if any test or lint error fails.
5. Mark the task as completed in \`tasks.md\` (\`- [x]\`).
6. Once all tasks are checked, mark the specification as complete:
   \`\`\`bash
   omni-spec complete <spec-id>
   \`\`\`
`
  }
];

/**
 * Installs all supported AI agent integrations in a target project.
 * Supports Antigravity, Cursor, Claude Code, GitHub Copilot, OpenCode, and KiloCode.
 *
 * @param {string} projectDir Absolute path to the repository
 * @param {Object} manifest Loaded manifest object
 * @param {Object} options Configuration options
 * @returns {Promise<Object>} Summary of created or updated files
 */
export async function installAgentIntegrations(projectDir, manifest, options = {}) {
  const created = [];
  const updated = [];

  // 1. Antigravity / Gemini CLI (.agents/skills/omni-*/SKILL.md)
  for (const skill of OMNI_SKILLS) {
    const skillDir = join(projectDir, '.agents', 'skills', skill.name);
    await mkdir(skillDir, { recursive: true });

    const skillContent = `---
name: ${skill.name}
description: "${skill.description}"
allowed-tools: Read Write Edit Glob Grep run_command
---
${skill.instructions}
`;
    const skillPath = join(skillDir, 'SKILL.md');
    await writeFile(skillPath, skillContent, 'utf-8');
    created.push(`.agents/skills/${skill.name}/SKILL.md`);
  }

  // 2. Cursor Rules (.cursor/rules/omni-spec.mdc)
  const cursorDir = join(projectDir, '.cursor', 'rules');
  await mkdir(cursorDir, { recursive: true });
  const cursorRuleContent = `---
description: OmniSpec Spec-Driven Development (SDD) rules and slash commands
globs: *
alwaysApply: true
---
# OmniSpec Spec-Driven Development Workflow

This repository uses **OmniSpec (v${manifest.version || '0.4.0'})** for Spec-Driven Development.

## Available Slash Commands:
- \`/omni-specify\`: Initialize and author a formal specification (\`spec.md\`).
- \`/omni-clarify\`: Execute Phase 0 Zero-Hallucination clarification questions.
- \`/omni-plan\`: Draft technical architecture and data contracts (\`plan.md\`).
- \`/omni-tasks\`: Decompose plan into dependency-ordered atomic tasks (\`tasks.md\`).
- \`/omni-audit\`: Run deterministic \`omni-spec audit\` checks.
- \`/omni-implement\`: Sequentially execute tasks and verify quality gates.

## Core Rules:
1. Always adhere to \`CONSTITUTION.md\` domain and architectural invariants.
2. Never write code without an active specification that passed Phase 0 audit.
3. Run \`omni-spec audit\` before and after each task.
`;
  await writeFile(join(cursorDir, 'omni-spec.mdc'), cursorRuleContent, 'utf-8');
  created.push('.cursor/rules/omni-spec.mdc');

  // 3. Claude Code Commands (.claude/commands/omni-*.md)
  const claudeDir = join(projectDir, '.claude', 'commands');
  await mkdir(claudeDir, { recursive: true });
  for (const skill of OMNI_SKILLS) {
    const cmdPath = join(claudeDir, `${skill.name}.md`);
    await writeFile(cmdPath, skill.instructions, 'utf-8');
    created.push(`.claude/commands/${skill.name}.md`);
  }

  // 4. GitHub Copilot Instructions (.github/copilot-instructions.md)
  const githubDir = join(projectDir, '.github');
  await mkdir(githubDir, { recursive: true });
  const copilotPath = join(githubDir, 'copilot-instructions.md');
  const copilotSection = `\n<!-- OMNI-SPEC-START -->
## OmniSpec Spec-Driven Development (v${manifest.version || '0.4.0'})
- Follow the project Constitution at \`CONSTITUTION.md\`.
- All features must have an active spec in \`specs/\` with Phase 0 clarification completed.
- Verify quality gates via \`omni-spec audit\` before submitting changes.
<!-- OMNI-SPEC-END -->\n`;

  try {
    const existing = await readFile(copilotPath, 'utf-8');
    if (existing.includes('<!-- OMNI-SPEC-START -->')) {
      const updatedContent = existing.replace(
        /<!-- OMNI-SPEC-START -->[\s\S]*?<!-- OMNI-SPEC-END -->/,
        copilotSection.trim()
      );
      await writeFile(copilotPath, updatedContent, 'utf-8');
      updated.push('.github/copilot-instructions.md');
    } else {
      await writeFile(copilotPath, existing + '\n' + copilotSection, 'utf-8');
      updated.push('.github/copilot-instructions.md');
    }
  } catch {
    await writeFile(copilotPath, copilotSection.trim() + '\n', 'utf-8');
    created.push('.github/copilot-instructions.md');
  }

  // 5. OpenCode & KiloCode (AGENTS.md & .kilo/rules/omni-spec.md + kilo.jsonc)
  const agentsPath = join(projectDir, 'AGENTS.md');
  const agentsSection = `\n<!-- OMNI-SPEC-START -->
## OmniSpec SDD Workflow & Slash Commands (v${manifest.version || '0.4.0'})
This repository is governed by OmniSpec. AI agents must follow the SDD lifecycle:
- \`/omni-specify\`: Create or update feature spec (\`spec.md\`).
- \`/omni-clarify\`: Resolve Phase 0 questions before coding.
- \`/omni-plan\`: Formulate architectural blueprint (\`plan.md\`).
- \`/omni-tasks\`: Break down tasks into \`tasks.md\`.
- \`/omni-audit\`: Run \`omni-spec audit\` to verify compliance.
- \`/omni-implement\`: Execute tasks and pass delivery quality gates.
Refer to \`CONSTITUTION.md\` for non-negotiable domain and regulatory invariants.
<!-- OMNI-SPEC-END -->\n`;

  try {
    const existingAgents = await readFile(agentsPath, 'utf-8');
    if (existingAgents.includes('<!-- OMNI-SPEC-START -->')) {
      const updatedAgents = existingAgents.replace(
        /<!-- OMNI-SPEC-START -->[\s\S]*?<!-- OMNI-SPEC-END -->/,
        agentsSection.trim()
      );
      await writeFile(agentsPath, updatedAgents, 'utf-8');
      updated.push('AGENTS.md');
    } else {
      await writeFile(agentsPath, existingAgents + '\n' + agentsSection, 'utf-8');
      updated.push('AGENTS.md');
    }
  } catch {
    await writeFile(agentsPath, agentsSection.trim() + '\n', 'utf-8');
    created.push('AGENTS.md');
  }

  // KiloCode configuration
  const kiloDir = join(projectDir, '.kilo', 'rules');
  await mkdir(kiloDir, { recursive: true });
  await writeFile(join(kiloDir, 'omni-spec.md'), cursorRuleContent, 'utf-8');
  created.push('.kilo/rules/omni-spec.md');

  const kiloConfigPath = join(projectDir, 'kilo.jsonc');
  try {
    await readFile(kiloConfigPath, 'utf-8');
  } catch {
    const kiloConfig = `{
  "$schema": "https://app.kilo.ai/config.json",
  "instructions": [
    ".kilo/rules/omni-spec.md",
    "CONSTITUTION.md",
    "AGENTS.md"
  ]
}\n`;
    await writeFile(kiloConfigPath, kiloConfig, 'utf-8');
    created.push('kilo.jsonc');
  }

  return { created, updated };
}
