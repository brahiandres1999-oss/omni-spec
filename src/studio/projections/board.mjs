import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AttestationError } from '../../attestation.mjs';
import { specRoute } from '../../fit.mjs';
import { gateStatus } from '../../gates.mjs';
import { loadManifest } from '../../manifest.mjs';
import { TASK_STATUSES, validateTasks } from '../../tasks.mjs';
import { inspectVerification } from '../../verification.mjs';
import { StudioError } from '../protocol.mjs';

/**
 * Specification Board (blueprint §4.7.2.1). The lane of a spec is derived from evidence (route,
 * tasks.json, the signed verification record and the human gates), never set by hand, so the
 * board is read-only (D-11).
 */
export const BOARD_LANES = Object.freeze({
  light: Object.freeze(['backlog', 'running', 'verified']),
  standard: Object.freeze(['specification', 'tasks', 'implementation', 'verification']),
  full: Object.freeze(['specification', 'gate-1', 'tasks', 'implementation', 'gate-2', 'closed']),
});

const ARCHIVED = new Set(['CLOSED', 'SUPERSEDED']);
const OWNER_MAX = 100;

/**
 * @typedef {{
 *   id: string, slug: string, title: string, type: string, status: string,
 *   route: 'light'|'standard'|'full'|'decision'|'invalid'|null,
 *   tags: string[], owner: string|null, risk: string|null, updatedAt: string,
 *   tasks: {total: number, pending: number, inProgress: number, done: number}|null,
 *   verification: 'none'|'passed'|'failed'|'stale'|'invalid-attestation',
 *   gates: {required: boolean, 1: string, 2: string},
 * }} BoardInput
 */

/** Board route of a spec: RFCs (decision route or never fitted) use the light lanes. */
function boardRoute(input) {
  if (input.route === 'decision' || (input.route === null && input.type === 'rfc')) return 'light';
  return BOARD_LANES[input.route] ? input.route : null;
}

function laneFor(route, input) {
  const tasks = input.tasks ?? { total: 0, pending: 0, inProgress: 0, done: 0 };
  const progressed = tasks.inProgress > 0 || tasks.done > 0;
  const completed = input.status === 'COMPLETED';
  const verification = input.verification;
  if (route === 'light') {
    if (verification === 'invalid-attestation') return 'running';
    if (completed || verification === 'passed') return 'verified';
    return progressed || verification !== 'none' ? 'running' : 'backlog';
  }
  if (route === 'standard') {
    if (completed || verification !== 'none') return 'verification';
    if (progressed) return 'implementation';
    return tasks.total > 0 ? 'tasks' : 'specification';
  }
  const passes = gate => !input.gates.required || input.gates[gate] === 'approved';
  if (verification === 'invalid-attestation') return 'gate-2';
  if (completed) return 'closed';
  if (verification !== 'none') return 'gate-2';
  if (tasks.total === 0) return 'specification';
  if (!passes(1)) return 'gate-1';
  return progressed ? 'implementation' : 'tasks';
}

/**
 * @param {BoardInput} input
 * @returns {object} The card with its lane ('unrouted' when the spec has no usable fit route).
 */
export function placeCard(input) {
  const route = boardRoute(input);
  const attestation =
    input.verification === 'passed' ? 'valid' : input.verification === 'invalid-attestation' ? 'invalid' : 'none';
  return {
    id: input.id,
    slug: input.slug,
    title: input.title,
    route,
    lane: route ? laneFor(route, input) : 'unrouted',
    tags: input.tags,
    owner: input.owner,
    risk: input.risk,
    updatedAt: input.updatedAt,
    tasks: input.tasks ? { done: input.tasks.done, total: input.tasks.total } : null,
    gates: input.gates,
    attestation,
    protected: attestation === 'invalid',
  };
}

function matches(input, filters) {
  const facet = (values, value) => !values?.length || values.includes(value);
  return (
    (!filters.tags?.length || filters.tags.some(tag => input.tags.includes(tag))) &&
    facet(filters.risk, input.risk) &&
    facet(filters.owner, input.owner)
  );
}

const byRecency = (a, b) =>
  a.updatedAt === b.updatedAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.updatedAt < b.updatedAt ? 1 : -1;

/**
 * @param {BoardInput[]} inputs
 * @param {{route?: 'light'|'standard'|'full', filters?: {tags?: string[], risk?: string[], owner?: string[]}}} [options]
 */
export function projectBoard(inputs, { route = 'standard', filters = {} } = {}) {
  const active = inputs.filter(input => !ARCHIVED.has(input.status));
  const placed = active.filter(input => matches(input, filters)).map(placeCard);
  const counts = { light: 0, standard: 0, full: 0, unrouted: 0 };
  for (const card of placed) counts[card.route ?? 'unrouted']++;
  return {
    route,
    lanes: BOARD_LANES[route].map(id => ({
      id,
      cards: placed.filter(card => card.route === route && card.lane === id).sort(byRecency),
    })),
    unrouted: placed
      .filter(card => card.lane === 'unrouted')
      .sort(byRecency)
      .map(card => ({ ...card, suggestedAction: { command: 'fit', spec: card.id } })),
    counts,
    archived: inputs.length - active.length,
  };
}

async function readJsonIfPresent(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  return JSON.parse(text.replace(/^﻿/, ''));
}

async function taskCounts(root, spec) {
  const data = await readJsonIfPresent(join(root, 'specs', spec.slug, 'tasks.json'));
  if (data === undefined) return null;
  const issues = validateTasks(data);
  if (issues.length)
    throw new StudioError(
      'TASKS_INVALID',
      `specs/${spec.slug}/tasks.json is invalid: ${issues.map(issue => issue.message).join(' ')}`,
    );
  const count = status => data.tasks.filter(task => task.status === status).length;
  const [pending, inProgress, done] = TASK_STATUSES.map(count);
  return { total: data.tasks.length, pending, inProgress, done };
}

async function verificationState(root, spec, manifest) {
  const record = await readJsonIfPresent(join(root, 'specs', spec.slug, 'verification.json'));
  if (record === undefined) return 'none';
  if (record?.passed !== true) return 'failed';
  try {
    await inspectVerification(root, spec, manifest);
    return 'passed';
  } catch (error) {
    // Classification, not suppression: inspectVerification reports outdated evidence with plain
    // Errors and forgeries with AttestationError. Anything else (TypeError, I/O errors) is a fault.
    if (error instanceof AttestationError) return 'invalid-attestation';
    if (error.constructor === Error) return 'stale';
    throw error;
  }
}

function ownerOf(spec) {
  if (spec.owner === undefined || spec.owner === null) return null;
  if (typeof spec.owner !== 'string' || !spec.owner.trim() || spec.owner.length > OWNER_MAX)
    throw new StudioError(
      'MANIFEST_INVALID',
      `Spec ${spec.id} has an invalid owner: it must be a non-empty string of at most ${OWNER_MAX} characters.`,
    );
  return spec.owner;
}

/** Reads every spec of specs/manifest.json into a normalized BoardInput. */
export async function collectBoardInputs(root) {
  const manifest = await loadManifest(root);
  if (!manifest) throw new StudioError('PROJECT_NOT_INITIALIZED', 'No OmniSpec manifest found. Run omni-spec init.');
  const inputs = [];
  for (const spec of manifest.specs) {
    const fit = await specRoute(root, spec);
    const blast = await readJsonIfPresent(join(root, 'specs', spec.slug, 'blast-radius.json'));
    const gates = await gateStatus(root, spec.id);
    inputs.push({
      id: spec.id,
      slug: spec.slug,
      title: spec.title ?? spec.slug,
      type: spec.type,
      status: spec.status,
      route: fit?.route ?? null,
      tags: Array.isArray(spec.tags) ? spec.tags : [],
      owner: ownerOf(spec),
      risk: blast?.overall?.level ?? null,
      updatedAt: spec.updated_at ?? spec.created_at,
      tasks: await taskCounts(root, spec),
      verification: await verificationState(root, spec, manifest),
      gates: { required: gates.required, 1: gates.gates[1], 2: gates.gates[2] },
    });
  }
  return inputs;
}
