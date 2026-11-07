import { open, readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StudioError } from '../protocol.mjs';
import { sameRoot } from '../workspace.mjs';
import { clipInput, toolTitle } from './claude.mjs';

/**
 * Earlier Codex conversations of a folder (docs/STUDIO-AGENT-COCKPIT.md, Fase 3 vuelta 4). Codex keeps its
 * sessions in `<CODEX_HOME || ~/.codex>/sessions/YYYY/MM/DD/rollout-<timestamp>-<sessionId>.jsonl`, where the
 * first record carries `cwd` and `id`. Studio filters by `cwd === root` and reads only conversation items.
 */

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEAD_BYTES = 128 * 1024;
const MAX_TITLE = 80;
const MAX_HISTORY = 400;

export function codexSessionsDir(env = process.env) {
  const home = env.CODEX_HOME || join(env.USERPROFILE || env.HOME || homedir(), '.codex');
  return join(home, 'sessions');
}

const parseLines = text =>
  text.split('\n').flatMap(line => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });

const firstLine = text => {
  const line =
    String(text ?? '')
      .split('\n')
      .find(entry => entry.trim()) ?? '';
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line.trim();
};

async function readHead(file, size) {
  const handle = await open(file, 'r');
  try {
    const length = Math.min(size, HEAD_BYTES);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function walkJsonl(dir, depth = 0) {
  if (depth > 4) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkJsonl(full, depth + 1)));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(full);
    }
  }
  return files;
}

function metaOf(records, filename) {
  for (const record of records) {
    const payload = record?.payload ?? record;
    const cwd = payload?.cwd ?? record?.cwd;
    const id = payload?.id ?? record?.id ?? record?.session_id;
    if (typeof cwd === 'string' && typeof id === 'string') return { id, cwd };
  }
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(filename);
  const cwdRecord = records.find(r => typeof (r?.payload?.cwd ?? r?.cwd) === 'string');
  if (match && cwdRecord) return { id: match[1], cwd: cwdRecord.payload?.cwd ?? cwdRecord.cwd };
  return null;
}

function userTextOf(record) {
  const item = record?.payload ?? record;
  const role = item?.role ?? (item?.type === 'user_message' || item?.type === 'user' ? 'user' : null);
  if (role !== 'user') return null;
  if (typeof item?.text === 'string' && item.text.trim()) return item.text.trim();
  if (typeof item?.message === 'string' && item.message.trim()) return item.message.trim();
  const content = item?.content ?? item?.message?.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .filter(part => part?.type === 'input_text' || part?.type === 'text')
      .map(part => part.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return null;
}

/**
 * Codex sessions started in `root`, newest first.
 * @returns {Promise<Array<{id: string, title: string, updatedAt: string, agent: 'codex'}>>}
 */
export async function listCodexSessions({ root, env = process.env, limit = 40 }) {
  const paths = await walkJsonl(codexSessionsDir(env));
  const stats = await Promise.all(
    paths.map(async path => {
      try {
        return { path, info: await stat(path) };
      } catch {
        return null;
      }
    }),
  );
  const valid = stats.filter(Boolean).sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
  const sessions = [];
  for (const { path, info } of valid) {
    if (sessions.length >= limit) break;
    const head = parseLines(await readHead(path, info.size).catch(() => ''));
    const meta = metaOf(head, path);
    if (!meta || !SESSION_ID.test(meta.id) || !sameRoot(meta.cwd, root)) continue;
    const prompt = head.map(userTextOf).find(Boolean);
    if (!prompt) continue;
    sessions.push({
      id: meta.id,
      title: firstLine(prompt),
      updatedAt: new Date(info.mtimeMs).toISOString(),
      agent: 'codex',
    });
  }
  return sessions;
}

/**
 * Reads one Codex rollout session of `root` and translates it to `agent.event`s.
 */
export async function readCodexSession({ root, sessionId, env = process.env }) {
  if (!SESSION_ID.test(sessionId ?? ''))
    throw new StudioError('SESSION_UNKNOWN', 'Esa conversación de Codex no existe en esta carpeta.');
  const paths = await walkJsonl(codexSessionsDir(env));
  let matchedRecords = null;
  for (const path of paths) {
    if (!path.toLowerCase().includes(sessionId.toLowerCase())) {
      const head = parseLines(await readHead(path, 8192).catch(() => ''));
      const meta = metaOf(head, path);
      if (!meta || meta.id.toLowerCase() !== sessionId.toLowerCase()) continue;
      if (!sameRoot(meta.cwd, root)) continue;
    }
    const text = await readFile(path, 'utf8').catch(() => '');
    const records = parseLines(text);
    const meta = metaOf(records, path);
    if (meta && meta.id.toLowerCase() === sessionId.toLowerCase() && sameRoot(meta.cwd, root)) {
      matchedRecords = records;
      break;
    }
  }
  if (!matchedRecords) throw new StudioError('SESSION_UNKNOWN', 'Esa conversación de Codex no existe en esta carpeta.');

  const events = [];
  let firstPrompt = null;
  let seq = 0;
  for (const record of matchedRecords) {
    const prompt = userTextOf(record);
    if (prompt) {
      firstPrompt ??= prompt;
      events.push({ kind: 'user', text: prompt });
      continue;
    }
    const item = record?.payload ?? record;
    if (item?.role === 'assistant' || item?.type === 'agent_message') {
      const text =
        typeof item.text === 'string'
          ? item.text
          : Array.isArray(item.content)
            ? item.content
                .filter(part => part?.type === 'output_text' || part?.type === 'text')
                .map(part => part.text)
                .join('\n')
            : '';
      if (text) events.push({ kind: 'text', key: `codex-hist-${++seq}`, delta: text });
    } else if (item?.type === 'function_call' || item?.type === 'commandExecution') {
      const name = item.name ?? 'Bash';
      const input =
        typeof item.arguments === 'string'
          ? (() => {
              try {
                return JSON.parse(item.arguments);
              } catch {
                return { command: item.arguments };
              }
            })()
          : (item.input ?? { command: item.command ?? '' });
      const id = String(item.call_id ?? item.id ?? `call-${++seq}`);
      events.push({ kind: 'tool', id, name, title: toolTitle(name, input), input: clipInput(input) });
    } else if (item?.type === 'function_call_output') {
      events.push({
        kind: 'tool_result',
        toolUseId: String(item.call_id ?? ''),
        isError: false,
        output: String(item.output ?? ''),
      });
    }
  }

  return {
    sessionId,
    title: firstLine(firstPrompt || ''),
    titleSource: 'prompt',
    events: events.slice(-MAX_HISTORY),
    truncated: events.length > MAX_HISTORY,
    contextTokens: null,
    costUsd: null,
  };
}
