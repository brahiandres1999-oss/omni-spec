import { readFile, writeFile, mkdir, cp, readdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProfile } from './profiles/index.mjs';
import { initManifest, _initManifestUnlocked, addSpec, loadManifest, saveManifest, withManifestLock } from './manifest.mjs';
import { installAgentIntegrations } from './integrations.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function copyDirectoryRecursive(src, dest, overwrite = true) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(srcPath, destPath, overwrite);
    } else {
      if (!overwrite) {
        try {
          await access(destPath);
          continue;
        } catch {}
      }
      await cp(srcPath, destPath, { force: overwrite });
    }
  }
}

export const ARCHETYPES = {
  feature: {
    folder: '01-feature',
    prefix: 'SPEC',
    branchPrefix: 'feat',
    name: 'Feature Specification'
  },
  bugfix: {
    folder: '02-bugfix',
    prefix: 'BUG',
    branchPrefix: 'fix',
    name: 'Bugfix & Incident RCA'
  },
  debt: {
    folder: '03-tech-debt',
    prefix: 'DEBT',
    branchPrefix: 'debt',
    name: 'Technical Debt Refactor'
  },
  rfc: {
    folder: '04-rfc-idea',
    prefix: 'RFC',
    branchPrefix: 'rfc',
    name: 'Architectural Decision Record'
  }
};

export function buildConstitutionContent(options) {
  const profile = getProfile(options.profile);
  const projectName = options.projectName || 'MyProject';
  const stack = options.stack || 'Node.js';
  const docStandard = options.docStandard || 'JSDoc';
  const qualityGates = options.qualityGates || 'npm test\nnpm run lint\nnpm run build';

  return `# CONSTITUTION — ${projectName}

> This file acts as the supreme engineering law for developers and AI coding agents. Every specification, architecture plan, and line of code must strictly adhere to these guidelines before merging.

---

## 1. Governance & Code Surgery (Constitutional Foundation)

1. **Pre-Execution Diagnostic:** Before making any non-trivial change, present a structured assessment: *Problem, Proposed Solution, and Consequences/Risks*.
2. **Strict Non-Destructive Policy:** Destructive changes, large refactors, or database modifications require explicit approval.
3. **Zero Hallucination Guarantee:** If requirements, models, or domain rules are ambiguous, the agent/developer must **pause and ask clarification questions (Phase 0)**. Guessing or inventing business rules is strictly forbidden.
4. **Minimal Touch Surgery:** Modify exclusively the files necessary to achieve the verified objective. Do not touch adjacent working code or reformat unrelated modules.
5. **Demonstrable Quality Gates:** Code is only complete when all automated quality gates pass with zero errors and zero warnings.

---

## 2. Domain & Regulatory Invariants (${profile.name})

${profile.constitutionInvariants}

---

## 3. Technology Stack & Documentation Standards

* **Primary Tech Stack:** \`${stack}\`
* **Documentation Standard:** \`${docStandard}\` (All public APIs, exported interfaces, and complex functions must follow this convention).

---

## 4. Delivery Quality Gates

The following commands must run and pass cleanly before considering any task or Pull Request complete:

\`\`\`bash
${qualityGates}
\`\`\`

---

## 5. UI Ergonomics & Anti-Slop (Frontend Only)

* **Zero Visual Slop:** Avoid generic AI-generated templates, excessive card-nesting (card-itis), and ungrounded gradients.
* **4 Mandatory Interface States:** Loading (skeleton/spinner), Empty (clear explanation), Error (with retry trigger), and Protected/Restricted.
* **Accessibility:** Full keyboard navigation (\`Tab\`, \`Enter\`, \`Escape\`) and WCAG AA contrast compliance.
`;
}

export function buildSpecsReadmeContent(projectName) {
  return `# ${projectName} — Spec-Driven Development (OmniSpec)

Welcome to the Spec-Driven Development workspace. This directory organizes all engineering changes into 4 specialized archetypes to prevent scope creep and eliminate AI hallucinations.

## The 4 Engineering Archetypes

| Archetype | Template Path | Purpose | Key Artifacts |
| :--- | :--- | :--- | :--- |
| **01. Feature** | \`specs/_templates/01-feature/\` | New user capabilities, views, or endpoints. | \`spec.md\` (Clarification, Non-Goals) + \`plan.md\` (Contracts, Rollback) + \`tasks.md\` |
| **02. Bugfix** | \`specs/_templates/02-bugfix/\` | Incidents, runtime crashes, and defects. | \`bug.md\` (Reproduction) + \`rca.md\` (5 Whys SRE) + \`fix.md\` (Test-First) |
| **03. Tech Debt**| \`specs/_templates/03-tech-debt/\` | Refactors, legacy code, outdated packages. | \`audit.md\` (Blast radius) + \`migration-plan.md\` (Strangler Fig) + \`tasks.md\` |
| **04. RFC / ADR** | \`specs/_templates/04-rfc-idea/\` | Architectural decisions and technical spikes. | \`rfc.md\` (MADR standard with Decision Drivers and trade-offs) |

---

## Git Workflow for Specifications

1. **Create Branch:** \`git checkout -b feat/001-name\` (or \`fix/\`, \`debt/\`, \`rfc/\`).
2. **Commit Spec First:** Complete and commit the specification artifact before writing code (\`git commit -m "docs(spec): define 001-name"\`).
3. **Execute Incrementally:** Mark checkboxes in \`tasks.md\` as code is built.
4. **Review PR:** Code reviews start by inspecting \`spec.md\` against the diff to ensure zero drift.
`;
}

export async function scaffoldProject(baseDir, options = {}) {
  const force = Boolean(options.force);

  // 1. Generate CONSTITUTION.md (preserve if exists and not force)
  const constitutionPath = join(baseDir, 'CONSTITUTION.md');
  let constitutionExists = false;
  try {
    await access(constitutionPath);
    constitutionExists = true;
  } catch {}

  const existingManifest = await loadManifest(baseDir);
  if (constitutionExists && existingManifest && !force) {
    const changes = [
      ['profile', options.profile, options.explicitProfile],
      ['stack', options.stack, options.explicitStack],
      ['documentationStandard', options.docStandard, options.explicitDoc]
    ].filter(([key, value, explicit]) => explicit && value && value !== existingManifest[key]);
    if (changes.length) {
      throw new Error('Configuration changes require init --force to update CONSTITUTION.md and manifest.json together.');
    }
  }

  if (!constitutionExists || force) {
    const constitutionContent = buildConstitutionContent(options);
    await writeFile(constitutionPath, constitutionContent, 'utf-8');
  }

  // 2. Initialize specs/manifest.json (idempotent, preserves existing specs array)
  await initManifest(baseDir, options);

  // 3. Setup specs directory and copy templates (preserve customized templates if not force)
  const specsDir = join(baseDir, 'specs');
  const templatesTarget = join(specsDir, '_templates');
  const templatesSource = join(__dirname, 'templates');

  await copyDirectoryRecursive(templatesSource, templatesTarget, force);

  // 4. Generate specs/README.md (preserve if exists and not force)
  const specsReadmePath = join(specsDir, 'README.md');
  let readmeExists = false;
  try {
    await access(specsReadmePath);
    readmeExists = true;
  } catch {}

  if (!readmeExists || force) {
    await writeFile(specsReadmePath, buildSpecsReadmeContent(options.projectName), 'utf-8');
  }

  // 5. Install multi-agent slash commands and integrations
  const manifest = await loadManifest(baseDir);
  if (manifest) {
    try {
      await installAgentIntegrations(baseDir, manifest);
    } catch {}
  }

  return {
    constitutionPath,
    specsDir,
    manifestPath: join(specsDir, 'manifest.json')
  };
}

export async function createSpec(baseDir, rawArchetype, name, options = {}) {
  const archetypeKey = rawArchetype.toLowerCase();
  const archetype = ARCHETYPES[archetypeKey];
  if (!archetype) {
    throw new Error(`Invalid archetype "${rawArchetype}". Valid types are: ${Object.keys(ARCHETYPES).join(', ')}`);
  }

  return withManifestLock(baseDir, async () => {
    const manifest = (await loadManifest(baseDir)) || (await _initManifestUnlocked(baseDir, options));

    // Inspect both manifest entries and actual folders in specs/ to prevent collisions
    let existingDirs = [];
    try {
      existingDirs = await readdir(join(baseDir, 'specs'));
    } catch {}

    const dirNumbers = existingDirs
      .map(d => parseInt(d.split('-')[0], 10))
      .filter(n => !isNaN(n));

    const manifestNumbers = (manifest.specs || [])
      .map(s => parseInt(s.id, 10))
      .filter(n => !isNaN(n));

    const allNumbers = [...dirNumbers, ...manifestNumbers];
    let nextNum = allNumbers.length > 0 ? Math.max(...allNumbers) + 1 : 1;

    // Sanitize name slug
    const sanitizedName = name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    let idStr = String(nextNum).padStart(3, '0');
    let slug = `${idStr}-${sanitizedName}`;
    let specDir = join(baseDir, 'specs', slug);

    // Ensure target folder does not already exist
    while (true) {
      try {
        await access(specDir);
        nextNum++;
        idStr = String(nextNum).padStart(3, '0');
        slug = `${idStr}-${sanitizedName}`;
        specDir = join(baseDir, 'specs', slug);
      } catch {
        break;
      }
    }

    await mkdir(specDir, { recursive: true });

    // Resolve template source: prefer project specs/_templates, fallback to package built-ins
    let templateSourceDir = join(baseDir, 'specs', '_templates', archetype.folder);
    try {
      await access(templateSourceDir);
    } catch {
      templateSourceDir = join(__dirname, 'templates', archetype.folder);
    }
    const files = await readdir(templateSourceDir);

    const today = new Date().toISOString().split('T')[0];
    const title = options.title || name.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const profile = getProfile(manifest.profile || options.profile || 'general');

    for (const file of files) {
      const srcFile = join(templateSourceDir, file);
      const destFile = join(specDir, file);
      let content = await readFile(srcFile, 'utf-8');

      // Replace template variables
      content = content
        .replaceAll('XXX', idStr)
        .replaceAll('AAAA-MM-DD', today)
        .replaceAll('YYYY-MM-DD', today)
        .replaceAll('Título de la Especificación', title)
        .replaceAll('Short Title', title)
        .replaceAll('Incident Title / Short Description', title);

      // Inject profile compliance matrix if feature and questions exist, preserving custom template rows
      if (file === 'spec.md' && profile && profile.specSecurityQuestions) {
        const tableMatch = content.match(/(^\| Control de Seguridad[^\r\n]*\r?\n(?:\|[^\r\n]*(?:\r?\n|$))*)/m);
        if (tableMatch) {
          const tableText = tableMatch[1];
          const lines = tableText.split('\n');
          const projectRows = lines.slice(1).filter(line =>
            line.trim().startsWith('|') &&
            !/^\s*\|[\s:|\-]+$/.test(line)
          );

          let replacement = profile.specSecurityQuestions;
          const existingRows = new Set(replacement.split('\n').map(line => line.trim()));
          const preservedRows = projectRows.filter(line => !existingRows.has(line.trim()));
          if (preservedRows.length > 0) {
            replacement += '\n' + preservedRows.join('\n');
          }
          content = content.replace(tableText, replacement + '\n');
        }
      }

      await writeFile(destFile, content, 'utf-8');
    }

    // Register in manifest
    const specEntry = {
      id: idStr,
      type: archetypeKey,
      slug,
      title,
      status: 'IN_PROGRESS',
      created_at: today,
      branch: `${archetype.branchPrefix}/${slug}`
    };

    let updatedManifest = (await loadManifest(baseDir)) || manifest;
    updatedManifest.active_spec = specEntry.slug;
    updatedManifest.active_archetype = specEntry.type;

    const existingIdx = (updatedManifest.specs || []).findIndex(s => s.id === specEntry.id);
    if (existingIdx >= 0) {
      updatedManifest.specs[existingIdx] = { ...updatedManifest.specs[existingIdx], ...specEntry };
    } else {
      updatedManifest.specs.push(specEntry);
    }

    await saveManifest(baseDir, updatedManifest);

    return {
      id: idStr,
      slug,
      specDir,
      branch: specEntry.branch,
      archetype: archetype.name
    };
  });
}
