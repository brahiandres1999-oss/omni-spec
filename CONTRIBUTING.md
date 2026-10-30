# Contributing to OmniSpec

Thank you for your interest in contributing to OmniSpec!

The current official release is **0.8.1** (npm channel `latest`). See the [Release notes](docs/releases/0.8.1.md) for scope, architecture and verification details.

## Guiding Principles
1. **Zero External Dependencies:** OmniSpec must remain 100% dependency-free. Do not add third-party npm packages to `dependencies`. Use Node.js built-in modules (`node:fs`, `node:path`, `node:readline`, `node:test`). Tooling used only to build or verify the project belongs in `devDependencies` and is never published; `npm run release:check` enforces that `dependencies` stays empty.
2. **Evidence and honest limits:** Ground templates and integrations in repository evidence and current primary documentation. Do not claim zero hallucinations, semantic proof from structural checks, or host compatibility without a host test.
3. **Multi-Archetype Integrity:** Features, bugs, tech debt, and RFCs must maintain their separate, optimized lifecycles.

## Development Workflow
1. Clone the repository.
   Use Node.js >=22.19.0. Work on the preparation branch or a focused contribution branch; versioned documentation must describe the package actually being tested.
2. Install the verification tooling (the only dependency, used for development only):
   ```bash
   npm ci
   ```
3. Run the test suite:
   ```bash
   npm test
   npm run test:package
   ```
4. Run the quality gates:
   ```bash
   npm run lint          # Biome lint + format check (errors fail the build)
   npm run test:coverage # Node built-in coverage with an 85% line floor
   ```
   `npm run lint:fix` applies safe fixes and formatting. The coverage floor is overridable with `COVERAGE_MIN=<percent>`; CI runs it on Node 24 only, because the built-in LCOV reporter is not available on the minimum supported runtime.
5. Ensure all tests and quality gates pass with zero warnings before opening a Pull Request.
6. When changing workflows or shared protocols, run `npm run build:skills` and review the generated skills. Run `npm run release:check` and `npm run release:pack` to check metadata and the package without publishing.

## Repository contents

Version source, tests and fixtures, schemas, canonical skills/agents/rules, brand assets, contributor documentation and release history. Keep local session reports, scratch research and obsolete generated outputs in `.research/` (ignored). Dependencies, coverage, logs, tarballs and `artifacts/` are local outputs; do not force-add them. Use generic paths and projects in public examples instead of personal workspaces or session links.

Commit messages describe the change and relevant validation. Omit automatic AI coauthor trailers, chat/session identifiers and assistant session links. References to supported tools in product documentation remain part of the integration contract.

Use the [behavior evaluation protocol](docs/BEHAVIOR-EVALUATION.md) and [pilot](docs/PILOT.md) to record observed agent behavior separately from engine test results. A commit, tag or successful build does not certify every host/model or authorize publication.

## Static Analysis
Biome provides linting and formatting; `biome.json` is the single source of truth for style. Coverage uses the Node.js built-in test runner (`--experimental-test-coverage` with the `lcov` reporter), so no coverage dependency is required. CI publishes the Biome SARIF report to GitHub Code Scanning, which surfaces new findings on Pull Requests without any external service or token.
