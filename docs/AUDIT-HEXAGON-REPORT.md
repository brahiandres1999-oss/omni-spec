# Auditoría del Paradigma Hexagonal — OmniSpec 0.7.0-preview.2

> Fecha: 2026-10-24 · Base: `main` @ `0e71c87` (0.7.0-preview.2) · Modo: auditoría e investigación, sin cambios de código.

**Alcance leído:**
- `bin/omni-spec.mjs` y todo `src/`: cli, fit, verification, acceptance, checks, snapshot, manifest, auditor, project-state, contracts, context-auditor, generator, workflows, protocols, integrations, assets, managed, updater, detector y versions.
- `schema/`: fit, acceptance, checks, contracts, manifest y project-state.
- `src/templates/` (10 plantillas) y `src/resources/` (design, evidence y setup).
- Las 9 skills (generadas desde `src/workflows.mjs`), `agents/omni-auditor.md` y `rules/constitution.md`.
- Los tests que fijan contratos.
- Datos de campo de `../Pulso360/specs`, solo lectura.

**Precisiones sobre el RFC:**
- `_templates/` es `src/templates/` en el repositorio y `specs/_templates/` en un proyecto instalado.
- No existe `schema/verification.schema.json`: `verification.json` es un registro generado y se valida en código (`src/verification.mjs`, versión 3).
- `omni-auditor` es un rol de agente, no una de las 9 skills.

## Resumen ejecutivo

1. **No encontré ningún framework que combine los seis pilares** con verificación determinista y portabilidad entre agentes. Los más cercanos cubren dos o tres:
   - Spec Kit: SDD, más TDD y observabilidad como principios en prosa y justificación de complejidad.
   - OpenSpec: SDD y archivo de deltas.
   - GSD: SDD e ingeniería de contexto.
   - Kiro: SDD, bugfix y carga condicional de reglas.

   Un estudio comparativo de 2026 concluye que ningún framework cubre con fuerza las seis dimensiones de proceso y que hay un trade-off entre profundidad y portabilidad (arXiv 2606.04967).
2. **La combinación es viable con condiciones, no al 100 %.** Fracasa si se implementa como más instrucciones:
   - El cumplimiento cae al aumentar las instrucciones (IFScale).
   - Los archivos de contexto suben el coste más de un 20 % sin mejorar resultados (ICLR 2026).
   - Los agentes ignoran el 67 % de las peticiones de logging.

   Funciona si cada pilar es una comprobación del CLI, proporcional a la ruta y al `scope`, con como mucho una frase de prompt.
3. **La versión 0.7.0-preview.2 ya cubre buena parte del RFC:**
   - SDD proporcional: fit v1/v2, rutas y arquetipos.
   - Criterios automatizados ligados a checks ejecutados.
   - Evidencia de UI tipada.
   - Decisiones de tecnología con fuentes oficiales fechadas.
   - Registro versionado de contratos.

   Faltan observabilidad, presupuesto de cambio medido, evidencia rojo→verde, carga perezosa real de las reglas de UI, dirección de arte positiva y un paso de destilación.
4. **Hallazgo de coste no previsto en el RFC.** Cada fase carga:
   - unos 1,6 k tokens de bloque común en la skill;
   - unos 2,9 k de `CONSTITUTION.md`, de los que el 56 % son protocolos de diseño, setup y tecnología que también se cargan en tareas de backend;
   - el historial completo del manifiesto en `status --json`. Desde 0.7, cada spec cerrada añade su aceptación completa: unos 4,2 KB (≈1.055 tokens) en un caso típico de UI, frente a unos 430 B sin ella. Con 12 specs son unos 50 KB por llamada.

   En Pulso360 (12 specs, 0.5.1), `specs/` ocupa unos 700 KB, de los que 381 KB son los `verification.json`.
5. **Llave de compatibilidad propuesta:** `fit.json` con `schemaVersion: 3`, que añade `scope`, `allowDependencyChanges` y `waivers` (motivos registrados para superar el presupuesto u omitir el rojo). Las comprobaciones nuevas solo aplican a specs v3; las v1/v2 y las ya existentes no cambian.
6. **En 0.8, el presupuesto de archivos es consultivo:** avisa, no bloquea. Solo bloquean las comprobaciones de alta precisión:
   - cambio semántico de dependencias sin permiso o sin decisión fechada;
   - falta del rojo en un bugfix con harness de tests;
   - sección de observabilidad ausente en specs v3 con plan;
   - falta de `automationGap` en criterios funcionales manuales cuando la spec ya automatiza otros.

   El piloto decidirá si el presupuesto pasa a bloquear en 0.9.
7. **Coste estimado tras la revisión adversarial, sin dependencias nuevas:**
   - Nivel 0, solo prompts y plantillas: ahorra unos 1,4–2,0 k tokens por fase de backend.
   - Nivel 1: unos 175 LOC de runtime.
   - Nivel 2: unos 375 LOC de runtime.
   - Tests: unos 670 LOC.
8. **Plan de implementación:**
   - Publicar 0.7.0 sin estos cambios.
   - Desarrollar 0.8 con OmniSpec gobernado por el runtime 0.7.0, no por el CLI que se modifica.
   - Trabajo previsto: una RFC y cinco features.
   - Añadir una prueba que limite el tamaño de los prompts.

---

## 1. Investigación de mercado, estado del arte y viabilidad real

### 1.1 Método y límites

Búsquedas web del 2026-10-24 y lectura directa de fuentes primarias cuando fue posible: README y plantillas en GitHub, arXiv y documentación oficial. Algunas cifras proceden de resúmenes y se marcan «(secundaria)». No se ejecutó ninguna herramienta de terceros.

El diseño de la §3 pasó además por una revisión adversarial independiente contra el código, de solo lectura. Sus hallazgos se verificaron en las líneas citadas y se incorporaron; la §3.6 los resume.

### 1.2 ¿Existe algo que combine SDD, TDD, ODD, presupuesto de complejidad y tokens, UI de alta factura y destilación de memoria?

| Proyecto | Pilares cubiertos | Mecanismo | Diferencia con la propuesta Omni |
| --- | --- | --- | --- |
| **GitHub Spec Kit** | SDD; TDD y observabilidad como *principios de ejemplo* («TDD mandatory», «Structured logging required»); justificación de complejidad | Constitución; puerta `Constitution Check` y tabla `Complexity Tracking` en la plantilla de plan, con columnas Violation / Why Needed / Simpler Alternative Rejected Because | Todo es prosa que el agente debe obedecer. No liga la evidencia a ejecuciones verificadas ni tiene presupuesto de tokens ni destilación. Críticas: Böckeler señala markdown repetitivo, agentes que ignoran instrucciones y exceso de ceremonia en cambios medianos. Scott Logic (secundaria) midió más de 2.000 líneas de markdown en una sola fase de plan. |
| **OpenSpec** | SDD y destilación | Deltas `ADDED/MODIFIED/REMOVED`; `archive` mueve el cambio a `changes/archive/` y actualiza `specs/` como fuente de verdad | Precedente más cercano al Pilar 6. No tiene TDD, ODD, UI ni presupuesto. |
| **Kiro (AWS)** | SDD, bugfix y carga condicional | requirements → design → tasks; *bugfix specs* (feb. 2026) con comportamiento actual, esperado y sin cambios; *steering* `always` / `fileMatch` / `manual` | Precedente del montaje perezoso por glob (Pilar 5.1). IDE propietario. |
| **BMAD + módulo TEA** | SDD ágil, ATDD y requisitos no funcionales (NFR) | Personas; `*atdd` genera tests de aceptación en rojo; además `*trace`, `*nfr-assess` y una puerta de release | Cubre TDD y NFR con mucha ceremonia y muchas personas. |
| **GSD / GSD Core** | SDD y economía de contexto | Subagentes con contexto nuevo de 200 k; `STATE.md` y `CONTEXT.md`; ciclo discuss → plan → execute → verify → ship | Precedente del Pilar 4.2. No tiene TDD ni UI y depende de subagentes del host. |
| **obra/Superpowers** | TDD y verificación antes de cerrar | Skills con la regla «NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST»; el rojo debe fallar por la razón correcta | Prosa de unas 300 líneas por skill, sin CLI ni huella. |
| **TDD Guard (nizos)** | TDD aplicado al editar | Hooks de Claude Code que bloquean ediciones sin un test fallido; validador con IA | Actúa al escribir, algo que OmniSpec no puede hacer de forma independiente del host. Solo funciona en hosts con hooks. |
| **Taskmaster AI** | Complejidad | `analyze-complexity` puntúa de 1 a 10 y sugiere subtareas | Usa la complejidad para descomponer, no como tope verificable. |
| **Consort** (arXiv 2609.09671) | SDD y TDD aplicado | Tests inmutables, puertas implementadas en código y verde contra una rama de base de datos | Investigación con hipótesis preregistrada, atada a ramas de base de datos. |
| **Anthropic `frontend-design`** | UI de alta factura | Dirección estética explícita: tipografía, tema, movimiento y fondos; unos 400 tokens cargados *just-in-time* | Precedente de los Pilares 5.1 y 5.3. Anthropic admite que el modelo sigue convergiendo en elecciones comunes (por ejemplo, Space Grotesk). No exige evidencia renderizada. |
| **Impeccable** | UI de alta factura | Vocabulario de diseño, comandos `audit` y `polish`, y detector determinista de 61 reglas (`npx impeccable detect`, secundaria) | Solo UI. Útil como check externo opcional. |
| **Vercel Web Interface Guidelines** | Calidad de interfaz | Comando de revisión de accesibilidad, foco, formularios y animación | Solo revisión de UI. |
| **Context7** | Vigencia de APIs | Documentación por versión obtenida en el momento de la consulta | Solo cubre el Pilar 4.3 y es un servicio externo. |
| **OSpec** (`@clawplays/ospec-cli`) | SDD y evidencia | proposal, design, plan, tasks, reviews y evidencia de verificación | Colisión de nombre y de posicionamiento que conviene vigilar. |

**Conclusión.** Las piezas existen por separado. «Unificar seis paradigmas» no puede probarse; lo que sí distingue a OmniSpec son tres rasgos que ya tiene:
- verificación ligada a una huella del proyecto;
- ceremonia proporcional (fit);
- portabilidad entre hosts sin hooks.

Recomiendo no usar «único del mercado» en documentación pública.

### 1.3 Evidencia sobre límites de atención, coste y fiabilidad

| Evidencia | Hallazgo | Implicación para OmniSpec |
| --- | --- | --- |
| IFScale (arXiv 2507.11538, NeurIPS 2025) | Con 500 instrucciones, el mejor modelo llega al 68 % de exactitud. La caída es lineal en Claude Sonnet 4 y GPT-4.1, con sesgo hacia las primeras instrucciones. | Cada pilar añadido en prosa reduce el cumplimiento de los demás. Lo crítico va al principio y el resto, al CLI. |
| *Evaluating AGENTS.md* (arXiv 2602.11988, ICLR 2026) | Los archivos de contexto no mejoran el éxito y suben el coste más de un 20 %. Los autores recomiendan requisitos mínimos. | `HOST_RULE`, `CONSTITUTION.md` y el bloque común deben reducirse. |
| Chroma, *Context Rot* (2025) | El rendimiento se degrada con la longitud de la entrada, incluso en tareas simples. | El historial de specs y los logs deben quedar fuera del contexto por defecto. |
| Anthropic, *Effective context engineering* (2025) | Buscar el «smallest possible set of high-signal tokens»; cargar *just-in-time* mediante identificadores; compactar; tomar notas estructuradas. | `readSet` calculado por el CLI y catálogo compacto de contratos. |
| Logging de agentes (arXiv 2604.09409) | En 4.550 PR, los agentes incumplen el 67 % de las peticiones de logging y los humanos hacen el 72,5 % de las reparaciones. Los autores proponen guardarraíles deterministas. | La observabilidad no puede ser solo una sección: las señales críticas deben ser criterios ligados a checks. |
| *Over-mocked tests* (MSR 2026, arXiv 2602.00409) | Los commits de agentes añaden mocks en el 36 % de los casos, frente al 26 % de los humanos. | La auditoría de tests en el ciclo rojo→verde debe vigilar los mocks. |
| ImpossibleBench (arXiv 2510.20270, ICLR 2026) | Los modelos frontera explotan los tests con frecuencia, más cuanto más capaces (secundaria: 76 % en GPT-5). | No basta con que el agente diga que escribió el test primero: hay que comparar los archivos de test entre el rojo y el verde. |
| Kent Beck, *augmented coding* | El agente borra o desactiva tests para que «pasen». | Mismo control que la fila anterior. |
| Alucinación de paquetes (USENIX Sec. 2025, vía CSO) | Al menos el 5,2 % de los paquetes que sugieren los modelos comerciales no existe (21,7 % en modelos abiertos), y el 43 % reaparece. | La regla de vigencia exige comprobar la existencia en el registro oficial. |
| APIs obsoletas (arXiv 2406.09834, ICSE 2025) | Todos los LLM evaluados producen usos obsoletos. | Consultar el registro y la documentación oficial al decidir. |
| Reglas por glob en hosts (anthropics/claude-code#17204) | El campo `paths:` documentado falló en algunas configuraciones. | Calcular el recorte en el CLI en lugar de depender de la carga condicional del host. |
| Pair programming con IA (revisión sistemática, ASEE 2026) | La evidencia es limitada y mixta. | Driver/Navigator como protocolo ligero de checkpoints, sin prometer productividad. |
| Thoughtworks Radar | SDD en «Assess» (nov. 2025). | Técnica aún en evaluación: medir antes de ampliar el alcance. |

### 1.4 Viabilidad por pilar: riesgos y ajustes

| Pilar | Riesgo real | Ajuste para que sea práctico |
| --- | --- | --- |
| 1 SDD proporcional | El agente declara menos archivos (`files`) de los reales para obtener la ruta light. | Al verificar, comparar lo declarado con lo tocado (Pilar 4). |
| 2 TDD con «candado» | Sin hooks universales no se puede impedir escribir el código antes que el test. Un rojo puede deberse al entorno, a otro check (lint) o a un test debilitado después. Si la corrección ya existe, no se puede volver a registrar el rojo. | Llamarlo **evidencia rojo→verde**, no candado. `--check <id>` es obligatorio: hay RED_GREEN cuando el mismo check falló (`check-failed`) en el rojo y pasó en el verde. Los tests modificados tras el rojo son informativos y van a revisión. Obligatorio solo en bugfix v3 fuera de light con `existingTests: true` y un criterio funcional automatizado; si no, `waivers.red` registra el motivo. En el resto, recomendado. |
| 3 ODD | La prosa se ignora (67 %). | Sección corta con N/A justificado, auditada solo en specs v3 con plan. Las señales críticas se expresan como criterios `[functional]` ligados a checks. No imponer una librería de logs. |
| 4.1 Tope de complejidad | Falsos positivos frecuentes: varias specs IN_PROGRESS en el mismo árbol; `git pull`, rebases y formateadores; `update` y `setup-agent`, que reescriben adaptadores, y `configure`, que reescribe la constitución; reglas de ignorado nuevas; lockfiles; plantillas `.html` de backend; docs; y renombres, que cuentan como dos rutas. | **Consultivo en 0.8:** cuenta solo fuente que no sea test ni doc, excluye los archivos gestionados por OmniSpec (`specs/.omni/managed.json`) y los que desaparecen porque pasaron a estar ignorados, y aplica una tolerancia de `files + max(2, ceil(files/2))`. Superarla genera un aviso y un bloqueo propio en `status`, que se cierra con `waivers.budget`, como el *Complexity Tracking* de Spec Kit. Solo bloquea un cambio semántico en las secciones `*dependencies` de `package.json` sin `allowDependencyChanges`. |
| 4.2 Presupuesto de lectura | Una prohibición absoluta no se puede imponer en todos los hosts, y a veces el historial hace falta (regresiones). | Directiva corta, `readSet` calculado por el CLI y una excepción («salvo que el usuario lo pida o lo cite un contrato o decisión»). Endurecer con permisos del host es opcional. |
| 4.3 Vigencia | Sin web no se puede comprobar, y «la última versión» no siempre es compatible. | Conservar la regla actual (estable según la política oficial; provisional sin web). Añadir existencia en el registro, preferencia por la API nativa y una decisión fechada ligada a la spec. |
| 5.1 Montaje perezoso | El agente declara `backend` para saltarse las reglas de UI. | Aviso `SCOPE_MISMATCH` cuando se tocan archivos de UI. |
| 5.2 Cinco estados | La versión 0.7 retiró a propósito «4 Mandatory Interface States» (`test/craft-hardening.test.mjs:39,82`). Buscar palabras como «Error» es un control débil, y pedir cinco N/A para un cambio de texto es fricción. | La lista de estados vive en `guide design` y en el texto guía de la plantilla. El audit solo exige una sección §4 *Experience and limits* sustantiva, o N/A justificado, con `scope` ui o fullstack en las rutas standard y full. La revisión semántica (omni-auditor) comprueba los cinco estados. |
| 5.3 Alta factura | La convergencia distribucional persiste, el gusto es subjetivo y las recetas fijas se retiraron en rc.1. | Contrato de dirección de arte (decisiones y rangos, no recetas), referencias reales, evidencia renderizada y preferencia del usuario sobre una superficie representativa. |
| 6 Destilación | Resumir pierde información y puede desviarse; prohibir el historial puede ocultar contexto necesario. | El historial queda en disco. Solo se destilan decisiones y contratos con `sourceSpec` y evidencia, y se avisa cuando el contexto crece demasiado. |
| XP Driver/Navigator | Demasiados checkpoints agotan al usuario. | Pausar solo ante un cambio de contrato, una dependencia o un presupuesto superado; el resto son incrementos autónomos verificables. |

**Veredicto.** Aproximadamente el 80–85 % del RFC es viable con estos ajustes. No es viable tal como está escrito:
- probar de forma determinista que el test precedió al código;
- prohibir lecturas en cualquier host;
- afirmar unicidad en el mercado o una viabilidad del 100 %.

**Nombres.** Las siglas chocan con términos establecidos:
- «MDD» suele leerse como *Model-Driven Development*, el precedente que Böckeler cita como advertencia para SDD.
- «CDD» se confunde con *Component-*, *Contract-* o *Consumer-Driven*.
- «CTD» se confunde con *Combinatorial Test Design*.

En la documentación conviene usar nombres descriptivos: destilación de memoria, presupuesto de cambio, dirección de arte de UI.

---

## 2. Mapa de cobertura actual (0.7.0-preview.2)

### 2.1 Cobertura por pilar

| Pilar | Dónde está hoy | Cómo funciona | Qué falta | % |
| --- | --- | --- | --- | --- |
| **1 SDD proporcional** | `src/fit.mjs:10-69` (preguntas v1/v2), `:132-207` (clasificación), `:223-230` (`specRoute`); `src/auditor.mjs:82-99`; `src/cli.mjs:389-430`; `src/generator.mjs:36-61` (4 arquetipos) | La ruta se deriva de respuestas declaradas. **v1:** bugfix → full; ≥3 archivos, ≥2 módulos, contrato, ambigüedad o razonamiento incompleto → full; sin tests → standard. **v2:** añade riesgo, incertidumbre y reversibilidad, y admite bugfix light. El audit exige los artefactos de la ruta. | `scope` y contraste entre lo declarado y lo tocado. La validación rechaza claves desconocidas (`fit.mjs:121-123`, `additionalProperties: false`), así que ampliar el esquema exige v3. | 85 % |
| **2 TDD** | `src/acceptance.mjs:67-78,177-226`; `src/verification.mjs:254-336`; `src/checks.mjs`; skill implement (`src/workflows.mjs:142`); `fix.md` | Un criterio `automated` debe referenciar `checkIds` configurados; el CLI lo marca PASSED, FAILED o NOT_RUN según la ejecución actual. La reproducción previa en bugfix solo se pide en prosa («when feasible»). | Evidencia del rojo y una política que limite `manual` e `inspection` en criterios funcionales de standard y full. En Pulso360, el 62,5 % de los criterios no estaba automatizado. | 45 % |
| **3 ODD** | Plantilla `plan.md:9-10` («failure behavior»); constitución «Fail-Fast» (`src/generator.mjs:86`); `rca.md` («Cite logs») | Fallos explícitos y sin excepciones tragadas. | No hay contrato de observabilidad, sección ni comprobación. | 15 % |
| **4.1 Tope de complejidad** | `fit.files` y `fit.modules` (estimación); «Minimal Touch Surgery» (`generator.mjs:81`); implement «Do not add files…» (`workflows.mjs:141`); `snapshot.mjs:311-369,407-412`; `CONTEXT_NAMES` (`project-state.mjs:17-55`) | La estimación elige la ruta. Cambiar un manifiesto de dependencias deja el contexto STALE y bloquea `verify` hasta reconciliar (control indirecto). | Línea base al crear la spec, comparación entre archivos tocados y declarados, y política de dependencias (los lockfiles no son entradas de contexto). | 30 % |
| **4.2 Presupuesto de lectura** | Bloque común: «Read CONSTITUTION.md, specs/project-context.md and CLI status --json» (`workflows.mjs:7`); init acota el descubrimiento (`:63`) | Lectura base fija. | No prohíbe abrir specs cerradas ni `verification.json`. `DESIGN` se carga siempre. `status --json` devuelve el manifiesto entero (`project-state.mjs:533-534`). | 25 % |
| **4.3 Vigencia de dependencias** | `TECHNOLOGY` (`protocols.mjs:6-10`: «do not present training memory as current research»); `validSource` exige `authority: "official"` y fecha (`project-state.mjs:146-154,178-191`); `plan.md:12-13`; omni-auditor | Toda decisión de tecnología aprobada o delegada necesita fuentes oficiales fechadas, que el CLI valida. | Vincular los cambios de dependencias de la spec con esa decisión, consultar el registro de forma explícita y preferir lo nativo. | 60 % |
| **5.1 Montaje perezoso** | `guide design` (`cli.mjs:240-248`, `src/resources/design.md`); omni-plan «run guide design» (`workflows.mjs:113`) | La guía existe y se carga bajo demanda. | Se anula porque `DESIGN` también va en `CONSTITUTION.md` §5 (`generator.mjs:125-127`) y en omni-plan (`workflows.mjs:114`). Ningún `scope` decide si se carga. | 40 % |
| **5.2 Cinco estados** | `DESIGN` (`protocols.mjs:23`); `spec.md:21-22`; evidencia de UI tipada (`acceptance.mjs:79-150`: tipos visual, interaction y accessibility, observaciones, viewport y sesión con render) | Sistema de evidencia de UI robusto; estados «aplicables» con N/A. | Matriz explícita de cinco estados (parcial/overflow e ideal no se nombran) y auditoría según `scope`. | 50 % |
| **5.3 Alta factura** | `DESIGN` (`protocols.mjs:21-22`); `design.md:11-13` («uno o dos rasgos de identidad») | Proceso de referencias y evidencia renderizada, sin receta. | Arquetipo nombrado, tokens con números, movimiento y pulido. Las reglas actuales evitan errores, pero no orientan hacia una interfaz visualmente rica. | 25 % |
| **6 Destilación** | `src/contracts.mjs` (capability, scope, decision, evidence y sourceSpec; activar exige spec COMPLETED, `:163-164`); decisiones con `appliesTo` (`project-state.mjs:386-431`); `project-context.md`; `complete` libera la spec activa (`verification.mjs:439-442`) | La base de memoria compacta ya existe. | Paso de destilación en converge y complete; lectura compacta (`listContracts({status})` existe en `contracts.mjs:99-107`, pero el CLI no lo expone); regla de no leer specs cerradas; control del tamaño de `status`. | 35 % |
| **XP Driver/Navigator** | `QUESTIONS` (`protocols.mjs:3-4`: lotes pequeños, recomendación, delegación); tareas ligadas a criterios (`workflows.mjs:124-125`); «Avoid task inflation» | Cadencia de preguntas y trazabilidad de criterio a tarea. | Bucle de incrementos (rojo, verde, diff, siguiente) y disparadores de checkpoint. | 40 % |

Los porcentajes son una estimación propia de los requisitos del RFC que ya cubre el código o el texto existente; no salen de una métrica automática.

### 2.2 Tamaño de los prompts generados

Medido con el generador real (`OMNI_SKILLS` y `buildConstitutionContent`). Tokens aproximados como caracteres/4.

| Artefacto | Caracteres | ≈ Tokens | Nota |
| --- | --- | --- | --- |
| Bloque común (incluido en las 9 skills) | 6.522 | 1.631 | Se carga en cada fase |
| omni-init | 22.735 | 5.684 | |
| omni-plan | 12.925 | 3.231 | Incluye `TECHNOLOGY` (≈508) y `DESIGN` (≈663) |
| omni-converge | 10.487 | 2.622 | |
| omni-specify / omni-discuss / omni-implement | ≈8.390 | ≈2.095 | |
| omni-tasks / omni-audit / omni-clarify | 7.030–7.562 | 1.758–1.891 | |
| `CONSTITUTION.md` (perfil general) | 11.488 | 2.872 | `DESIGN` + `TECHNOLOGY` + `SETUP` = 6.439 caracteres (56 %); otros perfiles: 11.413–11.708 |
| `HOST_RULE` (`AGENTS.md`) | 1.374 | 344 | |

Antes de leer código, cada fase consume aproximadamente:
- la skill: 1,8–5,7 k;
- la constitución: 2,9 k;
- `project-context.md`: unos 3 k en Pulso360;
- `status --json`, que crece con el historial.

En total, unos 8–12 k tokens, más el historial.

Para reproducir la medición (solo lectura):

```bash
node --input-type=module -e "const w=await import('./src/workflows.mjs');const g=await import('./src/generator.mjs');for(const s of w.OMNI_SKILLS)console.log(s.name,s.instructions.length);console.log('constitution',g.buildConstitutionContent({projectName:'X',profile:'general'}).length)"
```

### 2.3 Datos de campo: Pulso360 (0.5.1, solo lectura)

- **12 specs**, todas feature; ocho son de UI.
- **`specs/` ocupa 719.503 bytes:**
  - markdown: 288.459 (unos 24 KB por spec);
  - `verification.json`: 381.101 (unos 31 KB por spec), porque guarda hasta 16.000 caracteres de salida por check (`src/verification.mjs:148` sigue igual en 0.7);
  - `acceptance.json`: 19.914;
  - `project-context.md`: 12.183.
- **Métodos de aceptación:** 27 automated, 39 manual y 6 inspection (62,5 % sin automatizar).
- **Sin `fit.json`**, porque fit no existía en 0.5.x.

Los datos de 0.5.1 son orientativos para 0.7.

### 2.4 Hallazgos adicionales

1. **`status --json` crece con el historial.**
   - `projectStatus` devuelve `{...manifest, progress}` (`project-state.mjs:533-534`).
   - Desde 0.7, `complete` guarda la aceptación ligada completa (criterios, checks y observaciones) en `manifest.specs[].verification.acceptance` (`verification.mjs:433-438`).
   - Medido con el `bindAcceptance` real sobre un caso de 6 criterios (3 automatizados, 2 de UI manuales con una observación cada uno y 1 de inspección): **4.218 bytes (≈1.055 tokens) por spec cerrada** en `status --json` con formato indentado, frente a 428 bytes sin `acceptance`.
   - Eso supone unos 50 KB (≈12,6 k tokens) por llamada con 12 specs y unos 210 KB con 50. Las skills piden `status --json` al empezar cada fase.
   - Un test fija ese dato en el manifiesto (`test/acceptance.test.mjs:108-110`): conviene recortar solo la salida de `status`.
2. **La misma política de diseño está en tres sitios:** constitución §5, omni-plan y `guide design`.
3. **`update` no reemplaza `CONSTITUTION.md`** (`updater.mjs:76-91`). Una constitución más ligera solo llega a instalaciones nuevas; las existentes reciben la referencia en `specs/.omni/reference/CONSTITUTION.md`.
4. **`src/resources/design.md` solo está en español**, mientras que las skills están en inglés y existe `manifest.language`. Es menor; conviene ofrecer una variante por idioma.
5. **Las 9 skills salen de una única fuente:** `src/workflows.mjs` → `OMNI_SKILLS`, que regeneran `scripts/build-plugin-skills.mjs` e `integrations.mjs`. Cambiarlas equivale a editar un archivo y regenerar.

---

## 3. Diseño de cambios quirúrgicos

### 3.0 Principios

1. **fit v3 es la llave de compatibilidad.** Las comprobaciones nuevas solo aplican si `fit.json.schemaVersion === 3`. Las specs v1/v2, las existentes y las RFC no cambian.
2. **Los campos son aditivos.** `verification.json` sigue en versión 3, `acceptance.json` en 2 y `checks.json` en 1. Un registro sin los campos nuevos se trata como `NOT_EVALUATED`.
3. **Lo determinista va al CLI.** Cada pilar recibe como mucho una frase de prompt y el prompt base debe reducirse en neto.
4. **Proporcionalidad.** La ruta light no gana artefactos y toda sección nueva admite N/A con motivo.
5. **Escape honesto.** Superar el presupuesto u omitir el rojo se justifica en `waivers`; la estimación original se conserva.
6. **Consultivo antes que bloqueante.** Las comprobaciones con riesgo de falsos positivos empiezan como avisos medidos en el piloto. Solo bloquean las de alta precisión.
7. **Nada pesado bajo el `manifest.lock`.** El hash de la línea base se calcula fuera del lock. Si falla (enlace simbólico, límites del snapshot o archivos solo en la nube de OneDrive), el resultado es `NOT_EVALUATED`, sin romper `create` ni `focus`.

### 3.1 CLI y runtime

| Nivel | Archivo · función | Cambio | LOC |
| --- | --- | --- | --- |
| 1 | `src/fit.mjs` · `FIT_SUPPORTED_SCHEMA_VERSIONS`, `FIT_V3_QUESTIONS`, `VALUE_CHECKS`, `validateFitAnswers`, `classifyFit`, `fitQuestionnaire` | v3 = v2 + `scope` obligatorio (las RFC usan `docs`), más `allowDependencyChanges` y `waivers` opcionales, validados fuera del bucle de respuestas obligatorias (`:113-123`). Cada rama `=== 2` debe pasar a `>= 2` (`:112`, `:139`, `:238`, `:260`); si no, una v3 se trataría como v1 y un bugfix iría siempre a full. Clasifica como v2, y `allowDependencyChanges: true` sube de light a standard. | +60 |
| 1 | `src/cli.mjs` · `fit` (`:398` `fitQuestionnaire(2)` → `3`; el texto de `:401` fija `"schemaVersion": 2`); `contracts --active` con `contractEffectiveSnapshot` (`contracts.mjs:115-117`), no `current`, que puede ser una propuesta pendiente; `--red` exige `--check` y es incompatible con `--manual` | Superficie mínima de comandos | +35 |
| 1 | `src/auditor.mjs` · `auditSpec` | Solo v3 en standard y full: encabezado *Observability/Observabilidad*, con contenido o N/A de al menos 20 caracteres, en `plan.md` (feature) y `fix.md` (bugfix). El error incluye el fragmento exacto que hay que añadir, porque las plantillas del proyecto pueden ser antiguas: `createSpec` prefiere `specs/_templates` (`generator.mjs:302-307`) y el modo plugin no las refresca. Con `scope` ui o fullstack, la §4 *Experience and limits* de `spec.md` debe ser sustantiva o N/A justificado; no se buscan los cinco nombres. | +50 |
| 1 | `src/project-state.mjs` · `projectStatus` | `progress.readSet` con `files`, `guides` y `avoid`, que cae a la ruta full si fit falta o es inválido; omni-init queda exento. Quitar `verification.acceptance` de las specs no activas solo en la salida. Bloqueos propios `BUDGET_OVER_ESTIMATE` (aviso), `RED_EVIDENCE_REQUIRED` y `DEPENDENCY_DECISION_REQUIRED`, para que no aparezcan como `STALE_OR_INVALID_VERIFICATION` con la acción «verify», que provocaría un bucle (`:502-511`). | +45 |
| 1 | `src/context-auditor.mjs` · `auditProjectContext` | Aviso «destila» si `project-context.md` supera unos 24 KB (≈6 k tokens) | +4 |
| 1 | `src/verification.mjs:148` | La cola de salida guardada en el registro baja de 16.000 a 4.000 caracteres. El log completo ya se guarda y se hashea aparte, y `test/checks.test.mjs:42` usa `<=`. | ±1 |
| 2 | `src/budget.mjs` (nuevo) | `recordBaseline`: mapa de ruta a sha256 de los archivos fuera de `specs/`, con las reglas de `hashProjectFiles` y el mismo truncado en ambos lados de la comparación (si no, `changedFiles` marcaría todo como tocado, `snapshot.mjs:360-363,408-412`), más las secciones `*dependencies` de cada `package.json`. Se escribe en `specs/.omni/baselines/<id>.json` junto a un `.gitignore` con `*`, que no depende de que `update` refresque la sección gestionada. `classifyPath` distingue test, doc, dependencia, UI, fuente y archivo nuevo, y excluye los archivos de `managed.json` y los que desaparecieron pero siguen en disco (patrón `exists()` de `project-state.mjs:297`). `evaluateBudget`. Omite RFC y specs que no estén IN_PROGRESS. | +140 |
| 2 | `src/generator.mjs` · `createSpec`; `src/manifest.mjs` · `focusSpec` | Grabar la línea base **después** de liberar el lock (hoy `createSpec` corre bajo `withManifestLock`, `generator.mjs:256`); si falta, al enfocar. Los errores se registran como `NOT_EVALUATED`. | +20 |
| 2 | `src/verification.mjs` · `projectSnapshot`, `verifySpec`, `describeFailure` | Solo para specs v3, añadir al snapshot una clave `#baseline` con el digest de la línea base: borrarla o volver a tomarla invalida la verificación y el registro se puede creer sin recalcular, porque `fit.json` y las decisiones ya están en la huella (`:72-77`, `:98-103`). `verify` añade `budget` y `tdd` al registro, y pone `passed=false` solo ante hallazgos bloqueantes (dependencias), con un motivo propio en `describeFailure`. La decisión de tecnología se compara con `recordedAt` de la línea base (`consultedAt >=`), no con `created_at`, que es solo una fecha UTC (`generator.mjs:310`), y se usa `decisionApplies` (`project-state.mjs:589-593`) para incluir las decisiones globales. | +60 |
| 2 | `src/verification.mjs` · `verifyRed` (nuevo) | Preparación propia: contexto fresco y audit válido, aunque haya tareas pendientes, `[TODO]` en `verification.md` o criterios pending. Ejecuta **solo** los checks de `--check`, porque el bucle normal se detiene en el primer fallo (`:279-284`) y un lint rojo pasaría por rojo de test. Exige `check-failed` y escribe `specs/<slug>/red.json`, que entra en la huella. Los logs del rojo son locales (`specs/.omni/verification-logs/` está ignorado): otra máquina ve el registro, pero no puede revalidar sus hashes. | +150 |
| 2 | `src/acceptance.mjs` · `reviewAcceptance` (recibe la ruta y las respuestas de fit) | `automationGap` (≥20 caracteres) se exige en criterios `functional` manuales o de inspección en v3 standard/full, solo cuando otro criterio de la misma spec está automatizado y el `scope` no es docs ni config. Hay que conservar el campo en el mapeo de salida (`:155-162`). En bugfix v3 aplica la política de rojo de la §1.4. | +25 |

**Totales tras la revisión adversarial:** Nivel 1, unos 175 LOC; Nivel 2, unos 375 LOC; tests, unos 670 LOC (fit v3, presupuesto con sus falsos positivos, rojo→verde, `readSet`, auditoría v3, tope de prompts y paridad de skills). Mi primera estimación era de unos 415 LOC de runtime; la revisión añadió robustez: cálculo fuera del lock, `waivers`, exclusiones y vínculo de la línea base con la huella. Solo se usan `node:fs`, `node:crypto` y `node:path`.

**Clasificación de rutas (`classifyPath`):**
- **Test:**
  - segmentos `test`, `tests`, `__tests__`, `e2e`, `cypress` o `playwright`;
  - patrones `*.test.*`, `*.spec.*`, `*_test.go`, `test_*.py`, `*_test.py`, `*Test.java`, `*Tests.cs` y `*_spec.rb`.
- **Dependencia:**
  - los nombres de `CONTEXT_NAMES` y `requirements*.txt`;
  - lockfiles: `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock(b)`, `poetry.lock`, `Pipfile.lock`, `uv.lock`, `Cargo.lock`, `go.sum`, `composer.lock`, `Gemfile.lock`, `pubspec.lock`, `gradle.lockfile` y `packages.lock.json`;
  - en `package.json` solo cuentan las secciones `*dependencies`; cambiar `scripts` no cuenta;
  - otros manifiestos sin lockfile cambiado se marcan como posible cambio, solo con aviso.
- **Doc:** `*.md`, `docs/`, `CHANGELOG*` y carpetas de i18n (`locales/`, `i18n/`). No cuentan para el presupuesto.
- **UI:** `.css`, `.scss`, `.sass`, `.less`, `.tsx`, `.jsx`, `.vue`, `.svelte`, `.astro` y `.html`. Solo alimentan el aviso de `scope`, porque `.html` y `.hbs` también pueden ser plantillas de backend.
- **Nuevo:** ruta ausente en la línea base. Se informa aparte como señal de capas o abstracciones nuevas.

### 3.2 Esquemas JSON (campos opcionales y retrocompatibles)

**`schema/fit.schema.json`.** Cambia el `enum` de `schemaVersion` y se añaden tres propiedades. El bloque `if/then/else` actual pasa a ser este `allOf`, con `additionalProperties: false` sin cambios:

```json
{
  "properties": {
    "schemaVersion": { "enum": [1, 2, 3] },
    "scope": {
      "enum": ["backend", "ui", "fullstack", "docs", "config"],
      "description": "Version 3. Surface of the change; ui/fullstack mount guide design and the five-state review. Does not change the route."
    },
    "allowDependencyChanges": {
      "type": "boolean",
      "default": false,
      "description": "Version 3. Dependency manifests/lockfiles may change only when true; requires a dated technology decision for this spec and escalates light to standard."
    },
    "waivers": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "budget": { "type": "string", "minLength": 30, "description": "Why more source files were touched than the files estimate allows. The estimate is kept." },
        "red": { "type": "string", "minLength": 30, "description": "Why a required red run could not be recorded (no reproducing check, fix already present)." }
      },
      "description": "Version 3. Recorded, reviewable exceptions; they never rewrite estimates or evidence."
    }
  },
  "allOf": [
    {
      "if": { "properties": { "schemaVersion": { "enum": [2, 3] } } },
      "then": { "required": ["risk", "uncertainty", "reversibility"] },
      "else": { "properties": { "risk": false, "uncertainty": false, "reversibility": false } }
    },
    {
      "if": { "properties": { "schemaVersion": { "const": 3 } } },
      "then": { "required": ["scope"] },
      "else": { "properties": { "scope": false, "allowDependencyChanges": false, "waivers": false } }
    }
  ]
}
```

**`fit.json` v3 (ejemplo):** ruta light; tolerancia de 2 + max(2, 1) = 4 archivos de fuente.

```json
{
  "schemaVersion": 3,
  "reasoning": "done",
  "files": 2,
  "modules": 1,
  "crossesContract": false,
  "ambiguity": "none",
  "existingTests": true,
  "risk": "low",
  "uncertainty": "clear",
  "reversibility": "easy",
  "scope": "ui",
  "allowDependencyChanges": false
}
```

**`schema/acceptance.schema.json`.** Se queda en `schemaVersion: 2`, con un campo opcional por criterio (`additionalProperties` ya es `true`):

```json
"automationGap": {
  "type": "string",
  "minLength": 20,
  "description": "Why a functional criterion on a fit v3 standard/full route cannot be bound to a configured check."
}
```

**`verification.json`.** El registro sigue en versión 3 y gana dos bloques. Valores posibles:
- `budget.status`: `WITHIN`, `OVER_ESTIMATE` (consultivo), `WAIVED` o `NOT_EVALUATED`.
- `findings[].severity`: `warning` o `blocking`. En 0.8 solo bloquean `DEPENDENCY_CHANGE_NOT_ALLOWED` y `DEPENDENCY_DECISION_MISSING`.
- `tdd.status`: `RED_GREEN` (el mismo check falló en el rojo y pasó en el verde), `TESTS_CHANGED_AFTER_RED` (informativo, a revisión), `NO_RED_RECORD`, `WAIVED` o `NOT_APPLICABLE`.

```json
"budget": {
  "status": "OVER_ESTIMATE",
  "mode": "advisory",
  "baselineAt": "2026-11-03T14:02:11.000Z",
  "declaredFiles": 2,
  "allowedFiles": 4,
  "touched": {
    "source": ["src/export.mjs", "src/routes/report.mjs", "src/lib/format.mjs", "src/lib/csv.mjs", "src/lib/xlsx.mjs"],
    "tests": ["test/export.test.mjs"],
    "docs": ["README.md"],
    "dependencies": [],
    "ui": [],
    "created": ["src/lib/xlsx.mjs"]
  },
  "findings": [
    { "code": "FILES_OVER_ESTIMATE", "severity": "warning", "detail": "5 source files > 4 allowed; record waivers.budget or reduce the change" },
    { "code": "MULTIPLE_ACTIVE_SPECS", "severity": "warning", "detail": "Spec 003 is also IN_PROGRESS in this tree; touched files may belong to it" }
  ]
},
"tdd": {
  "status": "RED_GREEN",
  "redAt": "2026-11-03T14:20:40.000Z",
  "redCheckIds": ["api-test"],
  "testFilesChangedAfterRed": []
}
```

**`specs/<slug>/red.json` (nuevo, versionado con la spec y atestado por la huella).** Los logs referenciados son locales; los digests de los tests son informativos, porque CRLF los cambia en otra máquina.

```json
{
  "version": 1,
  "id": "004",
  "recordedAt": "2026-11-03T14:20:40.000Z",
  "fingerprint": "<huella del snapshot en el rojo>",
  "checks": [
    {
      "checkId": "api-test",
      "exitCode": 1,
      "errorType": "check-failed",
      "outputLog": "specs/.omni/verification-logs/<uuid>.log",
      "outputLogHash": "<sha256>"
    }
  ],
  "testFiles": { "test/export.test.mjs": "3f1c9a0b7d2e4c11" }
}
```

**`specs/.omni/baselines/<id>.json` (nuevo y local).** La carpeta incluye su propio `.gitignore` con `*`. En specs v3, el digest de este archivo entra en la huella como `#baseline`.

```json
{
  "version": 1,
  "id": "004",
  "recordedAt": "2026-11-03T14:02:11.000Z",
  "digest": "sha256-16",
  "files": { "src/export.mjs": "9f86d081884c7d65" },
  "packageDependencies": { "package.json": { "dependencies": { "express": "^5.1.0" } } }
}
```

**`status --json`.** Se añade un campo; las specs no activas salen sin `verification.acceptance`, aunque el manifiesto la conserva:

```json
"readSet": {
  "files": ["CONSTITUTION.md", "specs/project-context.md", "specs/004-export/spec.md", "specs/004-export/plan.md", "specs/004-export/acceptance.json", "specs/004-export/fit.json"],
  "guides": ["design"],
  "avoid": ["other specs", "specs/*/verification.json", "specs/.omni/", "specs/_templates/"]
}
```

`schema/verification.schema.json` (opcional, unas 60 líneas): solo documenta el registro y no se valida en tiempo de ejecución.

### 3.3 Plantillas y las 9 skills

Se edita una sola fuente: `src/workflows.mjs` y `src/protocols.mjs`. Después se regenera con `npm run build:skills`, y `update` propaga el resultado a los proyectos.

| Ubicación | Cambio exacto (texto en inglés, como hoy) | Δ tokens |
| --- | --- | --- |
| Bloque común (`workflows.mjs:7`) | Reemplazar «Read CONSTITUTION.md, specs/project-context.md and CLI status --json before acting.» por: «Run status --json first. Outside onboarding, read CONSTITUTION.md, specs/project-context.md and progress.readSet, plus files you will change or that they cite. Do not open other specs, verification.json, verification logs, specs/.omni or _templates unless the user asks or a decision or contract cites them; use contracts --active for earlier capabilities.» | +55 |
| Bloque común (`workflows.mjs:22`) | Dejar solo «For every factual citation, read the exact supporting passage and cite the file that contains it.». El formato de enlaces y el ejemplo pasan a omni-converge; omni-init ya tiene reglas equivalentes en `:55`. | −110 |
| `QUESTIONS` (`protocols.mjs:3`) | «Group a small number of material questions» → «Ask at most three material questions per turn, each with your recommendation» (cadencia ping-pong de XP) | ≈0 |
| `TECHNOLOGY` (`protocols.mjs:6-10`) | Añadir: «Never pin a version from memory: query the official registry or release page when deciding (for example npm view <pkg> version time --json), confirm the package exists and is maintained, prefer a runtime-native API when it suffices, and record the decision with dated sources before allowing dependency changes.» | +60 (solo init/plan) |
| omni-specify (`workflows.mjs:95`) | Sustituir la lista inline de claves de fit por: «Run fit <id> and answer its printed questionnaire in specs/<slug>/fit.json (schemaVersion 3, including scope and allowDependencyChanges, default false); earlier versions keep their routes. files is also the change budget verify compares with touched source files.» | −45 |
| omni-plan (`workflows.mjs:113-114`) | Quitar `${DESIGN}`. Sustituir la línea 113 por: «If fit scope is ui or fullstack, run guide design and record the art-direction contract, tokens and five-state matrix in the UI section; otherwise skip UI guidance.» Añadir: «Fill Observability: failure signals (structured log event, error code or metric), where they are read and which AC checks them; N/A with reason for cosmetic or light changes.» | ≈ −600 |
| omni-implement (`workflows.mjs:142`) | Sustituir la frase de bugfix por el bucle Driver/Navigator: «Work in verifiable increments (one task, or one criterion on light/standard): pick the narrowest reviewed check, make it fail for the expected reason (bugfix: record it once with verify <id> --red --check <id>), implement the minimum, rerun it and summarize the diff in at most five lines. Pause for the user before changing a contract, adding a dependency or exceeding the fit files estimate.» | +60 |
| omni-converge (`workflows.mjs:159`) | Añadir: «Before verify, if the change created or altered a durable capability, propose its contract with contract-record (status proposed, decision in at most two sentences); after complete, activate it with this spec as sourceSpec; otherwise state that no durable contract applies. If verify reports budget EXCEEDED, reduce the change or record waivers.budget in fit.json without rewriting the estimate; dependency changes need allowDependencyChanges and a dated technology decision for this spec.» | +110 |
| `agents/omni-auditor.md` (solo al auditar) | Nuevo punto: «Hexagon (fit v3): with scope ui/fullstack check the five-state matrix and the art-direction and token decisions; check Observability or its N/A; when dependencies changed check the dated technology decision; review tests changed after the red run for weakened assertions or excessive mocks.» | +65 |
| `CONSTITUTION.md` (`generator.mjs:99-127`) | En §3, conservar stack, `DOCUMENTATION` y `QUESTIONS`, y sustituir `TECHNOLOGY` y `SETUP` por una invariante condensada, que omni-implement también necesita: «Never select or pin a dependency or runtime version from memory: consult current official sources and the registry, record dated sources with approval or delegation (decision-record), and prefer runtime-native APIs; without web access the choice stays provisional. Setup and Git follow guide setup.». En §5, conservar el encabezado *UI Ergonomics & Frontend Craft (Anti-Slop)* y sustituir `DESIGN` por: «Interface work (fit scope ui or fullstack) follows guide design: references, art direction, tokens, five-state review and rendered evidence. Backend-only changes do not load it.». Los punteros no llevan rutas del runtime, porque `clean` las reescribe dentro de `CONSTITUTION.md` (`plugin-manager.mjs:247-255`). | ≈ −1.430 en cada fase |
| `src/resources/design.md` (`guide design`, solo UI) | Añadir el módulo de dirección de arte (abajo) y, como opción, `design.en.md` según `manifest.language` | +375 (solo `scope` ui) |
| `01-feature/spec.md` §4 | «[TODO] UI: record the applicable experience states; review Loading, Empty, Error, Partial/Overflow and Ideal for each affected surface (N/A with a reason where they do not apply). No UI: N/A with reason.». Es una guía de revisión, no filas obligatorias. | +25 |
| `src/resources/evidence.md:9-26` | Pasar el ejemplo de `fit.json` a v3 (`scope`, `allowDependencyChanges`, `waivers`) | ≈0 (bajo demanda) |
| `01-feature/plan.md` | Nueva sección «## Observability» tras *Contracts and compatibility*: «[TODO] Failure signals (structured log event, error code, metric), where they are read and which AC checks them; or N/A with reason.». En *UI & Interaction Design*, «no universal layout or fixed state count» → «art-direction archetype and tokens (reuse existing first) and the five-state matrix; no universal layout». | +40 |
| `02-bugfix/fix.md` | Nueva sección «## Observability»: «[TODO] Signal that would have exposed this defect and the one added or confirmed; or N/A with reason.». En *Regression verification*, añadir: «Record the failing run with verify <id> --red before fixing when a configured check reproduces it.» | +45 |

**Módulo de dirección de arte para `guide design`** (en español, como el recurso actual; unos 350 tokens que solo se cargan con `scope` ui o fullstack):

> **Contrato de dirección de arte (antes de programar).**
>
> 1. **Arquetipo estético nombrado**, justificado por la tarea y las referencias: precisión técnica (tipo Linear o Vercel), editorial limpio, dashboard de alta densidad, producto cálido de consumo, utilitario nativo de plataforma u otro definido en una frase. Indica uno o dos rasgos distintivos y qué vas a evitar.
> 2. **Tokens.** Reutiliza primero los existentes; un token nuevo necesita motivo. Regístralos como variables CSS o en formato DTCG 2025.10.
>    - **Tipografía:** escala modular con razón entre 1,2 y 1,333; una o dos familias; al menos dos pesos con contraste real; interlineado por rol.
>    - **Espaciado:** base de 4 px y múltiplos de 8 para el ritmo del layout.
>    - **Superficies:** como mucho tres radios; bordes de 1 px con alfa controlado; dos o tres niveles de elevación con sombras multicapa (ambiente y clave).
>    - **Color:** rampa neutra, un acento intencional y colores semánticos con pares de contraste medidos.
>    - **Movimiento:** 120–240 ms, una curva `cubic-bezier` declarada y respeto de `prefers-reduced-motion`.
> 3. **Matriz de estados por superficie:** Loading, Empty, Error, Partial/Overflow e Ideal (más foco y deshabilitado). Describe cada uno o marca N/A con motivo.
> 4. **Pulido:**
>    - `:hover`, `:active` y `:focus-visible` diferenciados;
>    - alineación óptica entre icono y texto;
>    - densidad coherente;
>    - ninguna decoración que no comunique.
>
> Son decisiones y rangos que se registran, no una receta obligatoria; se conserva la identidad aprobada.

**Balance por invocación (aprox.):**
- Constitución: de ~2.870 a ~1.440 tokens en todas las fases. Solo en instalaciones nuevas: un proyecto existente conserva su constitución, y adoptar la de referencia exige un `context-record`, porque `CONSTITUTION.md` es una entrada de contexto (`project-state.mjs:66-73`).
- omni-plan: ≈ −650 (incluido el bloque común).
- omni-specify: ≈ −100.
- omni-implement e init: ≈ 0.
- omni-converge: ≈ +110.
- `guide design`: +375, solo cuando aplica a UI.
- `status --json`: pasa de unos 1.055 a unos 107 tokens por spec cerrada típica.

**Una tarea de backend ahorra entre 1,4 k y 2,0 k tokens por fase**, más unos 0,95 k por cada spec cerrada del historial. Con 12 specs, el ahorro total ronda los 13 k tokens por fase.

### 3.4 Contratos que cambian a propósito (tests a actualizar)

**Tests que hay que actualizar:**
- `test/craft-hardening.test.mjs:38`: hoy exige que la constitución contenga `DESIGN`, `TECHNOLOGY` y `SETUP`. Debe comprobar los punteros y la invariante condensada.
- `test/craft-hardening.test.mjs:63`: hoy exige `DESIGN` dentro de omni-plan. Debe comprobar la instrucción condicional `guide design`.
- `test/fit.test.mjs:125-128,151`: hoy rechaza v3. Debe aceptar v3 y rechazar v4.
- `test/fit.test.mjs:338-343`: el cuestionario pasa a v3, con 10 preguntas y `scope` al final.
- `test/rc2-hardening.test.mjs:362-363`: la salida y el ejemplo pasan a `"schemaVersion": 3`.

**Tests que deben seguir pasando sin cambios:**
- `test/craft-hardening.test.mjs:37,39,49,82`: se conserva el encabezado y no se reintroducen estados obligatorios.
- `test/generator.test.mjs:51` y `test/rc2-hardening.test.mjs:347` (`Anti-Slop`).
- `test/integrations.test.mjs:100`: la ruta `specs/.omni/runtime` se queda en el bloque común.
- `test/acceptance.test.mjs:108-110`: el manifiesto conserva `verification.acceptance`.
- `test/acceptance.test.mjs:133`: una línea de log por comando, así que `budget` y `tdd` deben ir en el mismo `emit`.

**Tests nuevos:**
- Forma de `status --json`: `readSet`, specs no activas compactas y bloqueos propios.
- Falsos positivos del presupuesto: varias specs activas, archivos que pasan a ignorados, archivos gestionados, CRLF y renombres.
- Rojo→verde: un lint en rojo no cuenta; tiene que fallar y pasar el mismo `checkId`.
- Un test que lea `schema/fit.schema.json`; hoy ninguno lo carga y podría publicarse roto.
- Paridad entre `skills/*/SKILL.md` y `OMNI_SKILLS`; nada la protege hoy y el modo plugin distribuye esas copias.
- Tope de tamaño de los prompts. Se fija después de aplicar los cambios, con el perfil más grande, e incluye `HOST_RULE` y el envoltorio TOML de Gemini.

**Otros pasos:** regenerar las skills del plugin con `npm run build:skills`.

### 3.5 Descartado y motivo

- **`maxFilesChanged` como campo propio:** duplicaría `files` y crearía dos fuentes de verdad. Se usa `files` más una tolerancia.
- **Mover las specs cerradas a `_archive/`:** rompería enlaces, evidencia y contratos. Basta con excluirlas de forma lógica (`readSet` y `avoid`).
- **Un `kind: observability` nuevo:** los CLI anteriores rechazarían el `enum`. Se usa `functional` ligado a un check.
- **Hooks del host como mecanismo principal:** no son agnósticos. Se documentan como acelerador opcional (TDD Guard, permisos de lectura).
- **Que OmniSpec ejecute `npm view`:** añade red y ata el CLI a un ecosistema. El agente lo ejecuta y lo registra como fuente fechada.
- **Listas de archivos dentro de cada skill:** duplicarían información que acabaría desincronizándose. Se calcula `readSet` una sola vez.
- **Bloquear por número de archivos en 0.8:** demasiados falsos positivos (§1.4). Primero se mide en el piloto.

### 3.6 Correcciones incorporadas tras la revisión adversarial

Hallazgos de la revisión, todos verificados en el código:

1. **fit v3 se habría tratado como v1.** Las comparaciones `=== 2` (`fit.mjs:112,139,238,260`) habrían enviado cualquier bugfix v3 a full. El texto de `cli.mjs:401` y el `else` del esquema (`fit.schema.json:48-50`) también rompían v3.
2. **Digests incomparables.** Una línea base con digests truncados frente a digests completos habría marcado todos los archivos como tocados.
3. **Línea base versionada por error.** `SPECS_GITIGNORE` no la ignora. Se usa un `.gitignore` propio en la carpeta.
4. **Hash bajo el lock.** Calcularlo dentro de `create` y `focus` habría bloqueado durante ~10 s a los demás comandos (`manifest.mjs:114`) y roto `create` con enlaces simbólicos o límites del snapshot.
5. **Bucle de `verify`.** Un rechazo de presupuesto dentro de `inspectVerification` habría aparecido como `STALE_OR_INVALID_VERIFICATION` con la acción «verify»: se usan bloqueos propios.
6. **Evasión borrando la línea base.** Se resuelve vinculando `#baseline` a la huella; así ya no hace falta recalcular en `complete`.
7. **Fechas y alcance de decisiones.** `created_at` es solo una fecha UTC y `appliesTo` debe reutilizar `decisionApplies`.
8. **Rojo falso.** El bucle de checks se detiene en el primer fallo: un lint rojo habría pasado por rojo de test. `--check` es obligatorio y RED_GREEN exige el mismo check.
9. **Bloqueos del rojo.** No se puede volver a registrar el rojo cuando la corrección ya existe, hay bugs que ningún check reproduce y un formateador modifica tests. De ahí `waivers.red`, la condición `existingTests` y el tratamiento informativo de los tests cambiados.
10. **Cinco estados.** Reintroducían lo retirado en 0.7, la búsqueda de palabras era débil y las plantillas antiguas o del modo plugin fallarían el audit. El audit exige ahora una §4 sustantiva y el error incluye el fragmento que falta.
11. **Constitución ligera.** omni-implement perdería la regla de tecnología, de ahí la invariante condensada. `clean` reescribe rutas del runtime dentro de la constitución, así que los punteros no las llevan.
12. **`contracts --active`.** Debe mostrar el snapshot efectivo, no `current`, que puede ser una propuesta pendiente.

---

## 4. Plan de implementación con el propio OmniSpec

### 4.1 Estrategia de versiones

- **0.7.0:** promover `0.7.0-preview.2` sin cambios hexagonales, solo con correcciones.
- **0.8 en la rama `next/0.8`:**
  - `0.8.0-preview.1`: Niveles 0 y 1 (spec 002 y la parte de prompts de 005).
  - `0.8.0-preview.2`: Nivel 2 (specs 003, 004, la auditoría de 005 y 006).
  - `0.8.0`: tras la evaluación comparativa y el piloto IPS.

### 4.2 Preparación: dogfooding seguro

- **Gobernador:** el runtime 0.7.0 instalado en `specs/.omni/runtime/`. El CLI en desarrollo (`node bin/omni-spec.mjs`) se usa solo en los tests, para que el sistema que se modifica no certifique su propio cambio.
- **Actualizar el gobernador** con `update --dry-run` y luego `update` usando el tarball de cada preview. Las specs creadas a partir de preview.2 ya pueden usar fit v3 y probar los nuevos controles sobre el propio repositorio.
- **Lint:** excluir `specs/.omni/**` de Biome para no lintar la copia del runtime. `node --test` no descubre tests en esa copia.
- **Checks del catálogo** (`specs/.omni/inputs/checks.json`):

```json
{
  "schemaVersion": 1,
  "checks": [
    { "id": "engine-tests", "command": "npm test", "timeoutMs": 900000 },
    { "id": "lint", "command": "npm run lint" },
    { "id": "package-smoke", "command": "npm run test:package", "timeoutMs": 900000 }
  ]
}
```

Comandos de preparación, con el tarball 0.7.0 o `npx --yes omni-spec@0.7.0` cuando esté publicado:

```bash
git switch -c next/0.8
```

```bash
npx --yes omni-spec@0.7.0 init --yes --agent claude --lang es
```

```text
/omni-init
```

```bash
node specs/.omni/runtime/bin/omni-spec.mjs checks --from specs/.omni/inputs/checks.json
```

### 4.3 Secuencia de specs

| # | Tipo | Nombre | Pilares | fit esperado | Entregable |
| --- | --- | --- | --- | --- | --- |
| 001 | rfc | paradigma-hexagonal-0-8 | Todos: alcance, nombres, controles duros o suaves, llave fit v3 | decision | `Decision: ACCEPTED`, aceptando o aplazando cada pilar |
| 002 | feature | economia-de-contexto | 4.2, 5.1, 6 (lectura) y coste de tokens | full (≈9 archivos; cambia el contrato de `status`) | Constitución ligera, `readSet`, `status` compacto, `contracts --active`, aviso de tamaño, test de tope de prompts y bloque común −110 tokens |
| 003 | feature | fit-v3-presupuesto-de-cambio | 1, 4.1, 4.3 | full, riesgo alto | fit v3, línea base, `budget`, decisión de tecnología ligada a la spec |
| 004 | feature | evidencia-red-green | 2 | full | `verify --red`, `red.json`, `tdd`, `automationGap` |
| 005 | feature | observabilidad-y-direccion-ui | 3, 5.2, 5.3 | full | Plantillas, auditoría v3, `guide design` de alta factura, rol del auditor |
| 006 | feature | destilacion-de-memoria | 6 y XP | standard/full | Contratos en converge (propuesto → activo) y bucle Driver/Navigator |

**Orden y dependencias:**
- **002 va primero:** abarata todas las specs siguientes y tiene poco riesgo.
- **003 es la llave** que necesitan 004 y 005.
- **004 y 005 pueden ir en paralelo:** tocan archivos distintos, salvo `cli.mjs` en 004.
- **006 cierra la serie.**

**Comandos por spec.** La RFC usa `verify` en modo decisión, sin checks.

Para la RFC:

```text
/omni-specify RFC "Paradigma Hexagonal 0.8": alcance por pilar, nombres sin siglas ambiguas, controles duros o suaves y fit v3 como llave (base: docs/AUDIT-HEXAGON-REPORT.md)
/omni-clarify
/omni-converge
```

```bash
node specs/.omni/runtime/bin/omni-spec.mjs verify 001
```

```bash
node specs/.omni/runtime/bin/omni-spec.mjs complete 001
```

Para cada feature (002 a 006):

```text
/omni-specify feature "economia de contexto": constitución ligera, readSet en status, status compacto, contracts --active, aviso de tamaño del contexto y test de tope de prompts
/omni-clarify
/omni-plan
/omni-tasks
/omni-audit
/omni-implement
/omni-converge
```

```bash
node specs/.omni/runtime/bin/omni-spec.mjs fit 002
```

```bash
node specs/.omni/runtime/bin/omni-spec.mjs verify 002
```

```bash
node specs/.omni/runtime/bin/omni-spec.mjs complete 002
```

### 4.4 Criterios para publicar 0.8.0

1. **Tope de prompts en verde:** constitución ≤ 6.000 caracteres, bloque común ≤ 6.600, omni-plan ≤ 11.000 y el resto de skills sin crecer más de un 5 %.
2. **Evaluación de comportamiento** (`docs/BEHAVIOR-EVALUATION.md`), con cuatro escenarios nuevos:
   - una tarea solo de backend, que no debe cargar `guide design`;
   - un bugfix rojo→verde;
   - una dependencia nueva, que debe registrar una decisión fechada;
   - una UI con contrato de dirección de arte y los cinco estados.

   Comparar 0.7.0 con 0.8.0-preview.2 usando el mismo host y modelo, y registrar los tokens que informe el host. Los tres escenarios actuales no pueden empeorar.
3. **Piloto IPS** con 0.8.0-preview.2. Medir:
   - porcentaje de criterios automatizados;
   - presupuestos excedidos y sus justificaciones;
   - falsos positivos.

   Ajustar la tolerancia si aparece más de un falso positivo cada cinco specs, y decidir con esos datos si el presupuesto de archivos pasa a bloquear en 0.9.
4. **Documentación:** `COMPATIBILITY.md` (fit v3 y campos del registro), `DELIVERY.md`, `CHANGELOG.md` y notas de versión. Explicar que una constitución existente conserva su texto y que puede adoptar la referencia.

---

## Fuentes

Spec-driven development y frameworks:
- [Spec Kit — plan-template.md](https://raw.githubusercontent.com/github/spec-kit/main/templates/plan-template.md) · [constitution-template.md](https://raw.githubusercontent.com/github/spec-kit/main/templates/constitution-template.md)
- [Böckeler — Understanding Spec-Driven-Development (martinfowler.com)](https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)
- [Crítica de Scott Logic citada en CodeMySpec (secundaria)](https://codemyspec.com/blog/github-spec-kit-guide)
- [OpenSpec README](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/README.md) · [OpenSpec: change proposals y living specs (secundaria)](https://developertoolkit.ai/en/ecosystem/frameworks/openspec/)
- [Kiro steering](https://kiro.dev/docs/steering/index) · [Kiro bugfix specs](https://kiro.dev/docs/specs/bugfix-specs/)
- [BMAD testing / TEA](https://docs.bmad-method.org/reference/testing/) · [BMAD TEA repo](https://github.com/bmad-code-org/bmad-method-test-architecture-enterprise)
- [GSD Core README](https://raw.githubusercontent.com/open-gsd/gsd-core/main/README.md)
- [Superpowers — test-driven-development](https://raw.githubusercontent.com/obra/superpowers/main/skills/test-driven-development/SKILL.md)
- [TDD Guard README](https://raw.githubusercontent.com/nizos/tdd-guard/main/README.md)
- [Taskmaster — referencia de comandos (espejo, secundaria)](https://glama.ai/mcp/servers/@eyaltoledano/claude-task-master/blob/2d1211bfb32752b2b1130c9ce7f49b6217244f60/apps/docs/command-reference.mdx)
- [Consort, arXiv 2609.09671](https://arxiv.org/abs/2609.09671) · [From Prompt to Process, arXiv 2606.04967](https://arxiv.org/abs/2606.04967) · [Test-Driven Approaches survey, arXiv 2609.12012](https://arxiv.org/abs/2609.12012)
- [Thoughtworks Radar — Spec-driven development](https://www.thoughtworks.com/cn/radar/techniques/spec-driven-development)
- [OSpec en npm (Socket)](https://socket.dev/npm/package/@clawplays/ospec-cli/overview/1.9.5)

Contexto, atención y coste:
- [IFScale, arXiv 2507.11538](https://arxiv.org/abs/2507.11538)
- [Evaluating AGENTS.md (ICLR 2026)](https://iclr.cc/virtual/2026/10021235) · [InfoQ](https://infoq.com/news/2026/03/agents-context-file-value-review)
- [Chroma — Context Rot](https://research.trychroma.com/context-rot)
- [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Microsoft Agent Framework — Skills (guía de 500 líneas)](https://learn.microsoft.com/en-us/agent-framework/agents/skills)
- [Claude Code issue #17204 — reglas por paths](https://github.com/anthropics/claude-code/issues/17204)

Calidad de tests, logging y dependencias:
- [ImpossibleBench, arXiv 2510.20270](https://arxiv.org/abs/2510.20270)
- [Over-mocked tests, arXiv 2602.00409](https://arxiv.org/abs/2602.00409)
- [Do AI Coding Agents Log Like Humans?, arXiv 2604.09409](https://arxiv.org/abs/2604.09409)
- [Kent Beck — Augmented Coding: Beyond the Vibes](https://tidyfirst.substack.com/p/augmented-coding-beyond-the-vibes) · [Pragmatic Engineer: TDD, AI agents and Kent Beck](https://newsletter.pragmaticengineer.com/p/tdd-ai-agents-and-coding-with-kent)
- [Slopsquatting y alucinación de paquetes (CSO Online)](https://www.csoonline.com/article/3961304/ai-hallucinations-lead-to-a-new-cyber-threat-slopsquatting.html)
- [LLMs Meet Library Evolution, arXiv 2406.09834](https://arxiv.org/abs/2406.09834)
- [Context7 MCP (directorio)](https://mcpservers.org/en/servers/upstash/context7-mcp)
- [Pair Programming with AI — revisión sistemática (ASEE 2026)](https://peer.asee.org/pair-programming-with-ai-a-systematic-literature-review)

UI y diseño:
- [Anthropic — Improving frontend design through Skills](https://claude.com/resources/articles/improving-frontend-design-through-skills)
- [Impeccable (docs)](https://www.mintlify.com/pbakaus/impeccable) · [Impeccable en Hermes (detector, secundaria)](https://hermes-agent.nousresearch.com/docs/user-guide/skills/optional/creative/creative-impeccable)
- [Vercel — Web Interface Guidelines como comando de agente](https://vercel.com/changelog/web-interface-guidelines-now-available-as-an-agent-command)
- [W3C DTCG — Design Tokens 2025.10 estable](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/)
- [Hurff — UI Stack: ideal, empty, error, partial, loading (secundaria)](https://smart-interface-design-patterns.com/articles/how-to-fix-a-bad-user-interface/)
