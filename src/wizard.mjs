import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { basename, resolve, parse } from 'node:path';
import { homedir } from 'node:os';
import { lstat } from 'node:fs/promises';
import { listProfiles } from './profiles/index.mjs';
import { detectProjectEnvironment } from './detector.mjs';
import { loadManifest } from './manifest.mjs';
import { normalizeAgents } from './integrations.mjs';
import { initText } from './installation.mjs';
import { supportsTerminalUI, TerminalInstaller } from './terminal-ui.mjs';

const STACK_PRESETS = [
  { label: 'Node.js / TypeScript', doc: 'TSDoc', gates: 'npm test\nnpm run lint\nnpm run build' },
  { label: 'Node.js / JavaScript (ESM)', doc: 'JSDoc', gates: 'npm test\nnpm run lint' },
  { label: 'Python (FastAPI / Django)', doc: 'Python Docstrings (PEP 257)', gates: 'pytest --cov\nruff check .' },
  { label: 'Java / Spring Boot', doc: 'JavaDoc', gates: 'mvn test\nmvn checkstyle:check' },
  { label: 'Go', doc: 'Go doc', gates: 'go test -v ./...\ngolangci-lint run' },
  { label: 'Rust', doc: 'Rustdoc', gates: 'cargo test\ncargo clippy' },
  { label: 'Mobile / Flutter', doc: 'Dartdoc', gates: 'flutter test\nflutter analyze' },
];

function findPresetIndex(target) {
  if (!target) return -1;
  const lower = target.toLowerCase();

  // 1. Direct label match
  const directIdx = STACK_PRESETS.findIndex(p => p.label.toLowerCase() === lower);
  if (directIdx >= 0) return directIdx;

  // 2. Keyword/family mapping
  if (lower.includes('python') || lower.includes('fastapi') || lower.includes('django') || lower.includes('flask')) {
    return STACK_PRESETS.findIndex(p => p.label.includes('Python'));
  }
  if (/\b(java|maven|gradle|spring)\b/.test(lower)) {
    return STACK_PRESETS.findIndex(p => p.label.startsWith('Java /'));
  }
  if (/\b(go|golang)\b/.test(lower)) {
    return STACK_PRESETS.findIndex(p => p.label.startsWith('Go'));
  }
  if (lower.includes('rust') || lower.includes('cargo')) {
    return STACK_PRESETS.findIndex(p => p.label.includes('Rust'));
  }
  if (lower.includes('flutter') || lower.includes('dart')) {
    return STACK_PRESETS.findIndex(p => p.label.includes('Flutter'));
  }
  if (/\b(typescript|ts)\b/.test(lower)) {
    return STACK_PRESETS.findIndex(p => p.label.includes('TypeScript'));
  }
  if (lower.includes('node') || lower.includes('javascript') || lower.includes('react') || lower.includes('express')) {
    return STACK_PRESETS.findIndex(p => p.label.includes('Node.js / JavaScript'));
  }
  if (lower.includes('full-stack') || lower.includes('monorepo')) {
    return STACK_PRESETS.findIndex(p => p.label.includes('Node.js / JavaScript'));
  }
  return -1;
}

/**
 * Line reader that keeps lines arriving before a prompt (piped or pasted input), unlike
 * readline.question, which drops lines read ahead of the question.
 * @param {import('node:stream').Readable} stream Input stream.
 * @param {import('node:stream').Writable} out Prompt output.
 */
export function createLineReader(stream = input, out = output, options = {}) {
  const terminal = options.terminal ?? Boolean(stream.isTTY && out.isTTY);
  const rl = readline.createInterface({ input: stream, ...(terminal ? { output: out, terminal } : { terminal }) });
  const lines = [];
  const waiting = [];
  let ended = false;
  rl.on('line', line => (waiting.length ? waiting.shift().resolve(line) : lines.push(line)));
  rl.on('close', () => {
    ended = true;
    while (waiting.length)
      waiting
        .shift()
        .reject(
          new Error(
            'Input ended; no installation was started. Entrada cerrada; no se inició la instalación. For automation use `init --yes --agent <name>` (or generic). The --yes before the package name belongs to npx, not OmniSpec.',
          ),
        );
  });
  return {
    question(prompt) {
      // In a terminal readline owns the prompt so line editing redraws it correctly.
      if (terminal) {
        rl.setPrompt(prompt);
        rl.prompt();
      } else out.write(prompt);
      if (lines.length) return Promise.resolve(lines.shift());
      if (ended)
        return Promise.reject(
          new Error(
            'Input ended; no installation was started. Entrada cerrada; no se inició la instalación. For automation use `init --yes --agent <name>` (or generic). The --yes before the package name belongs to npx, not OmniSpec.',
          ),
        );
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    },
    close() {
      rl.close();
    },
  };
}

export async function promptUser(rl, question, defaultValue) {
  const displayPrompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  const answer = await rl.question(displayPrompt);
  return answer.trim() || defaultValue;
}

export async function promptChoice(rl, question, choices, defaultIndex = 0) {
  console.log(`\n${question}`);
  choices.forEach((c, idx) => {
    const marker = idx === defaultIndex ? '*' : ' ';
    console.log(`  [${idx + 1}] ${marker} ${c.label || c.name || c}`);
  });

  while (true) {
    const answer = (await rl.question(`Select an option (1-${choices.length}) [${defaultIndex + 1}]: `)).trim();
    if (!answer) return choices[defaultIndex];
    if (/^\d+$/.test(answer) && Number(answer) >= 1 && Number(answer) <= choices.length)
      return choices[Number(answer) - 1];
    console.log(`Choose a number from 1 to ${choices.length}. Elige un número del 1 al ${choices.length}.`);
  }
}

/** Prepare installation configuration without deciding the product or adopting candidate checks. */
export async function runWizard(baseDir, cliOptions = {}) {
  const directory = resolve(baseDir);
  if (directory === parse(directory).root || directory === resolve(homedir()))
    throw new Error(
      'Choose a project folder, not the filesystem root or home directory. Elige una carpeta de proyecto. Use mkdir and cd, then run init.',
    );
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Use a regular project directory, not a symlink.');
  if (cliOptions.lang !== undefined) initText(cliOptions.lang);
  const existing = await loadManifest(directory);
  const detected = await detectProjectEnvironment(directory);
  const validProfiles = listProfiles().map(p => p.id);
  if (cliOptions.profile && !validProfiles.includes(cliOptions.profile))
    throw new Error(`Invalid profile "${cliOptions.profile}". Valid profiles: ${validProfiles.join(', ')}`);

  const locale =
    process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale;
  let language = cliOptions.lang || existing?.language || (/^es(?:[-_.]|$)/i.test(locale) ? 'es' : 'en');
  initText(language);
  let agent = normalizeAgents(cliOptions.agent || cliOptions.ai || existing?.agent || 'generic').join(',');
  const explicitStack = cliOptions.stack !== undefined;
  const stack = cliOptions.stack || existing?.stack || detected.detectedStack || 'Undecided';
  const preset = STACK_PRESETS[findPresetIndex(stack)];
  const changedStack = explicitStack && stack !== existing?.stack;
  const config = {
    projectName: cliOptions.name || existing?.project || detected.projectName || basename(directory),
    stack,
    docStandard:
      cliOptions.doc ||
      (changedStack ? preset?.doc : existing?.documentationStandard) ||
      detected.docStandard ||
      'Project conventions',
    profile: cliOptions.profile || existing?.profile || 'general',
    qualityGates: cliOptions.gates ?? existing?.qualityGates ?? '',
    environment: detected,
    agent,
    language,
    force: Boolean(cliOptions.force),
    explicitProfile: cliOptions.profile !== undefined,
    explicitStack,
    explicitDoc: cliOptions.doc !== undefined || changedStack,
    explicitGates: cliOptions.gates !== undefined,
  };
  // --yes here is an OmniSpec option. npx --yes is consumed before this CLI starts.
  if (cliOptions.yes) return config;

  if (supportsTerminalUI(input, output, process.env, cliOptions.plain)) {
    const ui = new TerminalInstaller(input, output, { version: cliOptions.cliVersion });
    let cancelled = false;
    try {
      if (!cliOptions.lang && !existing?.language)
        language = await ui.choose({
          language,
          step: 1,
          title: 'Language / Idioma',
          options: [
            { value: 'en', label: 'English' },
            { value: 'es', label: 'Español' },
          ],
          defaultValue: language,
        });
      const es = language === 'es',
        t = initText(language);
      const details = [
        `${t.directory}: ${directory}`,
        existing ? t.reinit : detected.isGreenfield ? t.fresh : t.existing,
      ];
      if (!cliOptions.agent && !cliOptions.ai && !existing?.agent) {
        const selected = await ui.choose({
          language,
          step: 2,
          title: es ? '¿Dónde usarás OmniSpec?' : 'Where will you use OmniSpec?',
          details,
          multiple: true,
          options: [
            { value: 'antigravity', label: 'Antigravity' },
            { value: 'claude', label: 'Claude Code' },
            { value: 'codex', label: 'Codex' },
            { value: 'cursor', label: 'Cursor' },
            { value: 'copilot', label: 'VS Code / GitHub Copilot' },
            { value: 'kilo', label: 'Kilo' },
            { value: 'opencode', label: 'OpenCode' },
            { value: 'gemini', label: 'Gemini CLI' },
            { value: 'generic', label: es ? 'Otra herramienta / aún sin elegir' : 'Another tool / not decided yet' },
          ],
        });
        agent = normalizeAgents(selected).join(',');
      }
      const declarations = ['name', 'stack', 'doc', 'profile', 'gates']
        .filter(key => cliOptions[key] !== undefined)
        .map(key => `--${key}: ${cliOptions[key]}`);
      const warnings = (detected.warnings || []).filter(
        warning => !warning.startsWith('No quality-gate commands detected.'),
      );
      const confirmed = await ui.choose({
        language,
        step: 3,
        title: es ? '¿Preparar OmniSpec en esta carpeta?' : 'Prepare OmniSpec in this folder?',
        details: [
          ...details,
          `${t.selected}: ${agent}`,
          ...declarations,
          ...warnings,
          ...(config.force ? [t.force] : []),
        ],
        options: [
          { value: 'yes', label: es ? 'Preparar proyecto' : 'Prepare project' },
          { value: 'no', label: es ? 'Cancelar' : 'Cancel' },
        ],
      });
      if (confirmed === 'no') cancelled = true;
      else return { ...config, agent, language };
    } catch (error) {
      if (error.code !== 'OMNI_INIT_CANCELLED') throw error;
      cancelled = true;
    } finally {
      ui.close();
      if (cancelled) console.log(initText(language).cancelled);
    }
    return null;
  }

  const rl = createLineReader(input, output, { terminal: false });
  try {
    if (!cliOptions.lang && !existing?.language) {
      const choice = await promptChoice(rl, 'Language / Idioma', ['English', 'Español'], language === 'es' ? 1 : 0);
      language = choice === 'Español' ? 'es' : 'en';
    }
    const t = initText(language);
    console.log(`\nOmniSpec — ${t.welcome}\n${t.directory}: ${directory}`);
    console.log(existing ? t.reinit : detected.isGreenfield ? t.fresh : t.existing);
    for (const warning of detected.warnings || []) {
      if (!warning.startsWith('No quality-gate commands detected.')) console.log(`[INFO] ${warning}`);
    }
    if (!cliOptions.agent && !cliOptions.ai && !existing?.agent) {
      console.log(`\n${t.tool}\n${t.tools}`);
      while (true) {
        const answer = (await rl.question(t.toolPrompt)).trim() || 'generic';
        try {
          agent = normalizeAgents(answer).join(',');
          break;
        } catch (error) {
          console.log(error.message);
        }
      }
    }
    console.log(`\n${t.selected}: ${agent}\n${t.pending}`);
    // Explicit engineering declarations are reviewed here, not requested from every user.
    for (const key of ['name', 'stack', 'doc', 'profile', 'gates'])
      if (cliOptions[key] !== undefined) console.log(`  --${key}: ${cliOptions[key]}`);
    if (config.force) console.log(t.force);
    while (true) {
      const answer = (await rl.question(t.confirm)).trim().toLowerCase();
      if (['n', 'no'].includes(answer)) {
        console.log(t.cancelled);
        return null;
      }
      if (['', 's', 'si', 'sí', 'y', 'yes'].includes(answer)) break;
      console.log(t.invalidConfirm);
    }
    return { ...config, agent, language };
  } finally {
    rl.close();
  }
}
