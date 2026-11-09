import { randomUUID } from 'node:crypto';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * How an agent asks the person a question through Omni Studio, whatever the agent (docs/STUDIO-AGENT-COCKPIT.md).
 * Every agent Studio drives runs the Omni MCP server; its `omni_ask_user` tool connects to this channel, which the
 * engine serves on a local pipe. The engine shows the question as a panel in the chat and the answer travels back
 * as the tool's result. One connection carries one question: one JSON line each way.
 *
 * Environment the engine gives the MCP server of each conversation:
 *   OMNI_STUDIO_ASK           the channel's pipe (Windows) or socket path.
 *   OMNI_STUDIO_CONVERSATION  the engine slot of that conversation.
 */

export const ASK_ENV = 'OMNI_STUDIO_ASK';
export const CONVERSATION_ENV = 'OMNI_STUDIO_CONVERSATION';

/** A fresh path, private to this engine: a named pipe on Windows, a socket elsewhere. */
export function askChannelPath(platform = process.platform) {
  const name = `omni-ask-${randomUUID()}`;
  return platform === 'win32' ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`);
}

/**
 * Serves the channel. `onAsk(request, {reply, onClose})` gets each question; `reply(value)` answers it once and
 * `onClose(listener)` hears the MCP side give up (the agent's turn was cancelled).
 * @returns {Promise<{path: string, close(): void}>}
 */
export function openAskChannel({ onAsk, path = askChannelPath(), log = () => undefined }) {
  const server = createServer(socket => {
    let buffered = '';
    let received = false;
    socket.setEncoding('utf8');
    socket.on('error', error => log(`[studio-engine] ask channel: ${error.message}`));
    socket.on('data', chunk => {
      if (received) return;
      buffered += chunk;
      const newline = buffered.indexOf('\n');
      if (newline === -1) return;
      received = true;
      let request;
      try {
        request = JSON.parse(buffered.slice(0, newline));
      } catch (error) {
        log(`[studio-engine] ask channel: unreadable question (${error.message})`);
        socket.end(`${JSON.stringify({ error: 'unreadable question' })}\n`);
        return;
      }
      onAsk(request, {
        reply: value => {
          if (!socket.destroyed) socket.end(`${JSON.stringify(value)}\n`);
        },
        onClose: listener => socket.once('close', listener),
      });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.off('error', reject);
      resolve({ path, close: () => server.close() });
    });
  });
}

/**
 * The MCP side: sends one question and waits for the person's answer (no timeout of its own: people take
 * their time; the agent's own tool timeout or a cancelled turn closes the connection).
 * @returns {Promise<object>} `{answers}` or `{error}`.
 */
export function askThroughChannel(path, request) {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    let buffered = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', chunk => {
      buffered += chunk;
    });
    socket.on('error', reject);
    socket.on('close', () => {
      const line = buffered.split('\n').find(entry => entry.trim());
      if (!line) return reject(new Error('Omni Studio closed the question without an answer.'));
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(new Error(`Omni Studio sent an unreadable answer: ${error.message}`));
      }
    });
  });
}
