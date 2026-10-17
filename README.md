<p align="center">
  <img src="assets/omni-spec-banner.svg" alt="OmniSpec Banner" width="100%">
</p>

<p align="center">
  <a href="package.json"><img src="https://img.shields.io/badge/version-0.4.0-blue.svg" alt="Version 0.4.0"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/dependencies-0%20(pure%20node)-green.svg" alt="Zero Dependencies"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D18.19.0-black.svg" alt="Node.js >=18.19.0"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-gray.svg" alt="License MIT"></a>
  <a href=".github/workflows/ci.yml"><img src="https://img.shields.io/badge/build-passing-brightgreen.svg" alt="CI Build Passing"></a>
</p>

<p align="center">
  <strong>A zero-dependency Spec-Driven Development (SDD) framework and CLI for autonomous AI coding agents and human software engineers.</strong>
</p>

---

## Table of Contents

- [Overview & The Problem](#overview)
- [Quick Start](#quick-start)
  - [Option A: AI Agent Guided Adoption (Prompt Setup)](#option-a-ai-agent-guided-adoption-prompt-installation)
  - [Option B: Manual Installation (Human Engineers)](#option-b-manual-installation-human-engineers)
- [Architectural Principles](#architectural-principles)
  - [Zero External Dependencies](#zero-dependencies)
  - [Greenfield & Brownfield Adaptation](#greenfield--brownfield-adaptation)
  - [The Four Engineering Archetypes](#the-four-engineering-archetypes)
  - [State Machine Manifest & Concurrency](#state-machine-manifest--concurrency)
  - [Domain Regulatory Profiles](#domain-regulatory-profiles)
- [Command-Line Interface (CLI Reference)](#command-line-interface)
  - [1. Initialization (`omni-spec init`)](#1-initialization)
  - [2. Creating Specifications (`omni-spec create`)](#2-creating-specifications)
  - [3. Specification Health Auditor (`omni-spec audit`)](#3-specification-quality-audit-anti-hallucination-gate)
  - [4. Lifecycle & Status Management (`status` & `complete`)](#4-inspection-and-lifecycle-management)
  - [5. Version Verification & Upgrades (`check` & `update`)](#5-version-verification--non-destructive-upgrades)
- [AI Agent Integration & Chat Slash Commands (`/omni-*`)](#ai-agent-integration--chat-slash-commands)
- [Architectural Rationale: Node.js vs. Python](#architectural-rationale-nodejs-vs-python)
- [Automated Verification](#automated-verification)
- [Repository Governance](#repository-governance)

---

## Overview

Modern software development with frontier AI coding models suffers from two systemic points of failure:

1. **Hallucination by Ambiguity:** When requirements are underspecified, AI agents fill gaps by silently inventing database columns, APIs, or unneeded third-party libraries.
2. **Context Drift:** Over multi-turn sessions, agents lose alignment with architectural invariants, altering working code outside the task scope or leaving dead artifacts.

OmniSpec introduces **Spec-Driven Development (SDD)**: an engineering contract where specifications are authored, clarified, and audited prior to code implementation.

<p align="center">
  <img src="assets/mermaid-diagram.svg" alt="OmniSpec SDD Architecture" width="100%">
</p>

---

## Quick Start

OmniSpec requires only Node.js (version 18.19 or higher) and can be adopted through two frictionless pathways:

### Option A: AI Agent Guided Adoption (Prompt Installation)

If you are using frontier AI coding agents (Google Antigravity, Cursor, Claude Code, GitHub Copilot, Roo Code), you can bootstrap OmniSpec in any repository with a single conversational prompt.

#### 🇬🇧 English Prompt:
```text
Adopt Spec-Driven Development (SDD) in this repository using OmniSpec:
1. Initialize the framework by running:
   npx github:brahiandres1999-oss/omni-spec init --yes
   (or install locally with `npm i -D github:brahiandres1999-oss/omni-spec` or globally with `npm i -g github:brahiandres1999-oss/omni-spec`).
2. Inspect the newly generated CONSTITUTION.md and specs/manifest.json files.
3. Verify that project quality gates (test runners, linters, and documentation standards) were accurately detected.
4. For all subsequent tasks, strictly follow the SDD lifecycle:
   - Run `npx github:brahiandres1999-oss/omni-spec create <feature|bugfix|debt|rfc> <task-name>`.
   - Complete the generated specification folder under `specs/<id>-<task-name>/`:
     * feature: fill Phase 0 Clarification in `spec.md`, design in `plan.md`, tasks in `tasks.md`.
     * bugfix: reproduction in `bug.md`, 5 Whys RCA in `rca.md`, verification in `fix.md`.
     * debt: blast radius in `audit.md`, strangler strategy in `migration-plan.md`, tasks in `tasks.md`.
     * rfc: decision drivers and trade-offs in `rfc.md`.
   - Run `npx github:brahiandres1999-oss/omni-spec audit` to verify required criteria and completeness.
   - Only start implementing code after `npx github:brahiandres1999-oss/omni-spec audit` outputs [AUDIT PASSED].
```

#### 🇪🇸 Prompt en Español:
```text
Adopta Spec-Driven Development (SDD) en este repositorio usando OmniSpec:
1. Inicializa el framework ejecutando:
   npx github:brahiandres1999-oss/omni-spec init --yes
   (o instálalo localmente con `npm i -D github:brahiandres1999-oss/omni-spec` o globalmente con `npm i -g github:brahiandres1999-oss/omni-spec`).
2. Inspecciona los archivos CONSTITUTION.md y specs/manifest.json recién generados.
3. Verifica que los quality gates del proyecto (pruebas, linters y estándar de documentación) hayan sido detectados correctamente.
4. Para todas las tareas subsecuentes, sigue estrictamente el ciclo SDD:
   - Ejecuta `npx github:brahiandres1999-oss/omni-spec create <feature|bugfix|debt|rfc> <nombre-tarea>`.
   - Completa la carpeta de especificación generada en `specs/<id>-<nombre-tarea>/`:
     * feature: resuelve la Fase 0 de Clarificación en `spec.md`, diseño en `plan.md`, tareas en `tasks.md`.
     * bugfix: pasos de reproducción en `bug.md`, análisis 5 Whys RCA en `rca.md`, verificación en `fix.md`.
     * debt: blast radius en `audit.md`, migración gradual en `migration-plan.md`, tareas en `tasks.md`.
     * rfc: alternativas y justificación en `rfc.md`.
   - Ejecuta `npx github:brahiandres1999-oss/omni-spec audit` para verificar los criterios obligatorios y la ausencia de placeholders.
   - Solo comienza a programar código una vez que `npx github:brahiandres1999-oss/omni-spec audit` apruebe con [AUDIT PASSED].
```

---

### Option B: Manual Installation (Human Engineers)

#### 1. Instant Run via NPX (Zero-Install)
Run OmniSpec directly without permanent installation:
```bash
npx github:brahiandres1999-oss/omni-spec init
```

#### 2. Global CLI Installation
Install OmniSpec globally to make the `omni-spec` binary available anywhere in your terminal:
```bash
npm install -g git+https://github.com/brahiandres1999-oss/omni-spec.git

# Test global installation:
omni-spec version
```

#### 3. Standalone Clone (Zero External Network Overhead)
Clone the repository locally into your machine or tools directory and link it:
```bash
git clone https://github.com/brahiandres1999-oss/omni-spec.git
cd omni-spec
npm link
```

---

## Architectural Principles

### Zero Dependencies
OmniSpec contains zero runtime and development dependencies. It executes exclusively via native Node.js 18.19+ standard libraries (`node:fs/promises`, `node:readline/promises`, `node:test`, `node:assert/strict`). It requires no compilation, virtual environments, or external package installation steps.

### Greenfield & Brownfield Adaptation
OmniSpec automatically detects whether it is running in a blank folder (**Greenfield**) or an existing repository (**Brownfield**). When run in an existing codebase, it inspects your stack (React, Next.js, Express, Python FastAPI/Django, Java Maven/Gradle, Go, Rust) and extracts your existing quality gates (`npm test`, `pytest`, `mvn test`, etc.) directly into `CONSTITUTION.md` without disturbing existing code.

### The Four Engineering Archetypes
Software evolution comprises distinct task profiles. OmniSpec structures changes into four specialized archetypes:

| Archetype | Identifier | Primary Artifacts | Methodological Standard |
| :--- | :--- | :--- | :--- |
| **Feature** | `feature` | `spec.md`, `plan.md`, `tasks.md` | Phase 0 Clarification, Contract-First Design |
| **Bugfix** | `bugfix` | `bug.md`, `rca.md`, `fix.md` | Google SRE 5 Whys Root Cause Analysis |
| **Tech Debt** | `debt` | `audit.md`, `migration-plan.md`, `tasks.md` | Martin Fowler Strangler Fig Pattern |
| **RFC / ADR** | `rfc` | `rfc.md` | MADR (Markdown Architectural Decision Records) |

### State Machine Manifest & Concurrency
Active work is tracked in `specs/manifest.json`. AI agents inspect the manifest upon waking, identifying the active task, assigned Git branch, and completion state to prevent divergence across turns.

To support high-concurrency multi-agent setups without database or daemon dependencies, OmniSpec coordinates processes on the local filesystem using a native [Lamport Bakery Algorithm](docs/locking.md) in `specs/manifest.lock/`:
- **Atomic Manifest Updates:** Writes are staged to temporary files (`manifest.json.tmp.*`) and committed via atomic rename.
- **Dead-Owner Recovery:** Live processes are never timed out arbitrarily; deceased processes (`process.kill(pid, 0)` with `ESRCH`) have their individual claim cleanly reclaimed without corrupting concurrent peers.
- **Ordered Tickets:** Agents choose monotonically increasing tickets to serialize operations cleanly. Read more in [docs/locking.md](docs/locking.md).

### Domain Regulatory Profiles
Industry invariants are injected directly into `CONSTITUTION.md` during initialization:
* **General SaaS:** OWASP Top 10, tenant isolation, structured telemetry.
* **Fintech:** PCI-DSS Level 1 boundaries, double-entry ledger invariance, client-generated `Idempotency-Key` headers.
* **Healthtech:** HIPAA compliance, Protected Health Information (PHI) encryption, immutable audit trails.
* **BPO & Occupational Health:** k-Anonymity ($k \ge 5$) cohort protection, operator private journal isolation, anti-surveillance policies.
* **E-Commerce:** Distributed locks, inventory reservation expiration, zero price-tampering constraints.

---

## Command-Line Interface

### 1. Initialization
Initialize OmniSpec in the root of any repository:

```bash
# Interactive guided terminal setup (auto-detects project stack and gates)
omni-spec init

# Non-interactive initialization with defaults
omni-spec init --yes --profile fintech --stack "Node.js / TypeScript" --doc "TSDoc"
```

Project scaffold created:
```text
my-project/
├── CONSTITUTION.md          <-- Supreme architectural & quality gate rules
└── specs/
    ├── README.md            <-- Specification index & instructions
    ├── manifest.json        <-- Machine-readable state machine
    └── _templates/          <-- Local archetype templates
        ├── 01-feature/
        ├── 02-bugfix/
        ├── 03-tech-debt/
        └── 04-rfc-idea/
```

### 2. Creating Specifications

```bash
# User capability or API expansion
omni-spec create feature user-onboarding

# Incident postmortem and targeted regression fix
omni-spec create bugfix null-pointer-dashboard

# Legacy deprecation or framework migration
omni-spec create debt remove-mock-storage

# Architectural decision record
omni-spec create rfc postgres-vs-clickhouse
```

### 3. Specification Quality Audit (Anti-Hallucination Gate)

OmniSpec includes a programmatic specification health auditor. It verifies that requirements are mathematically sound and unambiguous before any human or AI agent writes code:

```bash
# Audit active specification
omni-spec audit

# Audit specific specification by sequence ID
omni-spec audit 001
```

Verification enforced by `omni-spec audit`:
* **Phase 0 Anti-Hallucination:** Verifies that ambiguity questions in Section 0 have substantive decisions documented (>30 non-whitespace characters outside headings).
* **Comment Stripping:** Strips HTML comments before auditing; commented-out headings cannot bypass requirements.
* **Non-Goals / Scope Creep:** Confirms explicit out-of-scope boundaries are defined.
* **Data Contracts & Rollbacks:** Ensures API payloads, database schema changes, and rollback strategies are documented in `plan.md`.
* **Zero AI-Slop & Placeholders:** Detects unreplaced template tokens (`SPEC-XXX`, `[Rol Autorizado]`, unedited sample questions).
* **Task Checklist Validation:** Parses task checkboxes in `tasks.md` and reports completion percentages (`X/Y tasks, Z%`). Requires at least one actionable task (`- [ ]`).

### 4. Inspection and Lifecycle Management

```bash
# Inspect current project state and active specification
omni-spec status

# Mark a specification as implemented and close active tracking
omni-spec complete 001
```

### 5. Version Verification & Non-Destructive Upgrades

OmniSpec protects brownfield projects by ensuring project configurations, templates, and AI agent skills can be upgraded without ever touching active specifications, in-progress tasks, or custom domain rules in `CONSTITUTION.md`:

```bash
# Check if current project is synchronized with installed OmniSpec CLI version
omni-spec check

# Preview upgrade changes without writing to disk
omni-spec update --dry-run

# Execute non-destructive project upgrade
omni-spec update

# Re-generate or configure multi-agent slash commands (.agents, .cursor, .claude, .kilo)
omni-spec setup-agent
```

---

## AI Agent Integration & Chat Slash Commands

OmniSpec establishes clear guardrails for autonomous agents across the modern 2026 AI coding ecosystem: **Google Antigravity, Cursor, Claude Code, GitHub Copilot, OpenCode, and KiloCode**.

### Universal Chat Slash Commands (`/omni-*`)

Developers and agents can invoke the entire SDD lifecycle directly within the chat interface using native slash commands backed by OmniSpec's deterministic engine:

| Slash Command | Purpose | Underlying Deterministic Action |
| :--- | :--- | :--- |
| **`/omni-specify`** | Author Specification | Scaffolds `specs/<slug>/` and drafts `spec.md` respecting domain regulatory invariants. |
| **`/omni-clarify`** | Phase 0 Gatekeeper | Conducts targeted clarification Q&A (Section 0) to eliminate assumptions before coding. |
| **`/omni-plan`** | Technical Architecture | Drafts `plan.md` with system diagrams, data contracts, and anti-slop guidelines. |
| **`/omni-tasks`** | Task Decomposition | Breaks down architecture into dependency-ordered checkboxes in `tasks.md`. |
| **`/omni-audit`** | Spec Health Audit | Programmatically audits Phase 0, completeness, and quality gates via `omni-spec audit`. |
| **`/omni-implement`** | Surgical Execution | Sequentially implements tasks, runs test gates, and marks completion via `omni-spec complete`. |

### Supported AI Agent Adapters:
- **Google Antigravity / Gemini CLI:** `.agents/skills/omni-*/SKILL.md` (interactive chat dropdown).
- **Cursor:** `.cursor/rules/omni-spec.mdc` (system prompt steering rules).
- **Claude Code:** `.claude/commands/omni-*.md` (custom slash command scripts).
- **GitHub Copilot:** `.github/copilot-instructions.md` (persistent repo guidelines).
- **OpenCode & KiloCode:** `AGENTS.md` and `.kilo/rules/omni-spec.md` + `kilo.jsonc`.

### Operational Protocol for Agents

Agents configured to work within an OmniSpec-enabled repository follow this protocol:

1. **State Discovery:** Read `specs/manifest.json` using `omni-spec status` to identify the active spec.
2. **Phase 0 Audit:** Inspect `spec.md` Section 0. If any requirement, data contract, or boundary is ambiguous, the agent must ask clarification questions before modifying code.
3. **Constitutional Invariance:** Review `CONSTITUTION.md`. Do not introduce patterns, libraries, or side-effects prohibited by domain rules.
4. **Task Execution:** Execute tasks defined in `tasks.md` sequentially following Minimal Touch surgery.
5. **Quality Gates:** Verify all commands declared in `CONSTITUTION.md` pass with zero errors before reporting completion.

---

## Architectural Rationale: Node.js vs. Python

| Metric | OmniSpec (Node.js ESM) | Python-Based Alternatives |
| :--- | :--- | :--- |
| **Installation Friction** | Instant (`node bin/omni-spec.mjs` or `npx`). | Requires Python runtime, `pip`, `venv`, or `pipx`. |
| **Startup Overhead** | Instantaneous execution without compiling (<30ms). | Slower initialization and module import overhead. |
| **Platform Compatibility** | Native POSIX and Windows support without path normalization scripts. | Path and permission discrepancies across Windows/Linux (`python3` vs `py`). |
| **Supply Chain Exposure** | Zero runtime dependencies (`node_modules` empty). | Vulnerable to upstream package supply-chain attacks. |

---

## Automated Verification

The repository includes a comprehensive, zero-dependency test suite executed via the native Node.js test runner:

```bash
npm test
```

Verification covers:
* State machine persistence, updates, and Lamport bakery concurrency.
* Scaffolding, re-initialization safety, and multi-archetype template generation.
* Anti-hallucination auditor validation and comment-stripping defenses.
* CLI arguments, interactive flags, and error boundary handling.

---

## Repository Governance

* [Contributing Guidelines](CONTRIBUTING.md)
* [Changelog](CHANGELOG.md)
* [Manifest Coordination & Locking Documentation](docs/locking.md)
* [MIT License](LICENSE)
