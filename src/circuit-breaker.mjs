/**
 * Deterministic circuit breaker for the autonomous pipeline.
 *
 * States: CLOSED -> HALF_OPEN -> OPEN -> DEAD_LETTER. Retries are counted per gate: the first
 * failure allows a retry in CLOSED, the second moves to HALF_OPEN (that retry is the single probe)
 * and a third trips OPEN. A successful probe closes the breaker but never restores turns or tokens,
 * so a loop cannot drain the budget by alternating failures and successes. Only a named human can
 * reset an OPEN breaker; DEAD_LETTER is terminal. State is persisted in memory.db so restarting
 * the process does not reset it.
 */

export const BREAKER_DEFAULTS = Object.freeze({
  maxTurnsPerTask: 3,
  maxRetriesPerGate: 2,
  tokenBudget: 80000,
  maxTokensPerWindow: 25000,
  rateLimitWindowMs: 60000,
  hardTimeoutMs: 60000,
});
export const BREAKER_STATES = Object.freeze(['CLOSED', 'HALF_OPEN', 'OPEN', 'DEAD_LETTER']);
const SNAPSHOT_VERSION = 1;
const HISTORY_LIMIT = 50;
const BACKOFF = { baseMs: 500, maxMs: 8000, jitterMs: 250 };

export class CircuitBreakerError extends Error {
  /** @param {string} code Stable code: ILLEGAL_TRANSITION, BREAKER_OPEN, BREAKER_DEAD_LETTER, BREAKER_STATE_INVALID. */
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'CircuitBreakerError';
    this.code = code;
  }
}

export class CircuitBreakerOpenError extends CircuitBreakerError {
  /**
   * @param {string} code BREAKER_OPEN when tripping or refusing work while OPEN.
   * @param {string} message
   * @param {string} reason Why the breaker opened (MAX_TURNS_EXCEEDED, TOKEN_BUDGET_EXCEEDED, ...).
   * @param {object} snapshot Counters at the moment of the error.
   */
  constructor(code, message, reason, snapshot) {
    super(code, message);
    this.name = 'CircuitBreakerOpenError';
    this.reason = reason;
    this.snapshot = snapshot;
  }
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer.`);
  return value;
}

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
  return value.trim();
}

function normalizeConfig(config) {
  const result = {};
  for (const key of Object.keys(BREAKER_DEFAULTS))
    result[key] = positiveInteger(config[key] ?? BREAKER_DEFAULTS[key], key);
  return result;
}

export class AutonomousCircuitBreaker {
  /**
   * @param {{taskId: string} & Partial<typeof BREAKER_DEFAULTS>} config
   * @param {{now?: () => number, random?: () => number}} [options] Injectable clock and randomness.
   */
  constructor(config = {}, { now = Date.now, random = Math.random } = {}) {
    this.taskId = text(config.taskId, 'taskId');
    this.config = normalizeConfig(config);
    this.now = now;
    this.random = random;
    this.state = 'CLOSED';
    this.turns = 0;
    this.consumedTokens = 0;
    this.window = [];
    this.failures = new Map();
    this.failureReason = null;
    this.history = [];
  }

  /** @returns {number} Failures recorded for a gate since its last success. */
  gateFailures(gateId) {
    return this.failures.get(gateId) ?? 0;
  }

  snapshot() {
    return {
      taskId: this.taskId,
      state: this.state,
      turns: this.turns,
      consumedTokens: this.consumedTokens,
      gateFailures: Object.fromEntries(this.failures),
      failureReason: this.failureReason,
    };
  }

  record(type, details) {
    this.history.push({ type, at: new Date(this.now()).toISOString(), ...details });
    if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);
  }

  /** Throws unless work may continue (CLOSED or HALF_OPEN). */
  assertExecutable() {
    if (this.state === 'DEAD_LETTER')
      throw new CircuitBreakerError(
        'BREAKER_DEAD_LETTER',
        `Task ${this.taskId} was aborted and cannot run again; open a new task.`,
      );
    if (this.state === 'OPEN')
      throw new CircuitBreakerOpenError(
        'BREAKER_OPEN',
        `Task ${this.taskId} is halted in state OPEN (${this.failureReason}). Human-in-the-Loop review required: a person must resetByHuman or abort it.`,
        this.failureReason,
        this.snapshot(),
      );
  }

  trip(reason, detail) {
    const from = this.state;
    this.state = 'OPEN';
    this.failureReason = reason;
    this.record('trip', { from, to: 'OPEN', reason });
    throw new CircuitBreakerOpenError(
      'BREAKER_OPEN',
      `Autonomous pipeline halted for task ${this.taskId}: state OPEN, reason ${reason} (${detail}). A human must review and resetByHuman or abort.`,
      reason,
      this.snapshot(),
    );
  }

  /** Counts one reasoning/action turn; the turn after the limit trips MAX_TURNS_EXCEEDED. */
  incrementTurn() {
    this.assertExecutable();
    this.turns++;
    if (this.turns > this.config.maxTurnsPerTask)
      this.trip('MAX_TURNS_EXCEEDED', `${this.turns} turns, limit ${this.config.maxTurnsPerTask}`);
  }

  /**
   * Adds input+output tokens. The budget is checked before the rate window, so when both fail the
   * reported reason is TOKEN_BUDGET_EXCEEDED.
   * @param {number} tokens Non-negative integer.
   */
  recordTokenUsage(tokens) {
    this.assertExecutable();
    if (!Number.isSafeInteger(tokens) || tokens < 0) throw new TypeError('Token usage must be a non-negative integer.');
    const now = this.now();
    this.consumedTokens += tokens;
    this.window = this.window.filter(entry => entry.time > now - this.config.rateLimitWindowMs);
    this.window.push({ time: now, count: tokens });
    const windowTotal = this.window.reduce((sum, entry) => sum + entry.count, 0);
    if (this.consumedTokens > this.config.tokenBudget)
      this.trip('TOKEN_BUDGET_EXCEEDED', `${this.consumedTokens} tokens, budget ${this.config.tokenBudget}`);
    if (windowTotal > this.config.maxTokensPerWindow)
      this.trip(
        'RATE_LIMIT_EXCEEDED',
        `${windowTotal} tokens within ${this.config.rateLimitWindowMs} ms, limit ${this.config.maxTokensPerWindow}`,
      );
  }

  /**
   * @param {string} gateId
   * @returns {{state: string, canRetry: boolean, attempt: number}}
   */
  recordGateFailure(gateId) {
    this.assertExecutable();
    text(gateId, 'gateId');
    const attempt = this.gateFailures(gateId) + 1;
    this.failures.set(gateId, attempt);
    if (attempt > this.config.maxRetriesPerGate)
      this.trip('VERIFICATION_RETRIES_EXHAUSTED', `gate "${gateId}" failed ${attempt} times`);
    if (attempt === this.config.maxRetriesPerGate && this.state === 'CLOSED') {
      this.state = 'HALF_OPEN';
      this.record('probe', { from: 'CLOSED', to: 'HALF_OPEN', gateId });
    }
    return { state: this.state, canRetry: true, attempt };
  }

  /** Clears a gate's failures; closes the breaker when no gate is still on its probe. */
  recordGateSuccess(gateId) {
    this.assertExecutable();
    text(gateId, 'gateId');
    this.failures.delete(gateId);
    if (
      this.state === 'HALF_OPEN' &&
      ![...this.failures.values()].some(count => count >= this.config.maxRetriesPerGate)
    ) {
      this.state = 'CLOSED';
      this.record('recover', { from: 'HALF_OPEN', to: 'CLOSED', gateId });
    }
    return { state: this.state };
  }

  /**
   * Human-in-the-Loop reset of an OPEN breaker. Counters restart; the event stays in the history.
   * @param {{actor: string, reason: string}} approval
   */
  resetByHuman(approval) {
    if (this.state === 'DEAD_LETTER') this.assertExecutable();
    const actor = text(approval?.actor, 'actor');
    const reason = text(approval?.reason, 'reason');
    if (this.state !== 'OPEN')
      throw new CircuitBreakerError(
        'ILLEGAL_TRANSITION',
        `Task ${this.taskId} is ${this.state}; only an OPEN breaker can be reset.`,
      );
    this.state = 'CLOSED';
    this.turns = 0;
    this.consumedTokens = 0;
    this.window = [];
    this.failures.clear();
    this.failureReason = null;
    this.record('reset', { from: 'OPEN', to: 'CLOSED', actor, reason });
  }

  /** Cancels the task for good. */
  abort(reason) {
    if (this.state === 'DEAD_LETTER') this.assertExecutable();
    const why = text(reason, 'reason');
    const from = this.state;
    this.state = 'DEAD_LETTER';
    this.record('abort', { from, to: 'DEAD_LETTER', reason: why });
  }

  /** @returns {number} Exponential backoff with jitter for lock contention. */
  backoffMs(attempt) {
    if (!Number.isSafeInteger(attempt) || attempt < 0) throw new TypeError('attempt must be a non-negative integer.');
    const exponential = Math.min(BACKOFF.maxMs, BACKOFF.baseMs * 2 ** attempt);
    return exponential + Math.floor(this.random() * BACKOFF.jitterMs);
  }

  /** @returns {number} The check timeout an autonomous run may use. Manual verify keeps checks.json. */
  effectiveTimeoutMs(checkTimeoutMs) {
    positiveInteger(checkTimeoutMs, 'checkTimeoutMs');
    return Math.min(checkTimeoutMs, this.config.hardTimeoutMs);
  }

  toJSON() {
    return {
      version: SNAPSHOT_VERSION,
      taskId: this.taskId,
      config: { ...this.config },
      state: this.state,
      turns: this.turns,
      consumedTokens: this.consumedTokens,
      window: this.window.map(entry => ({ ...entry })),
      gateFailures: Object.fromEntries(this.failures),
      failureReason: this.failureReason,
      history: this.history.map(entry => ({ ...entry })),
    };
  }

  /**
   * Restores a snapshot, re-validating every invariant so an edited row cannot reopen a tripped task.
   * @throws {CircuitBreakerError} BREAKER_STATE_INVALID
   */
  static fromJSON(data, options = {}) {
    const invalid = detail => new CircuitBreakerError('BREAKER_STATE_INVALID', `Stored breaker is invalid: ${detail}.`);
    if (!data || typeof data !== 'object' || data.version !== SNAPSHOT_VERSION) throw invalid('unknown version');
    let instance;
    try {
      instance = new AutonomousCircuitBreaker({ taskId: data.taskId, ...data.config }, options);
    } catch (error) {
      throw invalid(error.message);
    }
    const counter = value => Number.isSafeInteger(value) && value >= 0;
    if (!BREAKER_STATES.includes(data.state)) throw invalid(`state ${data.state}`);
    if (!counter(data.turns) || !counter(data.consumedTokens)) throw invalid('counters');
    if (!Array.isArray(data.window) || data.window.some(entry => !counter(entry?.time) || !counter(entry?.count)))
      throw invalid('token window');
    if (
      !data.gateFailures ||
      typeof data.gateFailures !== 'object' ||
      Object.values(data.gateFailures).some(v => !counter(v))
    )
      throw invalid('gate failures');
    if (!Array.isArray(data.history)) throw invalid('history');
    const { config } = instance;
    const counts = Object.values(data.gateFailures);
    const running = data.state === 'CLOSED' || data.state === 'HALF_OPEN';
    if (running) {
      if (data.turns > config.maxTurnsPerTask || data.consumedTokens > config.tokenBudget)
        throw invalid(`${data.state} beyond its limits`);
      if (counts.some(count => count > config.maxRetriesPerGate)) throw invalid('retries beyond the limit');
      const probing = counts.some(count => count === config.maxRetriesPerGate);
      if (probing !== (data.state === 'HALF_OPEN')) throw invalid(`${data.state} does not match gate failures`);
      if (data.failureReason !== null) throw invalid('a running breaker has a failure reason');
    } else if (data.state === 'OPEN' && (typeof data.failureReason !== 'string' || !data.failureReason))
      throw invalid('OPEN without a failure reason');
    instance.state = data.state;
    instance.turns = data.turns;
    instance.consumedTokens = data.consumedTokens;
    instance.window = data.window.map(entry => ({ time: entry.time, count: entry.count }));
    instance.failures = new Map(Object.entries(data.gateFailures));
    instance.failureReason = data.failureReason ?? null;
    instance.history = data.history.map(entry => ({ ...entry }));
    return instance;
  }
}

const TABLE = `CREATE TABLE IF NOT EXISTS circuit_breakers (
  task_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('CLOSED', 'HALF_OPEN', 'OPEN', 'DEAD_LETTER')),
  snapshot_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

/**
 * Breaker persistence in specs/.omni/memory.db. Every update runs in BEGIN IMMEDIATE so concurrent
 * processes serialize, and a trip is committed before its error propagates.
 * @param {{db: import('node:sqlite').DatabaseSync} | import('node:sqlite').DatabaseSync} memory
 * @param {{now?: () => number, random?: () => number}} [options]
 */
export function openBreakerStore(memory, options = {}) {
  const db = memory.db ?? memory;
  db.exec(TABLE);
  const select = db.prepare('SELECT snapshot_json FROM circuit_breakers WHERE task_id = ?');
  const upsert = db.prepare(
    `INSERT INTO circuit_breakers (task_id, state, snapshot_json, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(task_id) DO UPDATE SET state = excluded.state, snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`,
  );
  const load = (taskId, config = {}) => {
    const row = select.get(text(taskId, 'taskId'));
    // The stored configuration wins: a caller cannot raise the limits of an existing task.
    return row
      ? AutonomousCircuitBreaker.fromJSON(JSON.parse(row.snapshot_json), options)
      : new AutonomousCircuitBreaker({ ...config, taskId }, options);
  };
  const save = breaker =>
    upsert.run(breaker.taskId, breaker.state, JSON.stringify(breaker), new Date(breaker.now()).toISOString());
  const insertEvent = db.prepare(
    'INSERT INTO token_usage_events (task_id, tokens, source, provider, recorded_at_ms) VALUES (?, ?, ?, ?, ?)',
  );
  return {
    load,
    save,
    /**
     * Loads, mutates and saves a task's breaker atomically.
     * @template T
     * @param {string} taskId
     * @param {(breaker: AutonomousCircuitBreaker) => T} action
     * @param {Partial<typeof BREAKER_DEFAULTS>} [config] Limits used only when the task is new.
     * @param {{source?: string, provider?: string}} [meta] Labels of the token usage events this update records.
     * @returns {T}
     */
    update(taskId, action, config = {}, meta = {}) {
      db.exec('BEGIN IMMEDIATE');
      let breaker;
      try {
        breaker = load(taskId, config);
        const before = JSON.stringify(breaker);
        const tokensBefore = breaker.consumedTokens;
        // Tokens consumed by this update become one FinOps event, committed with the snapshot or not at all.
        const persist = () => {
          save(breaker);
          const tokens = breaker.consumedTokens - tokensBefore;
          if (tokens > 0)
            insertEvent.run(breaker.taskId, tokens, meta.source ?? null, meta.provider ?? null, breaker.now());
          db.exec('COMMIT');
        };
        let result;
        try {
          result = action(breaker);
        } catch (error) {
          if (!(error instanceof CircuitBreakerError) || JSON.stringify(breaker) === before) throw error;
          persist();
          throw error;
        }
        persist();
        return result;
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
