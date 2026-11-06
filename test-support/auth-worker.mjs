import { AuthBroker, createAuthStore, withAuthLock } from '../src/auth.mjs';

// hold <mutex> <ms>: owns the mutex, prints "held" and keeps it for <ms>.
// token <store> <url> <mutex>: one broker process asking for a token from a strict RTR server.
const [mode, ...rest] = process.argv.slice(2);

if (mode === 'hold') {
  const [name, ms] = rest;
  await withAuthLock(
    async () => {
      process.stdout.write('held\n');
      await new Promise(resolve => setTimeout(resolve, Number(ms)));
    },
    { name, timeoutMs: 10000 },
  );
} else if (mode === 'token') {
  const [path, url, name] = rest;
  const refresh = async refreshToken => {
    const response = await fetch(url, { method: 'POST', body: JSON.stringify({ refreshToken }) });
    const body = await response.json();
    if (!response.ok) {
      const error = new Error(body.error);
      error.oauthError = body.error;
      throw error;
    }
    return body;
  };
  const broker = new AuthBroker({
    store: createAuthStore({ path }),
    refresh,
    lock: action => withAuthLock(action, { name, timeoutMs: 20000 }),
  });
  process.stdout.write(`${await broker.getToken('copilot')}\n`);
} else {
  throw new Error(`Unknown mode ${mode}`);
}
