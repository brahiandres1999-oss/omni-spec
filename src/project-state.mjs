import { readFile, writeFile, readdir, mkdir, rename, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { safePath, hash } from './managed.mjs';
import { loadManifest, withManifestLock } from './manifest.mjs';
import { auditProjectContext } from './context-auditor.mjs';

const file = 'specs/project-state.json';
const capabilities = ['questions', 'web', 'terminal', 'render', 'delegation'];
const ignored = new Set([
  '.git',
  '.research',
  'node_modules',
  'specs',
  '.agents',
  '.agent',
  '.codex',
  '.claude',
  '.cursor',
  '.gemini',
  '.kilo',
  '.opencode',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  'target',
  'coverage',
  '.next',
  '.nuxt',
]);

/** @returns {object} Unconfirmed state; never implies application readiness. */
export function projectStateSeed() {
  return { schemaVersion: 1, context: null, session: null, decisions: [] };
}

/**
 * Read and validate declarations without inferring tools or user approvals.
 * @param {string} root Project root.
 * @returns {Promise<object>} Saved state or a pending seed if absent.
 * @throws {Error} Invalid records, unsafe paths or unreadable input.
 */
export async function readProjectState(root) {
  let state;
  try {
    state = JSON.parse((await readFile(await safePath(root, file), 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error.code === 'ENOENT') return projectStateSeed();
    throw error;
  }
  return validateState(state);
}

function validateState(state) {
  if (state?.schemaVersion !== 1 || !Array.isArray(state.decisions))
    throw new Error('Invalid project-state.json; expected schemaVersion 1 and decisions array.');
  const ids = new Set();
  for (const item of state.decisions) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      ids.has(item.id) ||
      !['pending', 'provisional', 'approved', 'delegated', 'not-applicable'].includes(item.status)
    )
      throw new Error('Invalid or duplicate project decision.');
    if (!item.id.trim() || (item.required !== undefined && typeof item.required !== 'boolean'))
      throw new Error('Decision ID must be a nonempty string and required must be boolean.');
    ids.add(item.id);
    if (
      item.appliesTo !== undefined &&
      (!Array.isArray(item.appliesTo) || item.appliesTo.some(id => typeof id !== 'string' || !id.trim()))
    )
      throw new Error(`Decision ${item.id} has invalid appliesTo IDs.`);
    if (item.reviewAfter && !Number.isFinite(Date.parse(item.reviewAfter)))
      throw new Error(`Decision ${item.id} has invalid reviewAfter.`);
    if (item.status === 'not-applicable' && (!item.basis || item.basis.trim().length < 10))
      throw new Error('Not-applicable decisions require an explicit reason.');
    if (
      ['approved', 'delegated'].includes(item.status) &&
      (typeof item.basis !== 'string' || item.basis.trim().length < 10)
    )
      throw new Error(`Decision ${item.id} requires the answer/delegation basis, not an invented approval.`);
    if (item.topic === 'technology' && ['approved', 'delegated'].includes(item.status)) {
      if (
        !item.value ||
        !Array.isArray(item.sources) ||
        !item.sources.length ||
        item.sources.some(source => !validSource(source))
      )
        throw new Error(`Technology decision ${item.id} requires a value and dated official-source references.`);
    }
  }
  if (state.session) {
    if (
      typeof state.session.host !== 'string' ||
      !state.session.host.trim() ||
      !Number.isFinite(Date.parse(state.session.observedAt || state.session.recordedAt))
    )
      throw new Error('Invalid recorded session host/time.');
    for (const [name, observation] of Object.entries(state.session.capabilities || {})) {
      if (
        !capabilities.includes(name) ||
        !['available', 'unavailable', 'unknown'].includes(observation?.status) ||
        typeof observation.source !== 'string'
      )
        throw new Error(`Invalid capability declaration: ${name}.`);
    }
  }
  return state;
}

function validSource(source) {
  try {
    return (
      ['https:', 'http:'].includes(new URL(source.url).protocol) &&
      Number.isFinite(Date.parse(source.consultedAt)) &&
      Date.parse(source.consultedAt) <= Date.now() + 60000 &&
      typeof source.appliesTo === 'string' &&
      source.appliesTo.trim().length > 0 &&
      source.authority === 'official'
    );
  } catch {
    return false;
  }
}

async function save(root, state) {
  const path = await safePath(root, file);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2) + '\n');
  await rename(temporary, path);
}

/**
 * Hash bounded application inputs and context without reading generated runtime copies.
 * @param {string} root Project root, excluding caches and OmniSpec metadata.
 * @returns {Promise<Object<string,string>>} Relative paths and SHA-256 values.
 * @throws {Error} Symlinks, unsafe paths or snapshot limits.
 */
export async function contextSnapshot(root) {
  const files = {};
  let count = 0,
    bytes = 0;
  async function walk(relative = '') {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Context snapshot refuses symlink: ${name}`);
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) {
        const path = await safePath(root, name);
        count += 1;
        bytes += (await stat(path)).size;
        if (count > 20000 || bytes > 256 * 1024 * 1024)
          throw new Error('Context snapshot exceeds 20,000 files / 256 MiB. Narrow the project root.');
        const data = await readFile(path);
        files[name] = hash(data);
      }
    }
  }
  await walk();
  files['specs/project-context.md'] = hash(await readFile(await safePath(root, 'specs/project-context.md')));
  return files;
}

/**
 * Save a reconciled baseline under the manifest lock and archive its predecessor.
 * @param {string} root Project root with a structurally valid context.
 * @returns {Promise<object>} Timestamped baseline; semantic truth remains reviewable.
 */
export async function recordContext(root) {
  return withManifestLock(root, async () => {
    const audit = await auditProjectContext(root);
    if (!audit.valid) throw new Error(`Cannot record context: ${audit.errors.join('; ')}`);
    const state = await readProjectState(root);
    const inputs = await contextSnapshot(root);
    const previous = state.context;
    if (previous) {
      const archive = await safePath(root, `specs/.omni/context-history/${randomUUID()}.json`);
      await mkdir(dirname(archive), { recursive: true });
      await writeFile(archive, JSON.stringify(previous, null, 2) + '\n');
    }
    state.context = {
      recordedAt: new Date().toISOString(),
      inputs,
      reviewScope: 'BYTE_BASELINE_AND_STRUCTURAL_LINKS_ONLY',
      semanticReview: 'AGENT_OR_HUMAN_REQUIRED',
    };
    await save(root, state);
    return state.context;
  });
}

/**
 * @param {string} root Project root.
 * @param {object|null} state Optional already validated state.
 * @returns {Promise<object>} NOT_RECORDED, CURRENT or STALE and changed paths.
 */
export async function contextFreshness(root, state = null) {
  state ||= await readProjectState(root);
  if (!state.context) return { status: 'NOT_RECORDED', changed: [] };
  if (!state.context.inputs || typeof state.context.inputs !== 'object')
    throw new Error('Invalid context baseline. Reconcile and run context-record.');
  const current = await contextSnapshot(root);
  const changed = [...new Set([...Object.keys(current), ...Object.keys(state.context.inputs)])]
    .filter(name => current[name] !== state.context.inputs[name])
    .sort();
  return {
    status: changed.length ? 'STALE' : 'CURRENT',
    changed,
    recordedAt: state.context.recordedAt,
    semanticReview: 'REQUIRED',
  };
}

/**
 * Block stale recorded context and unresolved required decisions in the active scope.
 * @param {string} root Project root.
 * @param {object|null} spec Active spec for scoped decisions; null means project-wide only.
 * @returns {Promise<object>} Freshness report; legacy unrecorded baselines remain explicit.
 * @throws {Error} A dependent decision or context reconciliation remains unresolved.
 */
export async function assertContextFresh(root, spec = null) {
  const state = await readProjectState(root);
  const freshness = await contextFreshness(root, state);
  if (freshness.status === 'STALE')
    throw new Error(
      `Context is stale: ${freshness.changed.slice(0, 10).join(', ')}. Reconcile project-context.md, then run context-record; do not certify old claims.`,
    );
  const pending = state.decisions.filter(
    item =>
      decisionApplies(item, spec) &&
      item.required !== false &&
      (['pending', 'provisional'].includes(item.status) ||
        (item.reviewAfter && Date.parse(item.reviewAfter) < Date.now())),
  );
  if (pending.length)
    throw new Error(`Required decisions remain unresolved or expired: ${pending.map(item => item.id).join(', ')}.`);
  return freshness;
}

/**
 * Save observed session capabilities; the declaration grants no tool or permission.
 * @param {string} root Project root.
 * @param {object} declaration Host, observation time and capability sources.
 * @returns {Promise<object>} New session ID and the recorded capabilities.
 */
export async function recordSession(root, declaration) {
  if (!declaration || typeof declaration.host !== 'string' || !declaration.host.trim() || !declaration.capabilities)
    throw new Error('Session record needs host and observed capabilities.');
  const observedAt = declaration.observedAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) > Date.now() + 60000)
    throw new Error('Invalid session observation date.');
  for (const [name, observation] of Object.entries(declaration.capabilities)) {
    if (
      !capabilities.includes(name) ||
      !['available', 'unavailable', 'unknown'].includes(observation?.status) ||
      typeof observation.source !== 'string' ||
      !observation.source.trim()
    )
      throw new Error(`Invalid session capability: ${name}.`);
  }
  return withManifestLock(root, async () => {
    const state = await readProjectState(root);
    state.session = {
      id: randomUUID(),
      host: declaration.host,
      observedAt,
      recordedAt: new Date().toISOString(),
      capabilities: Object.fromEntries(
        capabilities.map(name => [
          name,
          declaration.capabilities[name] || { status: 'unknown', source: 'Not inspected in this session' },
        ]),
      ),
    };
    await save(root, state);
    return state.session;
  });
}

/**
 * Persist an answer/delegation with sources, scope and revision conflict protection.
 * @param {string} root Project root.
 * @param {object} decision Record with expectedRevision for an existing decision.
 * @returns {Promise<object>} Saved revision; predecessor remains in local history.
 */
export async function recordDecision(root, decision) {
  return withManifestLock(root, async () => {
    const state = await readProjectState(root);
    const index = state.decisions.findIndex(item => item.id === decision.id);
    const previous = index >= 0 ? state.decisions[index] : null;
    if (previous && decision.expectedRevision !== previous.revision)
      throw new Error('Decision revision changed; inspect the saved answer before replacing it.');
    if (!previous && decision.expectedRevision !== undefined && decision.expectedRevision !== 0)
      throw new Error('A new decision starts with expectedRevision 0.');
    const { expectedRevision: _expectedRevision, ...payload } = decision;
    const next = { ...payload, recordedAt: new Date().toISOString(), revision: (previous?.revision || 0) + 1 };
    if (index < 0) state.decisions.push(next);
    else state.decisions[index] = next;
    // Reuse the same validation before committing, without trusting an in-memory input.
    if (!next.id || !['pending', 'provisional', 'approved', 'delegated', 'not-applicable'].includes(next.status))
      throw new Error('Invalid decision ID/status.');
    if (
      next.appliesTo !== undefined &&
      (!Array.isArray(next.appliesTo) || next.appliesTo.some(id => typeof id !== 'string' || !id.trim()))
    )
      throw new Error('appliesTo must contain specification IDs/slugs.');
    if (next.reviewAfter && !Number.isFinite(Date.parse(next.reviewAfter)))
      throw new Error('Invalid reviewAfter date.');
    if (next.status === 'not-applicable' && (!next.basis || next.basis.trim().length < 10))
      throw new Error('Not-applicable decisions require an explicit reason.');
    if (['approved', 'delegated'].includes(next.status) && (!next.basis || next.basis.trim().length < 10))
      throw new Error('Decision requires an explicit answer/delegation basis.');
    if (
      next.topic === 'technology' &&
      ['approved', 'delegated'].includes(next.status) &&
      (!next.value ||
        !Array.isArray(next.sources) ||
        !next.sources.length ||
        next.sources.some(source => !validSource(source)))
    )
      throw new Error('Technology decision requires dated official-source evidence.');
    validateState(state);
    if (previous) {
      const archive = await safePath(root, `specs/.omni/decision-history/${randomUUID()}.json`);
      await mkdir(dirname(archive), { recursive: true });
      await writeFile(archive, JSON.stringify(previous, null, 2) + '\n');
    }
    await save(root, state);
    return next;
  });
}

/**
 * Derive resumable delivery state using the same closure validator as complete.
 * @param {string} root Project root.
 * @returns {Promise<object>} Manifest plus progress, blockers and next action.
 */
export async function projectStatus(root) {
  const manifest = await loadManifest(root);
  if (!manifest) throw new Error('No OmniSpec project found. Run init first.');
  const state = await readProjectState(root);
  const freshness = await contextFreshness(root, state);
  const blockers = [];
  if (freshness.status === 'STALE')
    blockers.push({
      code: 'STALE_CONTEXT',
      files: freshness.changed,
      action: 'Reconcile context and run context-record',
    });
  const spec = manifest.specs.find(item => item.slug === manifest.active_spec);
  for (const item of state.decisions)
    if (
      decisionApplies(item, spec) &&
      item.required !== false &&
      (['pending', 'provisional'].includes(item.status) ||
        (item.reviewAfter && Date.parse(item.reviewAfter) < Date.now()))
    )
      blockers.push({
        code: 'DECISION_REQUIRED',
        id: item.id,
        action: 'Clarify or research the decision; record the answer/delegation',
      });
  let delivery = 'NO_ACTIVE_WORK',
    nextAction = freshness.status === 'NOT_RECORDED' ? 'omni-init' : 'omni-discuss';
  if (spec && ['COMPLETED', 'CLOSED', 'SUPERSEDED'].includes(spec.status)) delivery = spec.status;
  else if (spec) {
    delivery = spec.status;
    nextAction = 'omni-audit';
    try {
      const { auditSpec } = await import('./auditor.mjs');
      const audit = await auditSpec(root, spec.id);
      if (!audit.valid || audit.tasks.pending) {
        delivery = 'IMPLEMENTATION_PENDING';
        blockers.push({
          code: 'ARTIFACTS_OR_TASKS_PENDING',
          details: audit.errors,
          pendingTasks: audit.tasks.pending,
          action: 'Resolve the active route artifacts and work',
        });
      } else {
        delivery = 'VERIFICATION_PENDING';
        nextAction = `verify ${spec.id}`;
        const report = JSON.parse(await readFile(await safePath(root, `specs/${spec.slug}/acceptance.json`), 'utf8'));
        if (!Array.isArray(report.criteria)) throw new Error('Invalid acceptance criteria array.');
        const pending = report.criteria
          .filter(item => item.status !== 'passed')
          .map(({ id, kind, status, method }) => ({ id, kind, status, method }));
        if (pending.length) {
          delivery = 'ACCEPTANCE_PENDING';
          blockers.push({
            code: 'ACCEPTANCE_PENDING',
            criteria: pending,
            action: 'Observe or implement the unmet criteria; run omni-converge',
          });
        }
        try {
          const record = JSON.parse(
            await readFile(await safePath(root, `specs/${spec.slug}/verification.json`), 'utf8'),
          );
          if (record.passed) {
            try {
              const { inspectVerification } = await import('./verification.mjs');
              await inspectVerification(root, spec, manifest);
              delivery = 'READY_TO_COMPLETE';
              nextAction = `complete ${spec.id}`;
            } catch (error) {
              blockers.push({
                code: 'STALE_OR_INVALID_VERIFICATION',
                message: error.message,
                action: `verify ${spec.id}`,
              });
            }
          } else blockers.push({ code: 'VERIFICATION_FAILED', action: 'Inspect recorded check failures' });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    } catch (error) {
      blockers.push({ code: 'ASSESSMENT_ERROR', message: error.message, action: 'Resolve the reported error' });
    }
  }
  if (blockers.length) nextAction = blockers[0].action;
  return {
    ...manifest,
    progress: {
      delivery,
      context: freshness,
      blockers,
      nextAction,
      capabilities:
        state.session?.capabilities || Object.fromEntries(capabilities.map(name => [name, { status: 'unknown' }])),
      decisions: state.decisions,
      semanticReview: 'REQUIRED',
      publication: 'NOT_AUTHORIZED_BY_STATUS',
    },
  };
}

function decisionApplies(item, spec) {
  return (
    !item.appliesTo?.length || (!!spec && (item.appliesTo.includes(spec.id) || item.appliesTo.includes(spec.slug)))
  );
}
