import { open, readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StudioError } from '../protocol.mjs';
import { translateClaudeMessage } from './claude.mjs';

/**
 * Earlier Claude Code conversations of a folder (docs/STUDIO-AGENT-COCKPIT.md, vuelta 2). The CLI keeps one
 * JSON Lines file per session in `<config>/projects/<folder>/<sessionId>.jsonl`, where `<config>` is
 * `CLAUDE_CONFIG_DIR` or `~/.claude` and `<folder>` is the absolute path with every character other than a
 * letter or digit turned into `-` (checked with Claude Code 2.1.318). Studio only reads the conversation
 * records (prompts, answers, tools, title and cost); it never reads credentials.
 */

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 64 * 1024;
const MAX_TITLE = 80;
const MAX_HISTORY = 400;

/** Folder where the CLI keeps the sessions started in `root`. */
export function claudeSessionsDir(root, env = process.env) {
  const config = env.CLAUDE_CONFIG_DIR || join(env.USERPROFILE || env.HOME || homedir(), '.claude');
  return join(config, 'projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
}

const parseLines = text =>
  text.split('\n').flatMap(line => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return []; // a line cut by a partial read, or one the CLI is still writing
    }
  });

/**
 * What the person typed in a `user` record, or `null` for records that are not a prompt (tool results,
 * text the CLI injects, local command output). A slash command reads as the person typed it.
 */
export function promptOf(record) {
  if (record?.type !== 'user' || record.isMeta || record.isSidechain) return null;
  const content = record.message?.content;
  const raw =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter(block => block?.type === 'text')
            .map(block => block.text)
            .join('\n')
        : '';
  const command = /<command-name>([^<]*)<\/command-name>/.exec(raw);
  if (command) {
    const args = /<command-args>([^<]*)<\/command-args>/.exec(raw)?.[1]?.trim();
    return [command[1].trim(), args].filter(Boolean).join(' ');
  }
  if (!raw.trim() || raw.trimStart().startsWith('<')) return null;
  return raw.trim();
}

const firstLine = text => {
  const line = text.split('\n').find(entry => entry.trim()) ?? '';
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line.trim();
};

async function readSlice(file, position, length) {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

/** Title of one session from the start and the end of its file: the latest title the CLI gave it, else the first prompt. */
async function summarize(file, size) {
  const head = parseLines(await readSlice(file, 0, Math.min(size, HEAD_BYTES)));
  const prompt = head.map(promptOf).find(Boolean);
  if (!prompt) return null; // no prompt yet: nothing to resume
  const tail = size > HEAD_BYTES ? parseLines(await readSlice(file, size - TAIL_BYTES, TAIL_BYTES)) : head;
  const titled = tail.findLast(record => record?.type === 'custom-title' && typeof record.customTitle === 'string');
  return firstLine(titled?.customTitle || prompt);
}

/**
 * Conversations of `root`, newest first.
 * @returns {Promise<Array<{id: string, title: string, updatedAt: string}>>}
 */
export async function listClaudeSessions({ root, env = process.env, limit = 40 }) {
  const dir = claudeSessionsDir(root, env);
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return []; // the CLI never ran in this folder
  }
  const files = await Promise.all(
    names
      .filter(name => name.endsWith('.jsonl') && SESSION_ID.test(name.slice(0, -6)))
      .map(async name => ({ name, info: await stat(join(dir, name)) })),
  );
  files.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
  const sessions = [];
  for (const { name, info } of files) {
    if (sessions.length >= limit) break;
    const title = await summarize(join(dir, name), info.size).catch(() => null);
    if (title) sessions.push({ id: name.slice(0, -6), title, updatedAt: new Date(info.mtimeMs).toISOString() });
  }
  return sessions;
}

/**
 * History of one conversation as the same `agent.event`s a live turn emits (plus `user` for the prompts),
 * so the UI folds it with the same reducer. Also returns the context of the last answer and the cost the CLI
 * recorded, which the driver uses as the base of the next turns.
 */
export async function readClaudeSession({ root, sessionId, env = process.env }) {
  if (!SESSION_ID.test(sessionId ?? ''))
    throw new StudioError('SESSION_UNKNOWN', 'Esa conversación no existe en esta carpeta.');
  let text;
  try {
    text = await readFile(join(claudeSessionsDir(root, env), `${sessionId}.jsonl`), 'utf8');
  } catch {
    throw new StudioError('SESSION_UNKNOWN', 'Esa conversación no existe en esta carpeta.');
  }
  const state = { messageId: null, streamed: new Set() };
  const events = [];
  let costUsd = null;
  let firstPrompt = null;
  let customTitle = null;
  for (const record of parseLines(text)) {
    if (record.type === 'cost-state' && typeof record.totalCostUSD === 'number') costUsd = record.totalCostUSD;
    if (record.type === 'custom-title' && typeof record.customTitle === 'string') customTitle = record.customTitle;
    if (record.isSidechain || record.isMeta) continue;
    const prompt = promptOf(record);
    if (prompt) {
      firstPrompt ??= prompt;
      events.push({ kind: 'user', text: prompt });
      continue;
    }
    if (record.type !== 'assistant' && record.type !== 'user') continue;
    // One record per content block, all with the same message id: the record id keeps their order.
    const keyed = { ...record, message: { ...record.message, id: record.uuid ?? record.message?.id } };
    events.push(...translateClaudeMessage(keyed, state));
  }
  return {
    sessionId,
    // What the rail calls it: the title the CLI gave the session, else its first prompt.
    title: firstLine(customTitle || firstPrompt || ''),
    titleSource: customTitle ? 'agent' : 'prompt',
    events: events.slice(-MAX_HISTORY),
    truncated: events.length > MAX_HISTORY,
    contextTokens: typeof state.contextTokens === 'number' ? state.contextTokens : null,
    costUsd,
  };
}
