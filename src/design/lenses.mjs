import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadManifest } from '../manifest.mjs';

export const DESIGN_LENSES = {
  grill: {
    id: 'grill',
    title: 'Omni-Design Lens: Interrogatorio Estructural Pre-Diseño (Grill)',
    phase: 'Fase 0–1 · Interrogatorio y Cierre de Ambigüedad',
    origin: 'OmniSpec Native · Fase 0–1 Interrogatorio Pre-Diseño',
    summary:
      'Interrogatorio arquitectónico previo a escribir HTML/CSS/JSX: resuelve densidad operativa, jerarquía visual, geometría concéntrica y la matriz de 4+1 estados.',
    content: `# Lente Omni-Design: Interrogatorio Pre-Diseño (Grill)

Antes de proponer componentes, escribir JSX/CSS o generar maquetas, el agente debe interrogar el repositorio y cerrar toda ambigüedad material en \`spec.md\` y \`plan.md\` (\`## UI & Interaction Design\`):

## 1. Preguntas de Cierre Obligatorias (Árbol de Decisión)
1. **Tarea Primaria, Frecuencia e Impacto del Error:**
   - ¿Es un flujo operativo diario de alta densidad (requiere velocidad de escaneo, atajos de teclado, contraste calmado y \`tabular-nums\`) o una superficie de descubrimiento/conversión (requiere jerarquía dramática y punto focal único)?
2. **Presupuesto de Viewport y Arquitectura Anti-Islas:**
   - Máximo **4 grupos de componentes distintos** visibles sin hacer scroll.
   - Al menos **25% del viewport** debe permanecer como lienzo abierto (\`canvas\`) o espaciado estructural.
   - Prohibido encerrar toda sección dentro de contenedores redondeados flotantes («islas»). Usa el lienzo base y divisores de \`1px\` (\`hairline grid\`) para estructurar regiones.
3. **Reutilización vs. Creación (Brownfield First):**
   - ¿Qué variables CSS, configuración de Tailwind, tokens DTCG (\`tokens.json\`) o componentes primitivos existen ya en el repositorio? Prohibido introducir un segundo sistema de diseño paralelo.
4. **Matriz Obligatoria de 4+1 Estados por Superficie:**
   - \`Loading\`: Skeletons geométricos con dimensiones reservadas exactas (**Cumulative Layout Shift \`CLS = 0\`**). Prohibidos los spinners circulares genéricos en bloques de datos.
   - \`Empty\`: Explicación clara del motivo por el cual no hay datos + **acción primaria inmediata (CTA)** para poblar o crear el primer registro.
   - \`Error\`: Mensaje comprensible para humanos (prohibido volcar códigos crudos \`500\` o trazas) + **acción de reintento o recuperación en un clic**.
   - \`Protected / Ideal\`: Estado autenticado completo y variante de permisos insuficientes sin romper el layout.
   - \`Partial / Edge Overflow\`: Textos de 120+ caracteres (\`truncate\` / \`line-clamp\`), listas de 0, 1 y 1000+ elementos, y valores numéricos extremos.
5. **Contrato de Navegación Superior (3-Zone Top Bar):**
   - Si existe barra superior: Zona Izquierda (identidad/contexto), Zona Central (máximo 5 destinos planos de primer nivel), Zona Derecha (máximo 2 acciones globales).`,
  },

  wayfinder: {
    id: 'wayfinder',
    title: 'Omni-Design Lens: Dirección de Arte y Arquetipos (Wayfinder)',
    phase: 'Fase 2 · Dirección de Arte y Exploración Divergente',
    origin: 'OmniSpec Native · Fase 2 Dirección de Arte',
    summary:
      'Selección deliberada de arquetipo estético por dominio, regla tipográfica 2+1 con escala modular y presupuesto cromático 60-30-10 en espacio OKLCH.',
    content: `# Lente Omni-Design: Dirección de Arte y Arquetipos (Wayfinder)

Cuando el proyecto es *greenfield* o solicita un rediseño visual sin sistema previo, el agente nunca aplica el estilo genérico por defecto. Debe comprometerse con un **Arquetipo Estético** verificable en \`plan.md\`:

## 1. Matriz de 6 Arquetipos Estéticos por Dominio (Disciplina Anti-Monocultura)
Para evitar el «Nuevo Slop» (donde la IA reemplaza el gradiente violeta aplicando el mismo clon oscuro tipo consola a todos los proyectos), selecciona el arquetipo según la física y ergonomía del dominio real:
- **A. Precisión Técnica & Control (\`precision-dark\`):**
  - *Dominio:* DevTools, CLI dashboards, observabilidad, infraestructura, ciberseguridad.
  - *Rasgos:* Bordes expuestos de \`1px\`, superficies de pizarra profunda (\`#0B0F17\`), \`Space Grotesk\` + \`Inter\` + \`JetBrains Mono\` (\`tabular-nums\`), radios sobrios (\`4px\` / \`6px\` / \`10px\`), cero sombras difusas.
- **B. Claridad Editorial Suiza (\`swiss-editorial\`):**
  - *Dominio:* Documentación técnica, plataformas de conocimiento, analítica ejecutiva, finanzas institucionales, prensa.
  - *Rasgos:* Contraste de peso y escala tipográfica (\`Instrument Serif\` + \`Plus Jakarta Sans\` + \`IBM Plex Mono\`), lienzo cálido tipo papel (\`#FAF8F5\`), tinta profunda (\`#111318\`), jerarquía guiada por espacio negativo y filetes tipográficos.
- **C. Operación de Alta Densidad (\`high-density-ops\`):**
  - *Dominio:* ERP, logística, monitoreo transaccional, mesas de operaciones en tiempo real.
  - *Rasgos:* Ritmo espacial compacto (\`4px\` / \`8px\`), tablas alineadas por tipo de dato con \`tabular-nums\`, estados semánticos de alto contraste WCAG AAA (\`>= 7:1\`) y navegación completa por teclado.
- **D. Artesanía Cálida & Producto (\`warm-craft\`):**
  - *Dominio:* Herramientas creativas, hospitalidad, comercio especializado, productividad personal.
  - *Rasgos:* Superficies orgánicas en tonos piedra/arena (\`#FBF9F6\`), \`Fraunces\` + \`Plus Jakarta Sans\`, transiciones físicas suaves (\`cubic-bezier(0.22, 1, 0.36, 1)\`), micro-interacciones táctiles y radios concéntricos armónicos.
- **E. Claridad Clínica y Cívica Diurna (\`clinical-clarity\`):**
  - *Dominio:* Salud, expedientes médicos, legal, compliance, contabilidad, servicios ciudadanos.
  - *Rasgos:* Luz diurna mineral de máxima legibilidad (\`#F8FAFC\`), tinta de alto contraste (\`#0F172A\`), acento cobalto de confianza (\`oklch(0.48 0.15 240)\`), \`Plus Jakarta Sans\` + \`Public Sans\`, formularios sin ambigüedad y estados de validación explícitos.
- **F. Minimalismo Atmosférico y Arquitectónico (\`atmospheric-minimal\`):**
  - *Dominio:* Arquitectura, estudios de diseño, portafolios de autor, cultura, lujo silencioso.
  - *Rasgos:* Lienzo alabastro (\`#F4F3EF\`), tinta obsidiana (\`#18181B\`), \`Cormorant Garamond\` + \`Inter\`, radios geométricos puros (\`0px\`–\`6px\`) y al menos 35% de espacio negativo estructural.

## 2. Regla Tipográfica 2+1 y Escala Modular
- **Presupuesto estricto:** Máximo **2 familias tipográficas** (Display/Encabezados + UI/Cuerpo) + **1 Monospace** para código, IDs, métricas y tablas numéricas.
- **Proporción matemática:** Escala modular entre \`1.125\` (Major Second) y \`1.333\` (Perfect Fourth).
- **Medida de lectura:** Líneas de prosa restringidas entre \`60ch\` y \`72ch\`. Encabezados con \`letter-spacing\` negativo (\`-0.02em\` a \`-0.035em\`) y \`line-height\` compacto (\`1.08\`–\`1.2\`).

## 3. Presupuesto Cromático 60-30-10 en Espacio OKLCH
- **60% Lienzo Base (\`canvas\`):** Neutro tintado con sutil croma (\`C: 0.005–0.018\`) hacia el tono de marca; prohibido el negro puro \`#000000\` junto a blanco puro \`#FFFFFF\` sin matiz.
- **30% Superficie Estructural (\`surface\` / \`border\`):** Tarjetas, paneles laterales y divisores con salto de luminosidad perceptual controlado (\`ΔL <= 0.12\` en modo oscuro, \`ΔL <= 0.07\` en modo claro).
- **10% Acento Primario (\`accent\`):** Reservado exclusivamente para la acción principal (CTA primario), estado activo de navegación y foco de teclado.
- **Colores Semánticos (\`emerald\`, \`amber\`, \`rose\`):** Reservados estrictamente para estados reales del sistema, nunca como decoración.`,
  },

  distill: {
    id: 'distill',
    title: 'Omni-Design Lens: Destilación y Reducción de Ruido (Distill)',
    phase: 'Fase 3 · Refinamiento por Sustracción',
    origin: 'OmniSpec Native · Fase 3 Destilación Estructural',
    summary:
      'Elimina contenedores redundantes, aplica la disciplina Cero-Píldoras estáticas y restringe cada tarjeta a una sola métrica o propósito.',
    content: `# Lente Omni-Design: Destilación Estructural (Distill)

Toda interfaz generada debe someterse a una pasada de sustracción antes de darse por válida:

1. **Erradicación de «Card-itis» (\`UI_CARDITIS_NESTING\`):**
   - Prohibido anidar tarjetas con borde y sombra dentro de otras tarjetas con borde y sombra (máximo 2 niveles de contención visual).
   - Sustituye contenedores internos por **espaciado vertical (\`16px\` / \`24px\`)** o un divisor sutil de \`1px\`.
2. **Presupuesto de Densidad por Tarjeta (Regla 1-Métrica / 4-Datos):**
   - Una tarjeta de resumen o KPI contiene **1 métrica primaria**, máximo **4 puntos de datos** en total (título, valor principal, delta/contexto, estado) y máximo **3 filas de elementos** antes de requerir vista de detalle.
   - Prohibido incrustar gráficos secundarios, listas de actividades y barras de progreso simultáneamente dentro de una tarjeta KPI.
3. **Disciplina Cero-Píldoras Estáticas (\`UI_STATIC_PILL_BADGE\`):**
   - El radio \`rounded-full\` (\`9999px\`) está reservado para **controles interactivos** (switches, avatares, botones de filtro seleccionables) o indicadores de estado vivo con \`role="status"\`.
   - Para etiquetas de categoría, metadatos, versiones o tags informativos, usa geometría rectangular técnica (\`rounded-sm\` / \`rounded-md\`, \`4px\`–\`6px\`) o tipografía monoespaciada en mayúsculas con \`tracking-wider\`.
4. **Mecanismo Único de Profundidad:**
   - Define la jerarquía de una superficie mediante **borde de \`1px\` + salto tonal OKLCH** O mediante **sombra de elevación**, pero no apiles sombras pesadas junto con bordes gruesos y anillos decorativos.`,
  },

  bolder: {
    id: 'bolder',
    title: 'Omni-Design Lens: Intensificación de Jerarquía y Contraste (Bolder)',
    phase: 'Fase 3 · Refinamiento de Impacto Visual',
    origin: 'OmniSpec Native · Fase 3 Jerarquía y Punto Focal',
    summary:
      'Corrige interfaces planas o tímidas amplificando el contraste de escala tipográfica, la asimetría intencional y el punto focal primario.',
    content: `# Lente Omni-Design: Intensificación de Jerarquía (Bolder)

Usa esta lente cuando una interfaz cumple funcionalmente pero resulta visualmente monótona, plana o indecisa:

1. **Contraste Dramático de Escala Tipográfica:**
   - En lugar de diferenciar niveles con incrementos tímidos de \`2px\` (\`14px\` -> \`16px\` -> \`18px\`), aplica saltos francos en la escala modular: métricas primarias y titulares en \`clamp(1.75rem, 3vw, 2.75rem)\` con peso \`600\`/\`700\` y \`tracking-tight\`, contrastados contra etiquetas técnicas en \`11px\`/\`12px\` monoespaciadas.
2. **Punto Focal Único por Vista:**
   - Al entrecerrar los ojos ante el viewport, un único elemento debe dominar por contraste cromático o escala (el CTA primario o la métrica/canvas central). Si 5 botones compiten con el mismo peso visual, degrada 4 a variantes \`secondary\` o \`ghost\`.
3. **Asimetría Estructural en Rejilla:**
   - Evita el cliché de 3 tarjetas idénticas de \`33.3%\` repetidas fila tras fila (\`UI_ICON_CIRCLE_GRID_CLICHE\`). Combina proporciones asimétricas funcionales en CSS Grid (ej. \`7fr 5fr\` o \`8fr 4fr\`) donde el flujo principal recibe el espacio dominante y el panel contextual actúa como soporte.`,
  },

  quieter: {
    id: 'quieter',
    title: 'Omni-Design Lens: Calma Operativa y Reducción Tonal (Quieter)',
    phase: 'Fase 3 · Ergonomía Cognitiva en Uso Prolongado',
    origin: 'OmniSpec Native · Fase 3 Calma Operativa',
    summary:
      'Reduce la fatiga visual en consolas operativas, tablas densas y herramientas de uso diario eliminando ruido cromático y exceso de contraste en bordes.',
    content: `# Lente Omni-Design: Calma Operativa (Quieter)

Usa esta lente en dashboards operativos, IDEs, paneles de administración y flujos donde el usuario permanece horas frente a la pantalla:

1. **Bordes Silenciosos y Superficies Tonales:**
   - Los divisores de tabla y bordes de panel deben separar sin gritar: usa deltas de luminosidad OKLCH de \`0.05\`–\`0.08\` respecto al lienzo o bordes translúcidos (\`rgba(255,255,255,0.07)\` en oscuro, \`rgba(15,23,42,0.08)\` en claro).
2. **Reserva Estricta del Color de Alerta:**
   - El 90% de la superficie operativa debe mantenerse en la escala de neutros tintados. Cuando aparece un punto esmeralda, ámbar o carmesí, el operador sabe instantáneamente que requiere atención real.
3. **Alineación Tabular y Escaneo Lineal:**
   - Toda columna numérica, latencia, precio, porcentaje o fecha aplica \`tabular-nums\` y alineación consistente para permitir escaneo vertical sin zigzagueo ocular.`,
  },

  polish: {
    id: 'polish',
    title: 'Omni-Design Lens: Pulido Geométrico y Micro-Ergonomía (Polish)',
    phase: 'Fase 4 · Auditoría Pre-Verificación',
    origin: 'OmniSpec Native · Fase 4 Pulido Geométrico y Accesibilidad',
    summary:
      'Lista de comprobación matemática final antes de omni-spec verify: radios concéntricos, foco de teclado, animaciones de compositor y resistencia al contenido.',
    content: `# Lente Omni-Design: Pulido Geométrico y Micro-Ergonomía (Polish)

Antes de ejecutar \`omni-spec verify\`, comprueba cada punto sobre el código y el DOM renderizado:

1. **Fórmula Matemática de Radios Concéntricos:**
   - Cuando un elemento con borde redondeado está dentro de un contenedor redondeado con padding $p$, el radio interno debe calcularse como:
     $$r_{\\text{inner}} = \\max(0, r_{\\text{outer}} - p)$$
   - Ejemplo: Contenedor con \`rounded-xl\` (\`12px\`) y \`p-1\` (\`4px\`) -> el elemento hijo debe usar \`rounded-lg\` (\`8px\`). Usar el mismo radio en ambos produce un abultamiento óptico defectuoso en las esquinas.
2. **Foco de Teclado Visible y Áreas Táctiles (WCAG 2.2 AA):**
   - Ningún control interactivo puede usar \`outline-none\` sin un reemplazo explícito \`:focus-visible\` (\`focus-visible:ring-2 focus-visible:ring-offset-2\`).
   - Todo botón, pestaña o control interactivo mantiene un área de activación mínima de \`24x24px\` CSS (\`36px\`–\`44px\` recomendado en acciones primarias).
3. **Animaciones Exclusivas del Compositor GPU:**
   - Anima únicamente \`transform\` y \`opacity\` usando curvas de desaceleración natural (\`cubic-bezier(0.22, 1, 0.36, 1)\` o \`cubic-bezier(0.16, 1, 0.3, 1)\`, \`150ms\`–\`240ms\`).
   - Prohibido animar \`width\`, \`height\`, \`margin\`, \`top\` o \`left\`, y prohibidas las curvas con rebote elástico (\`UI_BANNED_BOUNCE_EASING\`) en interfaces profesionales.
   - Respeta \`@media (prefers-reduced-motion: reduce)\`.
4. **Cero Desbordamiento en Viewports Extremos:**
   - Comprueba en \`375x812\` (móvil) y \`1440x900\` (escritorio) que \`document.documentElement.scrollWidth <= document.documentElement.clientWidth\`.`,
  },

  tokens: {
    id: 'tokens',
    title: 'Omni-Design Lens: Arquitectura de Tokens DTCG 2025.10 y OKLCH',
    phase: 'Fase 2–4 · Verificación Matemática de Tokens',
    origin: 'OmniSpec Native · Motor Matemático DTCG 2025.10 & WCAG 2.2',
    summary:
      'Especificación formal de tokens DTCG 2025.10, generación de plantillas por arquetipo y validación determinista de contraste WCAG 2.2 + OKLCH.',
    content: `# Lente Omni-Design: Tokens DTCG 2025.10 y Matemática de Color

OmniSpec 0.10.0 incluye un validador y generador determinista de tokens de diseño sin dependencias externas:

## Comandos del Motor Matemático
1. **Generar scaffold DTCG 2025.10 validado por arquetipo (6 arquetipos disponibles):**
   \`\`\`sh
   omni-spec design scaffold --archetype <precision-dark|swiss-editorial|high-density-ops|warm-craft|clinical-clarity|atmospheric-minimal> [--output tokens.json] [--json]
   \`\`\`
2. **Auditar contraste perceptual y WCAG 2.2:**
   \`\`\`sh
   omni-spec design contrast "<foreground>" "<background>" --role <normal-text|large-text|ui-component|enhanced-text> [--json]
   \`\`\`
   - Soporta \`#hex\`, \`rgb()\`, \`hsl()\` y \`oklch(L C H)\`.
   - Verifica \`>= 4.5:1\` para texto normal, \`>= 3.0:1\` para texto grande (\`>= 18pt\` o \`>= 14pt bold\`) y bordes/controles interactivos, y \`>= 7.0:1\` para lectura prolongada AAA.
3. **Validar manifiesto de tokens DTCG 2025.10:**
   \`\`\`sh
   omni-spec design tokens <ruta/a/tokens.json> [--json]
   \`\`\`
   - Comprueba estructura \`$value\` / \`$type\`, escala tipográfica modular (\`1.125–1.333\`), presupuesto \`2+1\` de fuentes, ritmo espacial múltiplo de \`4px\`, máximo \`3\` radios de superficie, curvas \`cubicBezier\`, geometría concéntrica y pares de contraste declarados en \`$extensions["omni-design"].contrastPairs\`.`,
  },

  'anti-slop': {
    id: 'anti-slop',
    title: 'Omni-Design Lens: Catálogo Determinista UI-Slop Guard',
    phase: 'Fase 4 · Compuerta Léxica y Estructural Anti-Slop',
    origin: 'OmniSpec Native · Inspector Determinista UI-Slop Guard',
    summary:
      '14 reglas léxicas y estructurales verificadas por omni-spec design check para erradicar clichés clásicos de IA, «nuevo slop» y regresiones de accesibilidad.',
    content: `# Lente Omni-Design: Catálogo Determinista UI-Slop Guard

El comando \`omni-spec design check [archivos...] [--json]\` inspecciona archivos \`.tsx\`, \`.jsx\`, \`.vue\`, \`.svelte\`, \`.astro\`, \`.css\` y \`.html\` buscando 14 patrones deterministas de regresión visual, monocultura y ergonomía:

| Código | Severidad | Regla verificada y corrección |
| :--- | :--- | :--- |
| \`UI_CLICHE_GRADIENT\` | Error | Bloquea degradados genéricos violeta/púrpura/índigo/cian sobre fondos oscuros no respaldados por un token de marca (\`omni-design-allow: brand-gradient\`). |
| \`UI_CARDITIS_NESTING\` | Error | Bloquea el anidamiento de 3+ niveles de contenedores con borde y sombra en un mismo bloque. Usa espaciado o divisores de \`1px\`. |
| \`UI_DECORATIVE_PULSE_DOT\` | Error | Bloquea puntos \`animate-pulse\` / \`animate-ping\` puramente decorativos sin semántica \`role="status"\` ni \`aria-live\`. |
| \`UI_THICK_LEFT_ACCENT\` | Error | Bloquea franjas laterales gruesas (\`border-l-4\`, \`border-l-8\`) de plantilla genérica en tarjetas. |
| \`UI_MECHANICAL_HEADER_PREFIX\` | Error | Bloquea prefijos de comentario de código falsos (\`// 01_\`, \`[01] //\`, \`>_\`, \`FEAT_01:\`) dentro de encabezados \`<h1>\`–\`<h6>\`. |
| \`UI_FOCUS_SUPPRESSED\` | Error | Bloquea controles interactivos (\`button\`, \`a\`, \`input\`, \`select\`, \`textarea\`) que eliminan el outline sin definir \`:focus-visible\`. |
| \`UI_BANNED_BOUNCE_EASING\` | Error | Bloquea curvas \`cubic-bezier\` con sobreimpulso elástico (\`y2 > 1.05\`) o \`animate-bounce\` en interfaces operativas sin \`omni-design-allow: bounce\`. |
| \`UI_GLASSMORPHISM_ABUSE\` | Error | Bloquea el «nuevo slop» cristalino: 4+ contenedores apilados con \`backdrop-blur\` y fondo translúcido en una misma vista. |
| \`UI_ICON_CIRCLE_GRID_CLICHE\` | Error | Bloquea el cliché de rejilla de 3 tarjetas iguales con icono encerrado en círculo/caja tintada (\`bg-*-500/10\`). |
| \`UI_GENERIC_AI_HERO_COPY\` | Error | Bloquea titulares genéricos de IA (\`Supercharge your\`, \`Unleash the power of\`, \`Next-Gen AI\`, \`Revolutionize your\`). |
| \`UI_FAKE_TELEMETRY_LABEL\` | Error | Bloquea cadenas decorativas de pseudo-telemetría sci-fi (\`SYS_ONLINE\`, \`NEURAL_ENGINE_ACTIVE\`, \`QUANTUM_SYNC\`). |
| \`UI_NON_COMPOSITOR_ANIMATION\` | Warning | Advierte sobre transiciones CSS que animan propiedades de layout (\`width\`, \`height\`, \`margin\`, \`top\`, \`left\`). |
| \`UI_STATIC_PILL_BADGE\` | Warning | Advierte sobre el abuso de \`rounded-full\` en badges informativos estáticos en lugar de reservarlo para controles interactivos o \`role="status"\`. |
| \`UI_RAW_MAGIC_ZINDEX\` | Warning | Advierte sobre valores arbitrarios de apilamiento (\`z-[999]\`, \`z-[9999]\`) fuera de una escala gobernada de capas. |`,
  },
};

export function listDesignLenses() {
  return Object.values(DESIGN_LENSES).map(({ id, title, phase, origin, summary }) => ({
    id,
    title,
    phase,
    origin,
    summary,
  }));
}

export function getDesignLens(lensId) {
  const normalized = String(lensId || '')
    .trim()
    .toLowerCase();
  return DESIGN_LENSES[normalized] || null;
}

/**
 * Inspects an active or specified spec directory and evaluates whether its
 * UI & Interaction Design contract is complete or still has open interrogation gaps.
 */
export async function inspectSpecDesignGrill(rootDir, specIdentifier = null) {
  const manifest = await loadManifest(rootDir);
  if (!manifest) {
    throw new Error('No OmniSpec manifest found in this directory. Run `omni-spec init` first.');
  }
  const target = specIdentifier ? String(specIdentifier).trim() : manifest.active_spec;
  if (!target) {
    throw new Error('No active specification found. Specify a spec ID or create one first.');
  }
  const specEntry = (manifest.specs || []).find(
    s => s.id === target || s.slug === target || s.slug?.startsWith(`${target}-`),
  );
  const slug = specEntry ? specEntry.slug : target;
  const specDir = join(rootDir, 'specs', slug);

  const specMd = await readFile(join(specDir, 'spec.md'), 'utf8').catch(() => '');
  const planMd = await readFile(join(specDir, 'plan.md'), 'utf8').catch(() => '');
  const acceptanceRaw = await readFile(join(specDir, 'acceptance.json'), 'utf8').catch(() => '');

  const hasVisualCriteria =
    /\bAC-\d+\s*\[(?:visual|interaction|accessibility)\]/i.test(specMd) ||
    /"kind"\s*:\s*"(?:visual|interaction|accessibility)"/i.test(acceptanceRaw);

  const uiSectionMatch = planMd.match(
    /##\s+(?:UI\s*&\s*Interaction\s*Design|Diseño\s*UI)[\s\S]*?(?=\n##\s+|\n#\s+|$)/i,
  );
  const uiSection = uiSectionMatch ? uiSectionMatch[0] : '';
  const marksUiNa = /\bN\/A\b|\bno\s+aplica\b|\bsin\s+cambios\s+visuales\b/i.test(uiSection);

  const stateChecks = {
    loading: /\bloading\b|\bskeleton\b|\bcarga\b/i.test(uiSection),
    empty: /\bempty\b|\bvac[ií]o\b|\bcta\b/i.test(uiSection),
    error: /\berror\b|\bretry\b|\breintento\b/i.test(uiSection),
    protectedOrIdeal: /\bprotected\b|\bideal\b|\bpopulated\b|\bcompleto\b|\bpermiso/i.test(uiSection),
  };

  const hasArchetype =
    /\barquetipo\b|\barchetype\b|\bpaleta\b|\bpalette\b|\btipograf[ií]a\b|\btypography\b|\boklch\b/i.test(uiSection);
  const hasTokens = /\btoken|\breutiliz|\breuse|\bvariable|\bdtcg\b/i.test(uiSection);

  const openQuestions = [];
  if (hasVisualCriteria && marksUiNa) {
    openQuestions.push({
      id: 'Q-CONTRADICTION',
      severity: 'error',
      question:
        'La especificación declara criterios [visual], [interaction] o [accessibility], pero plan.md marca la sección UI & Interaction Design como N/A. ¿Qué superficies reales cambian y cuál es su dirección de arte?',
    });
  }

  if (hasVisualCriteria || (!marksUiNa && uiSection.length > 0)) {
    if (!hasArchetype) {
      openQuestions.push({
        id: 'Q-ARCHETYPE',
        severity: 'warning',
        question:
          '¿Qué arquetipo estético gobierna la interfaz (precision-dark, swiss-editorial, high-density-ops, warm-craft) y qué proporción tipográfica (2+1) se aplicará?',
      });
    }
    if (!hasTokens) {
      openQuestions.push({
        id: 'Q-TOKENS',
        severity: 'warning',
        question:
          '¿Qué tokens existentes del repositorio se reutilizarán intactos y qué nuevos tokens primitivos/semánticos son estrictamente necesarios?',
      });
    }
    const missingStates = Object.entries(stateChecks)
      .filter(([, covered]) => !covered)
      .map(([name]) => name);
    if (missingStates.length > 0) {
      openQuestions.push({
        id: 'Q-STATES',
        severity: 'warning',
        question: `Faltan estados obligatorios en la matriz de interfaz de plan.md: ${missingStates.join(', ')}. ¿Cómo se comportará cada superficie en Loading (CLS=0), Empty (+CTA), Error (+Retry) y Protected/Ideal?`,
      });
    }
  }

  return {
    specId: slug,
    hasVisualCriteria,
    uiSectionPresent: Boolean(uiSection),
    marksUiNa,
    contractStatus: {
      hasArchetype,
      hasTokens,
      stateChecks,
      allStatesCovered: Object.values(stateChecks).every(Boolean),
      contradictsUiCriteria: hasVisualCriteria && marksUiNa,
    },
    readyForImplementation:
      openQuestions.filter(q => q.severity === 'error').length === 0 && openQuestions.length === 0,
    openQuestions,
  };
}
