import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { safePath } from './managed.mjs';

/** @returns {string[]} Unique Markdown link destinations with titles and angle brackets removed. */
export function linkDestinations(text) {
  const links = [
    ...[...text.matchAll(/\[[^\]\n]*\]\((<[^>\n]+>|[^)\n]+)\)/g)].map(m => m[1]),
    ...[...text.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gm)].map(m => m[1]),
    ...[...text.matchAll(/<(file:\/\/[^>\n]+)>/gi)].map(m => m[1]),
  ];
  return [
    ...new Set(
      links.map(destination =>
        destination
          .trim()
          .replace(/^<|>$/g, '')
          .replace(/\s+["'][^"']*["']$/, ''),
      ),
    ),
  ];
}

/**
 * Project-relative files cited by local links in specs/project-context.md.
 * External URLs, anchors and nonportable destinations are skipped; validity is audited separately.
 * @returns {string[]} Normalized paths such as `package.json` or `api/pom.xml`.
 */
export function citedProjectFiles(text) {
  const result = new Set();
  for (const destination of linkDestinations(text)) {
    if (/^https?:\/\//i.test(destination) || destination.startsWith('#')) continue;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(destination) || destination.includes('\\')) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(destination.split('#')[0]);
    } catch {
      continue;
    }
    const parts = [];
    for (const part of `specs/${decoded}`.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!parts.length) {
          parts.length = 0;
          parts.push('..');
          break;
        }
        parts.pop();
      } else parts.push(part);
    }
    if (parts.length && parts[0] !== '..') result.add(parts.join('/'));
  }
  return [...result];
}

// A deliberately structural check: existence of a citation is not proof of its meaning.
export async function auditProjectContext(root) {
  const errors = [],
    warnings = [];
  let text;
  try {
    text = await readFile(await safePath(root, 'specs/project-context.md'), 'utf8');
  } catch (error) {
    return {
      valid: false,
      scope: 'STRUCTURE_AND_LOCAL_LINKS_ONLY',
      errors: [`Cannot read project context: ${error.message}`],
      warnings,
      linksChecked: 0,
      semanticReview: 'REQUIRED',
    };
  }
  const states = [...new Set(text.match(/\bCONTEXT_(?:PENDING|RECORDED)\b/g) || [])];
  if (states.length !== 1) errors.push('Record one current onboarding state: CONTEXT_PENDING or CONTEXT_RECORDED.');
  if (!/\bAPPLICATION_(?:NOT_VALIDATED|VALIDATED)\b/.test(text))
    errors.push('Record application validation separately from onboarding state.');
  if (
    !text.includes('<!-- omni:source-conflicts -->') &&
    !/^#{1,6}\s+.*(?:source.conflict|discrepancia|conflicto)/im.test(text)
  )
    errors.push(
      'Include a source-conflict section (<!-- omni:source-conflicts -->): conflicting declarations, or compared sources and coverage limits.',
    );
  let linksChecked = 0;
  for (const destination of linkDestinations(text)) {
    if (/^https?:\/\//i.test(destination) || destination.startsWith('#')) continue;
    linksChecked++;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(destination) || destination.includes('\\')) {
      errors.push(
        `Nonportable or unsupported citation: ${destination}. Use a document-relative path inside the project.`,
      );
      continue;
    }
    try {
      const decoded = decodeURIComponent(destination);
      const fragment = decoded.match(/#L(\d+)(?:-L?(\d+))?$/i);
      const line = fragment ? Number(fragment[1]) : null;
      const name = decoded.split('#')[0];
      const path = await safePath(root, join('specs', name));
      if (!(await stat(path)).isFile()) throw new Error('Citation is not a file');
      if (line !== null) {
        const count = (await readFile(path, 'utf8')).split(/\r?\n/).length;
        if (!Number.isSafeInteger(line) || line < 1 || line > count) throw new Error(`Line ${line} does not exist`);
        if (fragment?.[2] && (Number(fragment[2]) < line || Number(fragment[2]) > count))
          throw new Error(`Invalid line range ending at ${fragment[2]}`);
      }
    } catch (error) {
      errors.push(`Invalid local citation ${destination}: ${error.message}`);
    }
  }
  if (!linksChecked)
    warnings.push('No local Markdown citations checked. Backtick paths and prose citations require manual review.');
  warnings.push(
    'A pass does not prove claim attribution, conflict reconciliation, security, compatibility or application behavior. Review source passages and the final response manually.',
  );
  return {
    valid: !errors.length,
    scope: 'STRUCTURE_AND_LOCAL_LINKS_ONLY',
    errors,
    warnings,
    linksChecked,
    semanticReview: 'REQUIRED',
  };
}
