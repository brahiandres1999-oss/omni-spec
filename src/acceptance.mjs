import { readFile, stat } from 'node:fs/promises';
import { safePath } from './managed.mjs';
import { readProjectState, observationSession } from './project-state.mjs';

const primaryFiles = { feature: 'spec.md', bugfix: 'bug.md', debt: 'audit.md', rfc: 'rfc.md' };
/** @param {string} type Spec archetype. @returns {object} Pending v2 criteria. */
export function acceptanceSeed(type) {
  return {
    schemaVersion: 2,
    criteria: [
      {
        id: type === 'rfc' ? 'DECISION' : 'AC-01',
        kind: type === 'rfc' ? 'decision' : 'functional',
        status: 'pending',
        method: null,
        evidence: '',
      },
    ],
  };
}

/**
 * Validate declared criterion coverage and typed UI evidence without executing evidence text.
 * @param {string} root Project root.
 * @param {object} spec Active spec ID, slug and archetype.
 * @returns {Promise<object>} Reviewed declarations; evidence truth still requires review.
 * @throws {Error} Missing criteria, unresolved results or insufficient structured evidence.
 */
export async function reviewAcceptance(root, spec) {
  const prefix = `specs/${spec.slug}/`;
  const primary = await readFile(await safePath(root, prefix + primaryFiles[spec.type]), 'utf8');
  const criteria = [...new Set(primary.match(/\bAC-\d+\b/g) || [])];
  if (spec.type === 'rfc' && !criteria.length) criteria.push('DECISION');
  if (!criteria.length)
    throw new Error('Acceptance criteria need stable AC-01-style IDs in the primary artifact before verification.');
  let report;
  try {
    report = JSON.parse(
      (await readFile(await safePath(root, prefix + 'acceptance.json'), 'utf8')).replace(/^\uFEFF/, ''),
    );
  } catch {
    throw new Error(
      'Create a valid acceptance.json with explicit criterion status, method and evidence. Existing specs are preserved; migrate their evidence before verifying again.',
    );
  }
  if (![1, 2].includes(report.schemaVersion) || !Array.isArray(report.criteria))
    throw new Error('Invalid acceptance.json schemaVersion/criteria.');
  const seen = new Set();
  for (const item of report.criteria) {
    if (!item || typeof item.id !== 'string' || seen.has(item.id) || !criteria.includes(item.id))
      throw new Error('Acceptance IDs must be unique and match the primary artifact; remove stale or invented rows.');
    seen.add(item.id);
    if (item.status !== 'passed')
      throw new Error(
        `Acceptance criterion ${item.id} remains ${item.status || 'pending'}; passing quality gates cannot close it.`,
      );
    if (!['automated', 'manual', 'inspection', 'decision'].includes(item.method))
      throw new Error(`Record the actual evidence method for ${item.id}.`);
    if (
      typeof item.evidence !== 'string' ||
      item.evidence.trim().length < 20 ||
      /\[TODO\]|\[NEEDS CLARIFICATION\]/i.test(item.evidence)
    )
      throw new Error(`Record specific evidence and its limits for ${item.id}.`);
    if (spec.type === 'rfc' && item.method !== 'decision')
      throw new Error('RFC acceptance evidence must record decision review.');
    const refs = item.checkIds || item.checkCommands;
    if (item.checkIds && item.checkCommands) throw new Error(`Use checkIds or checkCommands for ${item.id}, not both.`);
    if (
      item.method === 'automated' &&
      (!Array.isArray(refs) ||
        !refs.length ||
        refs.some(command => typeof command !== 'string' || !command.trim()) ||
        new Set(refs).size !== refs.length)
    )
      throw new Error(
        `Automated criterion ${item.id} requires unique checkCommands or checkIds referencing configured checks; migrate its evidence before verifying.`,
      );
    const declaredKind = new RegExp(
      `\\b${item.id}\\s*\\[(functional|visual|interaction|accessibility|decision)\\]`,
      'i',
    )
      .exec(primary)?.[1]
      .toLowerCase();
    if (
      report.schemaVersion === 2 &&
      !['functional', 'visual', 'interaction', 'accessibility', 'decision'].includes(item.kind)
    )
      throw new Error(`Record the acceptance kind for ${item.id}.`);
    if (declaredKind && declaredKind !== item.kind)
      throw new Error(`Criterion ${item.id} kind must match [${declaredKind}] in the primary contract.`);
    if (['visual', 'interaction', 'accessibility'].includes(item.kind)) {
      if (!['automated', 'manual'].includes(item.method))
        throw new Error(
          `UI criterion ${item.id} requires executed UI checks or observed manual evidence; source inspection is insufficient.`,
        );
      if (item.method === 'manual') {
        if (!Array.isArray(item.observations) || !item.observations.length)
          throw new Error(`UI criterion ${item.id} needs observations of the actual render/journey.`);
        const state = await readProjectState(root);
        for (const observation of item.observations) {
          if (
            !observation ||
            !['agent', 'human'].includes(observation.actor) ||
            ['observer', 'surface', 'environment', 'expected', 'actual'].some(
              field => typeof observation[field] !== 'string' || !observation[field].trim(),
            ) ||
            !Array.isArray(observation.steps) ||
            !observation.steps.length ||
            observation.steps.some(step => typeof step !== 'string' || !step.trim()) ||
            observation.result !== 'passed' ||
            !Number.isFinite(Date.parse(observation.observedAt)) ||
            Date.parse(observation.observedAt) > Date.now() + 60000
          )
            throw new Error(
              `Incomplete observed UI evidence for ${item.id}; record actor, environment, steps, expected/actual and time.`,
            );
          if (
            observation.actor === 'agent' &&
            observationSession(state, observation)?.capabilities?.render?.status !== 'available'
          )
            throw new Error(
              `Agent UI evidence for ${item.id} requires a recorded session with render capability available at the observation time. Run session-record before observing, and use its sessionId or a later observedAt.`,
            );
          if (
            item.kind === 'visual' &&
            (!observation.viewport ||
              !Number.isFinite(observation.viewport.width) ||
              !Number.isFinite(observation.viewport.height) ||
              observation.viewport.width <= 0 ||
              observation.viewport.height <= 0)
          )
            throw new Error(`Visual criterion ${item.id} requires measured viewport dimensions.`);
          if (typeof observation.artifact !== 'string')
            throw new Error(`UI criterion ${item.id} needs a local evidence artifact.`);
          const specRoot = await safePath(root, `specs/${spec.slug}`);
          const artifactPath = await safePath(specRoot, observation.artifact);
          const generatedRecord = await safePath(specRoot, 'verification.json');
          if (
            process.platform === 'win32'
              ? artifactPath.toLowerCase() === generatedRecord.toLowerCase()
              : artifactPath === generatedRecord
          )
            throw new Error(`UI criterion ${item.id} cannot use its generated verification record as evidence.`);
          const artifactStat = await stat(artifactPath);
          if (!artifactStat.isFile() || !artifactStat.size || artifactStat.size > 32 * 1024 * 1024)
            throw new Error(`Invalid or oversized UI artifact for ${item.id}.`);
        }
      }
    }
  }
  const missing = criteria.filter(id => !seen.has(id));
  if (missing.length) throw new Error(`Missing acceptance evidence for ${missing.join(', ')}.`);
  return {
    criteria: report.criteria.map(({ id, status, method, checkCommands, checkIds, kind, observations }) => ({
      id,
      status,
      method,
      ...(kind ? { kind } : {}),
      ...(method === 'automated' ? (checkIds ? { checkIds } : { checkCommands }) : {}),
      ...(observations ? { observations } : {}),
    })),
    scope: 'DECLARED_CRITERION_EVIDENCE',
    truthOfEvidence: 'AGENT_OR_HUMAN_REVIEW_REQUIRED',
  };
}

/**
 * Bind declared automated criteria to configured commands and this run's results.
 * Commands are references only: this function never executes evidence text.
 * Passing a command does not prove that its assertions adequately cover the criterion.
 * @param {object} acceptance Structurally reviewed criterion declarations.
 * @param {Array<string|object>} gates Approved legacy commands or normalized catalogue checks.
 * @param {object[]|null} results Current run results, or null for preflight validation.
 * @returns {object} Coverage with explicit executed or unverified bindings.
 */
export function bindAcceptance(acceptance, gates, results = null) {
  const configured = gates.map((gate, index) =>
    typeof gate === 'string' ? { id: `gate-${index + 1}`, command: gate, cwd: '.', kind: 'automated' } : gate,
  );
  const criteria = acceptance.criteria.map(item => {
    if (item.method !== 'automated') return item;
    const references = item.checkIds || item.checkCommands;
    const targets = references.map(reference => {
      const matches = configured.filter(check =>
        item.checkIds ? check.id === reference : check.command === reference,
      );
      if (!matches.length)
        throw new Error(
          `Criterion ${item.id} references an unconfigured check: ${reference}. Configure the approved check first.`,
        );
      if (matches.length !== 1)
        throw new Error(`Criterion ${item.id} has an ambiguous command; reference its checkIds instead.`);
      const check = matches[0];
      if (['visual', 'interaction', 'accessibility'].includes(item.kind) && check.kind !== 'ui')
        throw new Error(
          `UI criterion ${item.id} cannot be satisfied by a generic build/check; configure a kind: ui check that exercises it.`,
        );
      return check;
    });
    const checks = targets.map(check => {
      const runs =
        results?.filter(result => (result.checkId ? result.checkId === check.id : result.command === check.command)) ||
        [];
      return {
        checkId: check.id,
        command: check.command,
        cwd: check.cwd,
        status: !runs.length
          ? 'NOT_RUN'
          : runs.every(run => run.exitCode === 0 && !run.timedOut && !run.error)
            ? 'PASSED'
            : 'FAILED',
      };
    });
    return { ...item, checks, execution: checks.every(check => check.status === 'PASSED') ? 'PASSED' : 'NOT_VERIFIED' };
  });
  return {
    ...acceptance,
    criteria,
    scope: 'DECLARED_EVIDENCE_WITH_EXECUTED_CHECK_BINDINGS',
    automatedChecksPassed: criteria
      .filter(item => item.method === 'automated')
      .every(item => item.execution === 'PASSED'),
  };
}
