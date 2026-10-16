import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { basename } from 'node:path';
import { listProfiles } from './profiles/index.mjs';
import { detectProjectEnvironment } from './detector.mjs';

const STACK_PRESETS = [
  { label: 'Node.js / TypeScript', doc: 'TSDoc', gates: 'npm test\nnpm run lint\nnpm run build' },
  { label: 'Node.js / JavaScript (ESM)', doc: 'JSDoc', gates: 'npm test\nnpm run lint' },
  { label: 'Python (FastAPI / Django)', doc: 'Python Docstrings (PEP 257)', gates: 'pytest --cov\nruff check .' },
  { label: 'Java / Spring Boot', doc: 'JavaDoc', gates: 'mvn test\nmvn checkstyle:check' },
  { label: 'Go', doc: 'Go doc', gates: 'go test -v ./...\ngolangci-lint run' },
  { label: 'Rust', doc: 'Rustdoc', gates: 'cargo test\ncargo clippy' },
  { label: 'Mobile / Flutter', doc: 'Dartdoc', gates: 'flutter test\nflutter analyze' }
];

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

  if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= choices.length) {
    return choices[defaultIndex];
  }
  return choices[selectedIdx];
}

export async function runWizard(baseDir, cliOptions = {}) {
  const defaultProjectName = basename(baseDir);
  const detected = await detectProjectEnvironment(baseDir);

  // If non-interactive mode is requested (e.g. --yes or in CI)
  if (cliOptions.yes) {
    return {
      projectName: cliOptions.name || detected.projectName || defaultProjectName,
      stack: cliOptions.stack || detected.detectedStack || 'Node.js',
      docStandard: cliOptions.doc || detected.docStandard || 'JSDoc',
      profile: cliOptions.profile || 'general',
      qualityGates: cliOptions.gates || detected.qualityGates || 'npm test\nnpm run lint\nnpm run build'
    };
  }

  const rl = readline.createInterface({ input, output });

  console.log('\nOmniSpec — Universal Spec-Driven Development');
  if (detected.isGreenfield) {
    console.log('[INIT] Greenfield environment detected (starting fresh repository).\n');
  } else {
    console.log(`[DETECT] Existing codebase detected (${detected.detectedStack}). Setting up in-place SDD.\n`);
  }

  try {
    // 1. Project Name
    const projectName = await promptUser(
      rl,
      'Project Name',
      cliOptions.name || defaultProjectName
    );

    // 2. Tech Stack
    const selectedStack = await promptChoice(
      rl,
      'Select your primary technology stack:',
      STACK_PRESETS,
      0
    );

    // 3. Documentation Standard
    const docStandard = await promptUser(
      rl,
      'Preferred Documentation Standard',
      selectedStack.doc
    );

    // 4. Domain & Regulatory Profile
    const availableProfiles = listProfiles();
    const selectedProfile = await promptChoice(
      rl,
      'Select the domain profile (regulatory & architectural invariants):',
      availableProfiles.map(p => ({ label: `${p.name} — ${p.description}`, id: p.id })),
      0
    );

    // 5. Quality Gates
    console.log('\nDefine your delivery quality gates (commands that must pass before merging):');
    const qualityGates = await promptUser(
      rl,
      'Quality Gates command(s)',
      selectedStack.gates.replace(/\n/g, ' && ')
    );

    console.log('\n[SUMMARY] Configuration:');
    console.log(`  - Project:       ${projectName}`);
    console.log(`  - Stack:         ${selectedStack.label}`);
    console.log(`  - Documentation: ${docStandard}`);
    console.log(`  - Profile:       ${selectedProfile.id}`);
    console.log(`  - Quality Gates: ${qualityGates}\n`);

    const confirm = await promptUser(rl, 'Proceed with scaffolding? (Y/n)', 'Y');
    if (confirm.toLowerCase() === 'n') {
      console.log('Setup aborted by user.');
      process.exit(0);
    }

    return {
      projectName,
      stack: selectedStack.label,
      docStandard,
      profile: selectedProfile.id,
      qualityGates: qualityGates.replace(/ && /g, '\n')
    };
  } finally {
    rl.close();
  }
}
