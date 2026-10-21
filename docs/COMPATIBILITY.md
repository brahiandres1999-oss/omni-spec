# Compatibilidad y verificación

OmniSpec 0.6.0 es una versión de precisión, soporte nativo de Plugin en Google Antigravity y subagentes autónomos de calidad sobre la base de desarrollo 0.x. Su contrato es instalar flujos por proyecto con precisión de primer pase (eliminación de AI slop en backend, frontend y especificaciones), conservar contexto y especificaciones al actualizar, destrabar el diagnóstico de bugs con pruebas empíricas y exigir auditoría, cobertura de criterios y verificación antes de cerrar trabajo nuevo. No certifica la aplicación ni el razonamiento de un modelo por instalarse.

## Plataformas y paquete

La matriz de GitHub Actions comprueba Windows y Ubuntu con Node 18.19, 20, 22 y 24: suite del motor, instalación del tarball, ejecución mediante npm-exec, CLI global en prefijo temporal y runtime autónomo. Consultar el resultado del workflow correspondiente a la etiqueta concreta; la matriz aprobada de una candidata no sustituye la de otra versión.

`npm run test:package` recorre proyectos nuevos, existentes, con fallos, stacks desconocidos, monorepos y documentos sin código. También verifica los cuatro tipos de trabajo y el rechazo de cierres sin evidencia. Son fixtures reproducibles, no una certificación de todos los proyectos.

## Agentes

Antigravity es la integración principal, soportando instalación en workspace (`.agents/skills/`) y modo Plugin modular (`plugin.json` enlazable mediante `npm run sync:plugin`) junto con el subagente independiente `omni-auditor`. Las nueve skills y sus contratos actuales tienen comprobaciones automatizadas; no se ha registrado un nuevo recorrido completo de chat con cada versión/modelo de Antigravity.

Cursor, Claude Code, Copilot en VS Code, Kilo, OpenCode, Gemini y Codex tienen adaptadores según sus formatos documentados y pruebas de generación. Su invocación y comportamiento deben comprobarse en la versión del host utilizada. `generic` ofrece archivos para lectura explícita, sin registrar comandos nativos. Ver [fuentes y formatos](STANDARDS.md).

Para aceptar un host: confirmar descubrimiento de comandos, usar `omni-init` en proyecto nuevo y existente, discutir sin implementar, completar una feature y un bug, registrar una RFC sin código y reanudar el foco en otra sesión. Conservar los resultados reales y declarar cualquier comprobación pendiente.

## Actualizaciones

La actualización admite instalaciones anteriores y copias de desarrollo que ya indiquen 0.5.0: compara archivos administrados aunque coincida el número de versión. `--dry-run` no escribe; `update` conserva contexto, constitución, gates y especificaciones. Las personalizaciones administradas bloquean el reemplazo hasta su revisión. Ver [procedimiento](RELEASING.md#actualizar-proyectos).

Los trabajos completados permanecen como historial. Reabrir o volver a verificar un trabajo antiguo requiere adaptar sus criterios a `acceptance.json`; la actualización no inventa evidencia ni reescribe su resultado.

## Límites operativos

- `context-check` y `audit` revisan estructura; el agente debe comprobar el significado de fuentes y requisitos.
- `acceptance.json` exige cobertura de IDs, estado, método y evidencia. La veracidad de esa evidencia requiere revisión; una cadena de texto no demuestra una interacción o conformidad de accesibilidad.
- `verify` ejecuta los gates configurados y registra su resultado; `complete` rechaza pendientes y cambios posteriores al snapshot.
- El snapshot tiene límites de 20.000 archivos y 256 MiB, excluye dependencias/cachés/salidas y rechaza fuentes symlink. Los registros locales son editables.
- Las escrituras de varios archivos no son una transacción global. Ante un fallo de I/O, revisar `doctor`, backups y la vista previa antes de reintentar.
- No se garantiza cero alucinaciones, cumplimiento regulatorio ni funcionamiento idéntico de todos los modelos y entornos.
