import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { basename } from 'node:path';
import { listProfiles } from './profiles/index.mjs';
import { detectProjectEnvironment } from './detector.mjs';
import { loadManifest } from './manifest.mjs';

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

  const answer = await rl.question(`Select an option (1-${choices.length}) [${defaultIndex + 1}]: `);
  const selectedIdx = parseInt(answer.trim(), 10) - 1;

  if (Number.isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= choices.length) {
    return choices[defaultIndex];
  }
  return choices[selectedIdx];
}

export async function runWizard(baseDir, cliOptions = {}) {
  const defaultProjectName = basename(baseDir);
  const detected = await detectProjectEnvironment(baseDir);
  for (const warning of detected.warnings || []) {
    console.warn(`[WARN] ${warning}`);
  }
  const existingManifest = await loadManifest(baseDir);
  const availableProfiles = listProfiles();
  const validProfileIds = availableProfiles.map(p => p.id);

  if (cliOptions.profile && !validProfileIds.includes(cliOptions.profile)) {
    throw new Error(`Invalid profile "${cliOptions.profile}". Valid profiles are: ${validProfileIds.join(', ')}`);
  }

  const isExplicitProfile = Boolean(cliOptions.profile);
  const isExplicitStack = Boolean(cliOptions.stack);
  const isExplicitDoc = Boolean(cliOptions.doc);
  const isExplicitGates = cliOptions.gates !== undefined;

  // If non-interactive mode is requested (e.g. --yes or in CI)
  if (cliOptions.yes) {
    const resolvedProfile = isExplicitProfile ? cliOptions.profile : existingManifest?.profile || 'general';

    let defaultGates = existingManifest?.qualityGates ?? detected.qualityGates ?? '';
    let defaultDoc = existingManifest?.documentationStandard || detected.docStandard || 'Project conventions';
    const resolvedStack = isExplicitStack
      ? cliOptions.stack
      : existingManifest?.stack || detected.detectedStack || 'Undecided';

    const presetIdx = findPresetIndex(resolvedStack);
    const preset = STACK_PRESETS[presetIdx];
    const changedStack =
      isExplicitStack && (!existingManifest?.stack || presetIdx !== findPresetIndex(existingManifest.stack));
    const detectedMatches = presetIdx >= 0 && presetIdx === findPresetIndex(detected.detectedStack);
    if (preset && (isExplicitStack || !existingManifest?.stack)) {
      if (!isExplicitDoc && (changedStack || !existingManifest?.documentationStandard)) {
        defaultDoc = preset.doc;
      }
      if (!isExplicitGates && !detectedMatches && (changedStack || !existingManifest?.qualityGates)) {
        defaultGates = '';
      }
    }

    return {
      projectName: cliOptions.name || existingManifest?.project || detected.projectName || defaultProjectName,
      stack: resolvedStack,
      docStandard: isExplicitDoc ? cliOptions.doc : defaultDoc,
      profile: resolvedProfile,
      qualityGates: cliOptions.gates ?? defaultGates,
      environment: detected,
      agent: cliOptions.agent || cliOptions.ai || existingManifest?.agent || 'antigravity',
      force: Boolean(cliOptions.force),
      explicitProfile: isExplicitProfile,
      explicitStack: isExplicitStack,
      explicitDoc: isExplicitDoc || changedStack,
      explicitGates: isExplicitGates,
    };
  }

  const rl = readline.createInterface({ input, output });

  // Fail loudly when the input stream ends before the wizard completes
  // (non-interactive terminal, closed stdin, or Ctrl+D). Without this guard,
  // pending readline questions never settle and Node exits silently with code 0
  // while the project stays uninitialized.
  let rejectOnInputEnd;
  const inputEnded = new Promise((_, reject) => {
    rejectOnInputEnd = reject;
  });
  const onInputEnd = () =>
    rejectOnInputEnd(
      new Error(
        'Interactive input ended before the wizard completed (non-interactive terminal or closed stdin). ' +
          'Re-run with `--yes` to accept the detected defaults automatically.',
      ),
    );
  input.once('end', onInputEnd);
  inputEnded.catch(() => {}); // never surface as an unhandled rejection
  const guarded = promise => Promise.race([promise, inputEnded]);

  console.log('\nOmniSpec — Universal Spec-Driven Development');
  if (detected.isGreenfield) {
    console.log('[INIT] Greenfield environment detected (starting fresh repository).\n');
  } else {
    console.log(`[DETECT] Existing codebase detected (${detected.detectedStack}). Setting up in-place SDD.\n`);
  }

  try {
    // 1. Project Name
    const projectName = await guarded(
      promptUser(rl, 'Project Name', cliOptions.name || existingManifest?.project || defaultProjectName),
    );

    // 2. Tech Stack - resolve default index from CLI or detector
    const targetStack = cliOptions.stack || existingManifest?.stack || detected.detectedStack || '';
    const defaultStackIdx = Math.max(0, findPresetIndex(targetStack));

    const customStack = { label: targetStack || 'Undecided / custom stack', doc: detected.docStandard, gates: '' };
    const selectedStack = await guarded(
      promptChoice(
        rl,
        'Select your primary technology stack:',
        [...STACK_PRESETS, customStack],
        findPresetIndex(targetStack) < 0 ? STACK_PRESETS.length : defaultStackIdx,
      ),
    );
    const resolvedInteractiveStack =
      !isExplicitStack &&
      existingManifest &&
      findPresetIndex(existingManifest.stack) === STACK_PRESETS.indexOf(selectedStack)
        ? existingManifest.stack
        : selectedStack.label;

    // 3. Documentation Standard - resolve default according to selected stack
    const docStandard = await guarded(
      promptUser(
        rl,
        'Preferred Documentation Standard',
        cliOptions.doc ||
          (existingManifest && findPresetIndex(existingManifest.stack) === STACK_PRESETS.indexOf(selectedStack)
            ? existingManifest.documentationStandard
            : null) ||
          selectedStack.doc,
      ),
    );

    // 4. Domain & Regulatory Profile - resolve default index from CLI or existing manifest
    const targetProfile = cliOptions.profile || existingManifest?.profile || 'general';
    let defaultProfileIdx = availableProfiles.findIndex(p => p.id === targetProfile);
    if (defaultProfileIdx < 0) defaultProfileIdx = 0;

    const selectedProfile = await guarded(
      promptChoice(
        rl,
        'Select the domain profile (regulatory & architectural invariants):',
        availableProfiles.map(p => ({ label: `${p.name} — ${p.description}`, id: p.id })),
        defaultProfileIdx,
      ),
    );

    // 5. Quality Gates
    console.log('\nDefine your delivery quality gates (commands that must pass before merging):');
    const selectedIndex = STACK_PRESETS.indexOf(selectedStack);
    const detectedMatchesSelected = findPresetIndex(detected.detectedStack) === selectedIndex;
    const existingMatchesSelected = existingManifest && findPresetIndex(existingManifest.stack) === selectedIndex;
    const defaultGatesSource =
      cliOptions.gates ||
      (existingMatchesSelected ? existingManifest.qualityGates : null) ||
      (detectedMatchesSelected ? detected.qualityGates : null) ||
      '';
    const defaultGatesPrompt = defaultGatesSource.replace(/\n/g, '\\n');
    const qualityGates = await guarded(promptUser(rl, 'Quality Gates command(s)', defaultGatesPrompt || 'none'));

    console.log('\n[SUMMARY] Configuration:');
    console.log(`  - Project:       ${projectName}`);
    console.log(`  - Stack:         ${resolvedInteractiveStack}`);
    console.log(`  - Documentation: ${docStandard}`);
    console.log(`  - Profile:       ${selectedProfile.id}`);
    console.log(`  - Quality Gates: ${qualityGates}\n`);

    const confirm = await guarded(promptUser(rl, 'Proceed with scaffolding? (Y/n)', 'Y'));
    if (confirm.toLowerCase() === 'n') {
      console.log('Setup aborted by user.');
      return null;
    }

    return {
      projectName,
      stack: resolvedInteractiveStack,
      docStandard,
      profile: selectedProfile.id,
      qualityGates: qualityGates === 'none' ? '' : qualityGates.replace(/\\n/g, '\n'),
      environment: detected,
      agent: cliOptions.agent || cliOptions.ai || existingManifest?.agent || 'antigravity',
      force: Boolean(cliOptions.force),
      explicitProfile: true,
      explicitStack: true,
      explicitDoc: true,
      explicitGates: true,
    };
  } finally {
    input.removeListener('end', onInputEnd);
    rl.close();
  }
}
