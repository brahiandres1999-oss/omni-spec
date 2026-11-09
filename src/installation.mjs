import { readFile, access } from 'node:fs/promises';
import { checkManagedFiles, safePath } from './managed.mjs';
import { AGENTS, normalizeAgents, onboardingPath } from './integrations.mjs';
import { compareVersions } from './versions.mjs';
import { resultSteps } from './terminal-ui.mjs';

const messages = {
  en: {
    welcome: 'Prepare this folder to build with your AI agent, with clear scope and evidence.',
    directory: 'Destination',
    fresh: 'No application files detected. Product and technology decisions will be discussed with your agent.',
    existing: 'Existing files detected. Application files and authored OmniSpec documents will be preserved.',
    reinit: 'OmniSpec is already installed. Keep its configuration and active work; review managed files only.',
    tool: 'Where will you use OmniSpec? Enter one or more names separated by commas.',
    toolPrompt: 'Tool [generic]: ',
    tools:
      'cursor = Cursor | copilot = VS Code / GitHub Copilot | claude = Claude Code\nantigravity = Google Antigravity | codex = Codex | kilo = Kilo | opencode = OpenCode | gemini = Gemini CLI\nall = all supported integrations | generic = another tool or not decided yet (explicit prompt).',
    selected: 'Selected integrations',
    pending: 'Product, stack, documentation and checks: resolve during agent onboarding unless already declared.',
    force: 'CAUTION: --force replaces the constitution and managed templates. Specifications remain preserved.',
    confirm: 'Prepare OmniSpec in this folder? [Y/n]: ',
    invalidConfirm: 'Enter yes or no.',
    cancelled: 'Cancelled. No installation files were written.',
  },
  es: {
    welcome: 'Prepara esta carpeta para construir con tu agente de IA, con alcance claro y evidencia.',
    directory: 'Destino',
    fresh: 'No se detectaron archivos de aplicación. Definirás el producto y las tecnologías con tu agente.',
    existing: 'Se encontraron archivos existentes. Se conservarán la aplicación y los documentos propios de OmniSpec.',
    reinit:
      'OmniSpec ya está instalado. Se conserva su configuración y trabajo activo; se revisan los archivos administrados.',
    tool: '¿Dónde usarás OmniSpec? Escribe uno o varios nombres separados por comas.',
    toolPrompt: 'Herramienta [generic]: ',
    tools:
      'cursor = Cursor | copilot = VS Code / GitHub Copilot | claude = Claude Code\nantigravity = Google Antigravity | codex = Codex | kilo = Kilo | opencode = OpenCode | gemini = Gemini CLI\nall = todas las integraciones | generic = otra herramienta o aún sin decidir (prompt explícito).',
    selected: 'Integraciones seleccionadas',
    pending: 'Producto, stack, documentación y checks: se resuelven con el agente, salvo decisiones ya declaradas.',
    force:
      'ATENCIÓN: --force reemplaza la constitución y las plantillas administradas. Las especificaciones se conservan.',
    confirm: '¿Preparar OmniSpec en esta carpeta? [S/n]: ',
    invalidConfirm: 'Escribe sí o no.',
    cancelled: 'Cancelado. No se escribieron archivos de instalación.',
  },
};

/** Installer UI text; this does not infer the user's experience or choose the application stack. */
export function initText(language = 'en') {
  if (!Object.hasOwn(messages, language)) throw new Error('Invalid --lang. Use en or es.');
  return messages[language];
}

/** Fail before installation writes when Node is below the package requirement. */
export async function assertInstallationRuntime(
  nodeVersion = process.versions.node,
  runtimeVersions = process.versions,
) {
  if (runtimeVersions?.bun) return;
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const minimum = pkg.engines.node.replace(/^>=/, '');
  if (compareVersions(nodeVersion, minimum) < 0)
    throw new Error(
      `OmniSpec requires Node.js >=${minimum}; found ${nodeVersion}. Actualiza Node.js y vuelve a ejecutar init.`,
    );
}

/** Check installed bytes before reporting readiness; discovery in the host remains unverified. */
export async function inspectInstallation(root, options, version) {
  const integrity = await checkManagedFiles(root);
  if (!integrity.tracked || integrity.changed.length)
    throw new Error(`Installation incomplete. Run doctor, then update --dry-run. ${integrity.changed.join(', ')}`);
  // Omni Studio keeps the runtime itself; the project has no local copy to check.
  const studio = String(options.agent ?? '')
    .split(',')
    .includes('studio');
  for (const name of ['CONSTITUTION.md', 'specs/project-context.md']) await access(await safePath(root, name));
  if (!studio) {
    await access(await safePath(root, 'specs/.omni/runtime/bin/omni-spec.mjs'));
    const runtime = JSON.parse(await readFile(await safePath(root, 'specs/.omni/runtime/package.json'), 'utf8'));
    if (runtime.version !== version) throw new Error('Local runtime version mismatch. Review update --dry-run.');
  }
  return {
    state: 'FILES_READY',
    version,
    language: options.language,
    directory: root,
    integrity: 'PASSED',
    agentDiscovery: 'NOT_CHECKED',
    projectOnboarding: 'PENDING',
    nextSteps: normalizeAgents(options.agent).map(agent => ({ agent, invocation: AGENTS[agent].invocation })),
    fallback: onboardingPath(options.agent),
    auditor: normalizeAgents(options.agent).includes('antigravity') ? '.agents/agents/omni-auditor.md' : null,
  };
}

const TOOL_NAMES = {
  studio: 'Omni Studio',
  antigravity: 'Antigravity',
  plugin: 'Antigravity',
  claude: 'Claude Code',
  cursor: 'Cursor',
  copilot: 'VS Code (GitHub Copilot)',
  codex: 'Codex',
  kilo: 'Kilo',
  opencode: 'OpenCode',
  gemini: 'Gemini CLI',
};

const closing = {
  en: {
    ready: (version, directory) => `OmniSpec ${version} is ready in ${directory}`,
    next: 'Next step',
    open: tools => `1. Open this folder in ${tools}.`,
    type: invocation => `2. In the chat, type:  ${invocation}`,
    typeEach: list => `2. In the chat, type: ${list}`,
    paste: fallback => `2. Paste this in the chat: Read ${fallback} and follow its instructions.`,
    build: '3. Tell it what you want to build.',
    resume: '3. Ask it to resume the pending work.',
    or: ' or ',
    anyTool: 'your AI tool',
    missing: invocation => `${invocation} not showing up? Paste this in the chat:`,
    prompt: fallback => `Read ${fallback} and follow its instructions.`,
  },
  es: {
    ready: (version, directory) => `OmniSpec ${version} está listo en ${directory}`,
    next: 'Siguiente paso',
    open: tools => `1. Abre esta carpeta en ${tools}.`,
    type: invocation => `2. En el chat escribe:  ${invocation}`,
    typeEach: list => `2. En el chat escribe: ${list}`,
    paste: fallback => `2. Pega esto en el chat: Lee ${fallback} y sigue sus instrucciones.`,
    build: '3. Cuéntale qué quieres construir.',
    resume: '3. Pídele que retome el trabajo pendiente.',
    or: ' o ',
    anyTool: 'tu herramienta de IA',
    missing: invocation => `¿No aparece ${invocation}? Pega esto en el chat:`,
    prompt: fallback => `Lee ${fallback} y sigue sus instrucciones.`,
  },
};

/**
 * Closing message of init: one line of confirmation, three numbered steps named after the chosen
 * tools and a fallback prompt. Integrity, discovery and scope stay in the JSON report and in
 * specs/project-context.md rather than on screen.
 * @param {object} installation Result of inspectInstallation.
 * @param {boolean} [hasActiveWork] The project already had an active specification.
 * @param {object} [presentation] Terminal capabilities for resultSteps.
 * @returns {string} Text ready to print.
 */
export function installationMessage(installation, hasActiveWork = false, presentation = {}) {
  const t = closing[installation.language] || closing.en;
  const steps = installation.nextSteps.filter(step => step.agent !== 'generic');
  const names = [...new Set(steps.map(step => TOOL_NAMES[step.agent] || step.agent))];
  const invocation = step => step.invocation.replace(/\s*\(.*\)$/, '');
  const lines = [t.open(names.length ? names.join(t.or) : t.anyTool)];
  if (!steps.length) lines.push(t.paste(installation.fallback));
  else if (new Set(steps.map(invocation)).size === 1) lines.push(t.type(invocation(steps[0])));
  else
    lines.push(
      t.typeEach(steps.map(step => `${TOOL_NAMES[step.agent] || step.agent} → ${invocation(step)}`).join(' · ')),
    );
  lines.push(hasActiveWork ? t.resume : t.build);
  const blocks = [{ title: t.next, lines }];
  // Omni Studio offers its workflows itself; there is no file in the project to fall back to.
  const studioOnly = steps.length > 0 && steps.every(step => step.agent === 'studio');
  if (steps.length && !studioOnly)
    blocks.push({ title: t.missing(invocation(steps[0])), lines: [t.prompt(installation.fallback)] });
  return resultSteps(t.ready(installation.version, installation.directory), blocks, presentation);
}
