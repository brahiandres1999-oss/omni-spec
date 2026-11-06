import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { estimateTokens } from '../../context-auditor.mjs';
import { AGENTS } from '../../integrations.mjs';
import { loadManifest, saveManifest, withManifestLock } from '../../manifest.mjs';
import { StudioError } from '../protocol.mjs';

/**
 * Smart Skill Hub (blueprint §4.7.2.5, D-9): installed OmniSpec skills and the project's own
 * SKILL.md files, with an estimated context weight. Market import and sanitization (§4.5) are
 * Phase 4b.
 */

export const DEFAULT_CONTEXT_BUDGET_TOKENS = 200_000;

/** Skill directories of every supported host (integrations.mjs is the source of truth). */
const PROJECT_SKILL_DIRS = [...new Set(Object.values(AGENTS).map(agent => agent.skills))].filter(Boolean).sort();

function parseFrontmatter(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (match) fields[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return fields;
}

async function directories(path) {
  try {
    return (await readdir(path, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readSkill(file, fallbackName, origin, path) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const frontmatter = parseFrontmatter(text);
  return {
    name: frontmatter?.name || fallbackName,
    description: frontmatter?.description ?? '',
    origin,
    path,
    weight: { tokens: estimateTokens(text), estimated: true },
    ...(frontmatter ? {} : { problem: 'FRONTMATTER_MISSING' }),
  };
}

async function catalogue(root, bundledDir) {
  const items = [];
  for (const name of (await directories(bundledDir)).filter(entry => entry.startsWith('omni-')).sort()) {
    const skill = await readSkill(join(bundledDir, name, 'SKILL.md'), name, 'bundled', `skills/${name}/SKILL.md`);
    if (skill) items.push(skill);
  }
  for (const dir of PROJECT_SKILL_DIRS)
    for (const name of (await directories(join(root, dir))).sort()) {
      const skill = await readSkill(join(root, dir, name, 'SKILL.md'), name, 'project', `${dir}/${name}/SKILL.md`);
      if (skill) items.push(skill);
    }
  return items;
}

async function manifestOf(root) {
  const manifest = await loadManifest(root);
  if (!manifest) throw new StudioError('PROJECT_NOT_INITIALIZED', 'No OmniSpec manifest found. Run omni-spec init.');
  return manifest;
}

/**
 * @param {string} root
 * @param {{bundledDir: string}} options Directory holding the installed omni-* skills.
 */
export async function listSkills(root, { bundledDir }) {
  const manifest = await manifestOf(root);
  const disabled = new Set(manifest.studio?.skills?.disabled ?? []);
  const items = (await catalogue(root, bundledDir)).map(skill => ({ ...skill, enabled: !disabled.has(skill.name) }));
  const activeTokens = items.filter(skill => skill.enabled).reduce((sum, skill) => sum + skill.weight.tokens, 0);
  const budgetTokens = manifest.studio?.contextBudgetTokens ?? DEFAULT_CONTEXT_BUDGET_TOKENS;
  return { items, activeTokens, budgetTokens, budgetShare: activeTokens / budgetTokens };
}

/**
 * Persists the skill's state in specs/manifest.json#studio.skills.disabled (atomic, idempotent).
 * @throws {StudioError} SKILL_NOT_FOUND
 */
export async function toggleSkill(root, name, enabled, { bundledDir }) {
  if (!(await catalogue(root, bundledDir)).some(skill => skill.name === name))
    throw new StudioError('SKILL_NOT_FOUND', `No installed or project skill is named ${name}.`);
  return withManifestLock(root, async () => {
    const manifest = await manifestOf(root);
    const disabled = new Set(manifest.studio?.skills?.disabled ?? []);
    if (enabled) disabled.delete(name);
    else disabled.add(name);
    manifest.studio = { ...manifest.studio, skills: { ...manifest.studio?.skills, disabled: [...disabled].sort() } };
    await saveManifest(root, manifest);
    return { name, enabled };
  });
}
