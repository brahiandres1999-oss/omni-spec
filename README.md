# OmniSpec

A zero-dependency Spec-Driven Development (SDD) framework and command-line interface for human software engineers and autonomous AI coding agents.

[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](package.json)
[![Dependencies](https://img.shields.io/badge/dependencies-0%20(pure%20node)-green.svg)](package.json)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-black.svg)](package.json)
[![License](https://img.shields.io/badge/license-MIT-gray.svg)](LICENSE)
[![CI](https://img.shields.io/badge/build-passing-brightgreen.svg)](.github/workflows/ci.yml)

---

## Overview

Modern software development with frontier AI coding models suffers from two systemic points of failure:

1. **Hallucination by Ambiguity:** When requirements are underspecified, AI agents fill gaps by silently inventing database columns, APIs, or unneeded third-party libraries.
2. **Context Drift:** Over multi-turn sessions, agents lose alignment with architectural invariants, altering working code outside the task scope or leaving dead artifacts.

OmniSpec introduces **Spec-Driven Development (SDD)**: an engineering contract where specifications are authored, clarified, and audited prior to code implementation.

```
                    ┌────────────────────────────┐
                    │      CONSTITUTION.md       │
                    │   Supreme Engineering Law  │
                    └──────────────┬─────────────┘
                                   │
                                   ▼
┌──────────────────┐        ┌──────────────┐        ┌──────────────────┐
│  Phase 0: Clarify├───────►│ Active Spec  ├───────►│  Execution Gate  │
│  (Resolve Gaps)  │        │  (Manifest)  │        │ (Tasks & Checks) │
└──────────────────┘        └──────────────┘        └──────────────────┘
```

---

## Architectural Principles

### Zero Dependencies
OmniSpec contains zero runtime and development dependencies. It executes exclusively via native Node.js 18+ standard libraries (`node:fs/promises`, `node:readline/promises`, `node:test`, `node:assert/strict`). It requires no compilation, virtual environments, or package installation steps, initializing in under 20 milliseconds.

### The Four Engineering Archetypes
Software evolution comprises distinct task profiles. OmniSpec structures changes into four specialized archetypes:

| Archetype | Identifier | Primary Artifacts | Methodological Standard |
| :--- | :--- | :--- | :--- |
| **Feature** | `feature` | `spec.md`, `plan.md`, `tasks.md` | Phase 0 Clarification, Contract-First Design |
| **Bugfix** | `bugfix` | `bug.md`, `rca.md`, `fix.md` | Google SRE 5 Whys Root Cause Analysis |
| **Tech Debt** | `debt` | `audit.md`, `migration-plan.md`, `tasks.md` | Martin Fowler Strangler Fig Pattern |
| **RFC / ADR** | `rfc` | `rfc.md` | MADR (Markdown Architectural Decision Records) |

### State Machine Manifest
Active work is tracked in `specs/manifest.json`. AI agents inspect the manifest upon waking, identifying the active task, assigned Git branch, and completion state to prevent divergence across turns.

### Domain Regulatory Profiles
Industry invariants are injected directly into `CONSTITUTION.md` during initialization:
* **General SaaS:** OWASP Top 10, tenant isolation, structured telemetry.
* **Fintech:** PCI-DSS Level 1 boundaries, double-entry ledger invariance, client-generated `Idempotency-Key` headers.
* **Healthtech:** HIPAA compliance, Protected Health Information (PHI) encryption, immutable audit trails.
* **BPO & Occupational Health:** k-Anonymity ($k \ge 5$) cohort protection, operator private journal isolation, anti-surveillance policies.
* **E-Commerce:** Distributed locks, inventory reservation expiration, zero price-tampering constraints.

---

## Command-Line Interface

### Initialization
Initialize OmniSpec in the root of any repository:

```bash
# Interactive guided terminal setup
omni-spec init

# Non-interactive initialization with defaults
omni-spec init --yes --profile fintech --stack "Node.js / TypeScript" --doc "TSDoc"
```

Project scaffold:
```text
my-project/
├── CONSTITUTION.md
└── specs/
    ├── README.md
    ├── manifest.json
    └── _templates/
        ├── 01-feature/
        ├── 02-bugfix/
        ├── 03-tech-debt/
        └── 04-rfc-idea/
```

### Creating Specifications

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

### Inspection and Lifecycle Management

```bash
# Inspect current project state and active specification
omni-spec status

# Mark a specification as implemented and close active tracking
omni-spec complete 001
```

---

## AI Agent Integration

OmniSpec establishes clear guardrails for autonomous agents (Google Antigravity, Cursor, Claude Code, GitHub Copilot).

### Operational Protocol for Agents

Agents configured to work within an OmniSpec-enabled repository follow this protocol:

1. **State Discovery:** Read `specs/manifest.json` using `omni-spec status` to identify the active spec.
2. **Phase 0 Audit:** Inspect `spec.md` Section 0. If any requirement, data contract, or boundary is ambiguous, the agent must ask clarification questions before modifying code.
3. **Constitutional Invariance:** Review `CONSTITUTION.md`. Do not introduce patterns, libraries, or side-effects prohibited by domain rules.
4. **Task Execution:** Execute tasks defined in `tasks.md` sequentially.
5. **Quality Gates:** Verify all commands declared in `CONSTITUTION.md` pass with zero errors before reporting completion.

---

## Architectural Rationale: Node.js vs. Python

| Metric | OmniSpec (Node.js ESM) | Python-Based Alternatives |
| :--- | :--- | :--- |
| **Installation Friction** | Instant (`node bin/omni-spec.mjs` or `npx`). | Requires Python runtime, `pip`, `venv`, or `pipx`. |
| **Startup Overhead** | ~15 ms cold start. | 150-300 ms module loading. |
| **Platform Compatibility** | Native POSIX and Windows support without path normalization scripts. | Path and permission discrepancies across Windows/Linux (`python3` vs `py`). |
| **Supply Chain Exposure** | Zero runtime dependencies (`node_modules` empty). | Vulnerable to upstream package supply-chain attacks. |

---

## Automated Verification

The repository includes a comprehensive, zero-dependency test suite executed via the native Node.js test runner:

```bash
npm test
```

Verification covers:
* State machine persistence, updates, and concurrency.
* Scaffolding and multi-archetype template generation.
* CLI arguments, interactive flags, and error boundary handling.

---

## Repository Governance

* [Contributing Guidelines](CONTRIBUTING.md)
* [Changelog](CHANGELOG.md)
* [MIT License](LICENSE)
