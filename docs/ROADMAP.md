# Próximas entregas de OmniSpec 0.8

Actualizado el 2026-10-28. Esta hoja de ruta distingue la candidata actual de las capacidades pendientes; las fechas y el número de la próxima Preview todavía no están fijados.

## Candidata 0.8.0-preview.1

Incluye economía de contexto, runtime local ignorado por Git y restaurable, mejoras de prompts, diagnóstico de coexistencia de Antigravity y UI companions (`better` y `frontend-design`). Consulta los cambios y límites en las [notas de la Preview](releases/0.8.0-preview.1.md).

La publicación usa el canal npm `preview` y una prerelease de GitHub. La validación local del motor no sustituye la aceptación en hosts reales ni promueve la candidata a `0.8.0` estable.

## Capacidades aplazadas

Se desarrollarán como dos trabajos independientes, en este orden, para una versión posterior del mismo paquete `omni-spec`:

| Trabajo | Estado | Objetivo |
| --- | --- | --- |
| 015 — Presets y puente Web Initializr | Pendiente | Importar configuración con `--preset` (JSON, Base64 o URL), exportar presets reproducibles y definir un contrato no interactivo para una futura interfaz web |
| 016 — Avisos de actualización y sincronización de companions | Pendiente | Consultar versiones del core y revisiones de companions, guardar una caché local y ofrecer avisos informativos y sincronización explícita |

Estos comandos y formatos propuestos **no forman parte de preview.1**. El sitio `start.omnispec.dev` es una iniciativa futura separada. La caché de 24 horas es una propuesta pendiente de diseño; todavía deben definirse errores de red, uso offline, privacidad y precedencia de configuración. No se han aprobado métricas de uso ni telemetría de usuarios.

## Resto del plan de 0.8

Se conservan los trabajos previstos para las próximas Previews: fit v3 y presupuestos, evidencia formal rojo→verde, auditoría de Observability y estados, destilación de memoria, Driver/Navigator y los pendientes de instalación/coexistencia del plugin. Las capacidades 015 y 016 no sustituyen esos compromisos.

Antes de promover `0.8.0` estable se revisarán la aceptación en hosts reales y los resultados del piloto comparativo. Las observaciones pendientes se mantienen visibles en las notas de cada entrega.
