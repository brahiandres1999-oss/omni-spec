import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { StudioError } from './protocol.mjs';
import { memoryPathOf } from './workspace.mjs';

/**
 * Omni Studio's own index of conversations (docs/STUDIO-AGENT-COCKPIT.md, Fase 3, vuelta 1): the rail lists
 * the conversations started from Studio, grouped by project, the same way for every agent. It lives in each
 * project's memory, so agents can later see what another agent did there.
 *
 * The table is created on first use and MEMORY_SCHEMA_VERSION does not change: the OmniSpec runtimes already
 * installed in repositories refuse any other version but ignore tables they do not know (the same approach
 * as `circuit_breakers`).
 */

const TABLE = `CREATE TABLE IF NOT EXISTS studio_conversations (
  agent TEXT NOT NULL,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  title_source TEXT NOT NULL CHECK(title_source IN ('prompt', 'agent', 'user')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  PRIMARY KEY (agent, session_id)
);
CREATE TABLE IF NOT EXISTS studio_active_work (
  conversation_id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  session_id TEXT,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  files_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;
const COLUMNS = 'agent, session_id, title, title_source, created_at, updated_at, archived_at';
const MAX_TITLE = 80;

/** First non-empty line of a prompt, clipped: what the rail shows until the agent or the person names it. */
export function titleFrom(text) {
  const line =
    String(text ?? '')
      .split('\n')
      .find(entry => entry.trim()) ?? '';
  const trimmed = line.trim();
  return trimmed.length > MAX_TITLE ? `${trimmed.slice(0, MAX_TITLE - 1)}…` : trimmed || 'Conversación';
}

const toSummary = row => ({
  agent: row.agent,
  sessionId: row.session_id,
  title: row.title,
  titleSource: row.title_source,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archived: row.archived_at !== null,
});

const unknown = () => new StudioError('CONVERSATION_UNKNOWN', 'Esa conversación no está en este proyecto.');

function statements(db) {
  return {
    list: db.prepare(`SELECT ${COLUMNS} FROM studio_conversations ORDER BY updated_at DESC`),
    rename: db.prepare(
      `UPDATE studio_conversations SET title = ?, title_source = 'user' WHERE agent = ? AND session_id = ?`,
    ),
    archive: db.prepare('UPDATE studio_conversations SET archived_at = ? WHERE agent = ? AND session_id = ?'),
    remove: db.prepare('DELETE FROM studio_conversations WHERE agent = ? AND session_id = ?'),
    removeWork: db.prepare('DELETE FROM studio_active_work WHERE session_id = ?'),
    clearWork: db.prepare('DELETE FROM studio_active_work'),
    upsertWork: db.prepare(
      `INSERT INTO studio_active_work (conversation_id, agent, session_id, title, state, files_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         agent = excluded.agent,
         session_id = excluded.session_id,
         title = excluded.title,
         state = excluded.state,
         files_json = excluded.files_json,
         updated_at = excluded.updated_at`,
    ),
    listWork: db.prepare(
      'SELECT conversation_id, agent, session_id, title, state, files_json, updated_at FROM studio_active_work ORDER BY updated_at DESC',
    ),
  };
}

const listFrom = (rows, includeArchived) => rows.map(toSummary).filter(entry => includeArchived || !entry.archived);

/**
 * The index of the open project, on the engine's own memory connection.
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function createConversationIndex(db, { now = () => new Date().toISOString() } = {}) {
  db.exec(TABLE);
  const sql = statements(db);
  // Opening a conversation is not activity: an existing entry keeps its place in the rail.
  const record = db.prepare(
    `INSERT INTO studio_conversations (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(agent, session_id) DO UPDATE SET
       title = CASE WHEN studio_conversations.title_source != 'user' AND excluded.title_source = 'agent' THEN excluded.title ELSE studio_conversations.title END,
       title_source = CASE WHEN studio_conversations.title_source != 'user' AND excluded.title_source = 'agent' THEN 'agent' ELSE studio_conversations.title_source END`,
  );
  const touch = db.prepare('UPDATE studio_conversations SET updated_at = ? WHERE agent = ? AND session_id = ?');
  return {
    /** Adds a conversation the first time Studio sees it; later calls change nothing (`touch` is activity). */
    record({ agent, sessionId, title, titleSource = 'prompt' }) {
      const at = now();
      record.run(agent, sessionId, titleFrom(title), titleSource, at, at);
    },
    touch(agent, sessionId) {
      touch.run(now(), agent, sessionId);
    },
    list({ includeArchived = false } = {}) {
      return listFrom(sql.list.all(), includeArchived);
    },
    rename(agent, sessionId, title) {
      if (sql.rename.run(titleFrom(title), agent, sessionId).changes === 0) throw unknown();
    },
    archive(agent, sessionId, archived) {
      if (sql.archive.run(archived ? now() : null, agent, sessionId).changes === 0) throw unknown();
    },
    /** Drops the conversation from Studio's index; the agent's own transcript on disk is never touched. */
    remove(agent, sessionId) {
      if (sql.remove.run(agent, sessionId).changes === 0) throw unknown();
      sql.removeWork.run(sessionId);
    },
    /** Publishes the project's live conversations and touched files so any agent's MCP can query them (Q26). */
    setActiveWork(entries = []) {
      const at = now();
      sql.clearWork.run();
      for (const entry of entries) {
        sql.upsertWork.run(
          String(entry.conversationId ?? 'default'),
          String(entry.agent ?? 'claude'),
          entry.sessionId ?? null,
          titleFrom(entry.title ?? ''),
          String(entry.state ?? 'idle'),
          JSON.stringify(Array.isArray(entry.files) ? entry.files : []),
          at,
        );
      }
    },
    listActiveWork() {
      return sql.listWork.all().map(row => ({
        conversationId: row.conversation_id,
        agent: row.agent,
        sessionId: row.session_id,
        title: row.title,
        state: row.state,
        files: JSON.parse(row.files_json || '[]'),
        updatedAt: row.updated_at,
      }));
    },
  };
}

/**
 * Opens the memory of a project that is not the open one. `null` when it has none yet: reading never creates
 * a database, so listing a project leaves no trace in it.
 */
async function openOther(root, { env, readOnly }) {
  const path = await memoryPathOf(root, { env });
  if (!existsSync(path)) return null;
  const db = new DatabaseSync(path, { readOnly });
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

const hasTable = db =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'studio_conversations'").get());

/** Conversations of another project, read-only. */
export async function listConversationsAt(root, { env = process.env, includeArchived = false } = {}) {
  const db = await openOther(root, { env, readOnly: true });
  if (!db) return [];
  try {
    return hasTable(db) ? listFrom(statements(db).list.all(), includeArchived) : [];
  } finally {
    db.close();
  }
}

/** Renames, archives or removes a conversation of another project (the rail allows it on every project). */
export async function updateConversationAt(
  root,
  change,
  { env = process.env, now = () => new Date().toISOString() } = {},
) {
  const db = await openOther(root, { env, readOnly: false });
  if (!db) throw unknown();
  try {
    if (!hasTable(db)) throw unknown();
    const sql = statements(db);
    const result = change.remove
      ? sql.remove.run(change.agent, change.sessionId)
      : 'title' in change
        ? sql.rename.run(titleFrom(change.title), change.agent, change.sessionId)
        : sql.archive.run(change.archived ? now() : null, change.agent, change.sessionId);
    if (result.changes === 0) throw unknown();
  } finally {
    db.close();
  }
}
