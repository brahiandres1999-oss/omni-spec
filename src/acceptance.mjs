import { readFile } from 'node:fs/promises';
import { safePath } from './managed.mjs';

const primaryFiles = { feature: 'spec.md', bugfix: 'bug.md', debt: 'audit.md', rfc: 'rfc.md' };
export function acceptanceSeed(type) {
  return {
    schemaVersion: 1,
    criteria: [{ id: type === 'rfc' ? 'DECISION' : 'AC-01', status: 'pending', method: null, evidence: '' }],
  };
}

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
  if (report.schemaVersion !== 1 || !Array.isArray(report.criteria))
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
    if (
      item.method === 'automated' &&
      (!Array.isArray(item.checkCommands) ||
        !item.checkCommands.length ||
        item.checkCommands.some(command => typeof command !== 'string' || !command.trim()) ||
        new Set(item.checkCommands).size !== item.checkCommands.length)
    )
      throw new Error(
        `Automated criterion ${item.id} requires unique checkCommands referencing configured gates; migrate its evidence before verifying.`,
      );
  }
  const missing = criteria.filter(id => !seen.has(id));
  if (missing.length) throw new Error(`Missing acceptance evidence for ${missing.join(', ')}.`);
  return {
    criteria: report.criteria.map(({ id, status, method, checkCommands }) => ({
      id,
      status,
      method,
      ...(method === 'automated' ? { checkCommands } : {}),
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
 * @param {string[]} gates Approved commands configured for this project.
 * @param {object[]|null} results Current run results, or null for preflight validation.
 * @returns {object} Coverage with explicit executed or unverified bindings.
 */
export function bindAcceptance(acceptance, gates, results = null) {
  const criteria = acceptance.criteria.map(item => {
    if (item.method !== 'automated') return item;
    for (const command of item.checkCommands) {
      if (!gates.includes(command))
        throw new Error(
          `Criterion ${item.id} references an unconfigured check: ${command}. Configure the approved gate first.`,
        );
    }
    const checks = item.checkCommands.map(command => {
      const runs = results?.filter(result => result.command === command) || [];
      return {
        command,
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
