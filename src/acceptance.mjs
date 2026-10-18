import { readFile } from 'node:fs/promises';
import { safePath } from './managed.mjs';

const primaryFiles = { feature: 'spec.md', bugfix: 'bug.md', debt: 'audit.md', rfc: 'rfc.md' };
export function acceptanceSeed(type) {
  return { schemaVersion: 1, criteria: [{ id: type === 'rfc' ? 'DECISION' : 'AC-01', status: 'pending', method: null, evidence: '' }] };
}

export async function reviewAcceptance(root, spec) {
  const prefix = `specs/${spec.slug}/`;
  const primary = await readFile(await safePath(root, prefix + primaryFiles[spec.type]), 'utf8');
  const criteria = [...new Set(primary.match(/\bAC-\d+\b/g) || [])];
  if (spec.type === 'rfc' && !criteria.length) criteria.push('DECISION');
  if (!criteria.length) throw new Error('Acceptance criteria need stable AC-01-style IDs in the primary artifact before verification.');
  let report;
  try { report = JSON.parse(await readFile(await safePath(root, prefix + 'acceptance.json'), 'utf8')); }
  catch { throw new Error('Create a valid acceptance.json with explicit criterion status, method and evidence. Existing specs are preserved; migrate their evidence before verifying again.'); }
  if (report.schemaVersion !== 1 || !Array.isArray(report.criteria)) throw new Error('Invalid acceptance.json schemaVersion/criteria.');
  const seen = new Set();
  for (const item of report.criteria) {
    if (!item || typeof item.id !== 'string' || seen.has(item.id) || !criteria.includes(item.id)) throw new Error('Acceptance IDs must be unique and match the primary artifact; remove stale or invented rows.');
    seen.add(item.id);
    if (item.status !== 'passed') throw new Error(`Acceptance criterion ${item.id} remains ${item.status || 'pending'}; passing quality gates cannot close it.`);
    if (!['automated', 'manual', 'inspection', 'decision'].includes(item.method)) throw new Error(`Record the actual evidence method for ${item.id}.`);
    if (typeof item.evidence !== 'string' || item.evidence.trim().length < 20 || /\[TODO\]|\[NEEDS CLARIFICATION\]/i.test(item.evidence)) throw new Error(`Record specific evidence and its limits for ${item.id}.`);
    if (spec.type === 'rfc' && item.method !== 'decision') throw new Error('RFC acceptance evidence must record decision review.');
  }
  const missing = criteria.filter(id => !seen.has(id));
  if (missing.length) throw new Error(`Missing acceptance evidence for ${missing.join(', ')}.`);
  return { criteria: report.criteria.map(({ id, status, method }) => ({ id, status, method })),
    scope: 'DECLARED_CRITERION_EVIDENCE', truthOfEvidence: 'AGENT_OR_HUMAN_REVIEW_REQUIRED' };
}
