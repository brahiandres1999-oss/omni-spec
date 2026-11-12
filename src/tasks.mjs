import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadManifest, withManifestLock } from './manifest.mjs';
import { safePath } from './managed.mjs';
import { writeFileAtomic } from './fs-retry.mjs';

/**
 * Typed task breakdown. specs/<slug>/tasks.json is the canonical state; tasks.md is a generated
 * projection for people. Specifications that still only have tasks.md keep the legacy checklist audit.
 */

export const TASKS_SCHEMA_VERSION = 1;
export const TASK_STATUSES = Object.freeze(['pending', 'in_progress', 'done']);
export const TASK_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/;
const TASK_FIELDS = new Set(['id', 'title', 'status', 'criteria']);
const PROJECTION_NOTE = '<!-- Generated from tasks.json by OmniSpec. Edit tasks.json; this file is rewritten. -->';
const PROJECTION_LINE =
  /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(?:([A-Za-z][A-Za-z0-9_.-]{0,39})( \(in progress\))?: )?(.+?)\s*$/;

/**
 * Parses a JSON document accepting a BOM and CRLF. Errors carry the 1-based line.
 * @param {string} text
 * @param {string} name File name used in the message.
 * @throws {Error & {code: 'JSON_PARSE_ERROR', line: number}}
 */
export function parseJsonDocument(text, name) {
  const clean = text.replace(/^\ufeff/, '');
  try {
    return JSON.parse(clean);
  } catch (error) {
    const position = Number(/position (\d+)/.exec(error.message)?.[1] ?? clean.length);
    const line = clean.slice(0, position).split(/\r\n|\r|\n/).length;
    const failure = new Error(`JSON_PARSE_ERROR: ${name}:${line} is not valid JSON (${error.message}).`);
    failure.code = 'JSON_PARSE_ERROR';
    failure.line = line;
    throw failure;
  }
}

/**
 * @param {unknown} data Parsed tasks.json.
 * @returns {{path: string, code: string, message: string}[]} Empty when valid.
 */
export function validateTasks(data) {
  const issues = [];
  const issue = (path, code, message) => issues.push({ path, code, message });
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    issue('$', 'TASKS_NOT_OBJECT', 'tasks.json must be an object with schemaVersion and tasks.');
    return issues;
  }
  if (data.schemaVersion !== TASKS_SCHEMA_VERSION)
    issue('$.schemaVersion', 'TASKS_SCHEMA_VERSION', `schemaVersion must be ${TASKS_SCHEMA_VERSION}.`);
  if (!Array.isArray(data.tasks) || !data.tasks.length) {
    issue('$.tasks', 'TASKS_EMPTY', 'tasks must be a non-empty array.');
    return issues;
  }
  const seen = new Set();
  data.tasks.forEach((item, index) => {
    const at = `$.tasks[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issue(at, 'TASK_NOT_OBJECT', 'Each task must be an object.');
      return;
    }
    for (const key of Object.keys(item))
      if (!TASK_FIELDS.has(key)) issue(`${at}.${key}`, 'TASK_FIELD_UNKNOWN', `Unknown task field "${key}".`);
    for (const field of ['id', 'title', 'status'])
      if (item[field] === undefined)
        issue(`${at}.${field}`, 'TASK_FIELD_REQUIRED', `Task field "${field}" is required.`);
    if (item.id !== undefined) {
      if (typeof item.id !== 'string' || !TASK_ID_PATTERN.test(item.id))
        issue(`${at}.id`, 'TASK_ID_INVALID', `Task id must match ${TASK_ID_PATTERN.source}.`);
      else if (seen.has(item.id)) issue(`${at}.id`, 'TASK_ID_DUPLICATE', `Task id ${item.id} is used more than once.`);
      else seen.add(item.id);
    }
    if (item.title !== undefined && (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 500))
      issue(`${at}.title`, 'TASK_TITLE_INVALID', 'Task title must be 1 to 500 characters.');
    if (item.status !== undefined && !TASK_STATUSES.includes(item.status))
      issue(`${at}.status`, 'TASK_STATUS_INVALID', `Task status must be one of ${TASK_STATUSES.join(', ')}.`);
    if (
      item.criteria !== undefined &&
      (!Array.isArray(item.criteria) || item.criteria.some(id => typeof id !== 'string' || !/^AC-\d+$/.test(id)))
    )
      issue(`${at}.criteria`, 'TASK_CRITERIA_INVALID', 'criteria must list AC-NN identifiers.');
  });
  return issues;
}

/** @returns {{total:number, completed:number, pending:number, percentage:number, source:'tasks.json'}} */
export function taskStats(data) {
  const total = data.tasks.length;
  const completed = data.tasks.filter(item => item.status === 'done').length;
  return {
    total,
    completed,
    pending: total - completed,
    percentage: total ? Math.round((100 * completed) / total) : 0,
    source: 'tasks.json',
  };
}

/** Deterministic Markdown projection of tasks.json. */
export function renderTasks(data) {
  const lines = data.tasks.map(
    item =>
      `- [${item.status === 'done' ? 'x' : ' '}] ${item.id}${item.status === 'in_progress' ? ' (in progress)' : ''}: ${item.title}`,
  );
  return `# Tasks\n\n${PROJECTION_NOTE}\n\n${lines.join('\n')}\n`;
}

/**
 * Reads a checklist (a projection or a legacy hand-written tasks.md) into tasks.json shape.
 * Lines without an id get T-01, T-02\u2026 in order. Fenced code is ignored.
 */
export function tasksFromMarkdown(markdown) {
  const tasks = [];
  let fence = null;
  for (const line of markdown.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const match = PROJECTION_LINE.exec(line);
    if (!match) continue;
    const [, checked, id, inProgress, title] = match;
    tasks.push({
      id: id ?? `T-${String(tasks.length + 1).padStart(2, '0')}`,
      title,
      status: checked.trim() ? 'done' : inProgress ? 'in_progress' : 'pending',
    });
  }
  return { schemaVersion: TASKS_SCHEMA_VERSION, tasks };
}

/**
 * Converts a legacy tasks.md into tasks.json and rewrites tasks.md as its projection.
 * @returns {Promise<object>} The new tasks.json content.
 * @throws {Error} TASKS_ALREADY_MIGRATED, TASKS_EMPTY or a validation issue.
 */
export async function migrateTasks(root, identifier) {
  return withManifestLock(root, async () => {
    const manifest = await loadManifest(root);
    const spec = manifest?.specs.find(item => item.id === identifier || item.slug === identifier);
    if (!spec) throw new Error('Specification not found. Use list and an exact ID.');
    const jsonPath = await safePath(root, join('specs', spec.slug, 'tasks.json'));
    const markdownPath = await safePath(root, join('specs', spec.slug, 'tasks.md'));
    try {
      await readFile(jsonPath);
      throw new Error(`TASKS_ALREADY_MIGRATED: specs/${spec.slug}/tasks.json already exists.`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const data = tasksFromMarkdown(await readFile(markdownPath, 'utf8'));
    const issues = validateTasks(data);
    if (issues.length) throw new Error(`${issues[0].code}: ${issues[0].path} ${issues[0].message}`);
    await writeFileAtomic(jsonPath, `${JSON.stringify(data, null, 2)}\n`);
    await writeFileAtomic(markdownPath, renderTasks(data));
    return data;
  });
}
