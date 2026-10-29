# Próximas entregas de OmniSpec 0.8

Actualizado el 2026-10-29. Esta hoja de ruta distingue la candidata actual de las capacidades pendientes; las fechas y el número de la próxima Preview todavía no están fijados.

## Candidata 0.8.0-preview.2

Incluye:
- **Triaje dinámico y flujo ligero** (Spec 017): Creación adaptativa de especificaciones (`--light`, `--preset`), andamiaje dinámico y flags de triaje con validación fail-fast.
- **Sintaxis EARS y Zero-Slop Guard** (Spec 016): Estandarización de criterios de aceptación EARS y protocolo de 5 reglas de calidad de código y arquitectura.
- **Guardián de diseño UI y `omni-init` optimizado** (Specs 015 y 018): Matriz obligatoria de 4 estados (*Loading*, *Empty*, *Error*, *Protected*), desacoplamiento total de *companions* de terceros y detección directa de kits de componentes (`--ui-components`).
- **Aislamiento y observabilidad**: Economía de contexto (`contracts --active`), runtime local ignorado por Git y restaurable, y diagnóstico de coexistencia de Antigravity. Consulta los cambios y límites en las [notas de la Preview](releases/0.8.0-preview.2.md).

La publicación usa el canal npm `preview` y una prerelease de GitHub. La validación local del motor no sustituye la aceptación en hosts reales ni promueve la candidata a `0.8.0` estable.

## Capacidades planificadas para próximas iteraciones (0.8.0-preview.2 / 0.8 estable)

| Capacidad | Estado | Objetivo |
| --- | --- | --- |
| Evidencia formal Rojo→Verde en TDD | Planificado | Verificación automatizada de fallos iniciales antes de la implementación de features y bugfixes |
| Auditoría automatizada de Observabilidad y Estados en CI | Planificado | Gate de verificación en CI para contrastes WCAG y observabilidad de errores en runtime |
| Perfiles avanzados y puente Web Initializr | Planificado | Importar/exportar perfiles de gobernanza reproducibles y definir contrato headless para web |
| Destilación de memoria duradera | Planificado | Indexación compacta de decisiones arquitectónicas y aprendizajes entre sesiones |

Antes de promover `0.8.0` estable se revisarán la aceptación en hosts reales y los resultados del piloto comparativo. Las observaciones pendientes se mantienen visibles en las notas de cada entrega.
