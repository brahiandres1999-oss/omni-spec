import { openMemory } from '../src/memory.mjs';
import { openBreakerStore } from '../src/circuit-breaker.mjs';

// Adds `count` x 10 tokens to one breaker task, one transaction per record, to race another worker.
const [path, taskId, count] = process.argv.slice(2);
const memory = openMemory(path);
const store = openBreakerStore(memory);
const config = { tokenBudget: 1_000_000, maxTokensPerWindow: 1_000_000 };
for (let index = 0; index < Number(count); index++)
  store.update(taskId, breaker => breaker.recordTokenUsage(10), config);
memory.close();
