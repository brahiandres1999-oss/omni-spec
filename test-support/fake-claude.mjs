#!/usr/bin/env node
/**
 * Stand-in for `claude -p --input-format stream-json --output-format stream-json` used by the Studio agent
 * tests. For every user message it streams a short answer, asks permission for one Write, and reports the
 * outcome of that decision in the final result. A message containing "auth-fail" answers like a CLI with no
 * login. It never touches the network or the disk.
 */
import { createInterface } from 'node:readline';

const out = message => process.stdout.write(`${JSON.stringify(message)}\n`);
let turn = 0;
let waiting = null;

out({
  type: 'system',
  subtype: 'init',
  session_id: 'fake-session',
  model: 'fake-model',
  tools: ['Write'],
  permissionMode: 'default',
});

createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.type === 'control_response' && waiting) {
    const decision = message.response.response.behavior;
    const id = waiting;
    waiting = null;
    out({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: id,
            is_error: decision !== 'allow',
            content: decision === 'allow' ? 'File written' : message.response.response.message,
          },
        ],
      },
    });
    out({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: `decision:${decision}`,
      total_cost_usd: 0.01,
      duration_ms: 5,
      num_turns: 2,
    });
    return;
  }
  if (message.type === 'control_request' && message.request?.subtype === 'interrupt') {
    out({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id } });
    out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'interrupted' });
    return;
  }
  if (message.type !== 'user') return;
  const text = message.message.content.map(block => block.text).join('');
  turn++;
  if (text.includes('auth-fail')) {
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login' });
    return;
  }
  const id = `msg_${turn}`;
  out({ type: 'stream_event', event: { type: 'message_start', message: { id } } });
  out({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hola, ' } },
  });
  out({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'escribo el archivo.' } },
  });
  out({ type: 'assistant', message: { id, content: [{ type: 'text', text: 'Hola, escribo el archivo.' }] } });
  const toolId = `toolu_${turn}`;
  const input = { file_path: 'notes.txt', content: 'hola' };
  out({
    type: 'assistant',
    message: { id: `${id}b`, content: [{ type: 'tool_use', id: toolId, name: 'Write', input }] },
  });
  waiting = toolId;
  out({
    type: 'control_request',
    request_id: `perm_${turn}`,
    request: { subtype: 'can_use_tool', tool_name: 'Write', input },
  });
});
