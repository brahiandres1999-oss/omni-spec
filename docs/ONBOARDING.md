# Contrato de onboarding — OmniSpec 0.9.0 Oficial Estable

Contrato distribuido en `0.9.0` estable. Empieza después del instalador de [INSTALLATION](INSTALLATION.md): la integridad local puede estar comprobada mientras descubrimiento y reconocimiento conversacional siguen pendientes. Ver [notas de la versión 0.9.0](releases/0.9.0.md).

## Preparación y decisiones pendientes

El reconocimiento conserva las decisiones confirmadas y pregunta solo por las brechas materiales. Usa el formulario nativo del agente si está disponible y permitido; en otro caso, el mismo chat o consola. Explica las opciones para una persona no técnica y registra una selección o delegación explícita. Una sugerencia preseleccionada y el silencio no son aprobación.

Antes de preparar una aplicación, el agente registra prerrequisitos disponibles, faltantes y desconocidos, versiones propuestas y evidencia oficial vigente de soporte y compatibilidad. También acuerda documentación por lenguaje y convención de commits. El inventario automático no realiza esa investigación ni aprueba el stack: esas decisiones empiezan pendientes en el contexto. La ausencia de web mantiene provisional una recomendación que depende de soporte actual.

La preparación autorizada puede incluir Git local después de comprobar los límites del repositorio y sus reglas de exclusión. El reconocimiento inicial no ejecuta `git init`. Crear un repositorio local, hacer un commit y publicar son acciones distintas; una restricción de trabajo local sigue vigente.

Para interfaces nuevas o rediseños importantes, se define una dirección con referencias pertinentes, una superficie representativa y pruebas sobre el resultado renderizado y su recorrido. En estricto cumplimiento del estándar **Zero Slop Guard**, toda vista interactiva debe contemplar explícitamente los **4 estados obligatorios**:
1. *Loading*: Skeletons contextuales o indicadores de carga con Cumulative Layout Shift (CLS) = 0.
2. *Empty*: Explicación contextual clara con acción inmediata o botón de llamada a la acción (CTA).
3. *Error*: Mensaje comprensible (sin códigos de error opacos) y mecanismo de reintento o recuperación.
4. *Protected / Ideal*: Contenido completo autorizado o estado restringido cuando no se poseen permisos.

Quedan estrictamente prohibidos los clichés visuales de IA (degradados azul/púrpura genéricos sin fundamento de marca, badges con resplandor difuso artificial y anidamiento excesivo de tarjetas con sombras o *card-itis*). Se exige tipografía deliberada y contraste WCAG 2.1 AA medible. Sin herramientas adecuadas se registra `NOT_VERIFIED` y el procedimiento manual pendiente.

Estos son contratos de comportamiento distribuidos al agente. Las pruebas de generación comprueban su presencia y la preservación del proyecto; no certifican su ejecución por todos los hosts ni la calidad del producto generado.

El usuario usa la invocación mostrada por el instalador (`/omni-init`, `$omni-init` en Codex o lectura explícita de la skill/prompt), sin instrucciones de auditoría adicionales. El agente confirma la instalación que lee y su versión. El agente adapta su recorrido a la evidencia del proyecto y documenta su contexto. Las mismas instrucciones se distribuyen mediante todos los adaptadores; cambia su formato e invocación según el host.

## Alcance predeterminado y memoria persistente

Leer manifiesto, constitución, contexto, configuración, instrucciones locales y código relevante. Usar `status --json` e `inspect --json` del motor local. Consultar el estado de trabajo de Git de solo lectura si existe; Git no es requisito para reconocer el proyecto.

En proyectos brownfield con código existente, el agente debe ejecutar `omni-spec cartography --json` para indexar de forma incremental el grafo de dependencias de módulos, exports, imports y rutas en la base de datos externa `memory.db`. Esto permite conocer la topología de la aplicación y calcular el radio de impacto (`blast-radius`) antes de proponer cambios arquitectónicos.

OmniSpec 0.9.0 erradica el almacenamiento de estado en archivos dentro del repositorio: no existen `specs/project-state.json`, carpetas `specs/decisions/` ni historiales locales en `specs/.omni/context-history/` o `specs/.omni/decision-history/`. Toda la información de sesiones, decisiones aprobadas, historiales y memoria heurística se gestiona de forma externa en `%LOCALAPPDATA%\OmniSpec\workspaces\<id>\memory.db` (o `$XDG_STATE_HOME/omnispec/workspaces/<id>/memory.db` en Linux/macOS).

El registro de sesiones y decisiones se realiza sin archivos temporales:
- `session-record` acepta directivas por flags directos (ej. `omni-spec session-record --host Antigravity --questions available --web available --terminal available --render available --delegation available`) o `--json-input`.
- `decision-record` registra acuerdos arquitectónicos directamente mediante flags (ej. `omni-spec decision-record --id stack --topic stack --status approved --basis "Confirmado por el usuario"`) o `--json-input`.
- No se generan ni requieren archivos JSON temporales en `specs/.omni/inputs/`, manteniendo el repositorio Git impecable.

Asimismo, el agente utiliza los comandos de memoria persistente para registrar observaciones duraderas del repositorio:
```sh
omni-spec memory add --category <pattern|gotcha|convention|constraint> --scope <path> --summary "<texto>"
omni-spec memory search "<consulta>"
omni-spec memory list
```
Estas observaciones son inyectadas automáticamente en el bloque `progress.memory` de `omni-spec status --json` para prevenir la amnesia entre sesiones.

### Bloqueo estricto de cierre (Strict Onboarding Gate)
`context-record` registra el baseline de entradas de contexto en `memory.db`. En OmniSpec 0.9.0, las compuertas de gobernanza `verify` y `complete` **bloquean terminantemente el cierre** de cualquier especificación si el estado de onboarding en `context-record` permanece como `NOT_RECORDED`. No es posible certificar ni cerrar trabajo técnico si el reconocimiento del proyecto y su contexto inicial no han sido completados y formalizados.

`init --yes` no convierte los scripts detectados en gates: quedan como candidatos `NOT_RUN` en la matriz de comandos del contexto. El agente los revisa y, con autorización, los configura con `checks --from` o `configure --gates`. El contexto registrado cubre `project-context.md`, los archivos que enlaza, manifiestos de build/dependencias/runtime, CI e instrucciones de agentes; los cambios de código fuente no lo dejan obsoleto. `omni-spec guide evidence` muestra la forma exacta de cada registro JSON.

## Rutas

| Proyecto | Comportamiento |
| --- | --- |
| Nuevo o vacío | Distinguir archivos de OmniSpec de una aplicación existente; aclarar propósito, usuarios, restricciones y primer resultado. Stack y pruebas quedan sin decidir si no hay evidencia. |
| Existente (Brownfield) | Ejecutar `omni-spec cartography --json` para mapear dependencias. Mapear finalidad, módulos, entradas, convenciones y comandos reales. Separar documentación de comportamiento inspeccionado y de resultados ejecutados. |
| Incompleto o roto | Registrar el error de configuración observado y posibles siguientes pasos. No declarar un fallo reproducido sin ejecución ni reparar la aplicación durante init. |
| Mixto o monorepo | Registrar runners, directorios y prerrequisitos por módulo. No imponer un único comando de raíz. |
| Desconocido o sin código | Inspeccionar artefactos y proceso de entrega; identificar límites del detector, revisión manual y N/A justificados. No inventar un stack. |

## Estados y evidencia

- `CONTEXT_PENDING`: faltan decisiones materiales o el inventario inicial aún requiere reconocimiento conversacional.
- `CONTEXT_RECORDED`: el reconocimiento y sus límites quedaron documentados formalmente en `project-context.md` y `memory.db`. No implica compatibilidad universal ni calidad aprobada.
- `APPLICATION_NOT_VALIDATED`: no se ha demostrado el resultado de las comprobaciones de la aplicación. Puede coexistir con contexto registrado y permite continuar discutiendo o especificando.

Cada afirmación diferencia OBSERVED, DECLARED, EXECUTED, INFERRED, UNKNOWN o NOT APPLICABLE con motivo. Las etiquetas pueden traducirse al idioma del usuario.

Una dependencia declarada no es una versión instalada. La versión seleccionada en CI/contenedor no prueba una versión mínima compatible. Una política de privacidad, seguridad, diseño o accesibilidad no demuestra cumplimiento. Un script disponible queda `NOT_RUN` hasta tener evidencia de ejecución.

Antes de concluir, comparar documentación, manifiestos, CI, contenedores y definiciones de comandos por módulo y entorno. Registrar discrepancias potenciales sin asumir que las diferencias siempre son defectos. Conservar fuente, declaración, alcance, consecuencia, estado y evidencia pendiente en un apartado marcado `<!-- omni:source-conflicts -->`. Si no se observan discrepancias, indicar qué se comparó y sus límites. Una versión configurada en CI no sustituye silenciosamente el prerrequisito declarado por un módulo en su matriz de comandos.

La respuesta final conserva esas discrepancias y las mismas categorías de evidencia del contexto. Una regla documentada debe presentarse como requisito declarado, no como aislamiento absoluto o garantía de cumplimiento. La cita debe apuntar al pasaje que realmente contiene la regla; una constitución genérica no respalda un umbral de negocio que solo aparece en otro documento. Leer un control en una ruta tampoco demuestra su aplicación en todas las rutas.

Los enlaces guardados son relativos al documento: desde `specs/project-context.md`, `[README](../README.md)` apunta al README de raíz. Usar fragmentos como `#L12` para líneas cuando correspondan; evitar URLs `file://` y rutas específicas de una máquina. Las observaciones de herramientas usadas como evidencia deben conservar comando, cwd, fecha real, código de salida y resultado; si falta alguno, registrar el límite sin inventarlo.

Cada comando relevante registra: comando, directorio relativo a raíz, fuente, propósito, prerrequisitos (nombres de variables, servicios y datos de prueba aislados), selección como gate y motivo, estado de ejecución. Una ejecución requiere comando exacto, directorio, fecha, código de salida, resumen del resultado y ubicación de evidencia. Nunca guardar secretos ni datos personales en el contexto.

El detector aporta candidatos y restricciones declaradas como datos estructurados; no ejecuta scripts, evalúa cumplimiento ni certifica compatibilidad. Sus límites de profundidad y cobertura siguen vigentes. El agente debe contrastar las áreas relevantes por lectura.

## Resultado esperado con el comando solo

El contexto contiene siete apartados: estado/alcance, mapa de evidencia, objetivos/decisiones, matriz de comandos, baseline/requisitos, trabajo previo/riesgos/pendientes y siguiente acción. La respuesta al usuario resume esos estados, fuentes principales, archivos modificados y decisiones o preparación pendientes.

No anunciar «completamente adaptado», «100% listo» o «todo verificado» por haber terminado una lectura. Si Git o una herramienta falla, registrar la limitación sin declarar el árbol limpio. Si no hay decisiones materiales abiertas, tampoco inventar preguntas o problemas para rellenar apartados.

Después de guardar el contexto, el agente ejecuta `context-check --json`. Este control de solo lectura comprueba estados explícitos, presencia del apartado de discrepancias, enlaces locales comunes de Markdown, existencia de sus archivos y rangos de líneas. Rechaza rutas absolutas, enlaces fuera del proyecto y referencias inexistentes. El marcador permite traducir libremente el título del apartado.

El resultado se etiqueta `STRUCTURE_AND_LOCAL_LINKS_ONLY`, con `semanticReview: REQUIRED`. Puede aprobar un inventario pendiente y también una cita que existe pero no respalda la afirmación: la comprobación de significado sigue siendo una revisión explícita del agente. No es un verificador universal de Markdown ni de fuentes externas; referencias en prosa/backticks y anclas de sección requieren revisión manual. Un error sin resolver se informa como onboarding incompleto, sin declarar que todo está adaptado.

## Comprobación y límites

Las regresiones instalan proyectos temporales vacíos, políglotas, rotos y editoriales. Comprueban preservación de archivos de aplicación, ausencia de ejecución de scripts, contexto inicial honesto, fuentes/cwd de comandos y distribución del contrato en los adaptadores. La prueba de paquete repite esos casos con el tarball instalado.

Las evaluaciones de instrucciones usan `/omni-init` como único mensaje en fixtures independientes, con la skill previa y la candidata. Son una muestra de comportamiento de un modelo y no una garantía para otros modelos o interfaces. Las comprobaciones de estructura no prueban la veracidad semántica de un contexto escrito por un agente.

La aceptación en Antigravity requiere reinstalar el candidato y repetir `/omni-init` a secas. Debe comprobarse la respuesta y el diff real. Las instrucciones mejoradas reducen ambigüedad; no convierten el razonamiento del agente en una operación determinista.

El formato y la organización de las instrucciones se contrastaron con la [especificación oficial Agent Skills](https://agentskills.io/specification), que recomienda instrucciones por pasos, ejemplos y casos límite. Esa especificación define interoperabilidad del formato; no certifica la calidad de un onboarding.
