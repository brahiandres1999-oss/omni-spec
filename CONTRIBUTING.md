# Contributing to OmniSpec

Thank you for your interest in contributing to OmniSpec!

## Guiding Principles
1. **Zero External Dependencies:** OmniSpec must remain 100% dependency-free. Do not add third-party npm packages to `dependencies`. Use Node.js built-in modules (`node:fs`, `node:path`, `node:readline`, `node:test`).
2. **Zero Hallucination & Anti-Slop:** Every template, prompt, and feature must be grounded in real-world software engineering practice.
3. **Multi-Archetype Integrity:** Features, bugs, tech debt, and RFCs must maintain their separate, optimized lifecycles.

## Development Workflow
1. Clone the repository.
2. Run the test suite:
   ```bash
   npm test
   ```
3. Ensure all tests pass with zero warnings before opening a Pull Request.
