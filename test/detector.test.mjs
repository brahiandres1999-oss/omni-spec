import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectProjectEnvironment } from '../src/detector.mjs';

describe('Project Environment & Stack Detector', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omnispec-detect-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // Safe cleanup
      }
    }
  });

  test('identifies greenfield environment when directory is empty', async () => {
    const result = await detectProjectEnvironment(tempDir);
    assert.equal(result.isGreenfield, true);
    assert.equal(result.type, 'greenfield');
    assert.equal(result.detectedStack, null);
    assert.equal(result.docStandard, 'Project conventions (review required)');
  });

  test('identifies brownfield Node.js with TypeScript and React', async () => {
    const pkg = {
      name: 'my-react-app',
      dependencies: {
        react: '^18.0.0',
        'react-dom': '^18.0.0',
      },
      devDependencies: {
        typescript: '^5.0.0',
      },
      scripts: {
        test: 'vitest run',
        lint: 'eslint .',
        build: 'vite build',
      },
    };

    await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkg, null, 2));

    const result = await detectProjectEnvironment(tempDir);
    assert.equal(result.isGreenfield, false);
    assert.equal(result.type, 'brownfield');
    assert.equal(result.detectedStack, 'React / TypeScript');
    assert.equal(result.docStandard, 'TSDoc');
    assert.match(result.qualityGates, /npm test/);
    assert.match(result.qualityGates, /npm run lint/);
    assert.match(result.qualityGates, /npm run build/);
    assert.equal(result.projectName, 'my-react-app');
  });

  test('identifies brownfield Python FastAPI project', async () => {
    await writeFile(join(tempDir, 'requirements.txt'), 'fastapi==0.110.0\nuvicorn==0.28.0\npydantic==2.6.0\n');

    const result = await detectProjectEnvironment(tempDir);
    assert.equal(result.isGreenfield, false);
    assert.equal(result.type, 'brownfield');
    assert.equal(result.detectedStack, 'Python (FastAPI)');
    assert.equal(result.docStandard, 'Python Docstrings (PEP 257)');
    assert.equal(result.qualityGates, '', 'FastAPI does not imply pytest is installed');
  });

  test('type declaration packages alone do not turn a JavaScript project into TypeScript', async () => {
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({
        type: 'module',
        dependencies: { react: '*' },
        devDependencies: { '@types/node': '*', '@types/react': '*' },
      }),
    );
    const result = await detectProjectEnvironment(tempDir);
    assert.equal(result.detectedStack, 'React / JavaScript');
    assert.equal(result.docStandard, 'JSDoc');
    assert.equal(result.assessment.projectScriptsExecuted, false);
  });

  test('a named TypeScript config is language evidence even without a typescript dependency', async () => {
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(join(tempDir, 'tsconfig.app.json'), '{}');
    const result = await detectProjectEnvironment(tempDir);
    assert.equal(result.detectedStack, 'Node.js / TypeScript');
    assert.equal(result.docStandard, 'TSDoc');
  });

  test('identifies brownfield Java Maven project', async () => {
    await writeFile(
      join(tempDir, 'pom.xml'),
      '<project><modelVersion>4.0.0</modelVersion><artifactId>demo</artifactId></project>',
    );

    const result = await detectProjectEnvironment(tempDir);
    assert.equal(result.isGreenfield, false);
    assert.equal(result.type, 'brownfield');
    assert.equal(result.detectedStack, 'Java / Maven');
    assert.equal(result.docStandard, 'JavaDoc');
    assert.match(result.qualityGates, /mvn test/);
  });

  test('identifies brownfield Go project', async () => {
    await writeFile(join(tempDir, 'go.mod'), 'module github.com/user/myapp\n\ngo 1.22\n');

    const result = await detectProjectEnvironment(tempDir);
    assert.equal(result.isGreenfield, false);
    assert.equal(result.type, 'brownfield');
    assert.equal(result.detectedStack, 'Go');
    assert.equal(result.docStandard, 'Go doc');
    assert.match(result.qualityGates, /go test/);
  });

  test('identifies brownfield Rust Cargo project', async () => {
    await writeFile(join(tempDir, 'Cargo.toml'), '[package]\nname = "my_crate"\nversion = "0.1.0"\n');

    const result = await detectProjectEnvironment(tempDir);
    assert.equal(result.isGreenfield, false);
    assert.equal(result.type, 'brownfield');
    assert.equal(result.detectedStack, 'Rust');
    assert.equal(result.docStandard, 'Rustdoc');
    assert.match(result.qualityGates, /cargo test/);
  });

  test('identifies polyglot monorepo structure with frontend and backend folders', async () => {
    await mkdir(join(tempDir, 'frontend'));
    await mkdir(join(tempDir, 'backend'));

    const result = await detectProjectEnvironment(tempDir);
    assert.equal(result.isGreenfield, false);
    assert.equal(result.type, 'brownfield');
    assert.match(result.detectedStack, /Unknown/);
    assert.equal(result.qualityGates, '', 'Empty frontend/backend directories do not imply test commands');
  });

  test('identifies monorepo with pure JavaScript ESM subdirectories', async () => {
    await mkdir(join(tempDir, 'backend'));
    const backendPkg = {
      name: 'backend',
      type: 'module',
      dependencies: { express: '^5.0.0' },
    };
    await writeFile(join(tempDir, 'backend', 'package.json'), JSON.stringify(backendPkg, null, 2));

    const result = await detectProjectEnvironment(tempDir);
    assert.equal(result.detectedStack, 'Monorepo: Express / JavaScript');
    assert.equal(result.docStandard, 'JSDoc');
  });

  test('identifies monorepo with TypeScript subdirectories', async () => {
    await mkdir(join(tempDir, 'frontend'));
    const frontendPkg = {
      name: 'frontend',
      dependencies: { react: '^18.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    };
    await writeFile(join(tempDir, 'frontend', 'package.json'), JSON.stringify(frontendPkg, null, 2));

    const result = await detectProjectEnvironment(tempDir);
    assert.equal(result.detectedStack, 'Monorepo: React / TypeScript');
    assert.equal(result.docStandard, 'TSDoc');
  });

  test('identifies Bun package manager with binary lockfile (bun.lockb)', async () => {
    const pkg = {
      name: 'bun-project',
      scripts: { test: 'bun test', build: 'bun build ./index.ts' },
    };
    await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkg, null, 2));
    await writeFile(join(tempDir, 'bun.lockb'), '');

    const result = await detectProjectEnvironment(tempDir);
    assert.match(result.qualityGates, /^bun test/m);
    assert.match(result.qualityGates, /^bun run build/m);
  });

  test('identifies modern Astro frontend framework with TypeScript', async () => {
    const pkg = {
      name: 'my-astro-site',
      dependencies: { astro: '^4.16.0' },
      devDependencies: { typescript: '^5.7.0' },
      scripts: { build: 'astro build' },
    };
    await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkg, null, 2));

    const result = await detectProjectEnvironment(tempDir);
    assert.equal(result.framework, 'Astro');
    assert.equal(result.detectedStack, 'Astro / TypeScript');
    assert.equal(result.docStandard, 'TSDoc');
  });

  test('identifies SvelteKit frontend framework', async () => {
    const pkg = {
      name: 'my-svelte-app',
      dependencies: { '@sveltejs/kit': '^2.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    };
    await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkg, null, 2));

    const result = await detectProjectEnvironment(tempDir);
    assert.equal(result.framework, 'Svelte');
    assert.equal(result.detectedStack, 'Svelte / TypeScript');
  });

  test('identifies Nuxt frontend framework', async () => {
    const pkg = {
      name: 'my-nuxt-app',
      dependencies: { nuxt: '^3.10.0' },
    };
    await writeFile(join(tempDir, 'package.json'), JSON.stringify(pkg, null, 2));

    const result = await detectProjectEnvironment(tempDir);
    assert.equal(result.framework, 'Nuxt');
    assert.equal(result.detectedStack, 'Nuxt / JavaScript');
  });

  test('identifies Python project with modern uv.lock and sets uv commands', async () => {
    await writeFile(join(tempDir, 'pyproject.toml'), '[project]\nname = "uv-demo"\ndependencies = ["ruff"]\n');
    await writeFile(join(tempDir, 'uv.lock'), '# uv lockfile\n');

    const result = await detectProjectEnvironment(tempDir);
    assert.equal(result.detectedStack, 'Python');
    assert.match(result.qualityGates, /uv run pytest/);
    assert.match(result.qualityGates, /uv run ruff check \./);
  });
});
