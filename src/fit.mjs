// Deterministic effort heuristics, not experimentally universal thresholds.
// Inspect technical facts and record estimates; ask the user about unresolved intent.
// Keep existing routing behavior until comparative evaluations justify changing it.
import { readFile } from 'node:fs/promises';
import { safePath } from './managed.mjs';

export const FIT_SCHEMA_VERSION = 1;
export const FIT_SUPPORTED_SCHEMA_VERSIONS = [1, 2];

export const FIT_QUESTIONS = [
  {
    id: 'reasoning',
    prompt: 'Did you reason about the problem, its edge cases and its failure modes before drafting anything?',
    values: ['done', 'partial', 'skipped'],
    why: 'Record the reasoning performed; a completed template does not establish that the problem was understood.',
  },
  {
    id: 'files',
    prompt: 'How many files does this change touch?',
    values: 'integer >= 1',
    why: 'The current heuristic escalates three files upwards; inspect affected files and revise estimates as scope changes.',
  },
  {
    id: 'modules',
    prompt: 'How many separate modules or packages does it touch?',
    values: 'integer >= 1',
    why: 'Changes across modules may require explicit coordination of contracts and verification.',
  },
  {
    id: 'crossesContract',
    prompt: 'Does it change a public API, a data schema, a storage format or any other contract other code depends on?',
    values: [true, false],
    why: 'Contract changes need explicit design, rollback and verification.',
  },
  {
    id: 'ambiguity',
    prompt: 'Does the request still hold a material ambiguity that would change the implementation?',
    values: ['none', 'material', 'blocked'],
    why: 'Inspect available evidence, then ask about material unresolved intent rather than inventing an answer.',
  },
  {
    id: 'existingTests',
    prompt: 'Do automated tests already cover the area being changed?',
    values: [true, false],
    why: 'The current heuristic requires a design for verification when existing coverage is absent.',
  },
];

export const FIT_V2_QUESTIONS = [
  ...FIT_QUESTIONS,
  {
    id: 'risk',
    prompt: 'What is the consequence of a defective change, including security, safety, money and data integrity?',
    values: ['low', 'high', 'critical'],
    why: 'One file can cause a critical failure. Record the assessed consequence rather than inferring safety from size.',
  },
  {
    id: 'uncertainty',
    prompt: 'Are the intended behavior, dependencies and verification approach understood?',
    values: ['clear', 'material', 'blocked'],
    why: 'Unresolved technical or product uncertainty needs a decision before implementation.',
  },
  {
    id: 'reversibility',
    prompt: 'Can the change be rolled back easily without irreversible data loss or external effects?',
    values: ['easy', 'difficult'],
    why: 'A difficult rollback requires an explicit recovery and verification design.',
  },
];

export const ROUTES = {
  light: {
    label: 'light',
    artifacts: { plan: false, tasks: false },
    summary: 'Primary artifact and acceptance criteria only. Reason first, implement, verify.',
  },
  standard: {
    label: 'standard',
    artifacts: { plan: true, tasks: false },
    summary: 'Primary artifact, design and acceptance criteria. No task breakdown.',
  },
  full: {
    label: 'full',
    artifacts: { plan: true, tasks: true },
    summary: 'Primary artifact, design, task breakdown and acceptance criteria.',
  },
  decision: {
    label: 'decision',
    artifacts: { plan: false, tasks: false },
    summary: 'Decision record. No implementation gates.',
  },
};

const VALUE_CHECKS = {
  reasoning: value => ['done', 'partial', 'skipped'].includes(value),
  files: value => Number.isSafeInteger(value) && value >= 1,
  modules: value => Number.isSafeInteger(value) && value >= 1,
  crossesContract: value => typeof value === 'boolean',
  ambiguity: value => ['none', 'material', 'blocked'].includes(value),
  existingTests: value => typeof value === 'boolean',
  risk: value => ['low', 'high', 'critical'].includes(value),
  uncertainty: value => ['clear', 'material', 'blocked'].includes(value),
  reversibility: value => ['easy', 'difficult'].includes(value),
};

export function validateFitAnswers(answers) {
  const errors = [];
  if (!answers || typeof answers !== 'object' || Array.isArray(answers))
    return { valid: false, errors: ['fit.json must be a JSON object with the recorded answers.'] };
  if (!FIT_SUPPORTED_SCHEMA_VERSIONS.includes(answers.schemaVersion))
    errors.push('fit.json schemaVersion must be 1 or 2.');
  const questions = answers.schemaVersion === 2 ? FIT_V2_QUESTIONS : FIT_QUESTIONS;
  for (const question of questions) {
    if (!Object.hasOwn(answers, question.id) || answers[question.id] === undefined) {
      errors.push(`fit.json is missing the answer "${question.id}".`);
      continue;
    }
    if (!VALUE_CHECKS[question.id](answers[question.id]))
      errors.push(`fit.json answer "${question.id}" is invalid. Allowed: ${allowedValues(question)}.`);
  }
  const known = new Set(questions.map(q => q.id));
  for (const key of Object.keys(answers))
    if (!known.has(key) && key !== 'schemaVersion') errors.push(`fit.json has an unknown answer "${key}".`);
  return { valid: errors.length === 0, errors };
}

function allowedValues(question) {
  return Array.isArray(question.values) ? question.values.map(v => JSON.stringify(v)).join(', ') : question.values;
}

// Pure function: the same answers always produce the same route.
export function classifyFit(answers, spec = {}) {
  const reasons = [];
  let route = 'light';

  if (spec.type === 'rfc')
    return { route: 'decision', reasons: ['RFCs are decided, not implemented.'], ...ROUTES.decision };

  if (answers.schemaVersion === 2) return classifyRiskFit(answers);

  if (spec.type === 'bugfix') {
    reasons.push(
      'A bugfix keeps the full route: root-cause analysis and an independent verification step are the point of the archetype.',
    );
    route = 'full';
  } else {
    if (answers.files >= 3) {
      route = 'full';
      reasons.push(`${answers.files} files are touched; the current heuristic escalates three files upwards.`);
    }
    if (answers.modules >= 2) {
      route = 'full';
      reasons.push(`${answers.modules} modules are touched; plan cross-module contracts and verification.`);
    }
    if (answers.crossesContract) {
      route = 'full';
      reasons.push('A public contract changes; it needs explicit design, rollback and verification.');
    }
    if (answers.ambiguity !== 'none') {
      route = 'full';
      reasons.push(`The request still holds ${answers.ambiguity} ambiguity; resolve it before choosing a route.`);
    }
    if (answers.reasoning !== 'done') {
      route = 'full';
      reasons.push('Reasoning was not completed; the specification cannot stand in for it.');
    }
    if (route === 'light' && answers.existingTests === false) {
      route = 'standard';
      reasons.push('No existing test coverage; the change needs its own design even though it is small.');
    }
  }

  if (route === 'light' && reasons.length === 0)
    reasons.push('Small, local, unambiguous and already covered; the light route is enough.');
  return { route, reasons, ...ROUTES[route] };
}

function classifyRiskFit(answers) {
  const reasons = [];
  const fullConditions = [
    [
      answers.risk !== 'low',
      `Assessed consequence is ${answers.risk}; record mitigation and independent verification.`,
    ],
    [
      answers.uncertainty !== 'clear',
      `Technical or product uncertainty is ${answers.uncertainty}; resolve decisions first.`,
    ],
    [answers.ambiguity !== 'none', `The request still holds ${answers.ambiguity} ambiguity.`],
    [answers.reversibility !== 'easy', 'Rollback is difficult; plan recovery and irreversible effects explicitly.'],
    [answers.reasoning !== 'done', 'Reasoning was not completed; templates cannot establish understanding.'],
    [answers.crossesContract, 'A public contract changes; design compatibility, rollback and verification.'],
    [answers.modules >= 2, `${answers.modules} modules need coordinated design and verification.`],
    [answers.files >= 3, `${answers.files} affected files exceed the current local-change heuristic.`],
  ];
  for (const [condition, reason] of fullConditions) if (condition) reasons.push(reason);
  let route = reasons.length ? 'full' : 'light';
  if (route === 'light' && !answers.existingTests) {
    route = 'standard';
    reasons.push('No existing test coverage; design meaningful regression verification before implementing.');
  }
  if (!reasons.length)
    reasons.push(
      'Declared low consequence, clear intent, easy rollback and local covered scope allow the light route, including a bugfix.',
    );
  return { route, reasons, ...ROUTES[route] };
}

export async function readFit(root, spec) {
  const path = await safePath(root, `specs/${spec.slug}/fit.json`);
  try {
    const raw = await readFile(path, 'utf8');
    return { present: true, answers: JSON.parse(raw.replace(/^\uFEFF/, '')) };
  } catch (error) {
    if (error.code === 'ENOENT') return { present: false, answers: null };
    if (error instanceof SyntaxError)
      return { present: true, answers: null, invalid: true, errors: ['fit.json is not valid JSON.'] };
    throw error;
  }
}

// Returns the route for a spec, or null when the change was never classified.
export async function specRoute(root, spec) {
  const fit = await readFit(root, spec);
  if (!fit.present) return null;
  if (fit.invalid) return { route: 'invalid', errors: fit.errors, artifacts: { plan: true, tasks: true } };
  const validation = validateFitAnswers(fit.answers);
  if (!validation.valid) return { route: 'invalid', errors: validation.errors, artifacts: { plan: true, tasks: true } };
  return classifyFit(fit.answers, spec);
}

export function fitQuestionnaire(schemaVersion = FIT_SCHEMA_VERSION) {
  if (!FIT_SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) throw new Error('fit schemaVersion must be 1 or 2.');
  return {
    schemaVersion,
    file: 'specs/<slug>/fit.json',
    example:
      schemaVersion === 2
        ? {
            schemaVersion: 2,
            reasoning: 'done',
            files: 1,
            modules: 1,
            crossesContract: false,
            ambiguity: 'none',
            existingTests: true,
            risk: 'low',
            uncertainty: 'clear',
            reversibility: 'easy',
          }
        : {
            schemaVersion: 1,
            reasoning: 'done',
            files: 1,
            modules: 1,
            crossesContract: false,
            ambiguity: 'none',
            existingTests: true,
          },
    questions: schemaVersion === 2 ? FIT_V2_QUESTIONS : FIT_QUESTIONS,
    note: 'Answer every question with the recorded value, then run `omni-spec fit <id>` to read the route. The route is derived, never written by hand.',
  };
}
