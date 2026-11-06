import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI = fileURLToPath(new URL('../bin/omni-spec.mjs', import.meta.url));

/**
 * Real OmniSpec project built with the CLI itself (init + git), so Studio tests read the exact
 * files the product writes instead of hand-written approximations.
 */
export function makeStudioProject({ prefix = 'omni-studio-', init = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const cli = (...args) =>
    execFileSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (rel, text) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  const read = rel => readFileSync(join(root, rel), 'utf8');
  const commit = message => {
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', message);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'studio-test@example.com');
  git('config', 'user.name', 'Studio Test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  if (init) {
    cli('init', '--yes');
    commit('init');
  }
  return {
    root,
    git,
    cli,
    write,
    read,
    commit,
    readJson: rel => JSON.parse(read(rel)),
    writeJson: (rel, value) => write(rel, JSON.stringify(value, null, 2) + '\n'),
    cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
}

/** Writes a valid tasks.json whose task statuses are given in order. */
export function writeTasks(project, slug, statuses) {
  project.writeJson(`specs/${slug}/tasks.json`, {
    schemaVersion: 1,
    tasks: statuses.map((status, index) => ({ id: `T${index + 1}`, title: `Task ${index + 1}`, status })),
  });
}

/** Deterministic multi-line source text: `count` numbered lines with an optional label. */
export function numberedLines(count, label = 'line') {
  return Array.from({ length: count }, (_, index) => `${label} ${index + 1}`).join('\n') + '\n';
}
