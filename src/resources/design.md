# Guía de diseño UI y experiencia (Omni-Design 0.10.0)

Lee esta guía solo cuando la tarea crea o modifica una interfaz o su recorrido, o ejecuta lentes específicas bajo demanda con `omni-spec guide design --lens <grill|wayfinder|distill|bolder|quieter|polish|tokens|anti-slop>`. No convierte una revisión del agente en certificación de diseño ni de accesibilidad.

## Antes de dibujar
- Inspecciona componentes, tokens, variables CSS, hojas de estilo, iconos, rutas y pruebas visuales o E2E existentes. Reutilízalos salvo que el alcance pida cambiarlos.
- Ejecuta el interrogatorio pre-diseño (`omni-spec design grill` o `omni-spec guide design --lens grill`) para cerrar tarea primaria, frecuencia de uso, densidad de datos y presupuesto de viewport (máximo 4 grupos de componentes visibles sin scroll y al menos 25% de lienzo abierto).
- Identifica la superficie, los usuarios, la tarea principal y las restricciones de marca, dispositivo, idioma y accesibilidad.
- Si es una interfaz nueva o un rediseño amplio y el usuario aún no fijó dirección visual, pide o busca 2 o 3 referencias del dominio y anota qué rasgo concreto tomas de cada una (densidad, jerarquía, navegación, tono), sin copiar marcas ni contenido ajeno.

## Contrato de diseño proporcional
- **Cambio visual local:** si el trabajo cabe en la ruta ligera, basta con declarar el resultado visual e interactivo esperado en los criterios `[visual]`, `[interaction]` o `[accessibility]` y cómo se comprobará.
- **Superficie nueva, varios estados o cambio de recorrido:** documenta en `## UI & Interaction Design` del plan (`plan.md` o `fix.md`) el contrato de dirección de arte que sigue. Si una especificación declara criterios visuales o de interacción pero marca `## UI & Interaction Design` como `N/A`, `omni-spec audit` bloqueará el avance con `UI_DESIGN_CONTRADICTION`.
- **Directriz Estética Anti-Clichés y Anti-Monocultura (UI-Slop Guard):** Rechaza los clichés visuales de IA: prohíbe degradados genéricos azul/púrpura sin justificación de marca, badges con glow difuso artificial y el anidamiento excesivo de tarjetas con sombras («card-itis»). Construye jerarquía visual deliberada mediante tipografía y espaciado proporcional en lugar de cajas artificiales. El inspector `omni-spec design check` bloquea determinísticamente 14 patrones de regresión (`UI_CLICHE_GRADIENT`, `UI_CARDITIS_NESTING`, `UI_DECORATIVE_PULSE_DOT`, `UI_THICK_LEFT_ACCENT`, `UI_MECHANICAL_HEADER_PREFIX`, `UI_FOCUS_SUPPRESSED`, `UI_BANNED_BOUNCE_EASING`, `UI_GLASSMORPHISM_ABUSE`, `UI_ICON_CIRCLE_GRID_CLICHE`, `UI_GENERIC_AI_HERO_COPY`, `UI_FAKE_TELEMETRY_LABEL`, `UI_NON_COMPOSITOR_ANIMATION`, `UI_STATIC_PILL_BADGE` y `UI_RAW_MAGIC_ZINDEX`).
- **Prevención del «Nuevo Slop» (Regla Anti-Monocultura):** Quitar un cliché no autoriza a sustituirlo por otro molde repetitivo (por ejemplo, convertir cualquier aplicación de salud, comercio o editorial en un clon oscuro tipo terminal con Bento Grid idéntico). El arquetipo, el modo de luz (`light` vs `dark`), la pareja tipográfica y la densidad deben derivarse estrictamente del dominio real del producto.

## Contrato de dirección de arte (antes de programar)
Registra en `## UI & Interaction Design` decisiones concretas y revisables; evita adjetivos vacíos («moderno», «limpio», «intuitivo») sin traducirlos a reglas verificables. Los ejemplos usan términos web; en otras plataformas aplica sus equivalentes nativos (estados de interacción, curvas de animación, ajustes de accesibilidad del sistema).

1. **Arquetipo estético.** Nómbralo y justifícalo con la tarea y las referencias (`precision-dark`, `swiss-editorial`, `high-density-ops`, `warm-craft`, `clinical-clarity`, `atmospheric-minimal` — consulta `omni-spec guide design --lens wayfinder`), indicando uno o dos rasgos distintivos y qué vas a evitar (por ejemplo, tarjetas decorativas anidadas, rejillas de 3 iconos en círculo `UI_ICON_CIRCLE_GRID_CLICHE`, abuso de cristal `UI_GLASSMORPHISM_ABUSE`, gradientes sin función o píldoras estáticas `UI_STATIC_PILL_BADGE`).
2. **Tokens (`omni-spec design tokens` / `omni-spec design scaffold`).** Reutiliza primero los existentes; cada token nuevo necesita un motivo:
   - Tipografía (Regla 2+1): una o dos familias (más una monoespaciada si hay código, IDs o tablas con `tabular-nums`), escala modular con razón entre 1,2 y 1,333, al menos dos pesos, altura de línea e interletreado por rol, y ancho de lectura de 60 a 75 caracteres en prosa.
   - Espacio, radio y elevación: ritmo espacial con base de 4 px y múltiplos de 8, como mucho tres radios y dos o tres niveles de elevación. Aplica la fórmula matemática de radios concéntricos $r_{\text{inner}} = \max(0, r_{\text{outer}} - p)$ cuando anides un elemento redondeado dentro de un contenedor con padding $p$.
   - Color y contraste (`omni-spec design contrast`): rampa neutra, un acento intencional y colores semánticos con pares de contraste medidos bajo distribución cromática 60-30-10 en espacio perceptual OKLCH ($\Delta L \le 0.12$ en oscuro, $\Delta L \le 0.07$ en claro).
   - Movimiento: de 120 a 240 ms, una curva `cubic-bezier` declarada y respeto de `prefers-reduced-motion`, animando exclusivamente propiedades del compositor (`transform`, `opacity`).
3. **Matriz de estados por superficie.** Loading (carga real), Empty (sin datos), Error (fallo y recuperación), Partial/Overflow (datos incompletos o contenido largo) e Ideal (contenido típico completo), más foco y deshabilitado. Describe cada uno o márcalo N/A con motivo.
   Toda vista interactiva debe contemplar explícitamente los 4 estados de interfaz obligatorios:
   - **Loading**: skeletons contextuales o indicadores de carga real con Cumulative Layout Shift (CLS) = 0.
   - **Empty**: explicación contextual clara acompañada de una acción inmediata (CTA).
   - **Error**: mensaje de error comprensible (sin códigos opacos) con mecanismo explícito de reintento.
   - **Protected / Ideal**: renderizado del contenido típico completo o tratamiento de estado restringido/sin permisos.
4. **Presupuesto de atención y ergonomía.** Una acción primaria por vista, como mucho tres grupos de datos por tarjeta (1 métrica primaria y máximo 4 puntos de datos), `:hover`, `:active` y `:focus-visible` diferenciados (`UI_FOCUS_SUPPRESSED` bloquea `outline-none` sin reemplazo `:focus-visible`), controles accionables por teclado y sin desbordamiento horizontal en móvil ni escritorio.

Son decisiones y rangos que se registran, no una receta obligatoria. Conserva la identidad y los tokens aprobados del proyecto salvo que la especificación pida cambiarlos.

## De la pantalla al recorrido
Una pantalla aislada no basta cuando la tarea cruza varios pasos:
- Comprueba cómo entra el usuario, qué ve primero, qué acción principal destaca y cómo vuelve o corrige un error.
Ejercita la matriz de estados de cada superficie junto con validación, recuperación tras error, confirmación y permisos cuando apliquen.
- Revisa el recorrido en el tamaño móvil y de escritorio relevantes para el proyecto (`375x812` y `1440x900`), con navegación por teclado, foco visible y textos reales (no `lorem ipsum`).
- Ejecuta las lentes de refinamiento (`--lens distill`, `--lens bolder`, `--lens quieter`, `--lens polish`) y el inspector determinista `omni-spec design check` antes de pasar a verificación.

## Evidencia de aceptación v2
- Los criterios `[visual]`, `[interaction]` y `[accessibility]` se registran en `acceptance.json` (`schemaVersion: 2`) con `kind` correspondente.
- Prefiere `method: "automated"` cuando el proyecto tenga pruebas E2E, de componentes o de accesibilidad que realmente ejerciten el criterio.
- Si requiere revisión en navegador o dispositivo, usa `method: "manual"` y completa `evidence.observation`: quién observó (`human` o `agent`), superficie, entorno, viewport cuando sea visual, pasos ejecutados, esperado, observado y fecha. Si observa el agente un criterio visual, guarda una imagen de la superficie como artefacto en cada viewport que nombra el criterio (si no nombra ninguno, registra el usado), enlázala en `evidence.artifacts` y úsala solo si la sesión registró `render` como `available`; una nota de texto del agente no sustituye la imagen.
- **Medición Empírica de Contraste (`omni-spec design contrast`):** Mide cada par de contraste real con una herramienta que nombras y registra los dos colores, la razón obtenida y el umbral aplicado (mínimo 4.5:1 para texto estándar y 3:1 para componentes de UI o texto grande); afirmar un nivel WCAG sin esa medición no es evidencia.
- Si no hay navegador, dispositivo o prueba aplicable en el entorno actual, no marques el criterio como aprobado: deja el límite explícito y bloquea el cierre hasta tener esa comprobación.

## Referencias primarias para consultar según alcance
- W3C WCAG 2.2 (contraste 1.4.3 y 1.4.11, reflujo 1.4.10, foco visible 2.4.7, tamaño de objetivo 2.5.8): https://www.w3.org/TR/WCAG22/
- W3C WAI-ARIA Authoring Practices Guide (patrones de componentes y teclado): https://www.w3.org/WAI/ARIA/apg/
- W3C CSS Color Module Level 4 — OKLab & OKLCH: https://www.w3.org/TR/css-color-4/#ok-lab
- Design Tokens Format Module 2025.10 (DTCG): https://www.designtokens.org/
- MDN Web Docs — `prefers-reduced-motion` y `:focus-visible`: https://developer.mozilla.org/
- OpenAI — Designing delightful frontends: https://developers.openai.com/blog/designing-delightful-frontends-with-gpt-5-4
