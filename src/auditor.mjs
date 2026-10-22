import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { loadManifest, getActiveSpec } from './manifest.mjs';
import { safePath } from './managed.mjs';
import { specRoute } from './fit.mjs';

function stripHtmlComments(content) {
  return content.replace(/<!--[\s\S]*?-->/g, '');
}

function checklistStats(content) {
  let fence = null,
    checked = 0,
    unchecked = 0;
  for (const line of stripHtmlComments(content).split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const task = /^\s*- \[([ xX])\]\s+\S.*$/.exec(line);
    if (task) task[1] === ' ' ? unchecked++ : checked++;
  }
  const total = checked + unchecked;
  return { total, completed: checked, pending: unchecked, percentage: total ? Math.round((100 * checked) / total) : 0 };
}

async function readRegularFile(filePath) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return { error: 'not a regular file' };
    }
    const content = await readFile(filePath, 'utf-8');
    return { content };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Validates the completeness and health of a specification artifact
 * to prevent AI coding agents from jumping to code with underspecified requirements.
 *
 * @param {string} baseDir Project root directory
 * @param {string|null} specIdentifier Spec ID (e.g. '001') or slug, defaults to active spec
 * @returns {Promise<Object>} Audit result with blockers, warnings, and task progress
 */
export async function auditSpec(baseDir, specIdentifier = null) {
  const manifest = await loadManifest(baseDir);
  if (!manifest) {
    return {
      valid: false,
      errors: ['No OmniSpec manifest found. Run `omni-spec init` first.'],
      warnings: [],
      spec: null,
    };
  }

  let spec = null;
  if (specIdentifier) {
    spec = manifest.specs.find(s => s.id === specIdentifier || s.slug === specIdentifier);
  } else {
    spec = await getActiveSpec(baseDir);
  }

  if (!spec) {
    return {
      valid: false,
      errors: ['No active specification found. Create one with `omni-spec create <type> <name>`.'],
      warnings: [],
      spec: null,
    };
  }

  const specDir = await safePath(baseDir, `specs/${spec.slug}`);
  const errors = [];
  const warnings = [];
  let taskStats = { total: 0, completed: 0, pending: 0, percentage: 0 };
  const route = await specRoute(baseDir, spec);
  if (route?.route === 'invalid') errors.push(`fit.json is invalid: ${route.errors.join(' ')}`);
  const needsPlan = !route || route.artifacts.plan;
  const needsTasks = !route || route.artifacts.tasks;
  const optionalArtifacts = new Set();
  if (['feature', 'debt'].includes(spec.type)) {
    if (!needsPlan) optionalArtifacts.add(spec.type === 'feature' ? 'plan.md' : 'migration-plan.md');
    if (!needsTasks) optionalArtifacts.add('tasks.md');
  }
  if (optionalArtifacts.size)
    warnings.push(
      `Spec fit route is ${route.route}: ${[...optionalArtifacts].join(', ')} are not required and are not audited. Keep required decisions in the active contract or select a fuller route.`,
    );

  let files = [];
  try {
    files = await readdir(specDir);
  } catch (err) {
    return {
      valid: false,
      errors: [`Specification directory not found at specs/${spec.slug}: ${err.message}`],
      warnings: [],
      spec,
    };
  }

  // Optional route artifacts remain on disk for later promotion, but do not block this route.
  for (const file of files) {
    if (!file.endsWith('.md') || file === 'verification.md' || optionalArtifacts.has(file)) continue;
    const readResult = await readRegularFile(join(specDir, file));
    if (readResult.error) {
      errors.push(`File ${file} could not be read as a regular file: ${readResult.error}`);
      continue;
    }

    const content = readResult.content;
    if (
      content.includes('SPEC-XXX') ||
      content.includes('BUG-XXX') ||
      content.includes('DEBT-XXX') ||
      content.includes('RFC-XXX') ||
      content.includes('Nombre / Rol') ||
      content.includes('ej. ¿Esta operación') ||
      content.includes('[Rol Autorizado]') ||
      content.includes('[TODO]') ||
      content.includes('[NEEDS CLARIFICATION]')
    ) {
      errors.push(`File ${file} still contains unreplaced placeholder tokens or sample template text.`);
    }
    if (content.includes('AAAA-MM-DD') || content.includes('YYYY-MM-DD')) {
      warnings.push(`File ${file} contains unpopulated date placeholder (AAAA-MM-DD).`);
    }
  }

  // Helper to load and validate mandatory file
  async function getCleanMandatoryContent(fileName, archetypeTitle) {
    if (!files.includes(fileName)) {
      errors.push(`Missing mandatory ${archetypeTitle} artifact: ${fileName}`);
      return null;
    }
    const res = await readRegularFile(join(specDir, fileName));
    if (res.error) {
      errors.push(`Mandatory ${archetypeTitle} artifact ${fileName} is invalid or unreadable: ${res.error}`);
      return null;
    }
    const clean = stripHtmlComments(res.content);
    if (clean.trim().length === 0) {
      errors.push(`Mandatory ${archetypeTitle} artifact ${fileName} is empty.`);
      return null;
    }
    return { raw: res.content, clean };
  }

  // Archetype-specific audits
  switch (spec.type) {
    case 'feature': {
      // 1. Audit spec.md
      const specData = await getCleanMandatoryContent('spec.md', 'feature');
      if (specData) {
        const cleanSpec = specData.clean;
        // Phase 0 Clarification check
        const hasSection0 =
          cleanSpec.includes('## 0. Fase de Clarificación') || cleanSpec.includes('## 0. Clarification');

        if (!hasSection0) {
          errors.push('spec.md is missing Section 0: Clarification & Assumptions (Anti-Hallucination Gate).');
        } else {
          // Check substantive content strictly within Section 0
          const section0Match = cleanSpec.match(/^## 0\.[^\n]*\n([\s\S]*?)(?=\n#{1,2}(?:\s|$)|$(?![\s\S]))/m);
          const section0Body = section0Match ? section0Match[1] : '';
          const substantiveText = section0Body
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/^\s*#{1,6}\s+.*$/gm, '')
            .replace(/^\s*(?:[-*_]\s*){3,}$/gm, '')
            .replace(/^\s*\|[\s:|-]+$/gm, '')
            .replace(/Phase 0|Clarification|Fase de Clarificación|Supuestos|Assumptions/gi, '')
            .trim();
          if (substantiveText.length < 30) {
            errors.push('spec.md Section 0 (Clarification) lacks substantive decision content.');
          }
        }

        // Non-Goals check
        if (!cleanSpec.includes('Non-Goals') && !cleanSpec.includes('Fuera de Alcance')) {
          errors.push('spec.md does not explicitly define Non-Goals (Scope creep risk).');
        }
        // Acceptance criteria
        if (
          !cleanSpec.includes('Gherkin') &&
          !cleanSpec.includes('Criterios de Aceptación') &&
          !cleanSpec.includes('Acceptance Criteria')
        ) {
          errors.push('spec.md does not include structured Acceptance Criteria.');
        }
      }

      // 2. Audit plan.md
      if (needsPlan) {
        const planData = await getCleanMandatoryContent('plan.md', 'feature');
        if (planData) {
          const cleanPlan = planData.clean;
          if (!cleanPlan.includes('Contratos') && !cleanPlan.includes('Contracts') && !cleanPlan.includes('API')) {
            errors.push('plan.md does not clearly define Data Contracts or API contracts (or justified N/A).');
          }
          if (!cleanPlan.includes('Rollback') && !cleanPlan.includes('Reversión')) {
            errors.push('plan.md does not define a Rollback / Migration reversal strategy (or justified N/A).');
          }
        }
      }

      // 3. Audit tasks.md & progress
      if (needsTasks) {
        const tasksData = await getCleanMandatoryContent('tasks.md', 'feature');
        if (tasksData) {
          taskStats = checklistStats(tasksData.clean);

          if (taskStats.total === 0) {
            errors.push('tasks.md has no actionable checkbox tasks defined (- [ ]).');
          }
        }
      }
      break;
    }

    case 'bugfix': {
      const bugData = await getCleanMandatoryContent('bug.md', 'bugfix');
      if (bugData && bugData.clean.length < 30) {
        errors.push('bug.md lacks substantive defect reproduction details.');
      }

      const rcaData = await getCleanMandatoryContent('rca.md', 'bugfix');
      if (rcaData) {
        if (rcaData.clean.length < 30) {
          errors.push('rca.md lacks substantive root cause analysis.');
        }
      }

      const fixData = await getCleanMandatoryContent('fix.md', 'bugfix');
      if (fixData && fixData.clean.length < 30) {
        errors.push('fix.md lacks substantive fix strategy and test verification details.');
      }
      if (fixData) {
        taskStats = checklistStats(fixData.clean);
        if (!taskStats.total) errors.push('fix.md requires an actionable regression/fix task checklist.');
      }
      break;
    }

    case 'debt': {
      const auditData = await getCleanMandatoryContent('audit.md', 'tech-debt');
      if (auditData && auditData.clean.length < 30) {
        errors.push('audit.md lacks substantive debt analysis and blast radius.');
      }

      if (needsPlan) {
        const migrationData = await getCleanMandatoryContent('migration-plan.md', 'tech-debt');
        if (migrationData && migrationData.clean.length < 30) {
          errors.push('migration-plan.md lacks substantive migration steps.');
        }
      }

      if (needsTasks) {
        const debtTasksData = await getCleanMandatoryContent('tasks.md', 'tech-debt');
        if (debtTasksData) {
          taskStats = checklistStats(debtTasksData.clean);

          if (taskStats.total === 0) {
            errors.push('tasks.md has no actionable checkbox tasks defined (- [ ]).');
          }
        }
      }
      break;
    }

    case 'rfc': {
      const rfcData = await getCleanMandatoryContent('rfc.md', 'RFC');
      if (rfcData && rfcData.clean.length < 40) {
        errors.push('rfc.md lacks substantive architectural proposal content.');
      }
      break;
    }

    default:
      errors.push(`Unknown specification archetype: "${spec.type}". Valid types are: feature, bugfix, debt, rfc.`);
  }

  const isValid = errors.length === 0;

  return {
    valid: isValid,
    spec,
    specDir,
    errors,
    warnings,
    tasks: taskStats,
  };
}
