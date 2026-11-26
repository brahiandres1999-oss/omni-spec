import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

/**
 * Omni-Design UI-Slop Guard (Deterministic AST/Lexical Inspector for Frontend Files)
 * Companion to hollow-guard.mjs for .tsx, .jsx, .vue, .svelte, .astro, .css, and .html files.
 *
 * Enforces 14 deterministic anti-slop and anti-monoculture rules:
 * 1. UI_CLICHE_GRADIENT: Generic purple/indigo/blue AI gradients without explicit brand token backing.
 * 2. UI_CARDITIS_NESTING: 3+ nested or tightly stacked card containers with borders and shadows.
 * 3. UI_DECORATIVE_PULSE_DOT: Animated pulsing status dots without semantic aria/role or live data binding.
 * 4. UI_THICK_LEFT_ACCENT: Generic `border-l-4` / `border-l-8` callout stripes on cards.
 * 5. UI_MECHANICAL_HEADER_PREFIX: Code-comment prefixes (`// 01_`, `>_`, `[01] //`) inside headings.
 * 6. UI_FOCUS_SUPPRESSED: `outline-none` or `outline: none` on interactive elements without a replacement `:focus-visible` indicator.
 * 7. UI_BANNED_BOUNCE_EASING: Overshoot/elastic cubic-bezier curves (`y2 > 1.05`) or `animate-bounce` in professional UI.
 * 8. UI_NON_COMPOSITOR_ANIMATION: CSS transitions animating layout properties (`width`, `height`, `margin`, `top`, `left`).
 * 9. UI_STATIC_PILL_BADGE: Excessive static `rounded-full` pill badges (`>= 4` in one component) without interactive/status semantics.
 * 10. UI_RAW_MAGIC_ZINDEX: Arbitrary magic z-index values (`z-[999]`, `z-[9999]`, `z-index: 9999`) outside governed layer scales.
 * 11. UI_GLASSMORPHISM_ABUSE: 4+ stacked containers with `backdrop-blur` + translucent `bg-white/*` or `bg-black/*` ("nuevo slop" cristalino).
 * 12. UI_ICON_CIRCLE_GRID_CLICHE: 3+ repeated icon-in-tinted-circle/box feature cards in a tight block.
 * 13. UI_GENERIC_AI_HERO_COPY: Generic AI marketing copywriting clichés inside headings (`<h1>`–`<h3>`).
 * 14. UI_FAKE_TELEMETRY_LABEL: Decorative sci-fi/pseudo-terminal telemetry strings (`SYS_ONLINE`, `NEURAL_ENGINE_ACTIVE`, etc.).
 */

export const UI_FILE_PATTERN = /\.(?:tsx|jsx|vue|svelte|astro|css|scss|html)$/i;

const CLICHE_GRADIENT_RE =
  /\b(?:bg-gradient-to-(?:r|l|t|b|tr|tl|br|bl)|bg-linear-to-(?:r|l|t|b|tr|tl|br|bl))[^"'\n`]*\b(?:from|via|to)-(?:purple|violet|indigo|fuchsia)-(?:400|500|600|700)\b[^"'\n`]*\b(?:from|via|to)-(?:blue|indigo|purple|violet|pink|cyan)-(?:400|500|600|700)\b/i;

const RAW_CSS_CLICHE_GRADIENT_RE =
  /linear-gradient\([^)]*(?:#8b5cf6|#7c3aed|#6366f1|#a855f7|rgba?\(\s*139\s*,\s*92\s*,\s*246)[^)]*(?:#3b82f6|#ec4899|#06b6d4|#4f46e5)/i;

const DECORATIVE_PULSE_RE =
  /<(?:span|div)\b[^>]*class(?:Name)?=["'{][^"'}]*(?:\b(?:animate-pulse|animate-ping)\b[^"'}]*\brounded-full\b|\brounded-full\b[^"'}]*\b(?:animate-pulse|animate-ping)\b)[^"'}]*["'}][^>]*>\s*<\/(?:span|div)>/i;

const THICK_LEFT_ACCENT_RE = /\bborder-l-(?:4|8|\[[4-9]px\])\b/;

const MECHANICAL_HEADING_RE =
  /<h[1-6]\b[^>]*>\s*(?:\/\/\s*\d+|\/\*\s*\w+|\[\s*0\d\s*\]\s*\/\/|>_+\s*\w+|FEAT_\d+\s*:)/i;

const GENERIC_AI_HERO_COPY_RE =
  /<h[1-3]\b[^>]*>[^<]*(?:\bSupercharge your\b|\bUnleash the power of\b|\bNext-Gen AI\b|\bRevolutionize your\b|\bSeamless workflow\b|\bPotencia tu flujo con IA\b|\bLleva tu [a-záéíóúñ]+ al siguiente nivel\b)[^<]*<\/h[1-3]>/i;

const FAKE_TELEMETRY_RE =
  /\b(?:SYS_ONLINE|NEURAL_ENGINE(?:_ACTIVE)?|QUANTUM_SYNC|CORE_STATUS\s*:\s*NOMINAL|UPLINK_ESTABLISHED|AI_CORE_READY|TELEMETRY_STREAM_ACTIVE)\b/;

const INTERACTIVE_OUTLINE_NONE_RE =
  /<(?:button|a|input|select|textarea)\b[^>]*class(?:Name)?=["'{]([^"'}]*\b(?:outline-none|focus:outline-none)\b[^"'}]*)["'}][^>]*>/gi;

const NON_COMPOSITOR_TRANSITION_RE =
  /\btransition(?:-property|Property)?\s*:\s*[^;}\n]*(?:\bwidth\b|\bheight\b|\bmargin\b|\bpadding\b|\btop\b|\bleft\b)/i;

const BANNED_BOUNCE_BEZIER_RE = /cubic-bezier\(\s*([0-9.-]+)\s*,\s*([0-9.-]+)\s*,\s*([0-9.-]+)\s*,\s*([0-9.-]+)\s*\)/gi;

const MAGIC_ZINDEX_RE = /\bz-\[(?:99\d+|\d{4,})\]|\bz-index\s*:\s*(?:99\d+|\d{4,})\b/i;

const CARD_CONTAINER_RE =
  /<(?:div|section|article|aside)\b[^>]*class(?:Name)?=["'{][^"'}]*\brounded-(?:lg|xl|2xl|3xl)\b[^"'}]*\bborder\b[^"'}]*\bshadow(?:-(?:sm|md|lg|xl|2xl))?\b[^"'}]*["'}][^>]*>/gi;

const GLASSMORPHISM_CONTAINER_RE =
  /<(?:div|section|article|aside)\b[^>]*class(?:Name)?=["'{][^"'}]*\bbackdrop-blur(?:-(?:xs|sm|md|lg|xl|2xl|3xl))?\b[^"'}]*\bbg-(?:white|black|slate-\d+|zinc-\d+)\/(?:5|10|15|20|25|30)\b[^"'}]*["'}][^>]*>/gi;

const ICON_CIRCLE_BOX_RE =
  /<div\b[^>]*class(?:Name)?=["'{][^"'}]*\b(?:w-(?:10|12|14)\s+h-(?:10|12|14)|size-(?:10|12|14))\b[^"'}]*\brounded-(?:full|xl|2xl)\b[^"'}]*\bbg-[a-z]+-(?:500|400|600)\/(?:10|15|20)\b[^"'}]*\bflex\b[^"'}]*\bitems-center\b[^"'}]*\bjustify-center\b[^"'}]*["'}][^>]*>/gi;

const STATIC_PILL_RE =
  /<(?:span|div)\b(?![^>]*(?:onClick|role=["']status["']|aria-live))[^>]*class(?:Name)?=["'{][^"'}]*\brounded-full\b[^"'}]*\b(?:bg-|border\b)[^"'}]*["'}][^>]*>/gi;

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Inspects a single UI source file and returns structured anti-slop findings.
 */
export function inspectUiSource(filePath, rawContent) {
  const content = String(rawContent || '');
  const findings = [];
  const lines = content.split(/\r?\n/);

  // Allow explicit per-file opt-out comment for legitimate brand exceptions
  const allowBrandGradient = /omni-design-allow:\s*brand-gradient/i.test(content);
  const allowBounce = /omni-design-allow:\s*bounce/i.test(content);

  // 1. Check line-by-line patterns
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (!allowBrandGradient && (CLICHE_GRADIENT_RE.test(line) || RAW_CSS_CLICHE_GRADIENT_RE.test(line))) {
      findings.push({
        code: 'UI_CLICHE_GRADIENT',
        severity: 'error',
        line: lineNo,
        message:
          'Degradado cliché de IA (púrpura/índigo/azul) detectado. Usa superficies tonales OKLCH o declara un token de marca explícito.',
      });
    }

    if (THICK_LEFT_ACCENT_RE.test(line) && !/omni-design-allow:\s*left-accent/i.test(line)) {
      findings.push({
        code: 'UI_THICK_LEFT_ACCENT',
        severity: 'error',
        line: lineNo,
        message:
          'Borde izquierdo grueso (`border-l-4` / `border-l-8`) detectado. Usa jerarquía tipográfica o un borde sutil uniforme de 1px.',
      });
    }

    if (NON_COMPOSITOR_TRANSITION_RE.test(line)) {
      findings.push({
        code: 'UI_NON_COMPOSITOR_ANIMATION',
        severity: 'warning',
        line: lineNo,
        message:
          'Animación fuera del compositor (`width`, `height`, `margin`, `top`, `left`). Anima únicamente `transform` y `opacity`.',
      });
    }

    if (!allowBounce && /\banimate-bounce\b/.test(line)) {
      findings.push({
        code: 'UI_BANNED_BOUNCE_EASING',
        severity: 'error',
        line: lineNo,
        message:
          'Animación de rebote (`animate-bounce`) detectada. Usa transiciones de desaceleración suave (`cubic-bezier(0.22, 1, 0.36, 1)`).',
      });
    }

    if (MAGIC_ZINDEX_RE.test(line)) {
      findings.push({
        code: 'UI_RAW_MAGIC_ZINDEX',
        severity: 'warning',
        line: lineNo,
        message:
          'Valor arbitrario de z-index (`999+`) detectado. Define una escala gobernada de capas (`10`, `20`, `30`, `40`, `50`).',
      });
    }

    if (FAKE_TELEMETRY_RE.test(line) && !/omni-design-allow:\s*telemetry/i.test(line)) {
      findings.push({
        code: 'UI_FAKE_TELEMETRY_LABEL',
        severity: 'error',
        line: lineNo,
        message:
          'Etiqueta de telemetría sci-fi decorativa (`SYS_ONLINE`, `NEURAL_ENGINE`, etc.) detectada. Muestra únicamente estados reales del dominio.',
      });
    }
  }

  // 2. Check multi-line / element patterns
  const pulseMatch = DECORATIVE_PULSE_RE.exec(content);
  if (pulseMatch && !/aria-live|role=["']status["']/i.test(pulseMatch[0])) {
    findings.push({
      code: 'UI_DECORATIVE_PULSE_DOT',
      severity: 'error',
      line: lineNumberAt(content, pulseMatch.index),
      message:
        'Punto `animate-pulse` decorativo sin semántica `role="status"` o `aria-live`. Elimina indicadores falsos de telemetría.',
    });
  }

  const headingMatch = MECHANICAL_HEADING_RE.exec(content);
  if (headingMatch) {
    findings.push({
      code: 'UI_MECHANICAL_HEADER_PREFIX',
      severity: 'error',
      line: lineNumberAt(content, headingMatch.index),
      message:
        'Prefijo mecánico de comentario (`// 01_`, `[01] //`, `>_`) dentro de un encabezado visible. Usa numeración tipográfica limpia (`01.`).',
    });
  }

  const heroCopyMatch = GENERIC_AI_HERO_COPY_RE.exec(content);
  if (heroCopyMatch) {
    findings.push({
      code: 'UI_GENERIC_AI_HERO_COPY',
      severity: 'error',
      line: lineNumberAt(content, heroCopyMatch.index),
      message:
        'Frase promocional cliché de IA detectada en encabezado (`Supercharge your...`, `Unleash the power of...`, `Next-Gen AI`). Escribe titulares específicos del dominio y tarea real.',
    });
  }

  // 3. Check suppressed focus outlines without focus-visible replacement
  for (const focusMatch of content.matchAll(INTERACTIVE_OUTLINE_NONE_RE)) {
    const classes = focusMatch[1];
    if (
      !/\bfocus-visible:(?:ring(?:(?=$|\s)|-(?!0(?=$|\s)|none(?=$|\s)))|outline-(?!none(?=$|\s)|0(?=$|\s))|border(?:(?=$|\s)|-(?!0(?=$|\s)|none(?=$|\s))))/i.test(
        classes,
      )
    ) {
      findings.push({
        code: 'UI_FOCUS_SUPPRESSED',
        severity: 'error',
        line: lineNumberAt(content, focusMatch.index),
        message:
          'Elemento interactivo con `outline-none` sin reemplazo `focus-visible:ring-*` o `focus-visible:outline-*` (violación WCAG 2.2 AA).',
      });
    }
  }

  // 4. Check banned bounce/overshoot cubic-bezier curves
  if (!allowBounce) {
    for (const bezierMatch of content.matchAll(BANNED_BOUNCE_BEZIER_RE)) {
      const y1 = Number.parseFloat(bezierMatch[2]);
      const y2 = Number.parseFloat(bezierMatch[4]);
      if (y1 > 1.05 || y2 > 1.05 || y1 < -0.05 || y2 < -0.05) {
        findings.push({
          code: 'UI_BANNED_BOUNCE_EASING',
          severity: 'error',
          line: lineNumberAt(content, bezierMatch.index),
          message: `Curva con sobreimpulso elástico (${bezierMatch[0]}) detectada. Usa desaceleración natural como cubic-bezier(0.22, 1, 0.36, 1).`,
        });
      }
    }
  }

  // 5. Check card-itis (3+ card containers with rounded + border + shadow in a tight 25-line window)
  const cardLines = [];
  for (const cardMatch of content.matchAll(CARD_CONTAINER_RE)) {
    cardLines.push(lineNumberAt(content, cardMatch.index));
  }
  if (cardLines.length >= 3) {
    for (let i = 0; i <= cardLines.length - 3; i++) {
      if (cardLines[i + 2] - cardLines[i] <= 24) {
        findings.push({
          code: 'UI_CARDITIS_NESTING',
          severity: 'error',
          line: cardLines[i],
          message:
            '«Card-itis» detectada (3+ contenedores con borde y sombra anidados o apilados en menos de 25 líneas). Usa espaciado, divisores de 1px o superficie plana.',
        });
        break;
      }
    }
  }

  // 6. Check Glassmorphism Abuse ("Nuevo Slop" cristalino: 4+ backdrop-blur translucent containers)
  const glassLines = [];
  for (const glassMatch of content.matchAll(GLASSMORPHISM_CONTAINER_RE)) {
    glassLines.push(lineNumberAt(content, glassMatch.index));
  }
  if (glassLines.length >= 4) {
    findings.push({
      code: 'UI_GLASSMORPHISM_ABUSE',
      severity: 'error',
      line: glassLines[0],
      message: `Abuso de glassmorphism detectado (${glassLines.length} contenedores con \`backdrop-blur\` + fondo translúcido). Reserva el desenfoque para un único header flotante o modal; usa superficies opacas OKLCH para el contenido.`,
    });
  }

  // 7. Check 3-column Icon-in-Circle Feature Grid Cliché
  const iconBoxLines = [];
  for (const iconBoxMatch of content.matchAll(ICON_CIRCLE_BOX_RE)) {
    iconBoxLines.push(lineNumberAt(content, iconBoxMatch.index));
  }
  if (iconBoxLines.length >= 3) {
    for (let i = 0; i <= iconBoxLines.length - 3; i++) {
      if (iconBoxLines[i + 2] - iconBoxLines[i] <= 48) {
        findings.push({
          code: 'UI_ICON_CIRCLE_GRID_CLICHE',
          severity: 'error',
          line: iconBoxLines[i],
          message:
            'Cliché de rejilla de 3 tarjetas con icono encerrado en círculo/caja tintada detectado. Usa composición asimétrica, numeración tipográfica editorial o evidencia funcional directa.',
        });
        break;
      }
    }
  }

  // 8. Check excessive static pill badges (Zero-Pill Discipline)
  const pillLines = [];
  for (const pillMatch of content.matchAll(STATIC_PILL_RE)) {
    pillLines.push(lineNumberAt(content, pillMatch.index));
  }
  if (pillLines.length >= 4) {
    findings.push({
      code: 'UI_STATIC_PILL_BADGE',
      severity: 'warning',
      line: pillLines[0],
      message: `Exceso de badges estáticos con \`rounded-full\` (${pillLines.length} instancias). Reserva la geometría de píldora para controles interactivos o \`role="status"\`; usa \`rounded-sm\`/\`rounded-md\` en metadatos.`,
    });
  }

  const errors = findings.filter(f => f.severity === 'error');
  const warnings = findings.filter(f => f.severity === 'warning');

  return {
    file: filePath,
    clean: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    findings,
  };
}

export function changedUiFiles(baselineFiles, afterFiles) {
  const before = baselineFiles || {};
  const after = afterFiles || {};
  return Object.keys(after)
    .filter(path => UI_FILE_PATTERN.test(path) && before[path] !== after[path])
    .sort();
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  'specs',
  '.omni',
  '.agents',
  '.claude',
  '.cursor',
  '.gemini',
  '.kilo',
  '.opencode',
  'artifacts',
]);

async function discoverUiFiles(rootDir, currentDir = rootDir, acc = []) {
  const entries = await readdir(currentDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await discoverUiFiles(rootDir, join(currentDir, entry.name), acc);
    } else if (UI_FILE_PATTERN.test(entry.name)) {
      acc.push(relative(rootDir, join(currentDir, entry.name)).replace(/\\/g, '/'));
    }
  }
  return acc;
}

export async function uiSlopFindings(rootDir, files = null) {
  const explicitFiles = Array.isArray(files) && files.length > 0;
  const targetFiles = explicitFiles ? files : await discoverUiFiles(rootDir);
  const results = [];
  const allErrors = [];
  const allWarnings = [];

  for (const relPath of targetFiles) {
    if (!UI_FILE_PATTERN.test(relPath)) {
      if (explicitFiles) {
        allErrors.push(
          `UI_UNSUPPORTED_EXTENSION (${relPath}:1): Extensión no soportada por UI-Slop Guard (.tsx, .jsx, .vue, .svelte, .astro, .css, .scss, .html).`,
        );
      }
      continue;
    }
    const fullPath = resolve(rootDir, relPath);
    const raw = await readFile(fullPath, 'utf8').catch(() => null);
    if (raw === null) {
      if (explicitFiles) {
        allErrors.push(
          `UI_FILE_NOT_FOUND (${relPath}:1): El archivo de interfaz especificado no existe o no se pudo leer.`,
        );
      }
      continue;
    }
    const report = inspectUiSource(relPath, raw);
    results.push(report);
    for (const item of report.findings) {
      const formatted = `${item.code} (${relPath}:${item.line}): ${item.message}`;
      if (item.severity === 'error') allErrors.push(formatted);
      else allWarnings.push(formatted);
    }
  }

  return {
    passed: allErrors.length === 0,
    filesChecked: results.length,
    errorCount: allErrors.length,
    warningCount: allWarnings.length,
    errors: allErrors,
    warnings: allWarnings,
    reports: results,
  };
}
