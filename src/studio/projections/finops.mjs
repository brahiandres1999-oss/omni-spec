import { BREAKER_DEFAULTS } from '../../circuit-breaker.mjs';

/**
 * FinOps & pipeline monitor (blueprint §4.7.2.4, D-7). Token events come from the circuit breaker
 * store (token_usage_events); the view never estimates usage that was not recorded.
 */

export const RATE_WINDOW_MS = 10_000;
export const EVENT_RETENTION_MS = 30 * 86_400_000;
const CREDENTIAL_KINDS = new Set(['passthrough', 'byok', 'local']);

/**
 * Tokens per second over the window (now - windowMs, now], matching the breaker's own window rule.
 * @param {{tokens: number, recordedAtMs: number}[]} events
 * @param {number} now
 */
export function tokenRate(events, now, windowMs = RATE_WINDOW_MS) {
  let total = 0;
  for (const event of events)
    if (event.recordedAtMs > now - windowMs && event.recordedAtMs <= now) total += event.tokens;
  return total / (windowMs / 1000);
}

/** Only the kind and provider leave the engine; keys, tokens and paths never do. */
function publicCredentialSource(source) {
  if (!source) return null;
  if (!CREDENTIAL_KINDS.has(source.kind)) throw new TypeError(`Unknown credential source kind ${source.kind}`);
  const label = { kind: source.kind, provider: source.provider ?? null };
  return source.kind === 'local' ? { ...label, costPerToken: 0 } : label;
}

const tableExists = (db, name) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

/**
 * @param {{db: import('node:sqlite').DatabaseSync}} memory
 * @param {{now?: number, credentialSource?: {kind: string, provider?: string}|null}} [options]
 */
export function projectFinops(memory, { now = Date.now(), credentialSource = null } = {}) {
  const { db } = memory;
  const events = db
    .prepare('SELECT tokens, recorded_at_ms FROM token_usage_events ORDER BY recorded_at_ms')
    .all()
    .map(row => ({ tokens: row.tokens, recordedAtMs: row.recorded_at_ms }));
  const tokensPerSecond = tokenRate(events, now);
  const tasks = tableExists(db, 'circuit_breakers')
    ? db
        .prepare('SELECT task_id, snapshot_json FROM circuit_breakers ORDER BY task_id')
        .all()
        .map(row => {
          const snapshot = JSON.parse(row.snapshot_json);
          const config = { ...BREAKER_DEFAULTS, ...snapshot.config };
          const windowTokens = (snapshot.window ?? [])
            .filter(entry => entry.time > now - config.rateLimitWindowMs)
            .reduce((sum, entry) => sum + entry.count, 0);
          return {
            taskId: row.task_id,
            state: snapshot.state,
            reason: snapshot.failureReason ?? null,
            turns: snapshot.turns,
            consumedTokens: snapshot.consumedTokens,
            remainingBudget: config.tokenBudget - snapshot.consumedTokens,
            rateHeadroom: config.maxTokensPerWindow - windowTokens,
          };
        })
    : [];
  return {
    stream: tokensPerSecond > 0 ? 'live' : 'idle',
    tokensPerSecond,
    session: { tokens: events.reduce((sum, event) => sum + event.tokens, 0) },
    limits: {
      tokenBudget: BREAKER_DEFAULTS.tokenBudget,
      maxTokensPerWindow: BREAKER_DEFAULTS.maxTokensPerWindow,
      rateLimitWindowMs: BREAKER_DEFAULTS.rateLimitWindowMs,
    },
    tasks,
    credentialSource: publicCredentialSource(credentialSource),
  };
}

/**
 * Deletes events older than the retention window (run at engine start).
 * @returns {number} Rows deleted.
 */
export function pruneTokenEvents(memory, { now = Date.now(), retentionMs = EVENT_RETENTION_MS } = {}) {
  return memory.write(() =>
    Number(memory.db.prepare('DELETE FROM token_usage_events WHERE recorded_at_ms < ?').run(now - retentionMs).changes),
  );
}
