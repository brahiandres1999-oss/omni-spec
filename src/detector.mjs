import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ignored = new Set([
  '.git',
  '.research',
  '.codex',
  'node_modules',
  'specs',
  '.agents',
  '.agent',
  '.claude',
  '.cursor',
  '.kilo',
  '.gemini',
  '.opencode',
  '.venv',
  'venv',
  'dist',
  'build',
  'target',
  'coverage',
  '.next',
  '__pycache__',
]);
const markers = new Set([
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Pipfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'go.mod',
  'Cargo.toml',
  'pubspec.yaml',
  'composer.json',
  'Gemfile',
  'CMakeLists.txt',
]);
const stripBom = s => s.replace(/^\uFEFF/, '');

export const UI_FRAMEWORKS = [
  'next',
  'react',
  'vue',
  'nuxt',
  'svelte',
  '@sveltejs/kit',
  '@angular/core',
  'astro',
  'solid-js',
  'preact',
];

export const UI_COMPONENT_KITS = ['shadcn', 'radix', 'headlessui', 'preline', 'flyonui'];

/**
 * Inspect bounded project metadata without running application commands or selecting versions.
 * @param {string} baseDir Project directory to inspect.
 * @returns {Promise<{
 *   isGreenfield: boolean,
 *   type: 'greenfield'|'brownfield',
 *   detectedStack: string|null,
 *   framework: string|null,
 *   ui: {
 *     signal: boolean,
 *     frameworks: string[],
 *     styling: string[],
 *     declaredComponents: string[],
 *     modules: string[],
 *   },
 *   docStandard: string,
 *   qualityGates: string,
 *   projectName: string|null,
 *   evidence: string[],
 *   modules: Array<{
 *     directory: string,
 *     source: string,
 *     stack: string,
 *     framework: string|null,
 *     ui: { frameworks: string[], styling: string[], declaredComponents: string[], evidence: string[] }|null,
 *     docStandard: string,
 *     commands: string[],
 *     projectName: string|null,
 *     declaredRuntime: object|null,
 *     commandCandidates: object[],
 *   }>,
 *   warnings: string[],
 *   assessment: object,
 *   limits: string,
 * }>} Heuristic module inventory with declared commands, UI stack signals and unresolved compatibility.
 */
export async function detectProjectEnvironment(baseDir) {
  const warnings = [],
    evidence = [],
    modules = [];
  const rootEntries = await readdir(baseDir, { withFileTypes: true });
  const meaningful = rootEntries.filter(
    e => !ignored.has(e.name) && !['CONSTITUTION.md', 'AGENTS.md', '.DS_Store', 'Thumbs.db'].includes(e.name),
  );
  let visited = 0;
  async function scan(directory, relative = '', depth = 0) {
    if (++visited > 200) {
      if (!warnings.includes('Detection limited to 200 directories. Inspect omitted modules manually.'))
        warnings.push('Detection limited to 200 directories. Inspect omitted modules manually.');
      return;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      warnings.push(`Cannot inspect ${relative || '.'}: ${error.message}`);
      return;
    }
    const names = entries.map(e => e.name);
    const hasComponentsConfig = entries.some(entry => entry.name === 'components.json' && entry.isFile());
    const detected = names.filter(n => markers.has(n) || /\.(sln|csproj|fsproj)$/.test(n));
    for (const marker of detected) {
      const source = relative ? `${relative}/${marker}` : marker;
      let raw;
      try {
        raw = stripBom(await readFile(join(directory, marker), 'utf8'));
      } catch (error) {
        warnings.push(`${source}: ${error.message}`);
        continue;
      }
      evidence.push(source);
      let stack,
        framework = null,
        moduleUi = hasComponentsConfig
          ? {
              frameworks: [],
              styling: [],
              declaredComponents: ['shadcn'],
              evidence: [relative ? `${relative}/components.json` : 'components.json'],
            }
          : null,
        doc = 'Project conventions (review required)',
        commands = [],
        projectName = null;
      let declaredRuntime = null,
        scriptDefinitions = {};
      if (marker === 'package.json') {
        let pkg;
        try {
          pkg = JSON.parse(raw);
          if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('Expected object');
        } catch (error) {
          warnings.push(`${source} could not be parsed: ${error.message}`);
          continue;
        }
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const ts = Boolean(deps.typescript || names.some(name => /^tsconfig(?:\.[^.]+)*\.json$/.test(name)));
        framework = deps.next
          ? 'Next.js'
          : deps.react
            ? 'React'
            : deps.vue
              ? 'Vue.js'
              : deps.astro
                ? 'Astro'
                : deps['@sveltejs/kit'] || deps.svelte
                  ? 'Svelte'
                  : deps.nuxt
                    ? 'Nuxt'
                    : deps.express
                      ? 'Express'
                      : deps['@nestjs/core']
                        ? 'NestJS'
                        : null;
        stack = framework
          ? `${framework} / ${ts ? 'TypeScript' : 'JavaScript'}`
          : `Node.js / ${ts ? 'TypeScript' : pkg.type === 'module' ? 'JavaScript ESM' : 'JavaScript'}`;
        doc = ts ? 'TSDoc' : 'JSDoc';
        projectName = pkg.name || null;
        if (typeof pkg.engines?.node === 'string')
          declaredRuntime = {
            tool: 'node',
            constraint: pkg.engines.node,
            source,
            state: 'DECLARED',
            compatibilityTested: false,
          };
        const manager =
          /^pnpm@/.test(pkg.packageManager || '') || names.includes('pnpm-lock.yaml')
            ? 'pnpm'
            : /^yarn@/.test(pkg.packageManager || '') || names.includes('yarn.lock')
              ? 'yarn'
              : /^bun@/.test(pkg.packageManager || '') || names.includes('bun.lock') || names.includes('bun.lockb')
                ? 'bun'
                : 'npm';
        for (const name of ['test', 'lint', 'build', 'typecheck', 'check']) {
          if (typeof pkg.scripts?.[name] === 'string' && pkg.scripts[name].trim()) {
            const command = `${manager} ${name === 'test' ? 'test' : `run ${name}`}`;
            commands.push(command);
            scriptDefinitions[command] = pkg.scripts[name];
          }
        }
        const moduleFrameworks = UI_FRAMEWORKS.filter(fw => Object.hasOwn(deps, fw));
        const moduleStyling =
          Object.hasOwn(deps, 'tailwindcss') || Object.keys(deps).some(d => d.startsWith('@tailwindcss/'))
            ? ['tailwindcss']
            : [];
        const moduleComponents = [];
        if (hasComponentsConfig) moduleComponents.push('shadcn');
        if (Object.hasOwn(deps, 'radix-ui') || Object.keys(deps).some(d => d.startsWith('@radix-ui/')))
          moduleComponents.push('radix');
        if (Object.keys(deps).some(d => d.startsWith('@headlessui/'))) moduleComponents.push('headlessui');
        if (Object.hasOwn(deps, 'preline') || Object.keys(deps).some(d => d.startsWith('@preline/')))
          moduleComponents.push('preline');
        if (Object.hasOwn(deps, 'flyonui')) moduleComponents.push('flyonui');

        if (moduleFrameworks.length || moduleStyling.length || moduleComponents.length) {
          const moduleEvidence = [
            ...moduleFrameworks,
            ...(moduleStyling.length
              ? [
                  Object.hasOwn(deps, 'tailwindcss')
                    ? 'tailwindcss'
                    : Object.keys(deps).find(d => d.startsWith('@tailwindcss/')),
                ]
              : []),
            ...(hasComponentsConfig ? [relative ? `${relative}/components.json` : 'components.json'] : []),
            ...(Object.hasOwn(deps, 'radix-ui')
              ? ['radix-ui']
              : Object.keys(deps).some(d => d.startsWith('@radix-ui/'))
                ? [Object.keys(deps).find(d => d.startsWith('@radix-ui/'))]
                : []),
            ...(Object.keys(deps).some(d => d.startsWith('@headlessui/'))
              ? [Object.keys(deps).find(d => d.startsWith('@headlessui/'))]
              : []),
            ...(Object.hasOwn(deps, 'preline')
              ? ['preline']
              : Object.keys(deps).some(d => d.startsWith('@preline/'))
                ? [Object.keys(deps).find(d => d.startsWith('@preline/'))]
                : []),
            ...(Object.hasOwn(deps, 'flyonui') ? ['flyonui'] : []),
          ].filter(Boolean);
          moduleUi = {
            frameworks: moduleFrameworks,
            styling: moduleStyling,
            declaredComponents: moduleComponents,
            evidence: moduleEvidence,
          };
        }
      } else if (['pyproject.toml', 'requirements.txt', 'Pipfile'].includes(marker)) {
        framework = /fastapi/i.test(raw)
          ? 'Python (FastAPI)'
          : /django/i.test(raw)
            ? 'Python (Django)'
            : /flask/i.test(raw)
              ? 'Python (Flask)'
              : 'Python';
        stack = framework;
        doc = 'Python Docstrings (PEP 257)';
        const usesUv = names.includes('uv.lock');
        if (/\bpytest\b/i.test(raw) || usesUv) commands.push(usesUv ? 'uv run pytest' : 'python -m pytest');
        if (/\bruff\b/i.test(raw)) commands.push(usesUv ? 'uv run ruff check .' : 'ruff check .');
      } else if (marker === 'pom.xml') {
        stack = 'Java / Maven';
        doc = 'JavaDoc';
        commands = [
          names.includes('mvnw') ? (process.platform === 'win32' ? '.\\mvnw.cmd test' : './mvnw test') : 'mvn test',
        ];
      } else if (marker.startsWith('build.gradle')) {
        stack = 'Java / Gradle';
        doc = 'JavaDoc';
        commands = [
          names.includes('gradlew')
            ? process.platform === 'win32'
              ? '.\\gradlew.bat test'
              : './gradlew test'
            : 'gradle test',
        ];
      } else if (marker === 'go.mod') {
        stack = 'Go';
        doc = 'Go doc';
        commands = ['go test ./...'];
      } else if (marker === 'Cargo.toml') {
        stack = 'Rust';
        doc = 'Rustdoc';
        commands = ['cargo test'];
      } else if (marker === 'pubspec.yaml') {
        stack = /sdk:\s*flutter/.test(raw) ? 'Flutter' : 'Dart';
        doc = 'Dartdoc';
      } else if (marker === 'composer.json') {
        stack = 'PHP';
      } else if (marker === 'Gemfile') {
        stack = 'Ruby';
      } else if (marker === 'CMakeLists.txt') {
        stack = 'C/C++ (CMake)';
      } else {
        stack = '.NET';
      }
      modules.push({
        directory: relative || '.',
        source,
        stack,
        framework,
        ui: moduleUi,
        docStandard: doc,
        commands,
        projectName,
        declaredRuntime,
        commandCandidates: commands.map(command => ({
          command,
          cwd: relative || '.',
          source,
          basis: Object.hasOwn(scriptDefinitions, command) ? 'declared-script' : 'tool-convention',
          ...(Object.hasOwn(scriptDefinitions, command) ? { definition: scriptDefinitions[command] } : {}),
          execution: 'NOT_RUN',
          prerequisites: 'NOT_ASSESSED',
          gateSelection: 'REVIEW_REQUIRED',
        })),
      });
    }
    if (depth < 3) {
      for (const entry of entries) {
        if (entry.isDirectory() && !ignored.has(entry.name) && !entry.name.startsWith('.'))
          await scan(join(directory, entry.name), relative ? `${relative}/${entry.name}` : entry.name, depth + 1);
      }
    }
  }
  await scan(baseDir);
  const isGreenfield = meaningful.length === 0;
  const stacks = [...new Set(modules.map(m => m.stack))];
  const nested = modules.some(m => m.directory !== '.');
  const gates = [];
  for (const module of modules)
    for (const command of module.commands) {
      // Paths with shell metacharacters are never interpolated into executable suggestions.
      if (module.directory !== '.' && !/^[a-zA-Z0-9_./-]+$/.test(module.directory)) {
        warnings.push(`Review command working directory manually: ${module.directory}`);
        continue;
      }
      gates.push(module.directory === '.' ? command : `cd "${module.directory}" && ${command}`);
    }
  if (!gates.length)
    warnings.push(
      'No quality-gate commands detected. Configure reviewed commands or document manual verification; no test runner is assumed.',
    );
  const docs = [...new Set(modules.map(m => m.docStandard))];
  const uiModules = modules.filter(m => m.ui);
  const ui = {
    signal: uiModules.length > 0,
    frameworks: UI_FRAMEWORKS.filter(fw => uiModules.some(m => m.ui.frameworks.includes(fw))),
    styling: ['tailwindcss'].filter(st => uiModules.some(m => m.ui.styling.includes(st))),
    declaredComponents: UI_COMPONENT_KITS.filter(kit => uiModules.some(m => m.ui.declaredComponents.includes(kit))),
    modules: [...new Set(uiModules.map(m => m.directory))],
  };
  return {
    isGreenfield,
    type: isGreenfield ? 'greenfield' : 'brownfield',
    detectedStack: stacks.length
      ? `${nested ? 'Monorepo: ' : ''}${stacks.join(' + ')}`
      : isGreenfield
        ? null
        : 'Unknown / existing project',
    framework: modules.find(m => m.framework)?.framework || null,
    ui,
    docStandard: docs.join(' / ') || 'Project conventions (review required)',
    qualityGates: [...new Set(gates)].join('\n'),
    projectName: modules.find(m => m.directory === '.')?.projectName || null,
    evidence,
    modules,
    warnings,
    assessment: {
      kind: 'REPOSITORY_INVENTORY',
      applicationValidation: 'APPLICATION_NOT_VALIDATED',
      projectScriptsExecuted: false,
      runtimeCompatibility: 'NOT_ASSESSED',
      policyCompliance: 'NOT_ASSESSED',
    },
    limits:
      'Heuristic inventory, maximum depth 3 and 200 directories. Commands are discovered/candidate commands, not executed or certified.',
  };
}
