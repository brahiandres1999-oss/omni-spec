# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
