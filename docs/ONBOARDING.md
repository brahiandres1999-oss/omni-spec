# Contrato de onboarding — 0.5.0 local

El usuario invoca `/omni-init` sin instrucciones de auditoría adicionales. El agente adapta su recorrido a la evidencia del proyecto y documenta su contexto. Las mismas instrucciones se distribuyen mediante todos los adaptadores; cambia su formato e invocación según el host.

## Alcance predeterminado

Leer manifiesto, constitución, contexto, configuración, instrucciones locales y código relevante. Usar `status --json` e `inspect --json` del motor local. Consultar el estado de trabajo de Git de solo lectura si existe; Git no es requisito para reconocer el proyecto.

Actualizar únicamente `specs/project-context.md`. Preservar decisiones confirmadas y reconciliar afirmaciones antiguas con fuentes actuales. No crear una especificación ni modificar la aplicación, políticas o gates para terminar el reconocimiento. No instalar dependencias, ejecutar scripts del proyecto, migraciones ni servicios. La validación ejecutada es otro paso que depende de la autorización y preparación correspondientes; no exige confirmación para cada lectura.

## Rutas

| Proyecto | Comportamiento |
| --- | --- |
| Nuevo o vacío | Distinguir archivos de OmniSpec de una aplicación existente; aclarar propósito, usuarios, restricciones y primer resultado. Stack y pruebas quedan sin decidir si no hay evidencia. |
| Existente | Mapear finalidad, módulos, entradas, convenciones y comandos reales. Separar documentación de comportamiento inspeccionado y de resultados ejecutados. |
| Incompleto o roto | Registrar el error de configuración observado y posibles siguientes pasos. No declarar un fallo reproducido sin ejecución ni reparar la aplicación durante init. |
| Mixto o monorepo | Registrar runners, directorios y prerrequisitos por módulo. No imponer un único comando de raíz. |
| Desconocido o sin código | Inspeccionar artefactos y proceso de entrega; identificar límites del detector, revisión manual y N/A justificados. No inventar un stack. |

## Estados y evidencia

- `CONTEXT_PENDING`: faltan decisiones materiales o el inventario inicial aún requiere reconocimiento conversacional.
- `CONTEXT_RECORDED`: el reconocimiento y sus límites quedaron documentados. No implica compatibilidad universal ni calidad aprobada.
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
