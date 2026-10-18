# OmniSpec 0.4.1 — alcance y contrato de estabilización

Fecha: 2026-10-18. Estado: diagnóstico verificado y propuesta de contrato; no certifica una versión estable.

**Registro histórico:** la implementación posterior se amplió a 0.5.0 por autorización del autor. El estado actual, las tres revisiones y los límites están en [VALIDATION-0.5.0.md](VALIDATION-0.5.0.md); este documento conserva el diagnóstico previo.

## 1. Intención confirmada por el autor

OmniSpec se instala por proyecto y se usa principalmente desde el chat de un agente de IA, mediante comandos invocables. Debe ayudar a entender proyectos existentes y a construir proyectos nuevos; explorar, proponer, aclarar, especificar, corregir y verificar trabajo. La CLI también debe ser útil directamente, con mensajes claros y una experiencia guiada. Se busca una instalación ligera y adaptación al agente elegido.

**Antigravity es el primer agente seleccionado para comprobar la experiencia completa.** La arquitectura seguirá admitiendo otros adaptadores, cuya compatibilidad debe demostrarse individualmente.

La aspiración de minimizar alucinaciones se traduce en controles observables: distinguir hechos, inferencias y dudas; vincular decisiones con evidencia; resolver ambigüedades relevantes; y verificar resultados. No es posible garantizar que cualquier modelo nunca invente información.

Definición propuesta del producto:

> OmniSpec es un sistema de trabajo guiado para agentes de programación, instalado en el repositorio, que convierte intenciones en cambios verificables y conserva contexto, decisiones, alcance y evidencia entre sesiones.

## 2. Estado observado

- El árbol de trabajo declara 0.4.1, pero HEAD `c54cc6f` declara 0.4.0. Las etiquetas locales llegan a `v0.4.0`. No se verificaron las referencias remotas.
- Hay modificaciones previas en código, pruebas y documentación; `schema/` y `test/field-regression.test.mjs` estaban sin seguimiento. La revisión no modifica esos cambios.
- Las 79 pruebas existentes pasan en Windows con Node 22.19.0 y npm 10.9.3 fuera del sandbox. Dentro del sandbox aparecieron errores EPERM de renombrado que no se reprodujeron en esa segunda ejecución.
- Se empaquetó la copia local con `npm pack --ignore-scripts` y se instaló el tarball en un directorio temporal con `--offline --ignore-scripts --no-audit --no-fund`.
- El paquete instalado informa 0.4.1 y permite inicializar y crear una especificación. No se probó aquí una instalación remota ni la invocación real dentro de Antigravity.

Las pruebas actuales aportan evidencia sobre funciones del motor, pero no certifican que el usuario pueda completar el recorrido de chat anunciado.

## 3. Brechas comprobadas

| ID | Evidencia | Consecuencia | Criterio propuesto |
| --- | --- | --- | --- |
| B01 | En el paquete instalado: crear una feature, ejecutar `audit` devuelve 1 con 0/32 tareas; `complete 001` devuelve 0 y registra COMPLETED. | El cierre no demuestra cumplimiento. | Rechazar cierre con auditoría bloqueada o trabajo pendiente; definir evidencia de verificación según el tipo de trabajo. |
| B02 | `setup-agent not-a-real-agent` devuelve 0, crea cero archivos y anuncia comandos disponibles. | La instalación puede afirmar éxito sin proporcionar integración. | Validar el agente antes de escribir y explicar valores admitidos. |
| B03 | Tras inicializar con Cursor y ejecutar `setup-agent claude`, el manifiesto sigue indicando Cursor. | La configuración y el siguiente `update` no reflejan necesariamente la elección más reciente. | Definir si setup cambia o añade adaptador; persistir y comunicar esa decisión. |
| B04 | Personalizar `_templates/01-feature/spec.md` y ejecutar `update` elimina esa personalización. | La promesa de actualización no destructiva necesita una política real de propiedad de archivos. | Detectar conflictos y conservar cambios o respaldarlos mediante un procedimiento explícito. |
| B05 | `check` antes de `init` devuelve 0 y muestra SYNCHRONIZED, junto con un aviso de que el proyecto no está inicializado. | La salida humana y la señal para automatización son contradictorias. | Estado no inicializado inequívoco y código de salida coherente. |
| B06 | `src/integrations.mjs` referencia principalmente `spec.md`, `plan.md` y `tasks.md`; los otros arquetipos generan archivos diferentes. | El recorrido del chat no está adaptado a los cuatro tipos anunciados. | Cada comando resuelve el tipo activo y sus artefactos; una RFC no requiere implementar código. |
| B07 | Las instrucciones de implementación y convergencia incluyen `npm test` fijo. | El agente recibe una guía incoherente para proyectos de otros stacks. | Usar los comandos del proyecto con su directorio de ejecución y declarar verificaciones ausentes. |
| B08 | `src/generator.mjs` silencia errores de instalación de integraciones; `src/updater.mjs` silencia errores de copia de plantillas. | Un fallo parcial puede presentarse como éxito. | Reportar fallos concretos y no registrar sincronización completa cuando falla una etapa obligatoria. |
| B09 | El auditor comprueba estructura, tokens y cantidades; varios requisitos son advertencias. No ejecuta las pruebas de la aplicación. | El README y el mensaje “Quality gates satisfied” atribuyen garantías superiores a la comprobación realizada. | Separar auditoría documental, revisión del agente y ejecución de pruebas. |
| B10 | La plantilla feature incluye 32 tareas predefinidas, incluidas base de datos, migraciones y capas de aplicación. | Puede inducir alcance ajeno a una herramienta CLI, librería o cambio pequeño. | Generar tareas desde la necesidad y evidencia; marcar explícitamente lo que no aplica. |

B01–B05 se reprodujeron ejecutando el paquete instalado. B06–B10 proceden de inspección del código y las plantillas; no se presentan como pruebas realizadas en el chat del agente.

## 4. Experiencia que debe cumplir la base

### Instalación y adopción

1. Instalar una versión identificable por proyecto, sin depender de una instalación global implícita.
2. Seleccionar Antigravity y generar únicamente su integración y el núcleo compartido necesario.
3. Mostrar versión, raíz del proyecto, archivos instalados, método de invocación y siguiente paso.
4. Abrir el proyecto en Antigravity y comprobar que los comandos se descubren y ejecutan.
5. El primer uso examina el repositorio y presenta hechos encontrados, dudas relevantes y reglas propuestas. En un proyecto vacío no inventa arquitectura existente; en uno empezado respeta convenciones comprobadas.

La documentación actual de Antigravity identifica `.agents/skills` como ubicación por defecto y mantiene compatibilidad con `.agent/skills`. La ruta actual de OmniSpec, por sí sola, no demuestra un error. Hay que verificar descubrimiento, formato e invocación en la versión concreta del agente usada para la aceptación: [Agent skills](https://www.antigravity.google/docs/skills?tab=ide) y [migración de workflows a skills](https://www.antigravity.google/docs/migration/workflows-to-skills/).

### Trabajo desde el chat

Conservar inicialmente los siete comandos existentes, corregir sus contratos y resolver el tipo de trabajo activo en cada fase. Evitar ampliar el catálogo antes de comprobar estos recorridos:

| Intención | Resultado esperado | Ruta inicial |
| --- | --- | --- |
| Entender o encontrar algo | Hallazgos con ubicación y evidencia, límites de la búsqueda y dudas | Exploración; no requiere crear una feature automáticamente |
| Aclarar o proponer una idea | Alternativas, restricciones y decisión pendiente o acordada | Clarificación; RFC cuando convenga conservar una decisión |
| Crear una capacidad | Criterios, plan proporcional, tareas, implementación y verificación | Feature |
| Corregir un fallo | Reproducción, hipótesis verificadas, causa, arreglo y regresión | Bugfix |
| Mejorar estructura o deuda | Motivo, impacto, estrategia y pruebas de comportamiento preservado | Debt |

La exploración ligera debe poder terminar con una respuesta útil. Su interfaz exacta —fase inicial compartida o comando específico— queda por definir; no existe hoy un comando dedicado que se haya validado. No convertir cada consulta en documentación extensa.

Cada operación debe comunicar: qué contexto leyó, qué encontró, qué cambió o propuso, qué verificó y qué sigue. La cantidad de documentos y preguntas se adapta al riesgo y a la ambigüedad.

### Reanudar y cerrar

Al reabrir el chat, el agente identifica la especificación activa, sus decisiones y el siguiente paso pendiente. No crea una segunda especificación por perder el contexto de conversación.

“Auditoría aprobada” significa únicamente que pasaron los controles documentales implementados. “Verificado” debe incluir qué pruebas o comprobaciones se ejecutaron y sus resultados. Para una RFC, el cierre registra una decisión y su justificación; para un cambio de código, exige evidencia correspondiente a sus criterios de aceptación.

## 5. Límites que conservan la ambición

- Compatibilidad amplia mediante adaptadores con contrato compartido; cada agente tiene un estado de soporte y una versión probada. Generar archivos no equivale a certificar integración.
- Un mismo flujo conceptual puede tener distinta sintaxis de invocación según el agente. Spec Kit también documenta esas diferencias: [referencia oficial de comandos](https://github.github.com/spec-kit/reference/agentic-sdd.html).
- Cero dependencias externas del CLI no significa cero prerrequisitos: se requiere el runtime declarado y el agente elegido.
- Las reglas de dominio son ayudas de diseño, no certificaciones regulatorias automáticas.
- Las preguntas deben resolver decisiones que cambian el resultado; lo comprobable en el repositorio debe investigarse antes de preguntarlo.
- La CLI necesita estados, errores y ayuda claros. Una interfaz gráfica adicional no está confirmada como requisito de 0.4.1.
- Los prompts orientan al agente; no impiden por sí mismos que un modelo o usuario salte el proceso. Los controles mecánicos se aplican en operaciones controladas por OmniSpec y en integraciones explícitas de verificación.

## 6. Orden de estabilización propuesto

1. **Contrato del producto:** utilizar esta intención como referencia; fijar entradas, salidas y límites de cada comando existente. Definir la exploración ligera sin multiplicar arquetipos prematuramente.
2. **Motor confiable:** corregir falsos éxitos, cierre sin controles, actualización de archivos personalizados y persistencia de adaptadores. Añadir regresiones que reproduzcan los fallos reales.
3. **Recorridos coherentes:** adaptar las instrucciones al arquetipo y a los comandos reales del proyecto; eliminar tareas obligatorias ajenas a la necesidad; separar aclaración temprana de auditoría completa para no exigir plan y tareas antes de crearlos.
4. **Aceptación en Antigravity:** instalar el paquete candidato en proyectos de prueba y ejecutar los recorridos desde el chat. Registrar versión del agente, versión/identidad del paquete y resultados.
5. **Distribución reproducible:** consolidar cambios revisados, ejecutar la matriz soportada, comprobar instalación del artefacto y del origen de distribución elegido, y publicar instrucciones fijadas a la referencia liberada. No etiquetar como estable antes de esta evidencia.
6. **Expansión de adaptadores:** repetir el mismo contrato de aceptación para cada agente anunciado. Ampliar capacidades sobre esa base.

## 7. Puerta de salida para declarar estable 0.4.1

- [ ] El paquete distribuido corresponde exactamente al código probado; la documentación no instala una rama cambiante como si fuera una versión fija.
- [ ] Instalación por proyecto funcional sin un binario global previo; el agente invoca la versión local correcta.
- [ ] Invocación real de los siete comandos en la versión de Antigravity registrada.
- [ ] Recorrido desde cero: necesidad → aclaración → plan → tareas → implementación → verificación.
- [ ] Recorrido en proyecto existente: reconocer estructura y pruebas, realizar cambio acotado y conservar comportamiento previo.
- [ ] Bugfix, debt y RFC utilizan sus propios artefactos y condiciones de cierre.
- [ ] Exploración de una pregunta y propuesta de una idea sin cambios de código no solicitados.
- [ ] Reanudación en sesión nueva conserva foco y decisiones.
- [ ] Proyecto no Node utiliza sus comprobaciones reales; lo no ejecutado se declara pendiente.
- [ ] Auditoría fallida o tareas pendientes no se presentan como entrega verificada.
- [ ] Fallos de integración o actualización no producen éxito engañoso ni versión falsamente sincronizada.
- [ ] Reinstalar y actualizar conserva trabajo y personalizaciones conforme a la política acordada.
- [ ] Las pruebas del motor y la matriz de sistemas/runtime soportados pasan para el candidato final.
- [ ] README, ayuda y mensajes describen exactamente lo que se ha comprobado.

Estabilidad significa cumplir el 100% de este contrato acordado dentro del entorno declarado. No significa ausencia demostrable de cualquier fallo futuro ni comportamiento perfecto de todos los modelos.

## 8. Siguiente decisión de trabajo

El primer agente ya está definido: Antigravity. La siguiente entrega de implementación debe cerrar B01–B09 y adaptar el recorrido feature al proyecto real, conservando la identidad de los cuatro arquetipos. La aceptación final sigue pendiente de una prueba dentro de Antigravity y de precisar la interfaz de exploración ligera. Este documento propone el contrato; no afirma que esas correcciones estén implementadas.
