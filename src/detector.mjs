import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Inspects a directory to determine if it is a greenfield (new) or brownfield (existing) project,
 * auto-detecting the underlying tech stack, testing gates, and documentation standards.
 *
 * @param {string} baseDir Absolute path to the repository directory
 * @returns {Promise<Object>} Detection summary object
 */
export async function detectProjectEnvironment(baseDir) {
  let entries = [];
  try {
    entries = await readdir(baseDir);
  } catch {
    entries = [];
  }

  // Filter out system and git files
  const projectEntries = entries.filter(
    (e) => !['.git', '.DS_Store', 'Thumbs.db', 'specs', 'CONSTITUTION.md'].includes(e)
  );

  const isGreenfield = projectEntries.length === 0;

  if (isGreenfield) {
    return {
      isGreenfield: true,
      type: 'greenfield',
      detectedStack: null,
      docStandard: 'JSDoc',
      qualityGates: 'npm test\nnpm run lint\nnpm run build',
      framework: null
    };
  }

  // 1. Check for Node.js / JavaScript / TypeScript (package.json)
  const pkgPath = join(baseDir, 'package.json');
  try {
    const raw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const isTs = Boolean(deps.typescript || deps['@types/node']);

    let stackName = isTs ? 'Node.js / TypeScript' : 'Node.js / JavaScript (ESM)';
    let framework = null;

    if (deps.react || deps['react-dom']) {
      framework = 'React';
      stackName = isTs ? 'React / TypeScript' : 'React / JavaScript';
    } else if (deps.next) {
      framework = 'Next.js';
      stackName = isTs ? 'Next.js / TypeScript' : 'Next.js / JavaScript';
    } else if (deps.vue) {
      framework = 'Vue.js';
      stackName = isTs ? 'Vue.js / TypeScript' : 'Vue.js / JavaScript';
    } else if (deps.express) {
      framework = 'Express';
      stackName = isTs ? 'Express / TypeScript' : 'Express / Node.js';
    } else if (deps['@nestjs/core']) {
      framework = 'NestJS';
      stackName = 'NestJS / TypeScript';
    }

    // Determine quality gates from package.json scripts
    const scripts = pkg.scripts || {};
    const gatesList = [];
    if (scripts.test) gatesList.push('npm test');
    if (scripts.lint) gatesList.push('npm run lint');
    if (scripts.build) gatesList.push('npm run build');

    const qualityGates = gatesList.length > 0 ? gatesList.join('\n') : 'npm test';

    return {
      isGreenfield: false,
      type: 'brownfield',
      detectedStack: stackName,
      framework,
      docStandard: isTs ? 'TSDoc' : 'JSDoc',
      qualityGates,
      projectName: pkg.name || null
    };
  } catch {
    // Not a Node.js root or package.json unreadable
  }

  // Check subdirectories (e.g. monorepo / frontend+backend structure)
  if (entries.includes('frontend') || entries.includes('backend')) {
    return {
      isGreenfield: false,
      type: 'brownfield',
      detectedStack: 'Full-Stack (Frontend / Backend Architecture)',
      framework: 'Polyglot Monorepo',
      docStandard: 'JSDoc / TSDoc',
      qualityGates: 'npm --prefix frontend test\nnpm --prefix backend test',
      projectName: null
    };
  }

  // 2. Check for Python (pyproject.toml, requirements.txt, Pipfile)
  if (
    entries.includes('pyproject.toml') ||
    entries.includes('requirements.txt') ||
    entries.includes('Pipfile')
  ) {
    let framework = 'Python';
    try {
      const reqPath = join(baseDir, 'requirements.txt');
      const reqContent = await readFile(reqPath, 'utf-8');
      if (reqContent.includes('fastapi')) framework = 'Python (FastAPI)';
      else if (reqContent.includes('django')) framework = 'Python (Django)';
      else if (reqContent.includes('flask')) framework = 'Python (Flask)';
    } catch {
      // Ignore if requirements.txt missing
    }

    return {
      isGreenfield: false,
      type: 'brownfield',
      detectedStack: framework,
      framework,
      docStandard: 'Python Docstrings (PEP 257)',
      qualityGates: 'pytest --cov\nruff check .',
      projectName: null
    };
  }

  // 3. Check for Java / Spring Boot (pom.xml, build.gradle)
  if (entries.includes('pom.xml')) {
    return {
      isGreenfield: false,
      type: 'brownfield',
      detectedStack: 'Java / Maven',
      framework: 'Spring Boot / Java',
      docStandard: 'JavaDoc',
      qualityGates: 'mvn test\nmvn checkstyle:check',
      projectName: null
    };
  }

  if (entries.includes('build.gradle') || entries.includes('build.gradle.kts')) {
    return {
      isGreenfield: false,
      type: 'brownfield',
      detectedStack: 'Java / Gradle',
      framework: 'Spring Boot / Java',
      docStandard: 'JavaDoc',
      qualityGates: './gradlew test\n./gradlew check',
      projectName: null
    };
  }

  // 4. Check for Go (go.mod)
  if (entries.includes('go.mod')) {
    return {
      isGreenfield: false,
      type: 'brownfield',
      detectedStack: 'Go',
      framework: 'Go Modules',
      docStandard: 'Go doc',
      qualityGates: 'go test -v ./...\ngolangci-lint run',
      projectName: null
    };
  }

  // 5. Check for Rust (Cargo.toml)
  if (entries.includes('Cargo.toml')) {
    return {
      isGreenfield: false,
      type: 'brownfield',
      detectedStack: 'Rust',
      framework: 'Cargo',
      docStandard: 'Rustdoc',
      qualityGates: 'cargo test\ncargo clippy',
      projectName: null
    };
  }

  // Fallback for generic existing folder
  return {
    isGreenfield: false,
    type: 'brownfield',
    detectedStack: 'General Existing Codebase',
    framework: null,
    docStandard: 'Standard Docstrings / JSDoc',
    qualityGates: 'npm test',
    projectName: null
  };
}
