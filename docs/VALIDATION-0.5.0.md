# Validación de la base 0.5.0 y candidata 0.5.0-rc.1

Fecha: 2026-10-18. Estado: candidata `0.5.0-rc.1` preparada para prerelease; el historial siguiente distingue pruebas locales y ensayos del usuario. El resultado de CI y publicación se comprueba en GitHub, no se presupone por preparar archivos.

## Resultado y entorno

- Windows, Node.js 22.19.0, npm 10.9.3.
- Suite tras la segunda corrección de onboarding: **125 pruebas aprobadas, 0 fallidas**. Las iteraciones anteriores tenían 111 y 117. Incluye coordinación entre procesos, recuperación de locks, configuración, generación, auditoría, evidencia, conservación de archivos y adaptadores.
- `npm run test:package`: empaquetado e instalación local sin red, sin scripts de instalación y sin depender de OmniSpec global. Recorridos sobre el CLI instalado y el runtime copiado al proyecto.
- `git diff --check` y comprobación de sintaxis de los módulos modificados.
- Durante las iteraciones locales anteriores no se crearon commits, ramas, tags ni publicaciones. La preparación de `0.5.0-rc.1` agrega su flujo de release y conserva aquellas ediciones en el candidato.
- Las pruebas de filesystem se ejecutaron fuera del sandbox porque el entorno restringido produjo EPERM al renombrar archivos temporales; esos fallos no se reprodujeron en la ejecución normal.

## Preparación de 0.5.0-rc.1

- Versión, etiqueta y canal: `0.5.0-rc.1`, `v0.5.0-rc.1`, npm `next`.
- Suite local final: **135 pruebas aprobadas, 0 fallidas**; las 125 citadas abajo corresponden a la iteración anterior.
- La prueba de paquete incluye ejecución desde tarball con npm-exec y comando global usando un prefijo temporal, sin instalarlo globalmente en el sistema del usuario.
- Cierre reforzado: `acceptance.json` debe cubrir cada criterio real con estado, método y evidencia; una prueba general exitosa no sustituye criterios pendientes. La cobertura se valida mecánicamente y la veracidad de cada evidencia requiere revisión.
- Se añadieron pruebas de orden SemVer rc/estable, etiquetas, canales y migración explícita de copias locales no publicadas que llevaban `0.5.0` hacia `0.5.0-rc.1`.
- La discusión debe contrastar afirmaciones externas con fuentes oficiales y respetar restricciones arquitectónicas condicionadas; no convertir propuestas visuales en nuevas reglas de negocio o garantías.
- El usuario recorrió una feature completa en Antigravity. Su registro conservaba 132 tests de backend, 48 de frontend y lint/build con código 0; la huella coincidió al revisar. También se detectó un contraste inferior al criterio declarado y evidencia de interacción insuficientemente detallada. Esa feature corresponde al candidato anterior: demuestra el recorrido real y el motivo del refuerzo, no certifica esta revisión nueva en el host.
- `release:check` valida versión, etiqueta, canal, metadatos y notas; el tarball se publica con SHA-256 tras la matriz de CI. La aprobación remota y la existencia de la release deben consultarse en GitHub; no se deducen de las pruebas locales.
- npm no tenía sesión autenticada y el mantenedor aún no tenía cuenta al preparar esta candidata. El workflow npm es manual y requiere configurar su trusted publisher o realizar primero la publicación autenticada. GitHub y npm mantienen estados de publicación independientes.

Evidencia local: `artifacts/rc-final-suite.log`, `artifacts/rc-final-package.log` y artefactos de `artifacts/release/`. No se incluyen en el repositorio ni en el paquete como supuestas certificaciones portables.

## Tres recorridos de autoentendimiento

Los tres recorridos siguientes documentan la primera iteración. La revisión posterior de onboarding está descrita después; no se extrapolan las 111 pruebas originales a la calidad del chat.

### Recorrido 1 — intención, estándares y contratos

Se contrastó el objetivo del autor con el comportamiento existente y con documentación oficial. Se confirmó Antigravity como primera integración objetivo y se distinguieron tres responsabilidades: instrucciones del agente, operaciones deterministas del CLI y evidencia de resultados.

Decisiones aplicadas:

- Nuevo onboarding conversacional y exploración ligera, sin convertir cada pregunta en una feature.
- Flujos por arquetipo, con una RFC que puede terminar en una decisión sin código.
- Adaptadores específicos: reglas persistentes no sustituyen los comandos de Cursor/Kilo/Copilot; Gemini y OpenCode tienen formatos propios.
- 0.5.0 por los nuevos comandos, runtime local y cambios en el contrato de cierre. No se etiquetó ni publicó esa versión.
- Retiro de promesas de “cero alucinaciones” y comprobación matemática de requisitos. Fuentes y decisiones en [STANDARDS.md](STANDARDS.md).

### Recorrido 2 — implementación y consumo real del paquete

Se añadieron regresiones de los hallazgos y se instalaron tarballs locales en proyectos temporales. La suite intermedia llegó a 103 pruebas aprobadas.

Recorridos del paquete:

1. Instalación offline y resolución del binario mediante npm.
2. Bootstrap en carpeta con espacios; nueve skills de Antigravity y runtime autónomo.
3. Feature, bugfix, debt y RFC: rechazar borradores, completar artefactos de prueba, auditar, verificar y cerrar.
4. Reanudar estado desde un subdirectorio en un nuevo proceso.
5. Rechazar agentes inválidos y persistir una nueva selección.
6. Detectar una plantilla personalizada; bloquear actualización, previsualizar conflicto y respaldar antes de reemplazar con aceptación explícita.
7. Adoptar un proyecto existente sin modificar su código; detectar una comprobación fallida, bloquear cierre, aplicar una corrección de fixture y volver a verificar.
8. Adoptar un proyecto con stack desconocido sin inventar comandos de prueba.

Los artefactos de estas pruebas son fixtures deliberadamente pequeños. No equivalen a evaluar el razonamiento de un modelo en proyectos arbitrarios.

### Recorrido 3 — casos límite y coherencia final

Se revisaron las rutas de error, migraciones y documentación contra los recorridos ya implementados. La suite final incluye 111 pruebas.

Correcciones adicionales:

- Inicialización concurrente bajo el mismo lock del manifiesto.
- Migración de proyectos anteriores con runtime y contexto faltante; conservación de constitución y especificaciones.
- Rechazo de downgrades, rutas de especificación inválidas, foco ambiguo y opciones de vista previa en comandos que no la soportan.
- Timeout de comprobaciones con resultado fallido; evidencia obsoleta después de cambiar fuente o configuración.
- Casillas dentro de bloques de ejemplo no satisfacen tareas reales.
- Perfiles condicionales: no imponen tenancy, bases de datos, cifrados o umbrales de anonimización como requisitos universales.
- README, ayuda, changelog y esquema alineados con lo que hace el código; CI incorpora la prueba de paquete, pero la matriz remota no se ejecutó aquí.

## Corrección posterior: onboarding con el comando solo

La revisión de los archivos generados en el primer ensayo real encontró certeza excesiva: comandos llamados verificados sin resultados registrados, requisitos de accesibilidad presentados como cumplimiento y versión mínima de runtime inferida desde configuración. No se solicitó al usuario compensarlo con un prompt largo: se corrigió el contrato compartido de OmniSpec. Pulso360 se usó únicamente como evidencia de lectura; no se modificó desde esta corrección.

Tres revisiones de esta corrección:

1. **Contrato y fuentes:** separación OBSERVED/DECLARED/EXECUTED/INFERRED/UNKNOWN/N/A; alcance por defecto limitado al contexto; rutas para proyectos vacíos, existentes, rotos, mixtos y editoriales. La especificación Agent Skills respalda el formato y las instrucciones por pasos, no certifica su resultado semántico. Detalles en [ONBOARDING.md](ONBOARDING.md).
2. **Datos y regresiones:** `inspect` aporta candidatos de comandos con cwd, fuente, origen declarado/convención, prerrequisitos sin evaluar y `NOT_RUN`; restricciones de runtime declaradas no se convierten en compatibilidad comprobada. Contexto semilla con siete apartados y estados pendientes. Suite completa: **117/117**; incluye seis regresiones nuevas de onboarding.
3. **Evaluación de instrucciones y bordes:** cuatro fixtures independientes con la skill anterior y cuatro con la candidata, invocando solo `/omni-init`: vacío, JS/Python con requisitos de integración, manifiesto roto y manual editorial. El candidato mantuvo aplicación no validada, preservó archivos y decisiones y registró estados explícitos. La skill anterior también produjo resultados prudentes en esta muestra; el beneficio observado es un contrato y salida más explícitos, no una demostración estadística de menor alucinación. Se detectó además el borde de repositorios Git envolventes y se acotaron las consultas de estado/diff al proyecto. Se añadió un recorrido de reconciliación de contexto heredado con afirmaciones sin evidencia.

Las evaluaciones son muestras con agentes de esta sesión, no ensayos en Antigravity ni repeticiones suficientes para estimar fiabilidad. Comparten fixtures y el mismo motor candidato; comparan instrucciones, no dos releases completas. La baseline anterior se conservó desde el tarball, con contexto mínimo equivalente. Un ajuste de nombre del script fixture ocurrió al iniciar las evaluaciones; ambos agentes releyeron el estado final antes de informar.

Evidencia local ignorada por Git: `artifacts/onboarding-suite.log`, `artifacts/onboarding-package.log` y `artifacts/onboarding-evals/` (contextos y respuestas por caso). El paquete debe regenerarse tras las correcciones; su hash identifica la revisión concreta de este candidato aún no publicado.

## Segunda corrección: reconciliación, atribución y enlaces

El segundo ensayo del usuario en Antigravity conservó los estados y `NOT_RUN`, pero mezcló declaraciones de runtime en los prerrequisitos, citó una constitución genérica para una regla específica, usó garantías de privacidad superiores a la evidencia leída y guardó enlaces `file://` ligados a una computadora. La respuesta y los archivos se revisaron de solo lectura; no se modificó Pulso360.

Tres revisiones antes de entregar esta corrección:

1. **Contrato y límites:** comparar fuentes por módulo/entorno, registrar discrepancias sin elegir autoridad por suposición y mantenerlas en los prerrequisitos y respuesta final. Citar el pasaje real, separar política/implementación/comprobación y usar enlaces relativos al documento. Estas reglas se aplican también al discutir, especificar y planificar con contexto guardado.
2. **Comprobaciones del motor:** nuevo `context-check` de solo lectura para estados, apartado de discrepancias y enlaces locales comunes, con alcance explícito `STRUCTURE_AND_LOCAL_LINKS_ONLY` y `semanticReview: REQUIRED`. Rechaza enlaces no portables, archivos/líneas inexistentes y rutas fuera del proyecto. Se documenta y prueba que una cita existente aún puede no respaldar su afirmación. Suite completa: **125/125**; revalidación final de contexto/onboarding: **14/14**, subconjunto de esa suite.
3. **Recorridos y actualización:** comparación de dos fixtures con el paquete anterior y dos con el candidato, cada uno usando solo `/omni-init`: documentación Node 22.19/PostgreSQL 18 frente a CI Node 20/PostgreSQL 17; y Python >=3.12 frente a imagen Python 3.10. El candidato mantuvo ambos lados en sus comandos y respuesta, requisitos como declarados y enlaces relativos. `context-check` validó 10 y 8 enlaces; la revisión de significado se hizo separadamente. Hashes de los cuatro proyectos muestran que solo cambió su contexto, sin ejecutar aplicaciones. La muestra anterior también reconoció las discrepancias; no se afirma una mejora estadística de razonamiento a partir de estos cuatro casos.

Se comprobó además la actualización desde el tarball anterior: agregó el comprobador y renovó motor/skills, conservando byte a byte contexto, constitución y fuente de aplicación; doctor terminó sano con 52 archivos administrados. Esto permite actualizar una instalación existente y reconciliar su contexto mediante el comando, sin borrar el proyecto.

Evidencia local: `artifacts/reconciliation-suite.log`, `artifacts/reconciliation-final-targeted.log`, `artifacts/reconciliation-evals/results.json` y respuestas/contextos de esos fixtures. La prueba de paquete incluye ahora seis escenarios de onboarding y rechazo de citas `file://` usando el motor instalado. Cada evaluación sigue siendo una muestra con el modelo de esta sesión, no la aceptación del candidato más reciente en Antigravity.

## Resolución de los hallazgos originales

| Hallazgo | Cambio | Evidencia |
| --- | --- | --- |
| B01: completar sin verificar | `complete` exige auditoría, checklist y registro vigente de verificación. | Regresiones para cuatro tipos; fallo real y posterior corrección en el paquete. |
| B02: agente inexistente con éxito | Validación antes de instalar archivos. | Prueba sin efectos de `init` inválido y rechazo en paquete instalado. |
| B03: selección no persistida | `setup-agent` guarda la selección bajo lock. | Estado leído en un proceso posterior. |
| B04: personalizaciones perdidas | Huellas, previsualización, conflictos y backups explícitos. | Comparación del contenido conservado y respaldado. |
| B05: proyecto ausente sincronizado | `check` devuelve error y estado NOT INITIALIZED. | Prueba de CLI no inicializada. |
| B06: todos los flujos asumían feature | Tabla compartida de rutas por tipo. | Revisión de instrucciones y cuatro recorridos CLI; chat semántico pendiente. |
| B07: npm fijo | Comandos del proyecto, candidatos con cwd y configuración explícita. | Detección multistack/monorepo; verificaciones ejecutadas desde raíz. |
| B08: errores silenciados | Fallos de assets propagados y versión guardada después de su escritura. | Instalación bloqueada por conflicto de filesystem y actualización conflictiva. |
| B09: auditoría exagerada | Separación audit/verify y límites documentados. | Salidas CLI, README y registros con modo de evidencia. |
| B10: tareas prefabricadas | Plantillas cortas con tareas derivadas del alcance. | Plantillas y pruebas de contenido/checklist. |

## Límites aún abiertos para declarar una release estable

1. **Chat real de Antigravity:** el usuario ejecutó dos iteraciones de `/omni-init` en un proyecto existente; se inspeccionaron los archivos y la traza/respuesta del segundo ensayo. La integración permitió ambos recorridos, pero reveló los fallos descritos arriba. El candidato tras la segunda corrección aún requiere aceptación en el host; versión exacta del host, modelo y salidas completas de herramientas no están registrados.
2. **Otros agentes:** contratos de archivos contrastados y probados; invocación real en sus interfaces pendiente. `generic` ofrece instrucciones por archivo, no un slash registrado.
3. **Matriz de plataforma/runtime:** validado aquí Windows/Node 22. La CI declara Ubuntu/Windows y Node 18.19, 20, 22 y 24; no se ejecutó remotamente ni se extrapola su resultado.
4. **Semántica y cobertura:** longitudes, tokens y checklists no prueban que los requisitos sean correctos. La revisión de criterios y la calidad de las pruebas siguen siendo responsabilidad compartida entre agente y usuario.
5. **Snapshots:** acotados a 20.000 archivos / 256 MiB, sin dependencias/cachés/salidas habituales y sin fuentes symlink. La evidencia local es editable y no constituye una atestación contra manipulación deliberada.
6. **Fallos de I/O parciales:** las escrituras de múltiples archivos no son una transacción global. Se reporta el fallo y no se adelanta la versión; revisar doctor/update y backups antes de reintentar. No se anuncia rollback automático universal.

## Aceptación pendiente en Antigravity

Usar una carpeta desechable y un proyecto existente de prueba. Registrar versión del host, versión de OmniSpec y modelo usado; no usar la aplicación real de producción como primer ensayo.

1. Desde cada proyecto, ejecutar el bootstrap con el CLI local 0.5.0 y `--agent antigravity`.
2. Abrir/recargar el proyecto y confirmar las nueve skills en el selector; ejecutar `/omni-init`.
3. Pedir `/omni-discuss` sobre una ubicación o decisión real. Comprobar que cite evidencia y no modifique código ni cree una feature por una pregunta.
4. Pedir una feature pequeña. Comprobar aclaración proporcional, plan sin capas innecesarias, tareas trazables y verificación real antes del cierre.
5. Repetir con un bug reproducible y una RFC rechazada o aplazada. No exigir archivos de feature en esas rutas.
6. Abrir una sesión nueva y comprobar foco, decisiones y siguiente tarea.
7. Registrar resultados, fallos y capturas/transcripciones relevantes. Solo entonces marcar esta integración como probada en ese host.

Esta aceptación es una comprobación concreta pendiente, no una promesa de que todos los entornos y modelos se comportarán igual.
