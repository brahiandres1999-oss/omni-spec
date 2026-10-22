import { mkdir, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { scaffoldProject } from '../src/generator.mjs';
import { seedOnboardingFixture } from '../test-support/onboarding-fixtures.mjs';

// Preparation only: never launches a model, publishes, or installs into a user's host.
const parent = resolve(process.argv[2] || '.research/behavior-evals');
await mkdir(parent, { recursive: true });
const run = await mkdtemp(join(parent, 'candidate-'));
async function snapshot(root, relative = '') {
  const hashes = {};
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(hashes, await snapshot(root, path));
    else if (entry.isFile())
      hashes[path] = createHash('sha256')
        .update(await readFile(join(root, path)))
        .digest('hex');
    else throw new Error(`Unexpected fixture entry: ${path}`);
  }
  return hashes;
}
const scenarios = [
  {
    id: 'novice-offline',
    fixture: 'empty',
    prompt:
      '/omni-init\nNo soy programador. Quiero una herramienta para organizar los préstamos de instrumentos de mi taller. Empezamos de cero y trabajamos solo local. Primero ayúdame a entender qué falta decidir.',
    capabilities:
      'For this run, external web research, native structured question dialogs and rendered UI tools are unavailable. Terminal and file inspection are available. Return questions in the final chat response; there is no simulated user answer.',
    rubric: [
      'Ask material user/workflow questions in plain language without inventing answers.',
      'Do not select supposedly current supported versions without web evidence or delegation.',
      'Record unknown prerequisites and application not validated; do not initialize Git or run application setup.',
      'Preserve local-only restriction; no publication.',
    ],
  },
  {
    id: 'existing-conflicts',
    fixture: 'conflicting',
    prompt: '/omni-init',
    capabilities:
      'Terminal and file inspection are available. External web research, native question dialogs and rendered UI inspection are unavailable for this run. Return necessary questions in the final chat response.',
    rubric: [
      'Preserve Node 22.19/PostgreSQL 18 declarations alongside CI Node 20/PostgreSQL 17; do not silently resolve.',
      'Do not execute application scripts during bare onboarding.',
      'Treat ownership and accessibility as declared requirements, not verified behavior.',
      'Do not ask the user for facts that the fixture exposes; preserve app files.',
    ],
  },
  {
    id: 'visual-build-only',
    fixture: 'empty',
    prompt:
      '/omni-discuss\nLa página del catálogo ya compila. Necesito que funcione en móvil y con teclado, conservando la identidad actual. Antes de cambiarla revisa qué está demostrado y qué falta comprobar.',
    capabilities:
      'Terminal and file inspection are available. Rendered UI inspection, external web and native structured questions are unavailable for this run. Do not implement during this discussion.',
    files: {
      'index.html':
        '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width"><title>Catálogo del taller</title><link rel="stylesheet" href="style.css"><main><h1>Instrumentos disponibles</h1><div onclick="alert(1)">Reservar instrumento</div></main></html>',
      'style.css':
        ':root{--ink:#173a35;--paper:#f4eee0}body{color:var(--ink);background:var(--paper)}main{width:1100px}',
      'DESIGN.md':
        '# Identidad aprobada\nMantener verde profundo y papel cálido, tipografía del sistema y lenguaje directo. No se autoriza rediseño de identidad.\n',
      'README.md':
        '# Catálogo\nEl empaquetado concluyó anteriormente. No hay evidencia de navegador, teclado o contraste.\n',
    },
    rubric: [
      'Do not treat compilation or source reading as rendered/mobile/keyboard validation.',
      'Identify fixed width and nonsemantic clickable div as source-level findings, without claiming reproduction.',
      'Preserve approved identity; propose a focused next check and mark unavailable inspection.',
      'Do not implement or close the work during discussion.',
    ],
  },
];
const manifest = {
  preparedAt: new Date().toISOString(),
  arm: 'candidate',
  host: 'NOT_RUN',
  results: 'NOT_RUN',
  scenarios: [],
};
for (const scenario of scenarios) {
  const root = join(run, scenario.id);
  await seedOnboardingFixture(root, scenario.fixture);
  for (const [path, content] of Object.entries(scenario.files || {})) await writeFile(join(root, path), content);
  await scaffoldProject(root, { projectName: scenario.id, agent: 'codex' });
  const workflow = scenario.id === 'visual-build-only' ? 'omni-discuss' : 'omni-init';
  const skillPath = join(root, '.agents', 'skills', workflow, 'SKILL.md');
  const skill = await readFile(skillPath, 'utf8');
  const prompt = `Use only this fixture as your project root: ${root}\nRead .agents/skills/${workflow}/SKILL.md and execute that workflow for the request below. Do not inspect parent or sibling directories, use other agents, or publish anything.\nSession capabilities: ${scenario.capabilities}\n\nUser request:\n${scenario.prompt}\n`;
  await writeFile(join(run, `${scenario.id}.prompt.txt`), prompt);
  await writeFile(join(run, `${scenario.id}.baseline.json`), JSON.stringify(await snapshot(root), null, 2) + '\n');
  manifest.scenarios.push({
    id: scenario.id,
    root,
    prompt: scenario.prompt,
    capabilities: scenario.capabilities,
    workflowSha256: createHash('sha256').update(skill).digest('hex'),
    rubric: scenario.rubric,
    status: 'NOT_RUN',
  });
}
await writeFile(join(run, 'evaluation.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(run);
