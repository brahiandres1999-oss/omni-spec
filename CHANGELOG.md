# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-10-16

### Added
- **Universal Multi-Agent Slash Commands (\`src/integrations.mjs\`):**
  - Generated 7 core SDD slash commands (\`/omni-specify\`, \`/omni-clarify\`, \`/omni-plan\`, \`/omni-tasks\`, \`/omni-audit\`, \`/omni-implement\`, \`/omni-converge\`).
  - Added \`/omni-converge\` for anti-drift verification between implementation, acceptance criteria, and architecture before marking specifications complete.
  - Native multi-agent adapters for Google Antigravity / Gemini CLI (\`.agents/skills/\`), Cursor (\`.cursor/rules/\`), Claude Code (\`.claude/commands/\`), GitHub Copilot (\`.github/\`), OpenCode (\`AGENTS.md\`), and KiloCode (\`.kilo/rules/\`, \`kilo.jsonc\`).
- **Specification Focus & List Engine (\`src/manifest.mjs\` & CLI \`focus\` / \`list\`):**
  - \`omni-spec focus <id|slug>\` (alias \`switch\`): Atomically switches active specification and updates active archetype with Lamport lock protection.
  - \`omni-spec list\` (alias \`specs\`): Tabular listing of all specifications with ID, slug, archetype, status, and active marker (\`[*]\`).
- **Non-Destructive Project Updater & Migration Engine (\`src/updater.mjs\`):**
  - \`omni-spec check\`: Validates synchronization between project manifest and installed CLI version.
  - \`omni-spec update\` (with \`--dry-run\`): Upgrades templates in \`specs/_templates/\`, updates manifest version, and refreshes agent skills while keeping active specs and \`CONSTITUTION.md\` 100% intact.
- **Deep Monorepo Stack Detection (\`src/detector.mjs\`):**
  - Inspects \`backend/package.json\` and \`frontend/package.json\` packages to accurately identify JavaScript ESM vs TypeScript dependencies.
- **Hardened Windows Concurrency (\`src/manifest.mjs\`):**
  - Handled transient \`EPERM\` and \`EBUSY\` filesystem locks during concurrent removal in dead-owner recovery.
- **Requirements Traceability Matrix (\`src/templates/01-feature/spec.md\`):**
  - Integrated Section 2.5 linking User Stories (Gherkin) with technical tasks and test suites.

## [0.3.1] - 2026-10-16

### Fixed & Hardened
- **Atomic Concurrency & Storage Locking (`src/manifest.mjs`):**
  - Local cross-process coordination through unique PID/UUID claims and ordered tickets; living owners never expire by age.
  - Dead-owner cleanup removes only that owner's unique claim, including interruptions before ticket publication. Release requires the acquiring lease.
  - Atomic manifest writes through randomized temporary files and atomic `rename`.
  - Shared coordination for `initManifest`, `createSpec`, `addSpec`, and `updateSpecStatus`, with regression tests for mixed operations and simultaneous recovery.
- **Non-Destructive Idempotent Scaffolding (`src/generator.mjs`):**
  - Re-running `omni-spec init` preserves customized documents. `--force` replaces constitution and templates but preserves registered specifications.
  - Profile injection retains both added rows and edits within original security rows, including CRLF templates.
  - Automatic collision prevention in `createSpec`: ensures unique folder creation without clobbering existing directories.
- **Auditor Hardening & Anti-Bypass (`src/auditor.mjs`):**
  - Strict HTML comment stripping before evaluating mandatory sections.
  - Regular file validation (`stat.isFile()`) preventing directories or unreadable paths from satisfying requirements.
  - Section 0 body checks require at least 30 trimmed characters after removing headings and empty separators. This is a structural check, not semantic verification of decisions.
  - Mandatory content enforcement across all 4 archetypes (feature, bugfix, debt, rfc) and rejection of unknown archetypes.
- **Wizard & CLI Configuration Synchronization (`src/wizard.mjs`):**
  - Accurate stack preset matching for framework families (FastAPI, Django, Spring, Maven, Go, Rust).
  - Preserves existing manifest profiles and configurations when reinvoking `init --yes`.
  - Accurately aligns documentation standards and quality gates with the interactively selected technology stack.
  - Maven and Gradle select Java rather than JavaScript; automatic initialization retains detected scripts instead of adding nonexistent lint commands.
  - Confirmed interactive choices update the manifest and constitution together with `--force`; conflicting changes without it are rejected before writing.
  - Injects domain profile security questions (`specSecurityQuestions`) into `spec.md` while preserving user-defined custom template controls.
- **DevOps & Release Pipeline Hardening (`.github/workflows/`):**
  - Conditioned GitHub Release on its Ubuntu/Node 22 test job (`needs: [test]`); the broader CI matrix runs independently.
  - Strict verification that release tags match `package.json` version.
  - Aligned Node engine requirement to `>=18.19.0`.

## [0.3.0] - 2026-10-16

### Added
- **Programmatic Specification Health Auditor (`src/auditor.mjs` & `omni-spec audit`):**
  - Enforces mathematically that an AI coding agent or software engineer cannot start coding if Phase 0 Clarification questions, explicit Non-Goals, or Data Contracts are missing or unclarified.
  - Detects unreplaced template placeholders and generic samples (`SPEC-XXX`, `[Rol Autorizado]`, unedited sample questions).
  - Verifies presence of mandatory archetype artifacts (`spec.md`, `plan.md`, `tasks.md`, `rca.md`, `migration-plan.md`).
  - Calculates and reports task checklist progress percentages directly from `tasks.md`.
  - Exits with deterministic POSIX status codes (0 for approved, 1 for blocked) for native integration into pre-commit hooks and CI pipelines.

## [0.2.0] - 2026-10-16

### Added
- **Smart Project Environment & Stack Detector (`src/detector.mjs`):**
  - Auto-detects Greenfield (new) vs. Brownfield (existing) repositories.
  - Auto-discovers technology stacks: Node.js (React, Next.js, Vue, Express, NestJS), Python (FastAPI, Django, Flask), Java (Maven, Gradle), Go, and Rust.
  - Automatically extracts test runners, linters, and quality gates from existing project configuration files (`package.json`, `pom.xml`, `requirements.txt`, `go.mod`, `Cargo.toml`).
  - Pre-fills documentation standards (`TSDoc`, `JSDoc`, `JavaDoc`, `Python Docstrings PEP 257`, `Go doc`, `Rustdoc`).
- **Resilient Execution & Stream Isolation:**
  - Added `--test-concurrency=1` to guarantee deterministic execution across all CI matrix environments.
  - Silenced stray console output during CLI tests to prevent V8 IPC serialization errors in Node.js 18/20 runners.
  - Replaced emojis with clean, professional ASCII status markers (`[OK]`, `[INFO]`, `[ERROR]`, `[CREATE]`).

## [0.1.0] - 2026-10-16

### Added
- **Zero-Dependency Architecture:** Standalone Node.js CLI with native `node:readline/promises` and `node:test`.
- **4 Multi-Archetypes:**
  - `01-feature`: Phase 0 clarification, Non-Goals, Data Contracts, Rollback (`down.sql`), atomic tasks.
  - `02-bugfix`: Deterministic issue report, Root Cause Analysis (5 Whys SRE standard), Test-First minimal surgery.
  - `03-tech-debt`: Debt categorization, Blast radius, Strangler Fig pattern migration, anti-regression gates.
  - `04-rfc-idea`: MADR architectural decision records with decision drivers and trade-offs.
- **Interactive Wizard (`omni-spec init`):** Guided setup asking for stack, documentation standard, domain profile, database, and test suite.
- **5 Domain Profiles:**
  - `general`: SaaS and general applications.
  - `fintech`: PCI-DSS, idempotency keys, financial ledger invariance.
  - `healthtech`: HIPAA, sensitive PII encryption, patient privacy.
  - `bpo`: k-anonymity (k >= 5), agent journal isolation, occupational health regulations.
  - `ecommerce`: Inventory consistency, checkout idempotency, SEO/catalog.
- **State Machine Manifest (`specs/manifest.json`):** Tracks active spec and history to prevent AI context drift.
- **Automated CI/CD Workflow:** Multi-version testing on Node 18, 20, and 22.
