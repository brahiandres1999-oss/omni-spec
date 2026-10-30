# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.1] — 2026-10-30

Official patch release on npm `latest` channel and GitHub Releases. See the [0.8.1 release notes](docs/releases/0.8.1.md).

### Changed
- **TUI Visual Modernization & Dual-Tone Wordmark (Spec 024):** Replaced 3D isometric polygon ray-casting in `src/terminal-ui.mjs` with a clean, 6-line standard FIGlet ASCII banner in corporate Dual-Tone (`Omni` in blue, `Spec` in amber, version in muted).
- **Interactive Terminal Ergonomics:** Reduced vertical header consumption from 27 rows to 6 rows (8 rows with margins and slogan), keeping 75%+ of the terminal viewport available for interactive wizard prompts in Windows PowerShell, CMD and Unix terminals.
- **Responsive Viewport Treshold:** Adjusted banner threshold to `columns >= 52` and `logoRoom >= 6`, preserving concise single-line fallback for narrow screens.

## [0.8.0] — 2026-10-30

Official stable release on npm `latest` channel and GitHub Releases. See the [0.8.0 release notes](docs/releases/0.8.0.md).

### Added
- **Pillar 6: MDD (Memory Distillation Driven) & Context FinOps (Spec 023):** Deterministic budget metrics exposed in CLI (`context-check`) and auditor, saving >70% of LLM tokens per prompt turn via dense 5-epoch index distillation.
- **Claude Code Native Fallback Synchronization:** Synchronized `CLAUDE.md` managed section in the `claude` host adapter, ensuring Claude Code reads OmniSpec constitution when a project-level `CLAUDE.md` is present.
- **Bun Runtime Compatibility:** Unattended execution via `bunx omni-spec` verified by recognizing Bun runtime environment in `assertInstallationRuntime`.
- **Ecosystem Interoperability (Spec 022):** Formal EARS acceptance criteria guidance in RFC template, verification of prompt budgets across all 10 canonical adapters, and native `AGENTS.md` support for modern agentic tools (Cline, Roo Code, Aider, Windsurf).

## [0.8.0-preview.3] — 2026-10-29

Prepared for the npm `preview` channel and a GitHub prerelease. npm `latest` remains `0.6.1`. See the [Preview 3 notes](docs/releases/0.8.0-preview.3.md).

### Added
- **Modern Package Manager & Lockfile Detection (Spec 019):** Added support for Bun binary lockfile (`bun.lockb`) alongside `bun.lock`, and modern Python tooling (`uv.lock`) with automated command candidate generation (`uv run pytest`, `uv run ruff check .`).
- **Modern Frontend Framework Recognition (Spec 019):** First-class environment detection for Astro, Svelte (`@sveltejs/kit` / `svelte`), and Nuxt in `detector.mjs`, with automatic wizard preset mapping in `findPresetIndex` to standard documentation conventions (`TSDoc` / `JSDoc`).
- **Expanded Context Inputs Tracking (Spec 020):** Native context baseline tracking for modern lockfiles (`uv.lock`, `bun.lock`, `bun.lockb`), linter/tool configs (`biome.json`, `biome.jsonc`, `components.json`), and config patterns (`eslint.config.*`, `tailwind.config.*`, `postcss.config.*`) in `project-state.mjs`.
- **Default Snapshot Ignore for Astro (Spec 021):** Included `.astro/` in `DEFAULT_IGNORE_PATTERNS` in `snapshot.mjs` to prevent ephemeral cache and collection files from invalidating verification fingerprints.

### Fixed
- **Verification Acceptance Timeout Resiliencia (Spec 021):** Increased acceptance test timeout to prevent transient I/O and antivirus timeouts during intensive Windows temp directory operations.

## [0.8.0-preview.2] — 2026-10-29

Prepared for the npm `preview` channel and a GitHub prerelease. npm `latest` remains `0.6.1`. See the [Preview 2 notes](docs/releases/0.8.0-preview.2.md).

### Behavioral Changes
- **Zero-Slop Protocol & Quality Guard (Spec 016):** Built-in enforcement across templates and agent skills of the 5 engineering craft rules: Minimal Touch (code surgery), Strict YAGNI, No Parrot Comments, Fail-Fast (no swallowed exceptions or silent nulls), and Anti-Cliché UI.
- **Dynamic Spec Triage & Adaptive Scaffolding (Spec 017):** Dynamic spec initialization via `create --light` or `create --preset <light|standard|full>`. Triage escalates or adapts spec files and tasks based on scope, risk, touched files, contract crossing, and existing test coverage.
- **Streamlined `omni-init` & UI Design Guardian (Spec 018):** `init` wizard streamlined by removing companion interrogation and focusing strictly on component kit selection (`--ui-components`) when UI signals exist. Visual guidelines in `guide design` mandate the 4 interactive states (Loading, Empty, Error, Protected).

### Added
- **EARS Requirements Syntax Standardization (Spec 016):** Formal adoption of the Easy Approach to Requirements Syntax (`[Ubiquitous]`, `[Event-driven]`, `[State-driven]`, `[Unwanted behavior]`, `[Optional feature]`, `[Complex]`) in acceptance criteria across all spec templates.
- **Dynamic Spec Creation & CLI Presets (Spec 017):** Added `--preset`, `--route`, `--files`, `--risk`, `--crosses-contract`, and `--existing-tests` flags to `omni-spec fit` and `omni-spec create`, enabling one-shot triage evaluation and light spec scaffolding with fail-fast validation.

### Removed
- **Third-Party UI Companions (Spec 015):** Completely removed external UI companion catalogs and `--ui-companion` CLI flag from core runtime. Replaced with clean component kit selection (`--ui-components`) and bundled zero-dependency design guidance (`guide design`).

### Fixed
- **CLI Flag Parsing & Fit Route Validation:** Fixed boolean flag parsing for `--crosses-contract` and `--existing-tests`, added fail-fast validation for `--preset` and `--route`, and prevented unhandled `TypeError` crashes during invalid triage routes.

## [0.8.0-preview.1] - 2026-10-28

Published on the npm `preview` channel. npm `latest` remains `0.6.1`. See the [Preview notes](docs/releases/0.8.0-preview.1.md).

### Behavioral Changes
- **Lean constitution & modular reference guides:** New initializations receive a concise constitution referencing bundled modular procedures (`guide setup`, `guide design`, `guide evidence`). Existing projects preserve their `CONSTITUTION.md` upon `update` and receive `specs/.omni/reference/CONSTITUTION.md` for review.
- **Git-ignored runtime & non-destructive update restoration:** `specs/.omni/runtime/` is added to the managed section of `specs/.gitignore`. `update` restores or updates local runtime entries to match the manifest version and prunes obsolete entries; existing tracked files stay in the Git index until explicitly untracked with `git rm -r --cached specs/.omni/runtime`.
- **Compact `status --json` & scoped readSet:** Omit acceptance criteria of non-active specs and closed decisions from default JSON output to preserve agent context budget, reporting count in `progress.omitted`. Use `--all` to retrieve complete structures. `readSet` enumerates active files according to the spec route.
- **`CONTEXT_INPUTS_V3` baseline:** Platform-independent line ending (CRLF/LF) normalization for watched text context inputs, preventing spurious stale context reports across operating systems. A 0.7.x CLI treats V3 as legacy and can re-record V2; use the same OmniSpec version across the team.

### Added
- **Antigravity plugin coexistence diagnosis & choice (Spec 012):** Read-only coexistence diagnosis in `doctor` and `plugin install/update`, warning of potential command duplication without altering health or exit codes. The `init` wizard offers informed interactive selection between Project Mode (`antigravity`) and Plugin Mode (`plugin`) when Antigravity is chosen alone; multi-tool configurations preserve local adapters with informational notices.
- **Context token economy & active contracts (Spec 008):** Add `contracts --active` and enforce character limits on prompts to maintain context economy on compact LLM windows.
- **Observability & UI art-direction standards (Spec 010):** Mandatory Observability section in `plan.md` and `fix.md` templates; 5-state experience matrix in `spec.md` (§4); art-direction contract and token constraints in `guide design`.
- **Development tarball packaging:** Add `npm run pack:dev` producing `<version>+dev.<timestamp>` tarballs (Spec 002).
- **Automated `release-check` gate:** Catalog check enforcing version metadata, documentation parity and empty runtime dependencies.

### Changed
- **CI test matrix expansion:** Include Node.js 26.x and `next/**` branch triggers in GitHub Actions workflow (Spec 003).
- **RFC acceptance schema flexibility:** Support explicit `DECISION` rows alongside `AC-n` criteria in RFC archetype specifications (Spec 005).
- **Documentation refresh:** Synchronize README, banner, CONTRIBUTING, and `docs/` guidelines with `0.8.0-preview.1` preview status and mark `0.7.0-preview.2` as published on 2026-10-24.

### Fixed
- **Coexistence workflow corrections:** Interactive agent flags retain mode choice; both terminal interfaces explain mixed-tool coexistence. Invalid choices are retried, project diagnosis precedes global plugin replacement, and only regular local skill files count.
- **Plugin bundle completeness:** Include schema files and license during `plugin install`; attempt to remove the incomplete target on copy failure. Installation replaces the old target and copies items sequentially, without an atomic swap (Spec 006).
- **Non-destructive test teardown:** Clean up temporary directories on successful `package-smoke` runs while preserving failures for inspection (Spec 002).
- **Future version downgrade test isolation:** Prevent test failures when running against major versions ahead of current release (Spec 004).

## [0.7.0-preview.2] - 2026-10-24

Supersedes the failed `v0.7.0-preview.1` tag without rewriting it. No npm package or GitHub prerelease was published for that first tag. npm channel remains `preview`; `latest` stays on 0.6.1.

### Fixed
- Keep embedded double asterisks within one directory: `a**/b` excludes `a/b` and `ax/b`, while `a/x/b` remains in verification snapshots. Only a complete globstar segment such as `a/**/b` crosses directories. Add a platform-independent regression and recognize the exact legacy Git oracle result without weakening the documented matching contract.

## [0.7.0-preview.1] — Preview (publication pending)

Prepared for the npm `preview` channel and a GitHub prerelease. npm `latest` remains `0.6.1` (checked 2026-10-23). See the [Preview notes](docs/releases/0.7.0-preview.1.md).

### Changed
- Add a zero-dependency terminal installer with OmniPage's isometric logo geometry and colors sampled at responsive character densities, keyboard selection, multi-select, cancellation, scrollable details and grouped results. Preserve plain/pipe/JSON output, `--plain` and `NO_COLOR`; restore raw input without breaking subsequent ConPTY writes on Windows.
- Install the Antigravity workspace auditor with sandbox policy and retain a portable review role for other hosts. Replace duplicated onboarding fallback text with a short entry pointing to the installed skill; generic prompts remain complete. Clean preserves user agents and updates the entry when moving to plugin mode.
- Rework `init` as one installation journey for every experience level: choose language and AI tool, confirm the destination, defer engineering questions to the agent, and preserve explicit CLI declarations. Automation without a selected host uses generic prompts rather than assuming Antigravity.
- Check managed-file integrity and local runtime version before reporting installation readiness. Every installation includes `specs/commands/omni-init.md` as a recovery path when the host does not discover skills. Report discovery and project onboarding as pending, and preserve active work on reinitialization.
- Explain npm's `--yes` versus OmniSpec's `init --yes`, retry invalid answers, and exit without installation on EOF/cancellation. Reject home/root destinations, nested OmniSpec installations and version migrations through init; retain the update preview path.
- Align public documentation with 0.7.0 Preview's release status, correct the workspace tree and banner, and keep local session reports and obsolete generated diagrams outside version control.

## [0.7.0-rc.2] - 2026-10-22

### Fixed
- Exclude generated outputs from the verification snapshot: root and nested `.gitignore`, `.git/info/exclude`, an optional `.omnispecignore` (gitignore syntax, evaluated last) and default cache/report/editor locations such as `test-results/`, `playwright-report/`, `.gradle/`, `.idea/` and `.vscode/`. A zero-dependency matcher is checked against `git ls-files --exclude-standard`. Previously any check writing a report (for example Playwright's `test-results/.last-run.json`) made every verification fail.
- Report the exact files that changed while checks ran, with a `VERIFICATION_SOURCE_CHANGED` blocker and remediation, instead of a generic check failure.
- Limit context staleness to context inputs: `project-context.md`, files it links, build/dependency/runtime manifests, CI and agent instruction files (excluding the OmniSpec-managed section of `AGENTS.md`). Source edits, IDE files and ignored paths no longer stale context. Legacy full-tree baselines are compared only on current inputs and still detect deleted inputs.
- Run checks under a dedicated verification lock instead of the manifest lock, so state commands no longer time out during long checks; `complete` refuses to race a running verification. Lock timeouts name the busy resource.
- Keep a history of recorded sessions so earlier agent UI observations remain attributable; match observations to the session whose window contains them, at second precision.
- `clean` removes only unmodified OmniSpec-managed runtime and `omni-*` skill files; it preserves user skills, unregistered files and backups, rejects crafted registry paths and refuses adapters that need the local runtime. Modified managed files block unless `--accept-updates` backs them up.
- `init --yes` no longer adopts detected scripts as quality gates; they remain `NOT_RUN` candidates in the context command matrix.
- Retry atomic renames on transient Windows `EPERM`/`EBUSY`/`EACCES` (OneDrive, antivirus) for the manifest, state, registry, contracts, checks and lock tickets.
- Treat CRLF checkouts of managed files as unchanged.
- The interactive wizard keeps answers piped before each prompt and keeps its prompt while editing in a terminal.
- Follow in-project file symlinks (for example `CLAUDE.md -> AGENTS.md`) by content; directory and external symlinks are still refused unless ignored. Symlinked ignored directories such as `node_modules` are skipped.
- Make the timeout regression test robust to zombie processes in containers without an init reaper.

### Added
- `guide evidence`: exact JSON shapes for fit, checks, acceptance, sessions and decisions, and where to keep input files.
- `--from -` reads JSON from stdin; `--from` accepts files outside the project.
- Managed `specs/.gitignore` section (`# OMNI-SPEC-START/END`) for local state: verification logs, backups, inputs, locks and temporary files.
- `update` writes `specs/.omni/reference/CONSTITUTION.md` and reports when a preserved constitution differs from current guidance.
- `fit` prints the exact `fit.json` path and an example with `schemaVersion: 2`.

### Changed
- Verification records use version 3: portable relative `checkCwd`, locale-independent ordering, `changedDuringVerification` and `attestedFiles`. Earlier records require a fresh `verify`.
- Ignore matching is case-sensitive on every platform so a snapshot recorded on one OS verifies on another. Ignore files in parent directories are not read, so an enclosing repository cannot disable attestation.
- The feature template is fully English and documents `AC-01 [kind]` tags; Spanish template headings remain accepted by the auditor and profile injection.
- Behavior-evaluation fixtures are prepared in the system temporary directory by default.

## [0.7.0-rc.1] - 2026-10-22

### Added
- Structured delivery state and blockers, context baselines/history, scoped decisions and observed session capabilities.
- Typed UI acceptance evidence, module check catalogue with complete bounded logs, and bundled design/setup guides.
- Versioned capability contracts and risk-aware fit v2, preserving legacy routes and data.
- Synthetic product lifecycle evaluation and Windows/Linux validation; local pilot candidate only.

### Fixed
- Require automated acceptance criteria to reference configured check commands and bind them to current execution results; reject failed, missing or unexecuted checks at completion. Verification records now use version 2 and older records require a fresh run.
- Bound timeout cleanup even when process-tree termination fails or inherited pipes remain open; record an explicit cleanup error instead of holding the verification lock indefinitely.
- Do not classify JavaScript as TypeScript merely because Node type declarations are installed; recognize named tsconfig files.
- Respect light/standard artifact requirements during audit for feature and debt specs. Optional templates remain on disk without blocking the selected route; promoting to full audits them again.
- Follow the selected route in the implementation workflow instead of always requiring a task checklist.
- Include nested specification evidence in verification fingerprints, with the same file/byte limits and symlink rejection as source files. Only the active spec's root verification.json is excluded from its evidence tree.

### Changed
- Bound onboarding discovery to application evidence and the authorized context edit; avoid reading validator internals or repeatedly hashing generated runtime copies merely to produce a report.
- Add local preparation of synthetic behavioral-evaluation fixtures, external rubrics, workflow fingerprints and pre-run file baselines. Preparing fixtures does not execute models or certify their behavior.
- Share setup, question, technology-selection, API-documentation and contextual UI protocols across generated constitutions and workflows. Generate the plugin rule from the same policy as host adapters.
- Replace mandatory visual recipes and first-attempt guarantees with proportional design, relevant references and actual rendered/interaction evidence. Seed unresolved setup decisions explicitly; bootstrap does not initialize Git or authorize publication.
- Show criterion coverage separately from gate execution in verify/complete output, preserve bindings for automated criteria in completed manifest entries, and distinguish those results from declared manual evidence and assertion adequacy.
- Clarify README guarantees and snapshot limitations. The fingerprint coverage change requires a fresh verify before completing work verified by an earlier version.

## [0.6.1] - 2026-10-21

### Added
- Native Antigravity Plugin Manager commands: `npx omni-spec plugin install`, `update`, and `status` to deploy clean ~180 KB plugin bundles directly to `~/.gemini/config/plugins/omni-spec/` without git clone or repository slop.
- Zero-Bloat project mode: support `"agent": "plugin"` in `specs/manifest.json`, decoupling the CLI engine from user repositories and keeping projects free of `.agents/` or `specs/.omni/runtime/` folders.
- Safe project clean/migration command: `npx omni-spec clean [--dry-run]` to safely strip legacy in-repo runtimes and `.agents/skills` while preserving 100% of specifications and context.
- Dedicated unit test suite `test/plugin-manager.test.mjs` verifying clean plugin installation, version detection, and non-destructive project cleaning.

### Changed
- Updated all 9 official skills in `src/workflows.mjs` to resolve CLI execution dynamically: Global Plugin CLI -> Project Local CLI (legacy) -> `npx omni-spec`.
- Synchronized Antigravity plugin installation guides and official website copy (`OmniPage`) to use `npx omni-spec plugin install`.

## [0.6.0] - 2026-10-20

### Added
- Native Google Antigravity Plugin manifest `plugin.json` supporting modular namespaced installation and suggested prompts (`/omni-init`, `/omni-discuss`, `/omni-specify`).
- Local plugin synchronization script `scripts/sync-plugin.mjs` exposed via `npm run sync:plugin` to link OmniSpec directly into `~/.gemini/config/plugins/omni-spec/`.
- Pre-built plugin directory assets (`rules/AGENTS.md`, `agents/omni-auditor.md`, `skills/`) generated and maintained via `scripts/build-plugin-skills.mjs`.
- Autonomous quality auditor subagent `omni-auditor` (`agents/omni-auditor.md` and `src/agents/omni-auditor.md`) for independent criteria verification, gate validation, and zero-slop enforcement in a dedicated context window.
- UI & Interaction Design section in `src/templates/01-feature/plan.md` to formalize spacing tokens, typographic hierarchy, and the 4 mandatory interface states before implementation.

### Changed
- Authorized read-only test execution and terminal log inspection in `/omni-plan` for `02-bugfix` to establish empirical root cause before authoring `rca.md`, eliminating speculative analysis delay.
- Updated release, compatibility, and onboarding documentation to version 0.6.0 across all guides and branding assets.

## [0.5.1] - 2026-10-19

### Fixed
- Eliminate first-pass AI slop across backend, frontend, and specification generation without requiring corrective follow-up iterations.
- Instate Backend Pragmatic Craft in `CONSTITUTION.md`: strict YAGNI against premature abstractions, zero comment slop (forbidding obvious parrot comments), and fail-fast requirements (banning blind defensive `try/catch` error swallowing).
- Elevate UI Ergonomics in `CONSTITUTION.md` to Impeccable-grade Frontend Craft: strict prohibition of AI visual clichés (ungrounded gradients, card-itis, glowing pill badges), deliberate whitespace and typography scale, interactive micro-interactions, WCAG AA measured contrast, and 4 mandatory interface states (*Loading, Empty, Error, Protected*).
- Enforce first-pass precision and high information density across universal skills in `src/workflows.mjs` (`common`, `omni-plan`, `omni-tasks`, `omni-implement`, `omni-converge`) and persistent agent rules in `src/integrations.mjs`.

## [0.5.0] - 2026-10-18

### Changed
- Publish the normal 0.5.0 release on GitHub; npm remains a separate pending publication.
- Restore the README banner, badges and navigation; retain current usage instructions.
- Remove internal baseline/iteration reports from the current repository tree and use a concise compatibility reference.
- Restrict package documentation to maintained user guides and include branding assets.
- Document and verify content-based migration of development copies already labeled 0.5.0, preserving completed specifications and authored context.

## [0.5.0-rc.1] - 2026-10-18

Release candidate distributed initially through the private GitHub repository; npm publication is separate and pending maintainer account setup. Previous local copies labeled `0.5.0` were unpublished development builds; see `docs/RELEASING.md` before migrating them to this prerelease.

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
- The initial local implementation did not imply host-chat certification; the rc was subsequently published on GitHub.
- Existing specification folders and custom constitution/context remain intact on update. Legacy specs need an authored `verification.md`; bugfix closure now requires a checklist in `fix.md`.
- Adapters use each host's documented invocation mechanism; a universal slash syntax is not promised. See `docs/STANDARDS.md` and `docs/COMPATIBILITY.md`.

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
