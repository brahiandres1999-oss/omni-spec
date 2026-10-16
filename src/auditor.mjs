import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadManifest, getActiveSpec } from './manifest.mjs';

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
      spec: null
    };
  }

  let spec = null;
  if (specIdentifier) {
    spec = manifest.specs.find((s) => s.id === specIdentifier || s.slug === specIdentifier);
  } else {
    spec = await getActiveSpec(baseDir);
  }

  if (!spec) {
    return {
      valid: false,
      errors: ['No active specification found. Create one with `omni-spec create <type> <name>`.'],
      warnings: [],
      spec: null
    };
  }

  const specDir = join(baseDir, 'specs', spec.slug);
  const errors = [];
  const warnings = [];
  let taskStats = { total: 0, completed: 0, pending: 0, percentage: 0 };

  let files = [];
  try {
    files = await readdir(specDir);
  } catch (err) {
    return {
      valid: false,
      errors: [`Specification directory not found at specs/${spec.slug}: ${err.message}`],
      warnings: [],
      spec
    };
  }

  // Common check across all archetypes: placeholder tokens
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    try {
      const content = await readFile(join(specDir, file), 'utf-8');
      if (
        content.includes('SPEC-XXX') ||
        content.includes('BUG-XXX') ||
        content.includes('DEBT-XXX') ||
        content.includes('RFC-XXX') ||
        content.includes('Nombre / Rol') ||
        content.includes('ej. ¿Esta operación') ||
        content.includes('[Rol Autorizado]') ||
        content.includes('[TODO]')
      ) {
        errors.push(`File ${file} still contains unreplaced placeholder tokens or sample template text.`);
      }
      if (content.includes('AAAA-MM-DD') || content.includes('YYYY-MM-DD')) {
        warnings.push(`File ${file} contains unpopulated date placeholder (AAAA-MM-DD).`);
      }
    } catch {
      // Ignored
    }
  }

  // Archetype-specific audits
  switch (spec.type) {
    case 'feature': {
      // 1. Audit spec.md
      if (!files.includes('spec.md')) {
        errors.push('Missing mandatory artifact: spec.md');
      } else {
        const specContent = await readFile(join(specDir, 'spec.md'), 'utf-8');
        // Phase 0 Clarification check
        if (!specContent.includes('## 0. Fase de Clarificación') && !specContent.includes('## 0. Clarification')) {
          errors.push('spec.md is missing Section 0: Clarification & Assumptions (Anti-Hallucination Gate).');
        }
        // Non-Goals check
        if (!specContent.includes('Non-Goals') && !specContent.includes('Fuera de Alcance')) {
          warnings.push('spec.md does not explicitly define Non-Goals (Scope creep risk).');
        }
        // Acceptance criteria
        if (!specContent.includes('Gherkin') && !specContent.includes('Criterios de Aceptación') && !specContent.includes('Acceptance Criteria')) {
          warnings.push('spec.md does not include structured Acceptance Criteria.');
        }
      }

      // 2. Audit plan.md
      if (!files.includes('plan.md')) {
        errors.push('Missing mandatory artifact: plan.md');
      } else {
        const planContent = await readFile(join(specDir, 'plan.md'), 'utf-8');
        if (!planContent.includes('Contratos') && !planContent.includes('Contracts') && !planContent.includes('API')) {
          warnings.push('plan.md does not clearly define Data Contracts or API contracts.');
        }
        if (!planContent.includes('Rollback') && !planContent.includes('Reversión')) {
          warnings.push('plan.md does not define a Rollback / Migration reversal strategy.');
        }
      }

      // 3. Audit tasks.md & progress
      if (!files.includes('tasks.md')) {
        errors.push('Missing mandatory artifact: tasks.md');
      } else {
        const tasksContent = await readFile(join(specDir, 'tasks.md'), 'utf-8');
        const checked = (tasksContent.match(/- \[[xX]\]/g) || []).length;
        const unchecked = (tasksContent.match(/- \[ \]/g) || []).length;
        const total = checked + unchecked;
        const percentage = total > 0 ? Math.round((checked / total) * 100) : 0;
        taskStats = { total, completed: checked, pending: unchecked, percentage };

        if (total === 0) {
          warnings.push('tasks.md has no actionable checkbox tasks defined (- [ ]).');
        }
      }
      break;
    }

    case 'bugfix': {
      if (!files.includes('bug.md')) errors.push('Missing mandatory bugfix artifact: bug.md');
      if (!files.includes('rca.md')) {
        errors.push('Missing mandatory Root Cause Analysis artifact: rca.md');
      } else {
        const rcaContent = await readFile(join(specDir, 'rca.md'), 'utf-8');
        if (!rcaContent.includes('5 Whys') && !rcaContent.includes('Por qué')) {
          warnings.push('rca.md does not document a 5 Whys root cause analysis chain.');
        }
      }
      if (!files.includes('fix.md')) errors.push('Missing mandatory fix artifact: fix.md');
      break;
    }

    case 'debt': {
      if (!files.includes('audit.md')) errors.push('Missing mandatory tech-debt artifact: audit.md');
      if (!files.includes('migration-plan.md')) {
        errors.push('Missing mandatory migration artifact: migration-plan.md');
      }
      if (!files.includes('tasks.md')) errors.push('Missing mandatory tasks artifact: tasks.md');
      break;
    }

    case 'rfc': {
      if (!files.includes('rfc.md')) errors.push('Missing mandatory RFC artifact: rfc.md');
      break;
    }

    default:
      warnings.push(`Unknown specification archetype: ${spec.type}`);
  }

  const isValid = errors.length === 0;

  return {
    valid: isValid,
    spec,
    specDir,
    errors,
    warnings,
    tasks: taskStats
  };
}
