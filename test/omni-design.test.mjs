import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseColor,
  calculateConcentricRadius,
  evaluateContrastPair,
  generateDtcgTokenScaffold,
  validateDesignTokens,
  inspectUiSource,
  uiSlopFindings,
  getDesignLens,
  listDesignLenses,
  inspectSpecDesignGrill,
} from '../src/design/index.mjs';
import { scaffoldProject, createSpec } from '../src/generator.mjs';
import { auditSpec } from '../src/auditor.mjs';

const CLI = fileURLToPath(new URL('../bin/omni-spec.mjs', import.meta.url));

describe('Omni-Design 0.10.0: Mathematical Color, Contrast, Concentric Geometry & DTCG 2025.10 Token Engine', () => {
  test('parses #hex, rgb(), hsl() and oklch() and computes accurate WCAG 2.2 contrast ratios', () => {
    const slate = parseColor('#0f172a');
    const white = parseColor('#ffffff');
    assert.equal(slate.hex, '#0F172A');
    assert.equal(white.hex, '#FFFFFF');
    assert.ok(slate.oklch.L < 0.25);
    assert.ok(white.oklch.L > 0.99);

    const highContrast = evaluateContrastPair('#0f172a', '#ffffff', { role: 'normal-text' });
    assert.equal(highContrast.passed, true);
    assert.ok(highContrast.ratio >= 15);
    assert.equal(highContrast.wcagLevel, 'AAA');

    const lowContrast = evaluateContrastPair('#94a3b8', '#f8fafc', { role: 'normal-text' });
    assert.equal(lowContrast.passed, false);
    assert.ok(lowContrast.ratio < 4.5);

    const oklchPair = evaluateContrastPair('oklch(0.21 0.03 260)', 'oklch(0.98 0.005 260)', {
      role: 'normal-text',
    });
    assert.equal(oklchPair.passed, true);
    assert.ok(oklchPair.oklchDeltaL > 0.7);
  });

  test('computes concentric border radii r_inner = max(0, r_outer - padding)', () => {
    assert.equal(calculateConcentricRadius(12, 4), 8);
    assert.equal(calculateConcentricRadius(10, 4), 6);
    assert.equal(calculateConcentricRadius(6, 8), 0);
  });

  test('generates valid DTCG 2025.10 token scaffolds for all 6 Omni-Design archetypes', () => {
    for (const archetype of [
      'precision-dark',
      'swiss-editorial',
      'high-density-ops',
      'warm-craft',
      'clinical-clarity',
      'atmospheric-minimal',
    ]) {
      const scaffold = generateDtcgTokenScaffold(archetype);
      const report = validateDesignTokens(scaffold);
      assert.equal(report.valid, true, `${archetype} failed: ${report.errors.join('; ')}`);
      assert.equal(report.warnings.length, 0, `${archetype} warnings: ${report.warnings.join('; ')}`);
      assert.equal(report.summary.fontFamilies, 3);
      assert.equal(report.summary.distinctRadii, 3);
    }
  });

  test('validates DTCG 2025.10 token documents for modular scale, 2+1 fonts, 4px/8px grid, max 3 radii, concentric pairs and contrast pairs', () => {
    const validDoc = generateDtcgTokenScaffold('precision-dark');
    const validReport = validateDesignTokens(validDoc);
    assert.equal(validReport.valid, true, validReport.errors.join('; '));
    assert.equal(validReport.summary.fontFamilies, 3);
    assert.equal(validReport.summary.distinctRadii, 3);
    assert.ok(validReport.summary.measuredScaleRatio >= 1.2 && validReport.summary.measuredScaleRatio <= 1.3);

    const invalidDoc = structuredClone(validDoc);
    invalidDoc.spacing.bad = { $value: '13px' };
    invalidDoc.radii.xl = { $value: '16px' };
    invalidDoc.typography.family.extra = { $value: 'Playfair Display' };
    invalidDoc.$extensions['omni-design'].concentricPairs.push({
      name: 'Mismatched inner radius',
      outerRadiusPx: 12,
      paddingPx: 4,
      innerRadiusPx: 12,
    });
    invalidDoc.$extensions['omni-design'].contrastPairs.push({
      name: 'Low contrast muted',
      foreground: '#334155',
      background: '#1E293B',
      role: 'normal-text',
    });

    const invalidReport = validateDesignTokens(invalidDoc);
    assert.equal(invalidReport.valid, false);
    assert.ok(invalidReport.errors.some(e => e.includes('TOKEN_SPACING_RHYTHM')));
    assert.ok(invalidReport.errors.some(e => e.includes('TOKEN_RADIUS_BUDGET')));
    assert.ok(invalidReport.errors.some(e => e.includes('TOKEN_FONT_BUDGET')));
    assert.ok(invalidReport.errors.some(e => e.includes('TOKEN_CONCENTRIC_RADIUS')));
    assert.ok(invalidReport.errors.some(e => e.includes('TOKEN_CONTRAST_FAILED')));
  });
});

describe('Omni-Design 0.10.0: Deterministic UI-Slop Guard (14-Rule AST / Lexical Inspector)', () => {
  test('flags all 14 AI cliché, anti-monoculture and ergonomic rules deterministically', () => {
    const slopComponent = `
export function SlopDashboard() {
  return (
    <div className="bg-gradient-to-r from-purple-600 via-indigo-500 to-blue-600 p-6 z-[9999]" style={{ transition: 'all 300ms cubic-bezier(0.34, 1.56, 0.64, 1)', transitionProperty: 'width, height' }}>
      <h1>Supercharge your Next-Gen AI workflow</h1>
      <h2>// 01_SYSTEM_TELEMETRY</h2>
      <span>SYS_ONLINE · NEURAL_ENGINE_ACTIVE</span>
      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
      <div className="border-l-4 border-indigo-500 p-4">Callout</div>
      <div className="backdrop-blur-md bg-white/10 p-2">Glass 1</div>
      <div className="backdrop-blur-md bg-white/10 p-2">Glass 2</div>
      <div className="backdrop-blur-md bg-white/10 p-2">Glass 3</div>
      <div className="backdrop-blur-md bg-white/10 p-2">Glass 4</div>
      <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center">I1</div>
      <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center">I2</div>
      <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center">I3</div>
      <span className="rounded-full bg-slate-800 border px-2 py-0.5">Tag 1</span>
      <span className="rounded-full bg-slate-800 border px-2 py-0.5">Tag 2</span>
      <span className="rounded-full bg-slate-800 border px-2 py-0.5">Tag 3</span>
      <span className="rounded-full bg-slate-800 border px-2 py-0.5">Tag 4</span>
      <div className="rounded-xl border shadow-lg p-4">
        <div className="rounded-xl border shadow-md p-4">
          <div className="rounded-lg border shadow-sm p-4">Nested card-itis</div>
        </div>
      </div>
      <button className="px-4 py-2 outline-none bg-slate-900 text-white">Action</button>
    </div>
  );
}
`;
    const report = inspectUiSource('src/SlopDashboard.tsx', slopComponent);
    assert.equal(report.clean, false);
    const codes = new Set(report.findings.map(f => f.code));
    assert.ok(codes.has('UI_CLICHE_GRADIENT'));
    assert.ok(codes.has('UI_MECHANICAL_HEADER_PREFIX'));
    assert.ok(codes.has('UI_DECORATIVE_PULSE_DOT'));
    assert.ok(codes.has('UI_THICK_LEFT_ACCENT'));
    assert.ok(codes.has('UI_CARDITIS_NESTING'));
    assert.ok(codes.has('UI_FOCUS_SUPPRESSED'));
    assert.ok(codes.has('UI_BANNED_BOUNCE_EASING'));
    assert.ok(codes.has('UI_NON_COMPOSITOR_ANIMATION'));
    assert.ok(codes.has('UI_STATIC_PILL_BADGE'));
    assert.ok(codes.has('UI_RAW_MAGIC_ZINDEX'));
    assert.ok(codes.has('UI_GLASSMORPHISM_ABUSE'));
    assert.ok(codes.has('UI_ICON_CIRCLE_GRID_CLICHE'));
    assert.ok(codes.has('UI_GENERIC_AI_HERO_COPY'));
    assert.ok(codes.has('UI_FAKE_TELEMETRY_LABEL'));
  });

  test('passes clean, accessible, high-craft UI components with focus-visible and single-elevation depth', () => {
    const cleanComponent = `
export function CleanWorkspace() {
  return (
    <section className="bg-slate-950 text-slate-100 p-8 border-b border-slate-800">
      <h2 className="text-xl font-semibold tracking-tight">01. Operational Telemetry</h2>
      <div className="mt-6 rounded-lg border border-slate-800 p-6">
        <p className="text-sm text-slate-400 tabular-nums">99.98% Uptime · 14ms p95</p>
        <button className="mt-4 px-4 py-2 text-xs font-medium bg-slate-100 text-slate-950 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
          Inspect Logs
        </button>
      </div>
    </section>
  );
}
`;
    const report = inspectUiSource('src/CleanWorkspace.tsx', cleanComponent);
    assert.equal(report.clean, true);
    assert.equal(report.findings.length, 0);
  });
});

describe('Omni-Design 0.10.0: On-Demand Lenses, Grill Interrogation & Auditor Contradiction Gate', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omni-design-010-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test('exposes all 8 proprietary OmniSpec lenses with zero external author/skill references', () => {
    const lenses = listDesignLenses();
    assert.equal(lenses.length, 8);
    for (const id of ['grill', 'wayfinder', 'distill', 'bolder', 'quieter', 'polish', 'tokens', 'anti-slop']) {
      const lens = getDesignLens(id);
      assert.equal(lens.id, id);
      assert.ok(lens.content.length > 100);
      assert.doesNotMatch(
        `${lens.title} ${lens.origin} ${lens.phase} ${lens.content}`,
        /pocock|bakaus|impeccable|superpowers|ui-ux-pro-max|anthropic/i,
      );
    }

    const cliOut = JSON.parse(
      execFileSync(process.execPath, [CLI, 'guide', 'design', '--lens', 'grill', '--json'], { encoding: 'utf8' }),
    );
    assert.equal(cliOut.topic, 'design');
    assert.equal(cliOut.lens, 'grill');
    assert.match(cliOut.content, /Matriz Obligatoria de 4\+1 Estados/);
  });

  test('auditSpec blocks when spec.md declares [visual] criteria but plan.md marks UI & Interaction Design as N/A', async () => {
    await scaffoldProject(tempDir, { projectName: 'UiContractApp', profile: 'general' });
    const spec = await createSpec(tempDir, 'feature', 'dashboard-redesign', { full: true });

    await writeFile(
      join(spec.specDir, 'spec.md'),
      `# Dashboard Redesign
## 0. Clarification
The user confirmed a high-density telemetry view for daily operators.
## Acceptance Criteria
AC-01 [visual]: The telemetry table renders without horizontal overflow at 1440px and 375px.
## Non-Goals
No backend schema changes.
`,
    );

    const planPath = join(spec.specDir, 'plan.md');
    const rawPlan = await (await import('node:fs/promises')).readFile(planPath, 'utf8');
    await writeFile(
      planPath,
      rawPlan
        .replace(/\[PLAN-XXX\]/g, 'PLAN-001')
        .replace(/^## UI & Interaction Design\n\[TODO\].*$/m, '## UI & Interaction Design\nN/A: backend only.')
        .replace(/\[TODO\][^\n]*/g, 'Documented for test.'),
    );

    const contradicted = await auditSpec(tempDir, spec.id);
    assert.equal(contradicted.valid, false);
    assert.ok(
      contradicted.errors.some(e => e.includes('UI_DESIGN_CONTRADICTION')),
      contradicted.errors.join('\n'),
    );

    // Now fill in real Art Direction + 4 states in UI & Interaction Design
    await writeFile(
      planPath,
      rawPlan
        .replace(/\[PLAN-XXX\]/g, 'PLAN-001')
        .replace(
          /^## UI & Interaction Design\n\[TODO\].*$/m,
          `## UI & Interaction Design
Arquetipo estético: Precisión Técnica con tokens DTCG reutilizados, escala modular 1.25 y contraste medido 15.8:1.
Estados por superficie:
- Loading: skeleton geométrico con CLS = 0.
- Empty: mensaje explicativo y botón CTA "Crear monitor".
- Error: alerta semántica legible con botón de reintento.
- Protected / Ideal: tabla con tabular-nums y foco visible.`,
        )
        .replace(/\[TODO\][^\n]*/g, 'Documented for test.'),
    );

    const grill = await inspectSpecDesignGrill(tempDir, spec.id);
    assert.equal(grill.contractStatus.contradictsUiCriteria, false);
    assert.equal(grill.contractStatus.hasArchetype, true);
    assert.equal(grill.contractStatus.hasTokens, true);
    assert.equal(grill.contractStatus.allStatesCovered, true);
  });

  test('CLI design contrast, design scaffold, design tokens and design check return proper exit codes and structured JSON', async () => {
    const contrastOut = JSON.parse(
      execFileSync(process.execPath, [CLI, 'design', 'contrast', '#0F172A', '#F8FAFC', '--json'], {
        encoding: 'utf8',
      }),
    );
    assert.equal(contrastOut.passed, true);
    assert.ok(contrastOut.ratio > 14);

    const tokenFile = join(tempDir, 'tokens.json');
    execFileSync(
      process.execPath,
      [CLI, 'design', 'scaffold', '--archetype', 'swiss-editorial', '--output', tokenFile, '--json'],
      { encoding: 'utf8' },
    );
    const tokenValidation = JSON.parse(
      execFileSync(process.execPath, [CLI, 'design', 'tokens', tokenFile, '--json'], { encoding: 'utf8' }),
    );
    assert.equal(tokenValidation.valid, true);

    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(
      join(tempDir, 'src/CleanCard.tsx'),
      'export const CleanCard = () => <div className="rounded-lg border p-6"><button className="focus-visible:ring-2">Save</button></div>;\n',
    );
    const checkReport = await uiSlopFindings(tempDir);
    assert.equal(checkReport.passed, true);
    assert.equal(checkReport.filesChecked, 1);
    assert.equal(checkReport.errorCount, 0);

    // Explicit missing file must fail with UI_FILE_NOT_FOUND
    const missingReport = await uiSlopFindings(tempDir, ['src/DoesNotExist.tsx']);
    assert.equal(missingReport.passed, false);
    assert.ok(missingReport.errors.some(e => e.includes('UI_FILE_NOT_FOUND')));

    // Spoofed focus-visible:outline-none or focus-visible:ring-0 without real ring/outline must be caught
    const spoofedFocus = inspectUiSource(
      'src/SpoofFocus.tsx',
      '<button className="outline-none focus-visible:outline-none focus-visible:ring-0">Save</button>',
    );
    assert.equal(spoofedFocus.clean, false);
    assert.ok(spoofedFocus.findings.some(f => f.code === 'UI_FOCUS_SUPPRESSED'));

    // Invalid contrast role and unknown archetype must throw explicit errors
    assert.throws(
      () => evaluateContrastPair('#000000', '#FFFFFF', { role: 'invalid-role' }),
      /Unsupported contrast role/,
    );
    assert.throws(() => generateDtcgTokenScaffold('non-existent-archetype'), /Unknown Omni-Design archetype/);
    assert.throws(() => parseColor({}), /Unsupported color object format/);
  });
});
