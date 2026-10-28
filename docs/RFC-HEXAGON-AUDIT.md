# PRD & RFC de Auditoría Arquitectónica: Evolución de OmniSpec (Paradigma Hexagonal)

## Instrucciones para el Agente Local (System Prompt de Ejecución)
Tienes acceso completo al código fuente del repositorio **OmniSpec (`0.7.0-preview.2`)** y a tus herramientas de búsqueda en internet / consola. 
Tu objetivo NO es reescribir el proyecto ni alterar lo que ya funciona, sino actuar como **Arquitecto Principal e Investigador** para:
0. **FASE 0 (Investigación Externa Obligatoria antes de analizar el código):** Buscar en internet, GitHub, blogs de ingeniería y publicaciones recientes si existe algún framework que combine estos paradigmas de esta forma exacta, y evaluar si esta combinación es **100% viable en la práctica** o si otros proyectos han fracasado al intentarlo por límites de atención de los LLMs o exceso de fricción.
1. Inspeccionar el código fuente actual del motor CLI, los esquemas JSON (`fit.json`, `acceptance.json`, `verification.json`, `checks.json`, `manifest.json`, `project-state.json`), las plantillas en `_templates/` y las 9 skills (`omni-init` a `omni-converge` + `omni-auditor`).
2. Contrastar el estado actual del código contra este **PRD del Paradigma Hexagonal**.
3. Entregar un **Informe de Viabilidad, Estado del Arte y Brecha (Gap Analysis)** detallando:
   - Qué existe hoy en el mercado, qué riesgos de viabilidad real existen y cómo mitigarlos.
   - Qué partes de este PRD **ya están cubiertas total o parcialmente** en `0.7.0-preview.2`.
   - Qué cambios mínimos y quirúrgicos (en líneas de código, esquemas JSON y prompts de skills) se requieren para implementar el resto sin romper la compatibilidad ni la filosofía *Zero-Dependencies*.

---

## 1. Visión del Producto y Restricciones Innegociables

**Objetivo:** Consolidar a **OmniSpec** como el único framework universal del mercado que unifica 6 paradigmas en un solo bucle determinista (**SDD + TDD + ODD + CTD + CDD-UI + MDD**), garantizando **bajo consumo de tokens**, **cero sobreingeniería**, **dependencias siempre vigentes**, **interfaces de alta factura visual** y **adaptabilidad total** (desde cero, en curso, `feature`, `bugfix`, `debt`, `rfc`) en cualquier agente, IDE o CLI.

### Restricciones de Ingeniería (Hard Constraints)
1. **Zero Dependencies:** Prohibido añadir paquetes externos en `package.json` del motor de OmniSpec. Todo debe resolverse con Node.js nativo (`>=22.19.0`).
2. **No regresión en `0.7.0-preview.2`:** Se conserva intacta la estructura de los 9 skills, los 4 arquetipos (`feature`, `bugfix`, `debt`, `rfc`), las 3 rutas de ceremonia (`light`, `standard`, `full`), el bloqueo concurrente (`manifest.lock/`) y la huella de verificación (`verify` / `complete`).
3. **Economía Estricta de Tokens (FinOps de Contexto):** Ningún cambio en plantillas o skills puede inflar innecesariamente el tamaño del prompt base (`AGENTS.md` o `SKILL.md`).

---

## 2. Los 6 Pilares del Paradigma "Omni" (Especificación Funcional)

### Pilar 1: SDD Proporcional (Spec-Driven Development) — [Validar base actual]
El contrato técnico guía al agente según la naturaleza y el riesgo del cambio.
* **Comportamiento esperado:** `omni-spec fit` evalúa la tarea y deriva la ruta (`light`, `standard`, `full`) en `specs/<slug>/fit.json` combinada con los 4 arquetipos (`feature`, `bugfix`, `debt`, `rfc`).
* **Qué debe auditar el agente en el código:** Verificar cómo se calcula actualmente la heurística en `fit` v1/v2 y cómo puede extenderse `fit.json` sin romper validaciones existentes.

### Pilar 2: TDD con Candado Determinista (Test-Driven Gate)
Evitar que el agente escriba código primero y luego invente tests superficiales que solo pasen por compromiso, sin añadir burocracia a cambios triviales.
* **Requerimiento en `acceptance.json` y `checks.json`:**
  * En rutas `standard` y `full` (y obligatoriamente en el arquetipo `bugfix`), todo criterio automatizable debe vincularse a un `checkId` de `checks.json`.
  * **Fase Red-Gate (Opcional/Recomendada en `bugfix` y `feature`):** Capacidad de registrar en `/omni-audit` o mediante un flag en `verify` (ej. `omni-spec verify <id> --red` o validación previa en `/omni-implement`) que el test de reproducción/aceptación fue creado antes de modificar la lógica de negocio.

### Pilar 3: ODD (Observability-Driven Development)
Garantizar que ningún `feature` o `bugfix` entregue código que sea una "caja negra" en producción.
* **Requerimiento en Plantillas (`_templates/`) y `acceptance.json`:**
  * En los arquetipos `feature` (`plan.md` / `spec.md`) y `bugfix` (`rca.md` / `fix.md`), incluir una sección ligera de **Contrato de Observabilidad**: qué logs estructurados, códigos de error trazables o señales de fallo debe emitir el cambio.
  * Si la ruta es `light` o un cambio puramente estético, la sección puede marcarse como `N/A (justificado)` para no forzar sobreingeniería.

### Pilar 4: CTD (Complexity & Token-Budget Driven Development) — [Anti-Sobreingeniería, Ahorro de Tokens y Vigencia de Dependencias]
Poner límites físicos verificables por el CLI para evitar que el agente cree abstracciones innecesarias, toque 20 archivos para un cambio de 2, instale librerías obsoletas o queme miles de tokens leyendo todo el repositorio.
* **Requerimiento 4.1 — Presupuesto de Complejidad (Complexity Cap):**
  * Extender la salida derivada de `fit.json` (o `plan.md`) con un bloque de presupuesto de alcance:
    * `scope`: `"backend" | "ui" | "fullstack" | "docs" | "config"`
    * `maxFilesChanged`: Límite estimado de archivos a crear/modificar según la ruta (`light` / `standard` / `full`).
    * `allowDependencyChanges`: `boolean` (por defecto `false`, bloqueando alteraciones en `package.json`, `Cargo.toml`, `requirements.txt`, `go.mod`, etc., salvo declaración explícita).
  * **Validación en `omni-spec verify`:** Aprovechar el cálculo de huella que ya hace `verify` para comparar los archivos tocados contra `maxFilesChanged` y `allowDependencyChanges`, reportando violaciones de sobreingeniería.
* **Requerimiento 4.2 — Inyección Quirúrgica de Contexto (Phase-Gated Context Slicing):**
  * Cada una de las 9 `SKILL.md` debe incluir una directiva estricta de **Presupuesto de Lectura (Read Budget)**: declarar exactamente qué archivos puede leer el agente en esa fase y prohibir expresamente leer especificaciones históricas cerradas o escanear carpetas ajenas al módulo activo.
* **Requerimiento 4.3 — Higiene y Vigencia Tecnológica (Dependency & API Freshness):**
  * Los agentes suelen sugerir e instalar librerías deprecadas o versiones antiguas basadas en su fecha de corte de entrenamiento.
  * Cuando `allowDependencyChanges: true` (o al iniciar un proyecto desde cero en `/omni-init` y `/omni-plan`), el agente tiene **prohibido fijar versiones de memoria**. Debe consultar el registro oficial en tiempo real (ej. `npm view <pkg> version`, `npm outdated`, búsqueda web oficial o inspección de lockfiles actuales) y justificar en `plan.md` que el paquete elegido es **estable, mantenido activamente y sin alternativas nativas en el runtime actual**.

### Pilar 5: CDD-UI (Constraint-Driven & High-Craft Design)
Superar el problema actual donde las reglas *anti-slop* evitan clichés feos (degradados morados, *card-itis*), pero terminan generando **interfaces demasiado básicas, planas o con aspecto de wireframe**. Buscamos un sistema que sea **Anti-Slop pero visualmente extraordinario, pulido y profesional**.
* **Requerimiento 5.1 — Montaje Perezoso (Lazy Skill Mounting):**
  * Las reglas detalladas de UI/UX y accesibilidad **solo se cargan en el contexto del agente** si el campo `scope` de la tarea es `"ui"` o `"fullstack"`. Si es `"backend"`, el agente ni siquiera lee las reglas de UI.
* **Requerimiento 5.2 — Matriz de los 5 Estados en `/omni-specify` y `/omni-audit`:**
  * Cuando `scope` incluye `"ui"`, `omni-auditor` y `/omni-audit` deben verificar que la especificación defina los 5 estados de la interfaz: **1. Loading, 2. Empty, 3. Error, 4. Partial/Overflow, 5. Ideal**, además de exigir reutilización de componentes/tokens existentes antes de crear estilos nuevos.
* **Requerimiento 5.3 — De "Anti-Slop Básico" a Estética Profesional (High-Craft Design Tokens & Composition):**
  * Las reglas prohibitivas (*qué NO hacer*) no bastan para crear belleza; se requieren **reglas compositivas positivas**. Auditar cómo tenemos hoy las reglas de UI en OmniSpec y diseñar un módulo ligero de **Dirección de Arte y Tokens de Diseño** (activado solo en `scope: ui/fullstack`) que obligue al agente a definir antes de programar:
    1. **Arquetipo Estético Explícito:** (ej. *Minimalismo Técnico / Precisión estilo Linear-Vercel*, *Editorial Limpio*, *Dashboard de Alta Densidad*, etc.) en lugar de HTML/CSS genérico sin alma.
    2. **Sistema de Tokens Matemático:** Escala tipográfica con contraste real de pesos, ritmo espacial estricto (`4px/8px`), bordes sutiles (`1px` con opacidad controlada), sombras multicapa realistas y paleta semántica con acentos intencionales.
    3. **Micro-interacciones y Pulido Visual:** Transiciones suaves (`cubic-bezier`), estados `:focus-visible` y `:hover` refinados, alineación óptica de iconos/texto y riqueza visual sin caer en ruido decorativo (*slop*).

### Pilar 6: MDD (Memory Distillation Driven) — [Compresión de Contexto a Largo Plazo]
Impedir que el proyecto se vuelva más lento y costoso en tokens a medida que se acumulan decenas de especificaciones (`001` a `099`).
* **Requerimiento en `omni-spec complete` y `omni-spec contracts`:**
  * Al ejecutar `omni-spec complete <id>`, la carpeta `specs/<id>-slug/` pasa a estado cerrado/histórico (**con prohibición de lectura para el agente en sesiones futuras**).
  * Antes de cerrar, las decisiones arquitectónicas y contratos vigentes se **destilan de forma ultra-compacta** en el catálogo maestro (`omni-spec contracts` y/o `specs/project-context.md`), manteniendo el consumo de tokens constante sin importar la edad del proyecto.

---

## 3. Dinámica de Ejecución: XP (Extreme Programming) & AI Pair Programming
Evaluar cómo integrar en el flujo conversacional de los 9 skills las mejores prácticas de **Extreme Programming (XP)** y **Pair Programming**, descartando la burocracia pesada de Scrum (sin Sprints ni Story Points que gasten tokens):
* **Patrón Navigator (Humano) / Driver (Agente):** En `/omni-discuss`, `/omni-clarify` y `/omni-implement`, establecer puntos de control cortos (*Ping-Pong Flow*) donde el agente no escriba bloques masivos a ciegas, sino que valide el test en rojo y avance en incrementos atómicos verificables.
* **Integración Continua de Evidencia:** Cada tarea de `tasks.md` actúa como un micro-incremento que mantiene el árbol de trabajo en un estado comprobable antes de pasar al siguiente.

---

## 4. Entregable Solicitado al Agente Local

Antes de proponer o tocar código, ejecuta tu investigación web y tu lectura del repositorio, y respóndeme con estas **4 secciones**:

1. **Investigación de Mercado, Estado del Arte y Viabilidad Real (Internet + Literatura):**
   - ¿Existe hoy en GitHub, artículos técnicos o herramientas comerciales algo que combine SDD + TDD + ODD + Presupuesto Determinista de Complejidad/Tokens + High-Craft UI + Destilación de Memoria? Nombra los proyectos más cercanos y en qué se diferencian.
   - **Análisis Crítico de Viabilidad:** ¿Qué partes de esta propuesta corren el riesgo de fracasar en el mundo real (por ejemplo, fatiga de instrucciones en el LLM, rigidez excesiva para el usuario o falsos positivos en `verify`) y cómo debemos ajustarlas para que sean 100% prácticas y fluidas?
2. **Mapa de Cobertura Actual en el Código (`0.7.0-preview.2`):**
   - Tabla indicando para cada uno de los 6 pilares + Vigencia de Dependencias + High-Craft UI + XP Pair Programming: qué archivos del repositorio actual ya implementan parte de esto, cómo funciona hoy y qué porcentaje está resuelto.
3. **Diseño de Cambios Quirúrgicos (Impacto Mínimo):**
   - **Cambios en CLI / Runtime JS:** Qué funciones y archivos exactos habría que tocar (ej. en `fit`, `verify`, `complete`, `audit`, `contracts`) y cuántas líneas estimadas implicaría.
   - **Cambios en Esquemas JSON:** Propuesta exacta de campos opcionales retrocompatibles para `fit.json`, `acceptance.json` y `verification.json`.
   - **Cambios en Plantillas y los 9 Skills (`SKILL.md`):** Cómo aplicar el *Context Slicing* (ahorro de tokens), la verificación de versiones estables en vivo, el flujo *Driver/Navigator* y el salto de *Anti-Slop Básico* a *High-Craft UI* sin inflar los prompts.
4. **Plan de Implementación usando el propio OmniSpec:**
   - Propón la secuencia de comandos de OmniSpec (`/omni-specify`, arquetipo `rfc` o `feature`) para implementar estas mejoras por fases rumbo a `0.8.0` sin frenar el lanzamiento de `0.7.0`.