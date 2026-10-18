# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0-rc.1] - 2026-10-18

Public release candidate. Previous local copies labeled `0.5.0` were unpublished development builds; see `docs/RELEASING.md` before migrating them to this prerelease.

### Added
- Per-criterion `acceptance.json` coverage required by verify/complete, separate from general automated gate results. Pending, failed, missing, duplicated and stale criterion IDs block closure; evidence truth still requires agent/human review.
- GitHub release matrix, version/tag validation, packaged assets with SHA-256 and prerelease detection. Optional manually dispatched npm trusted-publisher workflow, plus first-publication and existing-project update instructions.
- Read-only `context-check` for onboarding state, source-conflict section presence and common local Markdown citations; explicit structural-only scope and required semantic source review.
- Project onboarding (`omni-init`) and evidence-based exploration (`omni-discuss`) alongside the seven existing workflows.
- A portable CLI copied into `specs/.omni/runtime/`, plus user-owned project context and a locally resolvable manifest schema.
- Explicit `verify` and `configure` commands. Completion requires valid documents, finished checklists, authored evidence and a fresh successful source/specification snapshot. Manual and RFC decision evidence are labeled separately from executed automated gates.
- Real command adapters for Cursor, Copilot in VS Code, Kilo, OpenCode and Gemini; skills for Antigravity, Claude Code and Codex; generic Markdown fallback.
- Managed-file fingerprints, conflict previews and explicit backed-up replacement with `update --accept-updates`.
- Read-only `inspect`, integrity-oriented `doctor`, JSON outputs and offline installed-package acceptance scenarios.

### Changed
- Semantic version precedence for rc/stable updates; downgrades require explicit `--allow-downgrade`. Package smoke verifies exact current version, temporary-prefix global installation and npm-exec/npx-style invocation.
- Discussion checks current official tool documentation before ruling out alternatives, respects conditional architecture policies and distinguishes source-based UX hypotheses from observed behavior.
- Onboarding reconciles source declarations by module and environment, carries unresolved differences into command prerequisites and the final response, and requires exact attribution for domain policies. Durable citations resolve relative to their document instead of a developer's computer.
- Bare `/omni-init` now carries a bounded reconnaissance contract for empty, existing, broken, mixed and non-code projects: evidence categories, command provenance/cwd/prerequisites, pending validation and explicit context states. Default edits are limited to user-owned project context; application scripts and policy/gate changes are separate actions.
- Bootstrap seeds seven context sections with `CONTEXT_PENDING` / `APPLICATION_NOT_VALIDATED`; `inspect` exposes unexecuted command candidates and declared runtime constraints without inferring installed versions or compatibility. Installation output distinguishes copied files from completed onboarding.
- Unknown/new projects no longer inherit invented Node, npm, pytest or lint defaults. Bounded monorepo detection includes command working directories and reports uncertainty.
- Workflows route by archetype and use project checks. Feature templates no longer impose a database or a fixed 32-task implementation.
- `setup-agent` validates and persists the selected adapters; `check` fails for uninitialized or inconsistent installations.
- Installation/update failures are reported, and required asset writes must finish before the manifest version is advanced. Legacy/custom files are treated conservatively.
- The README describes structural checks, semantic review and executed verification separately. Earlier “zero hallucination” and mathematical-verification claims are not guarantees of this implementation.

### Compatibility
- Local changes only; no tag, commit, remote publication or host-chat certification is implied.
- Existing specification folders and custom constitution/context remain intact on update. Legacy specs need an authored `verification.md`; bugfix closure now requires a checklist in `fix.md`.
- Adapters use each host's documented invocation mechanism; a universal slash syntax is not promised. See `docs/STANDARDS.md` and `docs/VALIDATION-0.5.0.md`.

## [0.4.1] - 2026-10-17

### Fixed & Enhanced
- **Real-World Field Adoption Hardening (Regressions R14–R21):**
  - **Git-style project root discovery:** every command now locates the enclosing OmniSpec project by walking upward to `specs/manifest.json` or `CONSTITUTION.md`, so `status`, `create`, `audit`, and friends work from any subdirectory instead of failing or operating on the wrong folder.
  - **Anti-bootstrap gate:** `create`, `focus`, `complete`, `update`, and `setup-agent` now refuse to run outside an initialized OmniSpec project instead of silently scaffolding a parallel `specs/` universe in arbitrary directories.
  - **Nested universe prevention:** `omni-spec init` inside an already-initialized project is blocked with a clear, actionable error.
  - **Loud wizard EOF handling:** a closed or non-interactive stdin during the interactive wizard now fails with exit code 1 and explicit `--yes` guidance, instead of exiting 0 silently while leaving the project uninitialized.
  - **Windows UTF-8 BOM tolerance:** `package.json` and `manifest.json` saved with a BOM (PowerShell 5.x, Notepad, other Windows tooling) no longer break stack detection or the manifest state machine; the detector now reports fallback warnings instead of failing silently.
  - **Honest template upgrades:** `omni-spec update` now genuinely refreshes `specs/_templates/` — the previous internal path pointed at a nonexistent folder and silently skipped the copy while still reporting success.
  - **Published `schema/manifest.schema.json`:** manifests now reference a schema that actually exists; `omni-spec update` migrates stale `$schema` URLs from the previous dead link.
  - **Spanish-friendly slug transliteration:** `create feature "Gestión Usuarios"` produces `001-gestion-usuarios` instead of the mangled `001-gesti-n-usuarios`.
  - **Dynamic help version:** `omni-spec help` prints the installed version instead of a hardcoded release number.
- **Selective Agent Integration (`src/integrations.mjs`):**
  - Eliminated repository pollution: OmniSpec now selectively generates integration files for the specific target agent instead of cluttering repositories with multiple unused AI assistant directories.
  - Supported targets: `antigravity` (default, `.agents/skills/omni-*/SKILL.md`), `cursor` (`.cursor/rules/omni-spec.mdc`), `claude` (`.claude/commands/omni-*.md`), `copilot` (`.github/copilot-instructions.md`), `kilo` (`.kilo/rules/omni-spec.md`, `kilo.jsonc`, `AGENTS.md`), and `all`.
- **Target Agent Flag & Configuration (`src/cli.mjs`, `src/wizard.mjs`, `src/manifest.mjs`):**
  - Added `--agent` and `--ai` CLI flags to `omni-spec init`.
  - Added optional agent argument to `omni-spec setup-agent [agent]`.
  - Persisted target `agent` in `manifest.json`.
  - `omni-spec update` non-destructively respects the project's configured agent.
- **AI-Guided Conversational Initialization (`OmniInit`):**
  - Seamless IDE-agent workflow enabling developers to initialize OmniSpec directly through chat (e.g., asking the AI to install or configure OmniSpec), running background scaffolding without manual terminal friction.

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
