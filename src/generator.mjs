import { readFile, writeFile, mkdir, cp, readdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProfile } from './profiles/index.mjs';
import { _initManifestUnlocked, loadManifest, saveManifest, withManifestLock } from './manifest.mjs';
import { integrationEntries, normalizeAgents } from './integrations.mjs';
import { packageEntries } from './assets.mjs';
import { syncManagedFiles } from './managed.mjs';
import { detectProjectEnvironment } from './detector.mjs';
import { acceptanceSeed } from './acceptance.mjs';
import { QUESTIONS, TECHNOLOGY, DOCUMENTATION, SETUP, DESIGN } from './protocols.mjs';

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
    name: 'Feature Specification',
  },
  bugfix: {
    folder: '02-bugfix',
    prefix: 'BUG',
    branchPrefix: 'fix',
    name: 'Bugfix & Incident RCA',
  },
  debt: {
    folder: '03-tech-debt',
    prefix: 'DEBT',
    branchPrefix: 'debt',
    name: 'Technical Debt Refactor',
  },
  rfc: {
    folder: '04-rfc-idea',
    prefix: 'RFC',
    branchPrefix: 'rfc',
    name: 'Architectural Decision Record',
  },
};

export function buildConstitutionContent(options) {
  const profile = getProfile(options.profile);
  const projectName = options.projectName || 'MyProject';
  const stack = options.stack || 'Undecided';
  const docStandard = options.docStandard || 'Project conventions';
  const qualityGates = options.qualityGates || '# Not configured. Review project evidence with /omni-init.';

  return `# CONSTITUTION — ${projectName}

> Project engineering agreement. Apply it within the user's instructions and authorized scope; resolve material conflicts explicitly rather than silently overriding decisions.

---

## 1. Governance & Code Surgery (Constitutional Foundation)

1. **Pre-Execution Diagnostic:** Before making any non-trivial change, present a structured assessment: *Problem, Proposed Solution, and Consequences/Risks*.
2. **Strict Non-Destructive Policy:** Destructive changes, large refactors, or database modifications require explicit approval.
3. **Evidence and uncertainty:** Distinguish verified facts, hypotheses and unresolved decisions. Inspect repository evidence first; ask the user about material ambiguity. Never invent business rules or claim certainty from a structural audit.
4. **Minimal Touch Surgery:** Modify exclusively the files necessary to achieve the verified objective. Do not touch adjacent working code or reformat unrelated modules.
5. **Demonstrable Quality Gates:** Record actual results and pre-existing failures. Automated gates must pass for automated verification; when none apply, document explicitly labeled manual evidence. A checklist is not proof of behavior.
6. **Backend Pragmatic Craft & Zero Code Slop:**
   - *Strict YAGNI & Direct Implementation:* Never add speculative abstraction layers, premature interfaces, DTOs, factories, or wrapper classes when a direct, idiomatic function or standard module satisfies the acceptance criteria.
   - *Zero Comment Slop:* Avoid comments that only narrate syntax. Preserve accurate API documentation and explanations of purpose, contracts and non-obvious domain constraints.
   - *Fail-Fast & Transparent Failures:* Strictly forbid defensive \`try/catch\` wrappers that swallow exceptions, return dummy nulls, or silently mask errors without a documented business requirement.
   - *Zero Spec & Plan Slop:* Specifications and plans must maintain high technical density: tabular evidence, explicit non-goals, and atomic, falsable criteria (\`AC-01\`). No marketing fluff, corporate filler, or conversational apologies.

---

## 2. Domain & Regulatory Invariants (${profile.name})

${profile.constitutionInvariants}

These profile controls are review prompts; applicability must be established for this project. They do not certify regulatory compliance.

---

## 3. Technology Stack & Documentation Standards

* **Primary Tech Stack:** \`${stack}\`
* **Documentation Standard:** \`${docStandard}\` (All public APIs, exported interfaces, and complex functions must follow this convention).

${DOCUMENTATION}

### Supported technology decisions
${TECHNOLOGY}

### Clarification and setup
${QUESTIONS}
${SETUP}

---

## 4. Delivery Quality Gates

The following commands must run and pass cleanly before considering any task or Pull Request complete:

\`\`\`bash
${qualityGates}
\`\`\`

---

## 5. UI Ergonomics & Frontend Craft (Anti-Slop)

${DESIGN}
`;
}

export function buildSpecsReadmeContent(projectName) {
  return `# ${projectName} — Spec-Driven Development (OmniSpec)

This workspace organizes changes into four archetypes with explicit scope and evidence. Start with omni-init to understand the project, or omni-discuss to explore a question without creating a specification.

## The 4 Engineering Archetypes

| Archetype | Template Path | Purpose | Key Artifacts |
| :--- | :--- | :--- | :--- |
| **01. Feature** | \`specs/_templates/01-feature/\` | New user capabilities, views, or endpoints. | \`spec.md\` (Clarification, Non-Goals) + \`plan.md\` (Contracts, Rollback) + \`tasks.md\` |
| **02. Bugfix** | \`specs/_templates/02-bugfix/\` | Incidents, runtime crashes, and defects. | \`bug.md\` (Reproduction) + \`rca.md\` (Evidence and hypotheses) + \`fix.md\` (Scoped fix and regression) |
| **03. Tech Debt**| \`specs/_templates/03-tech-debt/\` | Refactors, legacy code, outdated packages. | \`audit.md\` (Impact) + \`migration-plan.md\` (Proportional migration) + \`tasks.md\` |
| **04. RFC / ADR** | \`specs/_templates/04-rfc-idea/\` | Architectural decisions and technical spikes. | \`rfc.md\` (MADR standard with Decision Drivers and trade-offs) |

---

## Git Workflow for Specifications

1. Read project-context.md and the active manifest before starting or resuming work.
2. Complete the appropriate specification and plan before implementation; use audit for structural checks.
3. Execute scoped tasks and record actual results in verification.md. Use verify then complete to close work.
4. Git branches and commits are optional user-controlled actions. OmniSpec does not create them.
`;
}

export async function scaffoldProject(baseDir, options = {}) {
  options = {
    ...options,
    agent: normalizeAgents(options.agent || options.ai || (await loadManifest(baseDir))?.agent).join(','),
  };
  getProfile(options.profile || 'general');
  return withManifestLock(baseDir, () => scaffoldUnlocked(baseDir, options));
}

async function scaffoldUnlocked(baseDir, options) {
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
      ['documentationStandard', options.docStandard, options.explicitDoc],
      ['qualityGates', options.qualityGates, options.explicitGates],
    ].filter(([key, value, explicit]) => explicit && value !== undefined && value !== existingManifest[key]);
    if (changes.length) {
      throw new Error(
        'Configuration changes require init --force to update CONSTITUTION.md and manifest.json together.',
      );
    }
  }

  const version = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf8')).version;
  let entries = await packageEntries();
  if (existingManifest && !force) {
    const preserved = [];
    for (const entry of entries) {
      if (entry.path.startsWith('specs/_templates/')) {
        try {
          await access(join(baseDir, entry.path));
          continue;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      preserved.push(entry);
    }
    entries = preserved;
  }
  const assets = await syncManagedFiles(
    baseDir,
    [...entries, ...integrationEntries({ ...existingManifest, ...options, version })],
    { acceptUpdates: force },
  );

  if (!constitutionExists || force) {
    const constitutionContent = buildConstitutionContent(options);
    await writeFile(constitutionPath, constitutionContent, 'utf-8');
  }

  // 2. Initialize specs/manifest.json (idempotent, preserves existing specs array)
  // Persist the synchronized version only after required assets have been written.

  // 3. Setup specs directory and copy templates (preserve customized templates if not force)
  const specsDir = join(baseDir, 'specs');

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

  await ensureProjectContext(baseDir, options.environment);
  await _initManifestUnlocked(baseDir, { ...options, version });

  return {
    constitutionPath,
    specsDir,
    manifestPath: join(specsDir, 'manifest.json'),
    assets,
  };
}

export async function createSpec(baseDir, rawArchetype, name, options = {}) {
  const requestedType = rawArchetype.toLowerCase();
  const archetypeKey = { bug: 'bugfix', fix: 'bugfix', feat: 'feature', idea: 'rfc' }[requestedType] || requestedType;
  const archetype = Object.hasOwn(ARCHETYPES, archetypeKey) ? ARCHETYPES[archetypeKey] : null;
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

    const dirNumbers = existingDirs.map(d => parseInt(d.split('-')[0], 10)).filter(n => !Number.isNaN(n));

    const manifestNumbers = (manifest.specs || []).map(s => parseInt(s.id, 10)).filter(n => !Number.isNaN(n));

    const allNumbers = [...dirNumbers, ...manifestNumbers];
    let nextNum = allNumbers.length > 0 ? Math.max(...allNumbers) + 1 : 1;

    // Sanitize name slug: transliterate diacritics (gestión -> gestion, ñ -> n)
    // instead of deleting them, so Spanish names produce readable slugs.
    const sanitizedName =
      name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'spec';

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
          const projectRows = lines
            .slice(1)
            .filter(line => line.trim().startsWith('|') && !/^\s*\|[\s:|-]+$/.test(line));

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

    await writeFile(
      join(specDir, 'verification.md'),
      '# Verification evidence\n\n[TODO] Map each acceptance criterion to a file, test or manual observation and actual result. Record limitations and unresolved findings. For an RFC, explain the decision and alternatives reviewed.\n',
    );
    await writeFile(join(specDir, 'acceptance.json'), JSON.stringify(acceptanceSeed(archetypeKey), null, 2) + '\n');

    // Register in manifest
    const specEntry = {
      id: idStr,
      type: archetypeKey,
      slug,
      title,
      status: 'IN_PROGRESS',
      created_at: today,
      branch: `${archetype.branchPrefix}/${slug}`,
    };

    const updatedManifest = (await loadManifest(baseDir)) || manifest;
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
      archetype: archetype.name,
    };
  });
}

export async function ensureProjectContext(baseDir, environment) {
  const path = join(baseDir, 'specs', 'project-context.md');
  try {
    await access(path);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await writeFile(path, buildContext(environment || (await detectProjectEnvironment(baseDir))), { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

function buildContext(environment) {
  const code = value =>
    '`' +
    String(value)
      .replaceAll('`', '\\`')
      .replace(/[\r\n|]/g, ' ') +
    '`';
  const commands = (environment.modules || []).flatMap(m => m.commandCandidates || []);
  const rows = commands
    .map(
      c =>
        `| ${code(c.command)} | ${code(c.cwd)} | ${code(c.source)} (${c.basis}) | NOT_ASSESSED | REVIEW_REQUIRED | NOT_RUN |`,
    )
    .join('\n');
  const runtimes = (environment.modules || [])
    .filter(m => m.declaredRuntime)
    .map(
      m =>
        `- DECLARED runtime constraint: ${code(m.declaredRuntime.constraint)} for ${code(m.declaredRuntime.tool)} in ${code(m.source)}; installed version and compatibility NOT_ASSESSED.`,
    )
    .join('\n');
  return `# Project context

User-owned context. Run /omni-init without extra instructions to review this seed; bootstrap is not completed conversational onboarding.

## 1. Onboarding state and scope
- State: CONTEXT_PENDING
- Application validation: APPLICATION_NOT_VALIDATED
- Inventory date: ${new Date().toISOString()}
- Coverage: ${environment.limits || 'Heuristic detection'}
- No project scripts were executed by bootstrap. A detector result is not proof of application health.

## 2. Evidence map
- Observed project type: ${environment.type}
- Inferred stack from recognized manifests: ${environment.detectedStack || 'Undecided'}
- Sources: ${(environment.evidence || []).map(code).join(', ') || 'No recognized build manifests; inspect other artifacts manually.'}
${runtimes || '- Runtime targets, installed versions and compatibility: UNKNOWN; inspect project evidence.'}
- Architecture and conventions: NOT_ASSESSED; inspect implementation and distinguish it from documented intent.

## 3. Goals and decisions
- Purpose, intended users, constraints and smallest outcome: UNKNOWN until confirmed from repository/user evidence.
- Preserve existing confirmed decisions; ask only material questions unanswered by available evidence.
- Stack/version selection: UNDECIDED until approved or explicitly delegated; record current official support/compatibility sources and consultation date before a material selection.
- Documentation convention per module: REVIEW_REQUIRED; preserve established API documentation and inspect language evidence before proposing JSDoc, TSDoc, Javadoc or another convention.
- Git boundary and local setup: UNKNOWN; initialization, commits and remote publication are separate operations requiring appropriate authorization.
- Commit convention and language: REVIEW_REQUIRED; preserve an existing convention or propose Conventional Commits 1.0.0 before the first authorized commit.
- Publication/deployment authorization: NOT_GRANTED by bootstrap; preserve any explicit local-only restriction.
- Session capabilities (native questions, web research, terminal, rendered UI inspection, delegation): UNKNOWN; inspect actual availability and record fallbacks and dependent blockers.
- UI direction and references: NOT_ASSESSED; record task, approved identity and sources when applicable, otherwise justified N/A.

## 4. Command matrix (not executed)
| Command | Working directory | Source / basis | Prerequisites | Gate selection / reason | Execution |
| --- | --- | --- | --- | --- | --- |
${rows || '| None detected | UNKNOWN | No recognized command source | NOT_ASSESSED | REVIEW_REQUIRED; manual checks may apply | NOT_RUN |'}

These are candidates, not validated checks. Inspect script definitions and CI for actual purpose, services and isolated test-data requirements before selecting gates. Record environment variable names only, never secret values. Existing manifest gates are configuration, not execution evidence.

## 5. Quality baseline and requirements
- Execution evidence: none recorded by bootstrap. Application health: UNKNOWN.
- For an executed check record command, cwd, timestamp, exit code, result and evidence location; otherwise retain NOT_RUN.
- Security, privacy, accessibility and design requirements: NOT_ASSESSED. Record declared requirements separately from implementation evidence and verified results.
- No failures reproduced by bootstrap; this does not mean there are no failures.

## 6. Existing work, risks and pending validation
- Existing-work baseline: UNKNOWN; inspect read-only Git status if available. Git is optional; record inspection errors instead of claiming a clean tree.
### Source conflicts
<!-- omni:source-conflicts -->
- NOT_ASSESSED. Compare module-specific documentation, manifests, CI, containers and code. Preserve each source's target/scope, record potential inconsistencies and carry unresolved constraints into command prerequisites. No conflict has been ruled out by bootstrap.
${(environment.warnings || []).map(w => '- Detector warning: ' + w).join('\n')}
- Pending: confirm goals, inspect relevant modules and prerequisites, review candidate gates and preserve prior work. Execute checks only in a separately authorized validation step.

## 7. Next action
Run /omni-init to record context, then discuss for exploration or specify for a concrete change. No application implementation or specification is created by onboarding alone.
`;
}
