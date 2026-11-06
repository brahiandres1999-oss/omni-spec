import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  AutonomousCircuitBreaker,
  BREAKER_DEFAULTS,
  CircuitBreakerError,
  CircuitBreakerOpenError,
  openBreakerStore,
} from '../src/circuit-breaker.mjs';
import { openMemory } from '../src/memory.mjs';

const worker = fileURLToPath(new URL('../test-support/breaker-worker.mjs', import.meta.url));

function clock(start = 0) {
  let current = start;
  const now = () => current;
  now.set = value => {
    current = value;
  };
  return now;
}

const breaker = (config = {}, options = {}) => new AutonomousCircuitBreaker({ taskId: 'T-1', ...config }, options);
const throwsCode = (code, fn) =>
  assert.throws(fn, error => error instanceof CircuitBreakerError && error.code === code, `expected ${code}`);
const tripsWith = (reason, fn) =>
  assert.throws(
    fn,
    error => error instanceof CircuitBreakerOpenError && error.reason === reason,
    `expected trip ${reason}`,
  );

function inState(state, now = clock()) {
  const instance = breaker({}, { now });
  if (state === 'HALF_OPEN') {
    instance.recordGateFailure('g');
    instance.recordGateFailure('g');
  } else if (state === 'OPEN') {
    instance.recordGateFailure('g');
    instance.recordGateFailure('g');
    assert.throws(() => instance.recordGateFailure('g'));
  } else if (state === 'DEAD_LETTER') instance.abort('cancelled by test');
  assert.equal(instance.state, state);
  return instance;
}

describe('Circuit breaker limits (C-04 / T-05)', () => {
  test('CB-01 defaults: CLOSED with 3 turns, 2 retries, 80k tokens, 25k/min and 60 s checks', () => {
    const instance = breaker();
    assert.equal(instance.state, 'CLOSED');
    assert.deepEqual(BREAKER_DEFAULTS, {
      maxTurnsPerTask: 3,
      maxRetriesPerGate: 2,
      tokenBudget: 80000,
      maxTokensPerWindow: 25000,
      rateLimitWindowMs: 60000,
      hardTimeoutMs: 60000,
    });
    assert.deepEqual(instance.config, BREAKER_DEFAULTS);
    assert.deepEqual(
      { turns: instance.turns, consumedTokens: instance.consumedTokens, failureReason: instance.failureReason },
      { turns: 0, consumedTokens: 0, failureReason: null },
    );
  });

  test('CB-02 invalid limits and task ids are rejected', () => {
    for (const key of Object.keys(BREAKER_DEFAULTS))
      for (const value of [0, -1, Number.NaN, 1.5, '3'])
        assert.throws(() => breaker({ [key]: value }), TypeError, `${key}=${value}`);
    assert.throws(() => new AutonomousCircuitBreaker({}), TypeError);
    assert.throws(() => new AutonomousCircuitBreaker({ taskId: '' }), TypeError);
  });

  test('CB-03 turns one to three are allowed', () => {
    const instance = breaker();
    for (let turn = 1; turn <= 3; turn++) instance.incrementTurn();
    assert.equal(instance.turns, 3);
    assert.equal(instance.state, 'CLOSED');
  });

  test('CB-04 the fourth turn trips the breaker with a counter snapshot', () => {
    const instance = breaker();
    for (let turn = 1; turn <= 3; turn++) instance.incrementTurn();
    assert.throws(
      () => instance.incrementTurn(),
      error =>
        error instanceof CircuitBreakerOpenError &&
        error.reason === 'MAX_TURNS_EXCEEDED' &&
        error.snapshot.turns === 4 &&
        error.snapshot.state === 'OPEN',
    );
    assert.equal(instance.state, 'OPEN');
  });

  test('CB-05 the token budget is inclusive', () => {
    const instance = breaker({ maxTokensPerWindow: 1_000_000 });
    instance.recordTokenUsage(40000);
    instance.recordTokenUsage(40000);
    assert.equal(instance.consumedTokens, 80000);
    assert.equal(instance.state, 'CLOSED');
  });

  test('CB-06 one token over budget trips TOKEN_BUDGET_EXCEEDED', () => {
    const instance = breaker({ maxTokensPerWindow: 1_000_000 });
    instance.recordTokenUsage(80000);
    tripsWith('TOKEN_BUDGET_EXCEEDED', () => instance.recordTokenUsage(1));
  });

  test('CB-07 negative, fractional, NaN or infinite token counts are refused', () => {
    const instance = breaker();
    for (const value of [-5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '10', undefined])
      assert.throws(() => instance.recordTokenUsage(value), TypeError, String(value));
    instance.recordTokenUsage(0);
    assert.equal(instance.consumedTokens, 0);
  });

  test('CB-08 more than 25,000 tokens inside the window trips RATE_LIMIT_EXCEEDED', () => {
    const now = clock();
    const instance = breaker({}, { now });
    instance.recordTokenUsage(20000);
    now.set(59999);
    tripsWith('RATE_LIMIT_EXCEEDED', () => instance.recordTokenUsage(5001));
  });

  test('CB-09 the rate window slides', () => {
    const now = clock();
    const instance = breaker({}, { now });
    instance.recordTokenUsage(20000);
    now.set(60000);
    instance.recordTokenUsage(20000);
    now.set(120001);
    instance.recordTokenUsage(20000);
    assert.equal(instance.state, 'CLOSED');
  });

  test('CB-10 when budget and rate both fail, the budget is the reported reason', () => {
    const now = clock();
    const instance = breaker({}, { now });
    for (let minute = 0; minute < 3; minute++) {
      now.set(minute * 60000);
      instance.recordTokenUsage(24000);
    }
    now.set(3 * 60000);
    tripsWith('TOKEN_BUDGET_EXCEEDED', () => instance.recordTokenUsage(26000));
  });
});

describe('Circuit breaker gate retries (C-04)', () => {
  test('CB-11 a first gate failure keeps the breaker closed and allows a retry', () => {
    const instance = breaker();
    assert.deepEqual(instance.recordGateFailure('unit'), { state: 'CLOSED', canRetry: true, attempt: 1 });
  });

  test('CB-12 a second failure moves to HALF_OPEN for a single probe', () => {
    const instance = breaker();
    instance.recordGateFailure('unit');
    assert.deepEqual(instance.recordGateFailure('unit'), { state: 'HALF_OPEN', canRetry: true, attempt: 2 });
  });

  test('CB-13 a successful probe closes the breaker without restoring turns or tokens', () => {
    const instance = breaker();
    instance.incrementTurn();
    instance.recordTokenUsage(1000);
    instance.recordGateFailure('unit');
    instance.recordGateFailure('unit');
    instance.recordGateSuccess('unit');
    assert.equal(instance.state, 'CLOSED');
    assert.equal(instance.gateFailures('unit'), 0);
    assert.equal(instance.turns, 1);
    assert.equal(instance.consumedTokens, 1000);
  });

  test('CB-14 a failed probe trips VERIFICATION_RETRIES_EXHAUSTED', () => {
    const instance = breaker();
    instance.recordGateFailure('unit');
    instance.recordGateFailure('unit');
    tripsWith('VERIFICATION_RETRIES_EXHAUSTED', () => instance.recordGateFailure('unit'));
    assert.equal(instance.state, 'OPEN');
  });

  test('CB-15 retries are counted per gate', () => {
    const instance = breaker();
    instance.recordGateFailure('a');
    instance.recordGateFailure('a');
    assert.equal(instance.recordGateFailure('b').attempt, 1);
    assert.equal(instance.state, 'HALF_OPEN');
    assert.deepEqual([instance.gateFailures('a'), instance.gateFailures('b')], [2, 1]);
    assert.throws(() => instance.recordGateFailure(''), TypeError);
  });

  test('CB-16 every operation is refused while OPEN', () => {
    const instance = inState('OPEN');
    for (const operation of [
      () => instance.incrementTurn(),
      () => instance.recordTokenUsage(1),
      () => instance.recordGateFailure('x'),
      () => instance.recordGateSuccess('x'),
      () => instance.assertExecutable(),
    ])
      throwsCode('BREAKER_OPEN', operation);
  });
});

describe('Circuit breaker human control (C-04)', () => {
  test('CB-17 a human reset closes an OPEN breaker, clears counters and is audited', () => {
    const now = clock(1000);
    const instance = inState('OPEN', now);
    instance.resetByHuman({ actor: 'brahian', reason: 'Fixed the local socket the test needed.' });
    assert.equal(instance.state, 'CLOSED');
    assert.deepEqual([instance.turns, instance.consumedTokens, instance.gateFailures('g')], [0, 0, 0]);
    const last = instance.history.at(-1);
    assert.deepEqual(
      { type: last.type, actor: last.actor, from: last.from, to: last.to, at: last.at },
      { type: 'reset', actor: 'brahian', from: 'OPEN', to: 'CLOSED', at: new Date(1000).toISOString() },
    );
  });

  test('CB-18 a reset needs an actor and a reason', () => {
    const instance = inState('OPEN');
    for (const input of [undefined, {}, { actor: 'x' }, { reason: 'why' }, { actor: ' ', reason: 'why' }])
      assert.throws(() => instance.resetByHuman(input), TypeError);
    assert.equal(instance.state, 'OPEN');
  });

  test('CB-19 resetting a breaker that is not OPEN is an illegal transition', () => {
    for (const state of ['CLOSED', 'HALF_OPEN'])
      throwsCode('ILLEGAL_TRANSITION', () => inState(state).resetByHuman({ actor: 'a', reason: 'b' }));
  });

  test('CB-20 aborting an OPEN breaker dead-letters the task', () => {
    const instance = inState('OPEN');
    instance.abort('Requirement withdrawn.');
    assert.equal(instance.state, 'DEAD_LETTER');
    assert.equal(instance.history.at(-1).type, 'abort');
  });

  test('CB-21 CLOSED and HALF_OPEN breakers can be aborted; a reason is required', () => {
    for (const state of ['CLOSED', 'HALF_OPEN']) {
      const instance = inState(state);
      assert.throws(() => instance.abort(''), TypeError);
      instance.abort('Superseded by another task.');
      assert.equal(instance.state, 'DEAD_LETTER');
    }
  });

  test('CB-22 DEAD_LETTER is terminal', () => {
    const instance = inState('DEAD_LETTER');
    for (const operation of [
      () => instance.incrementTurn(),
      () => instance.resetByHuman({ actor: 'a', reason: 'b' }),
      () => instance.abort('again'),
      () => instance.assertExecutable(),
    ])
      throwsCode('BREAKER_DEAD_LETTER', operation);
  });

  test('CB-23 exhaustive state x event matrix', () => {
    const events = {
      turn: instance => instance.incrementTurn(),
      tokens: instance => instance.recordTokenUsage(1),
      gateFailure: instance => instance.recordGateFailure('g'),
      gateSuccess: instance => instance.recordGateSuccess('g'),
      reset: instance => instance.resetByHuman({ actor: 'a', reason: 'b' }),
      abort: instance => instance.abort('stop'),
      assert: instance => instance.assertExecutable(),
    };
    const expected = {
      CLOSED: ['CLOSED', 'CLOSED', 'CLOSED', 'CLOSED', 'ILLEGAL_TRANSITION', 'DEAD_LETTER', 'CLOSED'],
      HALF_OPEN: [
        'HALF_OPEN',
        'HALF_OPEN',
        'VERIFICATION_RETRIES_EXHAUSTED',
        'CLOSED',
        'ILLEGAL_TRANSITION',
        'DEAD_LETTER',
        'HALF_OPEN',
      ],
      OPEN: ['BREAKER_OPEN', 'BREAKER_OPEN', 'BREAKER_OPEN', 'BREAKER_OPEN', 'CLOSED', 'DEAD_LETTER', 'BREAKER_OPEN'],
      DEAD_LETTER: Array(7).fill('BREAKER_DEAD_LETTER'),
    };
    for (const [state, outcomes] of Object.entries(expected))
      Object.values(events).forEach((event, index) => {
        const instance = inState(state);
        let outcome;
        try {
          event(instance);
          outcome = instance.state;
        } catch (error) {
          assert.ok(error instanceof CircuitBreakerError, error.message);
          // A refusal reports its code; a trip from a running state reports why it opened.
          outcome = state === 'OPEN' ? error.code : (error.reason ?? error.code);
        }
        assert.equal(outcome, outcomes[index], `${state} x ${Object.keys(events)[index]}`);
      });
  });
});

describe('Circuit breaker persistence (C-04)', () => {
  test('CB-24 toJSON and fromJSON round-trip exactly, including the token window', () => {
    const now = clock(5000);
    const instance = breaker({}, { now });
    instance.incrementTurn();
    instance.recordTokenUsage(1200);
    instance.recordGateFailure('lint');
    const json = JSON.parse(JSON.stringify(instance));
    const restored = AutonomousCircuitBreaker.fromJSON(json, { now });
    assert.deepEqual(JSON.parse(JSON.stringify(restored)), json);
    now.set(6000);
    restored.recordTokenUsage(1);
    assert.equal(restored.consumedTokens, 1201);
  });

  test('CB-25 tampered snapshots that break invariants are refused', () => {
    const json = breaker().toJSON();
    for (const tampered of [
      { ...json, consumedTokens: 90000 },
      { ...json, turns: 9 },
      { ...json, state: 'OPEN', failureReason: null },
      { ...json, state: 'HALF_OPEN' },
      { ...json, gateFailures: { lint: 2 } },
      { ...json, state: 'BROKEN' },
      { ...json, version: 99 },
      { ...json, consumedTokens: -1 },
    ])
      throwsCode('BREAKER_STATE_INVALID', () => AutonomousCircuitBreaker.fromJSON(tampered));
  });

  test('CB-26 an OPEN breaker survives closing and reopening memory.db', () => {
    const directory = mkdtempSync(join(tmpdir(), 'omni-breaker-'));
    try {
      const path = join(directory, 'memory.db');
      let memory = openMemory(path);
      let store = openBreakerStore(memory);
      assert.throws(() =>
        store.update('SPEC-7/task-1', instance => {
          for (let turn = 0; turn < 4; turn++) instance.incrementTurn();
        }),
      );
      memory.close();
      memory = openMemory(path);
      store = openBreakerStore(memory);
      const restored = store.load('SPEC-7/task-1');
      assert.equal(restored.state, 'OPEN');
      assert.equal(restored.failureReason, 'MAX_TURNS_EXCEEDED');
      throwsCode('BREAKER_OPEN', () => store.update('SPEC-7/task-1', instance => instance.incrementTurn()));
      assert.equal(store.load('fresh-task').state, 'CLOSED');
      memory.close();
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test('CB-27 two processes updating one task lose no tokens', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'omni-breaker-'));
    try {
      const path = join(directory, 'memory.db');
      openMemory(path).close();
      const run = tag =>
        new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [worker, path, 'shared-task', '60', tag], { stdio: 'pipe' });
          let stderr = '';
          child.stderr.on('data', chunk => {
            stderr += chunk;
          });
          child.on('error', reject);
          child.on('close', code => (code === 0 ? resolve() : reject(new Error(stderr))));
        });
      await Promise.all([run('a'), run('b')]);
      const memory = openMemory(path);
      const restored = openBreakerStore(memory).load('shared-task', {
        tokenBudget: 1_000_000,
        maxTokensPerWindow: 1_000_000,
      });
      assert.equal(restored.consumedTokens, 2 * 60 * 10);
      memory.close();
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe('Circuit breaker timing helpers (C-04)', () => {
  test('CB-28 exponential backoff with bounded jitter', () => {
    const fixed = breaker({}, { random: () => 0.5 });
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5].map(attempt => fixed.backoffMs(attempt)),
      [625, 1125, 2125, 4125, 8125, 8125],
    );
    const low = breaker({}, { random: () => 0 });
    const high = breaker({}, { random: () => 0.999999 });
    assert.equal(low.backoffMs(0), 500);
    assert.ok(high.backoffMs(0) < 750);
    assert.throws(() => fixed.backoffMs(-1), TypeError);
  });

  test('CB-29 the hard timeout caps pipeline checks only', () => {
    const instance = breaker();
    assert.equal(instance.effectiveTimeoutMs(120000), 60000);
    assert.equal(instance.effectiveTimeoutMs(5000), 5000);
    assert.throws(() => instance.effectiveTimeoutMs(0), TypeError);
  });

  test('CB-30 trip messages name the state, the reason and the human action, without config secrets', () => {
    const instance = breaker();
    for (let turn = 0; turn < 3; turn++) instance.incrementTurn();
    try {
      instance.incrementTurn();
      assert.fail('expected a trip');
    } catch (error) {
      assert.match(error.message, /OPEN/);
      assert.match(error.message, /MAX_TURNS_EXCEEDED/);
      assert.match(error.message, /resetByHuman|human/i);
      assert.match(error.message, /T-1/);
    }
    try {
      instance.incrementTurn();
    } catch (error) {
      assert.match(error.message, /Human-in-the-Loop|human/i);
    }
  });
});
