# Preparación y decisiones con OmniSpec

Inspecciona la carpeta y sus límites antes de ejecutar comandos. Registra OS/shell, Git local o repositorio envolvente, manifiestos/locks, runtimes instalados, CI, servicios y datos de prueba aislados. Marca cada prerrequisito disponible, faltante o desconocido y explica el siguiente paso con directorio de trabajo. No ejecutes scripts de aplicación durante el reconocimiento inicial.

Pregunta por decisiones materiales que el repositorio no puede contestar. Usa el formulario nativo si la sesión lo expone y permite; en CLI no interactiva o sin ese formulario, pregunta en el chat. Explica una recomendación, alternativas y consecuencias con lenguaje comprensible. Guarda respuesta o delegación con su alcance mediante decision-record. Silencio o una opción preseleccionada no son aprobación.

Antes de elegir versiones para scaffolding o cambios materiales, consulta fuentes oficiales de releases/soporte y compatibilidad de runtime, framework, herramientas y despliegue. Registra URL exacta, fecha, versión/canal, requisitos y motivo. Para una decisión de tecnología aprobada/delegada, el registro exige fuentes fechadas. Eso no demuestra compatibilidad ejecutada: conserva instalación/build/test como evidencia separada. Si no hay web, deja la selección provisional cuando dependa de soporte actual.

Conserva el stack aprobado de un proyecto existente. Expón conflictos de soporte o compatibilidad y propone un cambio acotado; no actualices por ser la versión más nueva ni mantengas una versión solo porque el modelo la recuerda. Distingue versiones declaradas, instaladas, soportadas y probadas.

Git local y publicación son operaciones separadas. En preparación autorizada, comprueba que no crearás un repositorio dentro de otro por accidente, acuerda carpeta/rama inicial y revisa reglas de exclusión. No inventes identidad de autor ni modifiques configuración global. Antes de un primer commit autorizado, conserva la convención existente o acuerda Conventional Commits, idioma, tipos y cambios incompatibles. Elegir convención no autoriza commit, push o despliegue. Conserva la restricción explícita de trabajo local.

Por módulo acuerda JSDoc/Javadoc/TSDoc o equivalente, con contratos significativos y firmas correctas. No sustituyas documentación de API con comentarios de sintaxis ni declares calidad por contar etiquetas. Identifica herramientas de documentación/lint disponibles y revisa contenido.

Usa status --json para bloqueos/próxima acción; session-record para capacidades observadas, context-check para estructura/enlaces y context-record después de reconciliar fuentes. Un cambio en entradas registradas deja el contexto stale; se debe revisar, no actualizar afirmaciones automáticamente para que coincidan con código defectuoso. Los registros previos permanecen en el historial local.
