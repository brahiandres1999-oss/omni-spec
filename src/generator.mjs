import { readFile, writeFile, mkdir, cp, readdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProfile } from './profiles/index.mjs';
import { _initManifestUnlocked, loadManifest, saveManifest, withManifestLock } from './manifest.mjs';
import { integrationEntries, normalizeAgents } from './integrations.mjs';
import { packageEntries, pluginEntries } from './assets.mjs';
import { syncManagedFiles } from './managed.mjs';
import { detectProjectEnvironment } from './detector.mjs';
import { acceptanceSeed } from './acceptance.mjs';
import { QUESTIONS, DOCUMENTATION } from './protocols.mjs';
import { FIT_PRESETS } from './fit.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** @returns {Promise<boolean>} Whether the path exists; errors other than ENOENT propagate. */
async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
export async function copyDirectoryRecursive(src, dest, overwrite = true) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(srcPath, destPath, overwrite);
    } else {
      if (!overwrite && (await pathExists(destPath))) continue;
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

const PROFILE_NOTE =
  'These profile controls are review prompts; applicability must be established for this project. They do not certify regulatory compliance.';

export function buildConstitutionContent(options) {
  const profile = getProfile(options.profile);
  const projectName = options.projectName || 'MyProject';
  const stack = options.stack || 'Undecided';
  const docStandard = options.docStandard || 'Project conventions';
  const qualityGates = options.qualityGates || '# Not configured. Review project evidence with /omni-init.';

  return `# CONSTITUTION — ${projectName}

> Project engineering agreement. Apply it within the user's instructions and authorized scope; resolve material conflicts explicitly rather than silently overriding decisions.

---

## 1. Governance & Code Surgery: Backend Pragmatic Craft & Zero Code Slop

1. **Pre-Execution Diagnostic:** Before making any non-trivial change, present a structured assessment: *Problem, Proposed Solution, and Consequences/Risks*.
2. **Strict Non-Destructive Policy:** Destructive changes, large refactors, or database modifications require explicit approval.
3. **Evidence and uncertainty:** Distinguish verified facts, hypotheses and unresolved decisions. Inspect repository evidence first; ask the user about material ambiguity. Never invent business rules or claim certainty from a structural audit.
4. **Minimal Touch Surgery:** Modify exclusively the files necessary to achieve the verified objective. Do not touch adjacent working code or reformat unrelated modules.
5. **Demonstrable Quality Gates:** Record actual results and pre-existing failures. Automated gates must pass for automated verification; when none apply, document explicitly labeled manual evidence. A checklist is not proof of behavior.
6. **Backend Pragmatic Craft & Zero Code Slop:**
   - *Strict YAGNI & Direct Implementation:* Never add speculative layers, DTOs, factories or wrappers when standard functions/modules suffice.
   - *Zero Comment Slop:* Avoid comments that only narrate syntax. Preserve accurate API documentation, contracts and constraints.
   - *Fail-Fast & Transparent Failures:* Strictly forbid defensive \`try/catch\` wrappers that swallow exceptions, return nulls, or mask errors.
   - *Zero Spec & Plan Slop:* Specifications and plans maintain high technical density: tabular evidence, non-goals, atomic criteria (\`AC-01\`).
7. **Write-Before-Speak & Zero Deferred Slop:** Never claim modifications exist before physically writing them; do not defer agreed requirement adjustments to 'later in code'. Persist scope adjustments to existing artifacts or record in memory, and re-audit before closing the turn.

---

## 2. Domain & Regulatory Invariants (${profile.name})

${profile.constitutionInvariants}

${PROFILE_NOTE}

---

## 3. Technology Stack & Documentation Standards

* **Primary Tech Stack:** \`${stack}\`
* **Documentation Standard:** \`${docStandard}\` (All public APIs, exported interfaces, and complex functions must follow this convention).

${DOCUMENTATION}

### Supported technology decisions
Never select or pin a dependency or runtime version from memory: consult current official sources and the package registry, record the dated sources with the approval or delegation (decision-record), and prefer runtime-native APIs when they suffice. Without web access the choice stays provisional.

### Clarification and setup
${QUESTIONS}
Setup, Git, the commit convention and session capabilities follow guide setup.

---

## 4. Delivery Quality Gates

The following commands must run and pass cleanly before considering any task or Pull Request complete:

\`\`\`bash
${qualityGates}
\`\`\`

---

## 5. UI Ergonomics & Frontend Craft (Anti-Slop)

Interface work follows guide design: references, direction, applicable states and rendered and interaction evidence. Changes without an interface do not load it.
`;
}

/**
 * Rewrite only the CONSTITUTION.md parts that hold a configured value, preserving every other line.
 * Used by `configure` so stack, profile, documentation and gates can change without init --force.
 * @param {string} content Current CONSTITUTION.md text.
 * @param {{gates?: string, stack?: string, profile?: string, doc?: string}} changes Values to set;
 *   undefined keys stay untouched, and an empty gates string records that no checks are configured.
 * @returns {string} Updated text.
 * @throws {Error} Unknown profile, or a custom constitution without the section a change needs;
 *   nothing is written in that case.
 */
export function configureConstitution(content, { gates, stack, profile, doc }) {
  const replace = (text, pattern, value, section) => {
    if (!pattern.test(text))
      throw new Error(
        `Custom constitution has no recognizable ${section}. Add it before configuring this value; custom text was preserved.`,
      );
    return text.replace(pattern, () => value);
  };
  let next = content;
  if (gates !== undefined)
    next = replace(
      next,
      /^## 4\. Delivery Quality Gates[^\n]*\n[\s\S]*?(?=^## |$(?![\s\S]))/m,
      `## 4. Delivery Quality Gates\n\nConfigured commands, executed from the project root by verify. Review commands before execution.\n\n\`\`\`text\n${gates || '# No automated checks configured; explicit manual evidence is required.'}\n\`\`\`\n\n`,
      'Delivery Quality Gates section',
    );
  if (profile !== undefined) {
    const selected = getProfile(profile);
    next = replace(
      next,
      /^## 2\. Domain & Regulatory Invariants[^\n]*\n[\s\S]*?(?=^---|^## )/m,
      `## 2. Domain & Regulatory Invariants (${selected.name})\n\n${selected.constitutionInvariants}\n\n${PROFILE_NOTE}\n\n`,
      'Domain & Regulatory Invariants section',
    );
  }
  if (stack !== undefined)
    next = replace(
      next,
      /^\* \*\*Primary Tech Stack:\*\* `[^`\n]*`/m,
      `* **Primary Tech Stack:** \`${stack}\``,
      'Primary Tech Stack line',
    );
  if (doc !== undefined)
    next = replace(
      next,
      /^\* \*\*Documentation Standard:\*\* `[^`\n]*`/m,
      `* **Documentation Standard:** \`${doc}\``,
      'Documentation Standard line',
    );
  return next;
}

/**
 * specs/README.md for a new project, in the installer language. It describes the conversation-first
 * cycle and the ceremony routes; it is written once and never replaced on reinstall.
 * @param {string} projectName Project name for the title.
 * @param {string} [language] 'es' for Spanish; anything else writes English.
 * @returns {string} Markdown content.
 */
export function buildSpecsReadmeContent(projectName, language = 'en', options = {}) {
  const pluginMode = normalizeAgents(options.agent).includes('plugin');
  const templateNoteEs = pluginMode
    ? 'Las plantillas maestras vienen integradas en OmniSpec y se invocan desde el chat con tu agente.'
    : 'Las plantillas están en `specs/_templates/`.';
  const templateNoteEn = pluginMode
    ? 'Master templates are built into OmniSpec and invoked from chat with your agent.'
    : 'Templates live in `specs/_templates/`.';
  if (language === 'es')
    return `# ${projectName} — OmniSpec

Aquí quedan los acuerdos de cada cambio: qué se decidió, por qué y con qué evidencia se cerró. Todo empieza en el chat de tu agente: \`/omni-init\` para conocer el proyecto y \`/omni-discuss\` para explorar una idea sin crear documentos.

## Cómo avanza un cambio

1. **Conversar:** \`/omni-discuss\` explora y responde; no crea archivos.
2. **Especificar:** \`/omni-specify\` crea solo el documento principal del cambio.
3. **Clasificar:** el agente evalúa riesgo, claridad y tamaño con \`fit\`. La ruta decide cuánta documentación hace falta.
4. **Construir y cerrar:** se implementa y \`/omni-converge\` registra la evidencia con \`verify\` y \`complete\`.

| Ruta | Cuándo | Documentos |
| :--- | :--- | :--- |
| **Ligera** | Cambio claro, de bajo riesgo, fácil de revertir y con pruebas | Solo el documento principal |
| **Estándar** | Toca varios archivos o módulos, o no tiene pruebas | Documento principal + diseño |
| **Completa** | Riesgo alto, contratos públicos, ambigüedad o difícil de revertir | Documento principal + diseño + tareas |

## Tipos de cambio

| Tipo | Para qué | Documento principal | Se suma en rutas estándar/completa |
| :--- | :--- | :--- | :--- |
| **Feature** | Capacidades nuevas | \`spec.md\` | \`plan.md\`, \`tasks.md\` |
| **Bugfix** | Errores e incidentes | \`bug.md\` (incluye causa raíz y prueba de regresión) | \`rca.md\`, \`fix.md\` |
| **Deuda técnica** | Refactors y actualizaciones | \`audit.md\` | \`migration-plan.md\`, \`tasks.md\` |
| **RFC** | Decisiones de arquitectura | \`rfc.md\` | — |

${templateNoteEs} \`specs/project-context.md\` guarda el contexto y las decisiones del proyecto.

Las ramas y los commits los decides tú; OmniSpec no los crea.
`;
  return `# ${projectName} — OmniSpec

This folder keeps the agreements behind each change: what was decided, why, and the evidence it closed with. Everything starts in your agent's chat: \`/omni-init\` to learn the project and \`/omni-discuss\` to explore an idea without creating documents.

## How a change moves

1. **Discuss:** \`/omni-discuss\` explores and answers; it creates no files.
2. **Specify:** \`/omni-specify\` creates only the change's primary document.
3. **Classify:** the agent assesses risk, clarity and size with \`fit\`. The route decides how much documentation is needed.
4. **Build and close:** implement, then \`/omni-converge\` records evidence with \`verify\` and \`complete\`.

| Route | When | Documents |
| :--- | :--- | :--- |
| **Light** | Clear, low-risk, easy to roll back and covered by tests | Primary document only |
| **Standard** | Touches several files or modules, or lacks tests | Primary document + design |
| **Full** | High risk, public contracts, ambiguity or hard rollback | Primary document + design + tasks |

## Kinds of change

| Kind | For | Primary document | Added on standard/full routes |
| :--- | :--- | :--- | :--- |
| **Feature** | New capabilities | \`spec.md\` | \`plan.md\`, \`tasks.md\` |
| **Bugfix** | Defects and incidents | \`bug.md\` (includes root cause and regression test) | \`rca.md\`, \`fix.md\` |
| **Tech debt** | Refactors and upgrades | \`audit.md\` | \`migration-plan.md\`, \`tasks.md\` |
| **RFC** | Architecture decisions | \`rfc.md\` | — |

${templateNoteEn} \`specs/project-context.md\` keeps the project's context and decisions.

Branches and commits are yours to decide; OmniSpec does not create them.
`;
}

/**
 * Prepare or reinitialize OmniSpec under the manifest lock, preserving specifications.
 * @param {string} baseDir Project root.
 * @param {object} [options] Installation configuration from runWizard. ui contains
 *   components; without ui the saved selection is preserved. force replaces managed local edits.
 * @returns {Promise<object>} Constitution, specifications and manifest paths plus managed-file changes.
 * @throws {Error} Invalid configuration, unsafe paths, edited managed files without force, or filesystem failure.
 *   Validation precedes managed-file writes.
 * @description Writes configuration, runtime, templates and host integrations. Does not run Git.
 */
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
  const constitutionExists = await pathExists(constitutionPath);

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
  const pluginMode = normalizeAgents(options.agent).includes('plugin');
  let entries = pluginMode ? pluginEntries() : await packageEntries();
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
  const readmeExists = await pathExists(specsReadmePath);

  if (!readmeExists || force) {
    await writeFile(specsReadmePath, buildSpecsReadmeContent(options.projectName, options.language, options), 'utf-8');
  }

  await ensureProjectContext(baseDir, options.environment, options.language);
  await _initManifestUnlocked(baseDir, { ...options, version });

  return {
    constitutionPath,
    specsDir,
    manifestPath: join(specsDir, 'manifest.json'),
    assets,
  };
}

/**
 * Create a specification folder for an archetype and make it the active spec.
 * Without a route option (light, standard, full or route) the change is unclassified: only the
 * primary artifact, acceptance.json and verification.md are written and no fit.json is recorded,
 * so audit, verify and complete ask for classification with fit before anything else.
 * @param {string} baseDir Project root.
 * @param {string} rawArchetype feature, bugfix (bug/fix), debt (refactor) or rfc (idea).
 * @param {string} name Human name; sanitized into the slug.
 * @param {{light?: boolean, standard?: boolean, full?: boolean, route?: string, title?: string,
 *   profile?: string}} [options] Explicit route preset and template values.
 * @returns {Promise<{id: string, slug: string, specDir: string, branch: string, archetype: string,
 *   route: string|null}>} Created spec; route is null while unclassified.
 * @throws {Error} Unknown archetype, missing manifest or unsafe path.
 */
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
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

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

    const route = options.light ? 'light' : options.standard ? 'standard' : options.full ? 'full' : options.route;
    const allowedFiles = new Set(files);
    // An unclassified change starts with the primary artifact only; fit scaffolds the rest on escalation.
    if (route === 'light' || !route) {
      if (archetypeKey === 'feature') {
        allowedFiles.delete('plan.md');
        allowedFiles.delete('tasks.md');
      } else if (archetypeKey === 'bugfix') {
        allowedFiles.delete('rca.md');
        allowedFiles.delete('fix.md');
      } else if (archetypeKey === 'debt') {
        allowedFiles.delete('migration-plan.md');
        allowedFiles.delete('tasks.md');
      }
    } else if (route === 'standard') {
      if (archetypeKey === 'feature' || archetypeKey === 'debt') {
        allowedFiles.delete('tasks.md');
      }
    }

    const today = new Date().toISOString().split('T')[0];
    const title = options.title || name.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const profile = getProfile(manifest.profile || options.profile || 'general');

    for (const file of files) {
      if (!allowedFiles.has(file)) continue;
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
        const tableMatch = content.match(
          /(^\| (?:Control de Seguridad|Security Control)[^\r\n]*\r?\n(?:\|[^\r\n]*(?:\r?\n|$))*)/m,
        );
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
    if (route && FIT_PRESETS[route]) {
      await writeFile(join(specDir, 'fit.json'), JSON.stringify(FIT_PRESETS[route], null, 2) + '\n', 'utf-8');
    }

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
      route: route || null,
    };
  });
}

export async function scaffoldMissingRouteArtifacts(baseDir, spec, targetRoute) {
  const archetype = ARCHETYPES[spec.type];
  if (!archetype) return [];

  const requiredFiles = [];
  if (['standard', 'full'].includes(targetRoute)) {
    if (spec.type === 'feature') requiredFiles.push('plan.md');
    else if (spec.type === 'bugfix') requiredFiles.push('rca.md', 'fix.md');
    else if (spec.type === 'debt') requiredFiles.push('migration-plan.md');
  }
  if (targetRoute === 'full') {
    if (['feature', 'debt'].includes(spec.type)) requiredFiles.push('tasks.md');
  }

  let templateSourceDir = join(baseDir, 'specs', '_templates', archetype.folder);
  try {
    await access(templateSourceDir);
  } catch {
    templateSourceDir = join(__dirname, 'templates', archetype.folder);
  }

  const specDir = join(baseDir, 'specs', spec.slug);
  const today = new Date().toISOString().split('T')[0];
  const title = spec.title || spec.slug;
  const idStr = spec.id;
  const scaffolded = [];

  for (const file of requiredFiles) {
    const destFile = join(specDir, file);
    try {
      await access(destFile);
    } catch {
      const srcFile = join(templateSourceDir, file);
      try {
        let content = await readFile(srcFile, 'utf-8');
        content = content
          .replaceAll('XXX', idStr)
          .replaceAll('AAAA-MM-DD', today)
          .replaceAll('YYYY-MM-DD', today)
          .replaceAll('Título de la Especificación', title)
          .replaceAll('Short Title', title)
          .replaceAll('Incident Title / Short Description', title);
        await writeFile(destFile, content, 'utf-8');
        scaffolded.push(file);
      } catch (error) {
        // Archetypes may list documents that have no template; any other failure is real.
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }

  return scaffolded;
}

export async function ensureProjectContext(baseDir, environment, language = 'en') {
  const path = join(baseDir, 'specs', 'project-context.md');
  try {
    await access(path);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await writeFile(path, buildContext(environment || (await detectProjectEnvironment(baseDir)), language), {
      flag: 'wx',
    });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

function buildContext(environment, language) {
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
  if (language === 'es')
    return `# Contexto del proyecto

Contexto propiedad del usuario. Ejecuta /omni-init sin instrucciones adicionales para revisar esta semilla; la instalación no completa el onboarding conversacional.

## 1. Estado del onboarding y alcance
- Estado: CONTEXT_PENDING
- Validación de la aplicación: APPLICATION_NOT_VALIDATED
- Fecha del inventario: ${new Date().toISOString()}
- Cobertura: ${environment.limits || 'Detección heurística'}
- La instalación no ejecutó scripts del proyecto. Un resultado del detector no prueba la salud de la aplicación.

## 2. Mapa de evidencias
- Tipo de proyecto observado: ${environment.type}
- Stack inferido de manifiestos reconocidos: ${environment.detectedStack || 'Undecided'}
- Fuentes: ${(environment.evidence || []).map(code).join(', ') || 'No se reconocieron manifiestos de build; revisa otros archivos manualmente.'}
${runtimes || '- Runtimes objetivo, versiones instaladas y compatibilidad: UNKNOWN; revisa la evidencia del proyecto.'}
- Arquitectura y convenciones: NOT_ASSESSED; revisa la implementación y distínguela de la intención documentada.

## 3. Objetivos y decisiones
- Propósito, usuarios previstos, restricciones y resultado mínimo: UNKNOWN hasta confirmarlo con evidencia del repositorio o del usuario.
- Conserva las decisiones ya confirmadas; pregunta solo lo material que la evidencia disponible no responde.
- Selección de stack y versiones: UNDECIDED hasta su aprobación o delegación explícita; registra fuentes oficiales vigentes de soporte/compatibilidad y su fecha de consulta antes de una selección material.
- Convención de documentación por módulo: REVIEW_REQUIRED; conserva la documentación de API existente y revisa la evidencia del lenguaje antes de proponer JSDoc, TSDoc, Javadoc u otra convención.
- Límite de Git y preparación local: UNKNOWN; inicializar, hacer commits y publicar en remoto son operaciones separadas que requieren autorización.
- Convención e idioma de commits: REVIEW_REQUIRED; conserva una convención existente o propone Conventional Commits 1.0.0 antes del primer commit autorizado.
- Autorización de publicación/despliegue: NOT_GRANTED por la instalación; conserva cualquier restricción explícita de trabajo solo local.
- Capacidades de la sesión (preguntas nativas, búsqueda web, terminal, inspección de UI renderizada, delegación): UNKNOWN; revisa la disponibilidad real y registra alternativas y bloqueos dependientes.
- Dirección de UI y referencias: NOT_ASSESSED; registra tarea, identidad aprobada y fuentes cuando aplique; si no, N/A justificado.

## 4. Matriz de comandos (no ejecutados)
| Comando | Directorio | Fuente / base | Prerrequisitos | Selección como check / motivo | Ejecución |
| --- | --- | --- | --- | --- | --- |
${rows || '| Ninguno detectado | UNKNOWN | Sin fuente de comandos reconocida | NOT_ASSESSED | REVIEW_REQUIRED; pueden aplicar comprobaciones manuales | NOT_RUN |'}

Son candidatos, no checks validados. Revisa las definiciones de scripts y la CI para conocer su propósito real, servicios y datos de prueba aislados antes de elegir checks. Registra solo nombres de variables de entorno, nunca valores secretos. Los checks configurados en el manifiesto son configuración, no evidencia de ejecución.

## 5. Línea base de calidad y requisitos
- Evidencia de ejecución: ninguna registrada por la instalación. Salud de la aplicación: UNKNOWN.
- Para un check ejecutado registra comando, directorio, fecha y hora, código de salida, resultado y ubicación de la evidencia; si no, conserva NOT_RUN.
- Requisitos de seguridad, privacidad, accesibilidad y diseño: NOT_ASSESSED. Registra los requisitos declarados por separado de la evidencia de implementación y de los resultados verificados.
- La instalación no reprodujo fallos; eso no significa que no los haya.

## 6. Trabajo existente, riesgos y validación pendiente
- Línea base del trabajo existente: UNKNOWN; revisa el estado de Git en modo lectura si está disponible. Git es opcional; registra errores de inspección en lugar de afirmar un árbol limpio.
### Conflictos entre fuentes
<!-- omni:source-conflicts -->
- NOT_ASSESSED. Compara documentación por módulo, manifiestos, CI, contenedores y código. Conserva el alcance de cada fuente, registra posibles inconsistencias y lleva las restricciones sin resolver a los prerrequisitos de comandos. La instalación no descartó ningún conflicto.
${(environment.warnings || []).map(w => '- Aviso del detector: ' + w).join('\n')}
- Pendiente: confirmar objetivos, revisar módulos relevantes y prerrequisitos, revisar checks candidatos y conservar el trabajo previo. Ejecuta checks solo en un paso de validación autorizado aparte.

## 7. Siguiente acción
Ejecuta /omni-init para registrar el contexto; después usa discuss para explorar o specify para un cambio concreto. El onboarding por sí solo no crea implementación ni especificaciones.
`;
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
