import { readFile, access } from 'node:fs/promises';
import { checkManagedFiles, safePath } from './managed.mjs';
import { AGENTS, normalizeAgents, onboardingPath } from './integrations.mjs';
import { compareVersions } from './versions.mjs';
import { resultSections } from './terminal-ui.mjs';

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
    ready: 'OmniSpec files are ready',
    checked: 'Managed-file integrity and local runtime version checked.',
    next: 'Next: open this exact folder in your AI tool and start its chat.',
    discovery: 'Agent discovery is not yet checked. The agent must confirm it can read this installation.',
    fallback: 'If the skill is missing, refresh/reopen the workspace, or paste this in the agent chat:',
    later:
      'Then explain what you want to build. The agent will clarify the goal, pending decisions and a first verifiable outcome.',
    preserved: 'No application scripts were run. No application was created or validated. Nothing was published.',
    resume: 'Existing work: check local status and resume the active specification rather than creating a duplicate.',
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
    ready: 'Los archivos de OmniSpec están preparados',
    checked: 'Integridad de archivos administrados y versión del runtime local comprobadas.',
    next: 'Siguiente paso: abre esta misma carpeta en tu herramienta de IA e inicia su chat.',
    discovery:
      'El descubrimiento por el agente aún no está comprobado. El agente debe confirmar que puede leer esta instalación.',
    fallback: 'Si no aparece la skill, actualiza/reabre el proyecto o pega esto en el chat del agente:',
    later:
      'Después explica qué quieres construir. El agente aclarará el objetivo, las decisiones pendientes y un primer resultado verificable.',
    preserved: 'No se ejecutaron scripts de aplicación. No se creó ni validó una aplicación. No se publicó nada.',
    resume: 'Trabajo existente: consulta el estado local y retoma la especificación activa en vez de duplicarla.',
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
  for (const name of ['CONSTITUTION.md', 'specs/project-context.md', 'specs/.omni/runtime/bin/omni-spec.mjs'])
    await access(await safePath(root, name));
  const runtime = JSON.parse(await readFile(await safePath(root, 'specs/.omni/runtime/package.json'), 'utf8'));
  if (runtime.version !== version) throw new Error('Local runtime version mismatch. Review update --dry-run.');
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

/** A host-specific handoff plus a prompt that works without slash-command discovery. */
export function installationMessage(installation, hasActiveWork = false, presentation = {}) {
  const t = initText(installation.language);
  const prompt =
    installation.language === 'es'
      ? `Lee ${installation.fallback} y sigue sus instrucciones. Confirma la versión del runtime local y usa el idioma de esta conversación.`
      : `Read ${installation.fallback} and follow it. Confirm the local runtime version and use the language of this conversation.`;
  const es = installation.language === 'es';
  return resultSections(
    `[OK] ${t.ready} - ${installation.version}`,
    [
      {
        title: es ? 'INSTALACIÓN' : 'INSTALLATION',
        lines: [
          `${t.directory}: ${installation.directory}`,
          `[OK] ${t.checked}`,
          ...(installation.auditor ? [`[OK] omni-auditor: ${installation.auditor}`] : []),
        ],
      },
      {
        title: es ? 'SIGUIENTE PASO' : 'NEXT STEP',
        lines: [
          t.next,
          ...installation.nextSteps.map(step => `${step.agent}: ${step.invocation}`),
          hasActiveWork ? t.resume : t.later,
        ],
      },
      { title: es ? 'SI NO APARECE LA SKILL' : 'IF THE SKILL IS MISSING', lines: [t.fallback, prompt] },
      {
        title: es ? 'ESTADO Y ALCANCE' : 'STATUS AND SCOPE',
        lines: [t.discovery, t.preserved, 'Local CLI: node specs/.omni/runtime/bin/omni-spec.mjs status'],
      },
    ],
    presentation,
  );
}
