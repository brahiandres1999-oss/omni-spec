import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { safePath, hash } from './managed.mjs';
import { writeFileAtomic } from './fs-retry.mjs';
import { loadManifest, withManifestLock } from './manifest.mjs';
import { auditProjectContext, citedProjectFiles } from './context-auditor.mjs';
import { hashProjectFiles } from './snapshot.mjs';
import { specRoute } from './fit.mjs';

const file = 'specs/project-state.json';
const capabilities = ['questions', 'web', 'terminal', 'render', 'delegation'];
export const CONTEXT_SCOPE = 'CONTEXT_INPUTS_V3';
// Baselines written before CONTEXT_INPUTS_V3 hashed raw bytes. Remove this scope and its comparison
// in contextFreshness when that compatibility is retired.
const RAW_CONTEXT_SCOPE = 'CONTEXT_INPUTS_V2';
const MAX_SESSION_HISTORY = 100;
const CLOSED = ['COMPLETED', 'CLOSED', 'SUPERSEDED'];
// Artifacts each archetype's route requires, in reading order; mirrors auditSpec.
const ROUTE_ARTIFACTS = {
  feature: { primary: ['spec.md'], plan: ['plan.md'], tasks: ['tasks.md'] },
  bugfix: { primary: ['bug.md'], plan: ['rca.md', 'fix.md'], tasks: [] },
  debt: { primary: ['audit.md'], plan: ['migration-plan.md'], tasks: ['tasks.md'] },
  rfc: { primary: ['rfc.md'], plan: [], tasks: [] },
};
// Tooling and state files status replaces: status --json --all and contracts --active.
const AVOID_ALWAYS = ['specs/.omni/', 'specs/_templates/', 'specs/project-state.json', 'specs/contracts.json'];
// Files that usually carry facts recorded in project-context.md: build/dependency
// declarations, runtime pins, containers, CI and agent instructions. Source code is not a
// context input unless the context cites it, so implementing a change does not stale context.
const CONTEXT_NAMES = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'lerna.json',
  'nx.json',
  'turbo.json',
  'deno.json',
  'bunfig.toml',
  'angular.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'gradle.properties',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'Pipfile',
  'tox.ini',
  'go.mod',
  'go.work',
  'Cargo.toml',
  'composer.json',
  'Gemfile',
  'pubspec.yaml',
  'mix.exs',
  'CMakeLists.txt',
  'Makefile',
  'Jenkinsfile',
  '.gitlab-ci.yml',
  'azure-pipelines.yml',
  '.nvmrc',
  '.node-version',
  '.python-version',
  '.ruby-version',
  '.tool-versions',
  'global.json',
]);
const CONTEXT_PATTERNS = [
  /^tsconfig(?:\.[\w-]+)?\.json$/,
  /^jsconfig\.json$/,
  /^requirements[\w.-]*\.txt$/,
  /^Dockerfile(?:\.[\w-]+)?$/,
  /^(?:docker-)?compose(?:\.[\w-]+)?\.ya?ml$/,
  /\.(?:csproj|fsproj|sln)$/,
  /^\.env\.(?:example|sample|template)$/,
  /^(?:vite|vitest|next|nuxt|svelte|astro|webpack|rollup|playwright|jest|cypress|karma)\.config\.[cm]?[jt]s$/,
];
const ROOT_CONTEXT = new Set([
  'AGENTS.md',
  'CONSTITUTION.md',
  'CLAUDE.md',
  'GEMINI.md',
  'README.md',
  'CONTRIBUTING.md',
]);
const managedSection = /<!-- OMNI-SPEC-START -->[\s\S]*?<!-- OMNI-SPEC-END -->/;

// OmniSpec rewrites these while working; citing them must not make context permanently stale.
function generatedState(name) {
  return (
    name === 'specs/project-context.md' ||
    name.startsWith('specs/.omni/') ||
    ['specs/manifest.json', 'specs/project-state.json', 'specs/contracts.json'].includes(name) ||
    name.startsWith('specs/manifest.lock') ||
    /^specs\/[^/]+\/verification\.json$/.test(name)
  );
}

function isContextInput(name, cited) {
  if (cited.has(name)) return true;
  if (!name.includes('/') && ROOT_CONTEXT.has(name)) return true;
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(name) || name === '.circleci/config.yml') return true;
  const base = name.slice(name.lastIndexOf('/') + 1);
  return CONTEXT_NAMES.has(base) || CONTEXT_PATTERNS.some(pattern => pattern.test(base));
}

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
  if (state.sessions !== undefined && !Array.isArray(state.sessions))
    throw new Error('Invalid project-state.json sessions history.');
  for (const session of [...(state.sessions || []), ...(state.session ? [state.session] : [])]) {
    if (
      !session ||
      typeof session.host !== 'string' ||
      !session.host.trim() ||
      !Number.isFinite(Date.parse(session.observedAt || session.recordedAt))
    )
      throw new Error('Invalid recorded session host/time.');
    for (const [name, observation] of Object.entries(session.capabilities || {})) {
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
  await writeFileAtomic(path, JSON.stringify(state, null, 2) + '\n');
}

const withNewline = (bytes, newline) => Buffer.from(bytes.toString('latin1').replace(/\r?\n/g, newline), 'latin1');

/**
 * Hashes one context input can match. Git rewrites line endings of text files on checkout
 * (core.autocrlf, .gitattributes eol), so text is recorded in its LF form; the conversion runs on
 * latin1, which maps each byte to one character, and never decodes UTF-8. A NUL byte marks a binary
 * file, which Git does not convert: its three forms are its raw hash.
 * @param {Buffer} bytes Input content.
 * @returns {{recorded: string, raw: string, crlf: string}} SHA-256 of the form context-record stores,
 *   of the raw bytes and of the CRLF form; the last two only matter for CONTEXT_INPUTS_V2 baselines.
 */
function inputDigests(bytes) {
  const raw = hash(bytes);
  if (bytes.includes(0)) return { recorded: raw, raw, crlf: raw };
  return { recorded: hash(withNewline(bytes, '\n')), raw, crlf: hash(withNewline(bytes, '\r\n')) };
}

async function contextDigests(root) {
  const contextText = await readFile(await safePath(root, 'specs/project-context.md'), 'utf8');
  const citations = citedProjectFiles(contextText).filter(name => !generatedState(name));
  const cited = new Set(citations.filter(name => !name.startsWith('specs/')));
  const files = Object.fromEntries(
    await hashProjectFiles(root, {
      skipTop: new Set(['specs']),
      select: name => isContextInput(name, cited),
      symlinks: 'reject-selected',
      label: 'Context snapshot',
      digest: inputDigests,
    }),
  );
  // hashProjectFiles has already confirmed AGENTS.md is a regular file or an in-project link.
  // Buffer.from encodes UTF-8, the bytes that preview.2 hashed from the same text.
  if (files['AGENTS.md'])
    files['AGENTS.md'] = inputDigests(
      Buffer.from((await readFile(join(root, 'AGENTS.md'), 'utf8')).replace(managedSection, '')),
    );
  for (const name of citations.filter(item => item.startsWith('specs/'))) {
    try {
      files[name] = inputDigests(await readFile(await safePath(root, name)));
    } catch (error) {
      if (!['ENOENT', 'EISDIR'].includes(error.code)) throw error;
    }
  }
  files['specs/project-context.md'] = inputDigests(Buffer.from(contextText));
  return files;
}

/**
 * Hash the inputs that project-context.md describes: the context itself, files it cites,
 * build/dependency/runtime declarations, CI and agent instructions. Ignored paths
 * (.gitignore, .omnispecignore and defaults) and symlinks are skipped. The OmniSpec-managed
 * section of AGENTS.md is excluded so adapter updates do not stale user context. Text inputs are
 * hashed with CRLF converted to LF, so checkouts with other line endings give the same values;
 * inputs containing a NUL byte are hashed as raw bytes.
 * @param {string} root Project root.
 * @returns {Promise<Object<string,string>>} Relative paths and the SHA-256 values context-record stores.
 * @throws {Error} Missing project-context.md, unsafe paths, symlinked inputs or snapshot limits.
 */
export async function contextSnapshot(root) {
  return Object.fromEntries(Object.entries(await contextDigests(root)).map(([name, { recorded }]) => [name, recorded]));
}

/**
 * Save a reconciled baseline under the manifest lock and archive its predecessor. The baseline uses
 * CONTEXT_SCOPE and the values of contextSnapshot.
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
      scope: CONTEXT_SCOPE,
      inputs,
      reviewScope: 'EOL_NORMALIZED_BASELINE_AND_STRUCTURAL_LINKS_ONLY',
      semanticReview: 'AGENT_OR_HUMAN_REQUIRED',
    };
    await save(root, state);
    return state.context;
  });
}

/**
 * Compare the current context inputs with the recorded baseline. A CONTEXT_SCOPE baseline matches
 * the form contextSnapshot records. A CONTEXT_INPUTS_V2 baseline, which hashed raw bytes, also
 * matches the raw or CRLF form of a text input, so a checkout with other line endings stays current.
 * Any other scope is a legacy full-tree baseline compared on raw bytes.
 * @param {string} root Project root.
 * @param {object|null} state Optional already validated state.
 * @returns {Promise<object>} NOT_RECORDED, CURRENT or STALE, changed paths and the baseline scope.
 * @throws {Error} A baseline without inputs, or a failed context snapshot.
 */
export async function contextFreshness(root, state = null) {
  state ||= await readProjectState(root);
  if (!state.context) return { status: 'NOT_RECORDED', changed: [] };
  if (!state.context.inputs || typeof state.context.inputs !== 'object')
    throw new Error('Invalid context baseline. Reconcile and run context-record.');
  const current = await contextDigests(root);
  const baseline = state.context.inputs;
  const { scope } = state.context;
  // Baselines recorded before 0.7.0-rc.2 hashed every source file; compare only the
  // inputs selected today so ordinary code changes do not report stale context.
  const legacy = scope !== CONTEXT_SCOPE && scope !== RAW_CONTEXT_SCOPE;
  const matches =
    scope === CONTEXT_SCOPE
      ? (digest, recorded) => digest.recorded === recorded
      : scope === RAW_CONTEXT_SCOPE
        ? (digest, recorded) => [digest.recorded, digest.raw, digest.crlf].includes(recorded)
        : (digest, recorded) => digest.raw === recorded;
  // A legacy baseline also detects deleted inputs, but never hashed files under specs/ other
  // than project-context.md, and hashed AGENTS.md including the managed section.
  const comparable = name =>
    name !== 'AGENTS.md' && (!name.startsWith('specs/') || name === 'specs/project-context.md');
  const cited = legacy
    ? new Set(citedProjectFiles(await readFile(await safePath(root, 'specs/project-context.md'), 'utf8')))
    : null;
  const legacyInputs = legacy
    ? Object.keys(baseline).filter(
        name => comparable(name) && (name === 'specs/project-context.md' || isContextInput(name, cited)),
      )
    : [];
  const names = legacy
    ? [...new Set([...Object.keys(current).filter(comparable), ...legacyInputs])]
    : [...new Set([...Object.keys(current), ...Object.keys(baseline)])];
  const changed = [];
  for (const name of names.sort()) {
    if (current[name] && matches(current[name], baseline[name])) continue;
    // A legacy full-tree baseline also hashed files that are ignored today (vendor/, .gradle/).
    // Such a file only counts as changed when it was actually deleted.
    if (legacy && current[name] === undefined && (await exists(root, name))) continue;
    changed.push(name);
  }
  return {
    status: changed.length ? 'STALE' : 'CURRENT',
    changed,
    recordedAt: state.context.recordedAt,
    scope: legacy ? 'LEGACY_FULL_SNAPSHOT' : scope,
    ...(legacy
      ? { recommendation: 'Run context-record after reviewing context to adopt the input-based baseline.' }
      : {}),
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
    // Earlier sessions stay available so evidence observed in them remains attributable.
    if (state.session) state.sessions = [...(state.sessions || []), state.session].slice(-MAX_SESSION_HISTORY);
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
 * Blockers, nextAction and delivery always use every decision. Unless options.all is set, the
 * returned copy omits verification.acceptance from specs other than the active one, and the
 * decisions whose appliesTo names only closed specs other than the active one; progress.omitted
 * counts both. specs/manifest.json and specs/project-state.json are never written.
 * @param {string} root Project root.
 * @param {{all?: boolean}} [options] all keeps every acceptance record and decision.
 * @returns {Promise<object>} Manifest copy plus progress: delivery, blockers, nextAction, readSet
 *   (files to read for the active spec and paths to avoid), omitted and decisions.
 * @throws {Error} No project, invalid project state, or context freshness cannot be computed.
 */
export async function projectStatus(root, { all = false } = {}) {
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
  if (spec && CLOSED.includes(spec.status)) delivery = spec.status;
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
          } else {
            const { describeFailure } = await import('./verification.mjs');
            blockers.push({
              code: record.sourceChangedDuringVerification ? 'VERIFICATION_SOURCE_CHANGED' : 'VERIFICATION_FAILED',
              message: describeFailure(record),
              ...(record.changedDuringVerification ? { files: record.changedDuringVerification } : {}),
              action: record.sourceChangedDuringVerification
                ? 'Exclude generated outputs in .gitignore/.omnispecignore or stop concurrent edits, then verify again'
                : `Fix the failing check or evidence, then verify ${spec.id}`,
            });
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    } catch (error) {
      blockers.push({ code: 'ASSESSMENT_ERROR', message: error.message, action: 'Resolve the reported error' });
    }
  }
  let files = [];
  if (spec)
    try {
      files = await readSetFiles(root, spec);
    } catch (error) {
      // auditSpec already reports an unreadable fit.json with the same message.
      if (!blockers.some(item => item.code === 'ASSESSMENT_ERROR' && item.message === error.message))
        blockers.push({ code: 'ASSESSMENT_ERROR', message: error.message, action: 'Resolve the reported error' });
    }
  const readSet = {
    files,
    avoid: [
      ...manifest.specs.filter(item => item.slug !== manifest.active_spec).map(item => `specs/${item.slug}/`),
      ...(spec ? [`specs/${spec.slug}/verification.json`] : []),
      ...AVOID_ALWAYS,
    ],
  };
  if (blockers.length) nextAction = blockers[0].action;
  let specs = manifest.specs,
    decisions = state.decisions;
  if (!all) {
    specs = manifest.specs.map(item => {
      if (item.slug === manifest.active_spec || !item.verification?.acceptance) return item;
      const { acceptance: _acceptance, ...verification } = item.verification;
      return { ...item, verification };
    });
    const closed = new Set(
      manifest.specs
        .filter(item => item.slug !== manifest.active_spec && CLOSED.includes(item.status))
        .flatMap(item => [item.id, item.slug]),
    );
    decisions = state.decisions.filter(
      item => !item.appliesTo?.length || !item.appliesTo.every(ref => closed.has(ref)),
    );
  }
  return {
    ...manifest,
    specs,
    progress: {
      delivery,
      context: freshness,
      blockers,
      nextAction,
      readSet,
      capabilities:
        state.session?.capabilities || Object.fromEntries(capabilities.map(name => [name, { status: 'unknown' }])),
      omitted: {
        acceptance: specs.filter((item, index) => item !== manifest.specs[index]).length,
        decisions: state.decisions.length - decisions.length,
        command: 'status --json --all',
      },
      decisions,
      semanticReview: 'REQUIRED',
      publication: 'NOT_AUTHORIZED_BY_STATUS',
    },
  };
}

/**
 * List the files an agent reads for a spec: the artifacts its fit route requires, then
 * acceptance.json and verification.md. Without fit.json, or with an invalid one, the full route
 * applies, as in auditSpec.
 * @param {string} root Project root.
 * @param {object} spec Manifest entry of the active spec.
 * @returns {Promise<string[]>} Project-relative paths under specs/<slug>/.
 * @throws {Error} The spec type is unknown, or fit.json cannot be read (for example, a directory).
 */
async function readSetFiles(root, spec) {
  if (!Object.hasOwn(ROUTE_ARTIFACTS, spec.type)) throw new Error(`Unknown spec type: ${spec.type}`);
  const artifacts = ROUTE_ARTIFACTS[spec.type];
  const route = await specRoute(root, spec);
  return [
    ...artifacts.primary,
    ...(!route || route.artifacts.plan ? artifacts.plan : []),
    ...(!route || route.artifacts.tasks ? artifacts.tasks : []),
    'acceptance.json',
    'verification.md',
  ].map(name => `specs/${spec.slug}/${name}`);
}

async function exists(root, name) {
  try {
    await access(await safePath(root, name));
    return true;
  } catch {
    return false;
  }
}

const secondFloor = value => Math.floor(Date.parse(value) / 1000) * 1000;

/**
 * Find the recorded session an observation belongs to: its sessionId, or otherwise the latest
 * session recorded at or before the observation (second precision, since hosts often omit ms).
 * @param {object} state Validated project state.
 * @param {object} observation Observation with observedAt and optional sessionId.
 * @returns {object|null} Session whose window [start, next session start) contains the observation.
 */
export function observationSession(state, observation) {
  const observed = Date.parse(observation.observedAt);
  const start = session => secondFloor(session.observedAt || session.recordedAt);
  // Windows follow observation start times, even if a later record declared an earlier start.
  const sessions = [...(state.sessions || []), ...(state.session ? [state.session] : [])]
    .map((session, order) => ({ session, order }))
    .sort((left, right) => start(left.session) - start(right.session) || left.order - right.order)
    .map(item => item.session);
  if (observation.sessionId) {
    const index = sessions.findIndex(item => item.id === observation.sessionId);
    if (index < 0) return null;
    const session = sessions[index];
    // A session's window ends when the next recorded session starts.
    const next = sessions[index + 1];
    return observed >= start(session) && (!next || observed < start(next)) ? session : null;
  }
  // The latest session started by then owns the observation.
  let owner = null;
  for (const session of sessions) if (start(session) <= observed) owner = session;
  return owner;
}

function decisionApplies(item, spec) {
  return (
    !item.appliesTo?.length || (!!spec && (item.appliesTo.includes(spec.id) || item.appliesTo.includes(spec.slug)))
  );
}
