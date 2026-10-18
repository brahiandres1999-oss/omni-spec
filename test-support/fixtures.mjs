import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function fillSpec(root, spec, { pending = false } = {}) {
  const dir = join(root, 'specs', spec.slug);
  await mkdir(dir, { recursive: true });
  const checklist = `- [${pending ? ' ' : 'x'}] AC-01: verify the greeting returns the specified value.\n`;
  const content = {
    feature: {
      'spec.md': '# Greeting\n## 0. Clarification\nThe user confirmed that the greeting must be deterministic and independent of network access.\n## Acceptance Criteria\nAC-01: input Ada produces Hello Ada.\n## Non-Goals\nNo remote calls or persistence.\n',
      'plan.md': '# Plan\n## API Contracts\nThe greet(name) function returns a string.\n## Rollback\nRestore the previous local function if the contract regresses.\n',
      'tasks.md': checklist
    },
    bugfix: {
      'bug.md': '# Bug\nReproduction: call greet with Ada; actual output undefined, expected Hello Ada. AC-01: the greeting returns the specified value.\n',
      'rca.md': '# Root cause\nA missing return statement in the greeting function caused the deterministic reproduction. The source and assertion provide evidence.\n',
      'fix.md': '# Fix\nRestore the return value without changing callers. Regression: assert the exact greeting in the local check.\n' + checklist
    },
    debt: {
      'audit.md': '# Debt\nThe greeting logic is duplicated. AC-01: consolidate the function while preserving the existing return contract for callers.\n',
      'migration-plan.md': '# Migration\nReplace the duplicate helper with the shared function. Verify the greeting assertion before and after; restore the old call if it fails.\n',
      'tasks.md': checklist
    },
    rfc: { 'rfc.md': '# Decision\nKeep the deterministic local greeting. A remote greeting adds unnecessary latency and availability risk.\nDecision: ACCEPTED\n' }
  };
  for (const [name, text] of Object.entries(content[spec.type || 'feature'])) await writeFile(join(dir, name), text);
  await writeFile(join(dir, 'verification.md'), '# Evidence\nAC-01 maps to check.cjs: the local assertion compares the greeting result to Hello Ada. For this fixture, the explicit manual review checks the same deterministic contract. No remote behavior is claimed.\n');
  await writeFile(join(dir, 'acceptance.json'), JSON.stringify({ schemaVersion: 1, criteria: [{ id: spec.type === 'rfc' ? 'DECISION' : 'AC-01', status: 'passed', method: spec.type === 'rfc' ? 'decision' : 'manual', evidence: 'Fixture review compares the specified deterministic greeting to the local check; no UI or remote acceptance is claimed.' }] }, null, 2));
}
