import { StudioError } from '../protocol.mjs';
import { CLAUDE_EFFORTS, CLAUDE_MODELS, createClaudeDriver, locateClaude } from './claude.mjs';

/**
 * The agents Omni Studio can drive (docs/STUDIO-AGENT-COCKPIT.md). Every driver emits the same
 * provider-independent `agent.event` payloads, so the UI does not know which CLI is behind the chat.
 * This prototype ships the Claude Code driver; Codex (`app-server`) and ACP drivers plug in here.
 */
export const AGENTS = Object.freeze([
  { id: 'claude', label: 'Claude Code', models: CLAUDE_MODELS, efforts: CLAUDE_EFFORTS },
]);

/**
 * @param {{
 *   root: string,
 *   workspace: {mode: string, dir: string},
 *   notify: (method: string, params: object) => Promise<void>,
 *   log?: (line: string) => void,
 *   createDriver?: typeof createClaudeDriver,
 *   locate?: typeof locateClaude,
 * }} options
 */
export function createAgentHub({
  root,
  workspace,
  notify,
  log = () => undefined,
  createDriver = createClaudeDriver,
  locate = locateClaude,
}) {
  const emit = event =>
    notify('agent.event', { agent: 'claude', root, at: Date.now(), ...event }).catch(error =>
      log(`[studio-engine] agent.event could not be sent: ${error.message}`),
    );
  const driver = createDriver({ cwd: root, emit });

  return {
    async status() {
      const location = await locate();
      return {
        workspace: { mode: workspace.mode, dir: workspace.dir },
        active: 'claude',
        agents: AGENTS.map(agent => ({ ...agent, available: Boolean(location), path: location?.path ?? null })),
        ...driver.status(),
      };
    },
    prompt({ text, model, effort }) {
      if (!text.trim()) throw new StudioError('EMPTY_PROMPT', 'Escribe un mensaje antes de enviarlo.');
      return driver.prompt(text, { model, effort });
    },
    cancel: () => driver.cancel(),
    permission: ({ requestId, decision, message }) => driver.respond(requestId, decision, message),
    reset: () => driver.reset(),
    dispose: () => driver.dispose(),
  };
}
