# Contributing to OmniSpec

Thank you for your interest in contributing to OmniSpec!

## Guiding Principles
1. **Zero External Dependencies:** OmniSpec must remain 100% dependency-free. Do not add third-party npm packages to `dependencies`. Use Node.js built-in modules (`node:fs`, `node:path`, `node:readline`, `node:test`). Tooling used only to build or verify the project belongs in `devDependencies` and is never published; `npm run release:check` enforces that `dependencies` stays empty.
2. **Evidence and honest limits:** Ground templates and integrations in repository evidence and current primary documentation. Do not claim zero hallucinations, semantic proof from structural checks, or host compatibility without a host test.
3. **Multi-Archetype Integrity:** Features, bugs, tech debt, and RFCs must maintain their separate, optimized lifecycles.

## Development Workflow
1. Clone the repository.
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

## Static Analysis
Biome provides linting and formatting; `biome.json` is the single source of truth for style. Coverage uses the Node.js built-in test runner (`--experimental-test-coverage` with the `lcov` reporter), so no coverage dependency is required. CI publishes the Biome SARIF report to GitHub Code Scanning, which surfaces new findings on Pull Requests without any external service or token.
