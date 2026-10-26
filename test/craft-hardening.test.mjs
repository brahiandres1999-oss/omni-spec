import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildConstitutionContent, createSpec, scaffoldProject } from '../src/generator.mjs';
import { auditSpec } from '../src/auditor.mjs';
import { OMNI_SKILLS } from '../src/workflows.mjs';
import { integrationEntries } from '../src/integrations.mjs';
import { updateProject } from '../src/updater.mjs';
import { loadManifest } from '../src/manifest.mjs';
import { profiles } from '../src/profiles/index.mjs';
import { DOCUMENTATION, QUESTIONS, TECHNOLOGY, SETUP, HOST_RULE } from '../src/protocols.mjs';

// One sentence from each paragraph of the former DESIGN policy, now served only by guide design.
const DESIGN_FRAGMENTS = [
  'Distinguish a landing page from an operational tool',
  'research a small set of relevant real interfaces or official design-system examples',
  'No blanket prohibition or mandatory recipe for cards',
  'build a representative rendered surface or interactive prototype',
  'Review applicable normal, focus, loading, empty, error/recovery',
  'Without a suitable inspection tool, mark those checks NOT_VERIFIED',
];
const TECHNOLOGY_INVARIANT =
  'Never select or pin a dependency or runtime version from memory: consult current official sources and the package registry, record the dated sources with the approval or delegation (decision-record), and prefer runtime-native APIs when they suffice. Without web access the choice stays provisional.';

function section(content, number) {
  const start = content.indexOf(`\n## ${number}. `);
  assert.ok(start >= 0, `section ${number}`);
  const end = content.indexOf('\n## ', start + 1);
  return content.slice(start, end < 0 ? undefined : end);
}

function headed(content, heading) {
  const start = content.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, heading);
  const end = content.indexOf('\n## ', start + 1);
  return content.slice(start, end < 0 ? undefined : end);
}

const source = path => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

function assertIncludes(content, phrases, label) {
  for (const phrase of phrases) assert.ok(content.includes(phrase), `${label}: ${phrase}`);
}

describe('Delivery protocol distribution (not a generated-product quality evaluation)', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omnispec-craft-'));
  });

  afterEach(async () => {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {}
    }
  });

  test('buildConstitutionContent includes Backend Craft and Zero Code Slop clauses', () => {
    const content = buildConstitutionContent({ projectName: 'CraftApp', profile: 'general' });
    assert.match(content, /Backend Pragmatic Craft & Zero Code Slop/);
    assert.match(content, /Strict YAGNI & Direct Implementation/);
    assert.match(content, /Zero Comment Slop/);
    assert.match(content, /Fail-Fast & Transparent Failures/);
    assert.match(content, /Zero Spec & Plan Slop/);
  });

  test('every profile constitution keeps its sections and drops the policies served by guides', () => {
    for (const [id, profile] of Object.entries(profiles)) {
      const content = buildConstitutionContent({ profile: id });
      assert.match(
        section(content, 1),
        /Governance & Code Surgery[\s\S]*Pre-Execution Diagnostic[\s\S]*Zero Spec & Plan Slop/,
        id,
      );
      assert.ok(section(content, 2).includes(profile.constitutionInvariants), id);
      assert.match(section(content, 4), /Delivery Quality Gates[\s\S]*# Not configured/, id);
      assert.ok(content.includes('* **Primary Tech Stack:** `Undecided`'), id);
      assert.ok(content.includes('* **Documentation Standard:** `Project conventions`'), id);
      assert.ok(content.includes(DOCUMENTATION), id);
      assert.ok(content.includes(QUESTIONS), id);
      assert.ok(content.includes('## 5. UI Ergonomics & Frontend Craft (Anti-Slop)'), id);
      for (const line of [...TECHNOLOGY.split('\n'), ...SETUP.split('\n')]) assert.ok(!content.includes(line), line);
      for (const fragment of DESIGN_FRAGMENTS) assert.ok(!content.includes(fragment), fragment);
      assert.doesNotMatch(content, /4 Mandatory Interface States|CLS=0|scale-\[0\.98\]/);
    }
  });

  test('constitution keeps a technology invariant and points setup and interface work to guides', () => {
    for (const id of Object.keys(profiles)) {
      const content = buildConstitutionContent({ profile: id });
      const technology = section(content, 3);
      assert.ok(technology.includes(TECHNOLOGY_INVARIANT), id);
      assert.match(technology, /Setup, Git, the commit convention and session capabilities follow guide setup\./, id);
      const ui = section(content, 5);
      assert.match(ui, /Interface work follows guide design/, id);
      assert.match(ui, /Changes without an interface do not load it\./, id);
      assert.doesNotMatch(ui, /scope/i, id);
      assert.ok(!content.includes('specs/.omni/runtime'), id);
    }
  });

  test('update preserves a different constitution and writes the light one as reference', async () => {
    await scaffoldProject(tempDir, { projectName: 'RefApp', profile: 'fintech' });
    const constitution = join(tempDir, 'CONSTITUTION.md');
    const own = '# Our constitution\r\n\r\nKept byte for byte.\r\n';
    await writeFile(constitution, own);
    const result = await updateProject(tempDir, {});
    assert.equal(result.constitution.status, 'PRESERVED_REVIEW_RECOMMENDED');
    assert.equal(result.constitution.reference, 'specs/.omni/reference/CONSTITUTION.md');
    assert.equal(await readFile(constitution, 'utf8'), own);
    const manifest = await loadManifest(tempDir);
    assert.equal(
      await readFile(join(tempDir, result.constitution.reference), 'utf8'),
      buildConstitutionContent({
        projectName: manifest.project,
        profile: manifest.profile,
        stack: manifest.stack,
        docStandard: manifest.documentationStandard,
        qualityGates: manifest.qualityGates,
      }),
    );
  });

  test('scaffoldProject outputs constitution with both backend and frontend craft invariants on disk', async () => {
    const res = await scaffoldProject(tempDir, {
      projectName: 'TestCraftDisk',
      profile: 'general',
    });
    const constitution = await readFile(res.constitutionPath, 'utf-8');
    assert.match(constitution, /Backend Pragmatic Craft & Zero Code Slop/);
    assert.match(constitution, /UI Ergonomics & Frontend Craft/);
  });

  test('workflows distribute relevant policies without making every change repeat full discovery', () => {
    const planSkill = OMNI_SKILLS.find(s => s.name === 'omni-plan');
    const tasksSkill = OMNI_SKILLS.find(s => s.name === 'omni-tasks');
    const implementSkill = OMNI_SKILLS.find(s => s.name === 'omni-implement');

    assert.ok(planSkill);
    assert.ok(tasksSkill);
    assert.ok(implementSkill);

    // Common protocol check
    assert.ok(planSkill.instructions.includes(TECHNOLOGY));
    assert.match(planSkill.instructions, /For interface work run guide design/);
    const planLines = planSkill.instructions.split('\n');
    const observability = planLines.find(line => line.includes('Fill Observability')) ?? '';
    assertIncludes(
      observability,
      ['plan.md or fix.md', 'structured log event, error code or metric', 'acceptance criterion', 'N/A with reason'],
      'omni-plan',
    );
    assert.doesNotMatch(observability, /scope/);
    assert.doesNotMatch(
      planLines.find(line => line.includes('run guide design')),
      /scope/,
    );
    for (const skill of OMNI_SKILLS)
      for (const fragment of DESIGN_FRAGMENTS)
        assert.ok(!skill.instructions.includes(fragment), `${skill.name}: ${fragment}`);
    assert.ok(implementSkill.instructions.includes(DOCUMENTATION));
    assert.ok(tasksSkill.instructions.includes(QUESTIONS));
    assert.match(planSkill.instructions, /Code craft:/i);
    assert.match(planSkill.instructions, /Spec and plan craft:/i);
    assert.match(planSkill.instructions, /UI craft/i);

    // Specific workflow additions
    assert.match(planSkill.instructions, /speculative architecture or unrequested abstraction layers/i);
    assert.match(tasksSkill.instructions, /Avoid task inflation/i);
    assert.match(implementSkill.instructions, /without parrot comments or speculative fallbacks/i);
  });

  test('feature and bugfix templates ask for observability, experience states and art direction', async () => {
    const plan = await source('templates/01-feature/plan.md');
    assert.deepEqual(plan.match(/^## .+$/gm), [
      '## Evidence and existing architecture',
      '## Proposed change',
      '## Contracts and compatibility',
      '## Observability',
      '## Technology, setup and documentation decisions',
      '## UI & Interaction Design',
      '## Verification',
      '## Rollback / recovery',
    ]);
    const observability = headed(plan, '## Observability');
    assert.ok(observability.startsWith('\n## Observability\n[TODO] '));
    assertIncludes(
      observability,
      [
        'structured log event, error code or metric',
        'acceptance criterion',
        'N/A with reason',
        'Never log secrets or personal data',
      ],
      'plan.md Observability',
    );
    const ui = headed(plan, '## UI & Interaction Design');
    assertIncludes(
      ui,
      [
        'art-direction archetype and tokens from guide design',
        'reuse existing ones first',
        'state matrix',
        'Record justified N/A for non-UI work',
        'no universal layout',
      ],
      'plan.md UI',
    );
    assert.doesNotMatch(ui, /fixed state count/);

    const fix = await source('templates/02-bugfix/fix.md');
    assert.deepEqual(fix.match(/^## .+$/gm), [
      '## Minimal change and compatibility',
      '## Regression verification',
      '## Observability',
      '## Tasks',
    ]);
    const signal = headed(fix, '## Observability');
    assert.ok(signal.startsWith('\n## Observability\n[TODO] '));
    assertIncludes(
      signal,
      [
        'would have exposed this defect',
        'structured log event, error code or metric',
        'adds or confirms',
        'N/A with reason',
      ],
      'fix.md Observability',
    );
    assert.doesNotMatch(fix, /--red|red\.json/);

    const experience = section(await source('templates/01-feature/spec.md'), 4);
    assert.ok(experience.startsWith('\n## 4. Experience and limits\n[TODO] '));
    assertIncludes(
      experience,
      [
        'Loading, Empty, Error, Partial/Overflow and Ideal',
        'for each affected surface',
        'N/A and a reason for the rest',
        'Without a user interface: N/A with reason',
      ],
      'spec.md §4',
    );
    assert.doesNotMatch(experience, /mandatory/i);
    assert.doesNotMatch(experience, /^\|/m);
  });

  test('new specs carry the template sections and audit flags an unfilled Observability', async () => {
    await scaffoldProject(tempDir, { projectName: 'ObservabilityApp' });
    const feature = await createSpec(tempDir, 'feature', 'signals');
    const bugfix = await createSpec(tempDir, 'bugfix', 'missing-signal');
    assert.equal(
      section(await readFile(join(feature.specDir, 'spec.md'), 'utf8'), 4),
      section(await source('templates/01-feature/spec.md'), 4),
    );
    assert.match(await readFile(join(bugfix.specDir, 'fix.md'), 'utf8'), /^## Observability\n\[TODO\] /m);

    await writeFile(
      join(feature.specDir, 'fit.json'),
      JSON.stringify({
        schemaVersion: 2,
        reasoning: 'done',
        files: 1,
        modules: 1,
        crossesContract: false,
        ambiguity: 'none',
        existingTests: false,
        risk: 'low',
        uncertainty: 'clear',
        reversibility: 'easy',
      }),
    );
    const planPath = join(feature.specDir, 'plan.md');
    const plan = await readFile(planPath, 'utf8');
    assert.match(plan, /^## Observability\n\[TODO\] /m);
    const [, observability] = plan.match(/^## Observability\n(\[TODO\] .*)$/m);
    await writeFile(
      planPath,
      plan.replace(/^\[TODO\] .*$/gm, line => (line === observability ? line : 'Defined for this test.')),
    );
    const placeholder = 'File plan.md still contains unreplaced placeholder tokens';
    const unfilled = await auditSpec(tempDir, feature.id);
    assert.ok(
      unfilled.errors.some(error => error.includes(placeholder)),
      unfilled.errors.join('\n'),
    );

    await writeFile(
      planPath,
      (await readFile(planPath, 'utf8')).replace(observability, 'N/A: this change emits no runtime signal.'),
    );
    const filled = await auditSpec(tempDir, feature.id);
    assert.ok(!filled.errors.some(error => error.includes(placeholder)), filled.errors.join('\n'));
  });

  test('guide design carries the art-direction contract, one state matrix and measured evidence', async () => {
    const design = await source('resources/design.md');
    assert.deepEqual(design.match(/^## .+$/gm), [
      '## Antes de dibujar',
      '## Contrato de diseño proporcional',
      '## Contrato de dirección de arte (antes de programar)',
      '## De la pantalla al recorrido',
      '## Evidencia de aceptación v2',
      '## Referencias primarias para consultar según alcance',
    ]);
    assertIncludes(
      headed(design, '## Contrato de dirección de arte (antes de programar)'),
      [
        'Los ejemplos usan términos web; en otras plataformas aplica sus equivalentes nativos (estados de interacción, curvas de animación, ajustes de accesibilidad del sistema).',
        '**Arquetipo estético.** Nómbralo y justifícalo con la tarea y las referencias',
        'uno o dos rasgos distintivos y qué vas a evitar',
        'Reutiliza primero los existentes; cada token nuevo necesita un motivo',
        'razón entre 1,2 y 1,333',
        'una o dos familias',
        'al menos dos pesos',
        'base de 4 px y múltiplos de 8',
        'como mucho tres radios',
        'dos o tres niveles de elevación',
        'rampa neutra, un acento intencional y colores semánticos con pares de contraste medidos',
        'de 120 a 240 ms, una curva `cubic-bezier` declarada y respeto de `prefers-reduced-motion`',
        'Loading (carga real), Empty (sin datos), Error (fallo y recuperación), Partial/Overflow (datos incompletos o contenido largo) e Ideal (contenido típico completo), más foco y deshabilitado',
        'Describe cada uno o márcalo N/A con motivo',
        '`:hover`, `:active` y `:focus-visible` diferenciados',
        'Son decisiones y rangos que se registran, no una receta obligatoria. Conserva la identidad y los tokens aprobados',
      ],
      'art direction',
    );
    const journey = design.match(/^Ejercita .*$/m)?.[0] ?? '';
    assertIncludes(
      journey,
      ['matriz de estados de cada superficie', 'validación, recuperación tras error, confirmación y permisos'],
      'journey',
    );
    assert.doesNotMatch(journey, /vacío|carga|foco/);
    assertIncludes(
      headed(design, '## Evidencia de aceptación v2'),
      [
        'Si observa el agente un criterio visual, guarda una imagen de la superficie como artefacto en cada viewport que nombra el criterio (si no nombra ninguno, registra el usado)',
        'una nota de texto del agente no sustituye la imagen',
        'Mide cada par de contraste real con una herramienta que nombras y registra los dos colores, la razón obtenida y el umbral aplicado',
        'afirmar un nivel WCAG sin esa medición no es evidencia',
      ],
      'evidence',
    );
    assert.ok(design.includes('Design Tokens Format Module 2025.10 (DTCG): https://www.designtokens.org/'));
  });

  test('integrationEntries distributes the same project contract into agent configurations', () => {
    const entries = integrationEntries({ version: '0.5.1' }, { agent: 'cursor' });
    const cursorRule = entries.find(e => e.path.endsWith('.cursor/rules/omni-spec.mdc'));
    assert.ok(cursorRule);
    assert.ok(cursorRule.content.includes(HOST_RULE));
    assert.doesNotMatch(cursorRule.content, /Deliver first-pass precision|4 mandatory states/i);
  });
});
