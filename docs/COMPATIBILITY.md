# Compatibilidad y verificación — 0.7.0 Preview

La versión preparada es `0.7.0-preview.2`, canal npm `preview`. Los resultados históricos de rc.1/rc.2 se conservan con su alcance; no implican una ejecución nueva de todos los hosts. Ver [notas de la Preview](releases/0.7.0-preview.2.md).

OmniSpec instala flujos de especificación y revisión por proyecto, con soporte de Plugin en Google Antigravity y adaptadores para otros hosts. Conserva contexto y especificaciones al actualizar y exige auditoría, cobertura declarada de criterios y un registro de verificación antes de cerrar trabajo. No garantiza precisión al primer intento ni certifica la aplicación o el razonamiento de un modelo por instalarse.

## Plataformas y paquete

El candidato requiere Node >=22.19.0. La matriz configurada de GitHub Actions contempla Windows y Ubuntu con Node 22.19, 22, 24 y 26: suite del motor, instalación del tarball, ejecución mediante npm-exec, CLI global en prefijo temporal y runtime autónomo. Esa configuración no implica una ejecución remota. rc.1 se validó localmente en Windows y Ubuntu (WSL) con Node 22.23.4 y en Windows con 22.19.0. rc.2 se validó en Linux con Node 22.22.0 (suite, cobertura, lint, paquete instalado y paridad de reglas de ignorado con Git); el ajuste local del instalador del 2026-10-23 se comprobó en Windows con Node 24.22.1 (299 pruebas: 296 aprobadas y 3 omitidas por permisos de enlaces; 21 escenarios de paquete, incluidos npx interactivo y automático, interfaz de teclado y auditor instalado). La matriz completa y el descubrimiento real por host siguen pendientes. Consultar el resultado del workflow correspondiente a una etiqueta cuando exista; la matriz aprobada de una candidata no sustituye la de otra versión.

`npm run test:package` recorre proyectos nuevos, existentes, con fallos, stacks desconocidos, monorepos y documentos sin código. También verifica los cuatro tipos de trabajo y el rechazo de cierres sin evidencia. Son fixtures reproducibles, no una certificación de todos los proyectos.

`0.7.0-preview.1` se comprobó localmente en Windows con Node 24.22.1 y npm 11.19.1: 300 pruebas (297 aprobadas, 3 omitidas por permisos de enlaces), cobertura de líneas 94,80 %, lint y 21 escenarios del paquete aprobados. La migración desde el tarball rc.2 conservó especificaciones, idioma, contexto y constitución; requiere la opción explícita de versión descrita en [RELEASING](RELEASING.md#copias-locales-de-070-rc1-o-rc2).

## Reglas de exclusión y Preview 2

La candidata actual es `0.7.0-preview.2`, pendiente de publicación; el tag Preview 1 falló en CI antes de empaquetar.

El ajuste posterior al primer tag Preview conserva la semántica documentada de globstar: `a**/b` no excluye `a/x/b`; `a/**/b` sí. Algunas compilaciones de Git, incluida la 2.51.0.windows.1 comprobada localmente, difieren en el primer patrón. OmniSpec mantiene la misma regla en todos los sistemas para evitar omitir fuentes de la huella. La regresión independiente y la prueba diferencial reconocen únicamente ese resultado antiguo concreto. Ver la [sintaxis oficial de gitignore](https://git-scm.com/docs/gitignore#_pattern_format).

## Agentes

Antigravity es la integración principal, soportando instalación en workspace (`.agents/skills/` y `.agents/agents/omni-auditor.md`) y modo Plugin modular (`plugin.json` enlazable mediante `npm run sync:plugin`) junto con el subagente independiente `omni-auditor`. Las nueve skills y sus contratos actuales tienen comprobaciones automatizadas; no se ha registrado un nuevo recorrido completo de chat con cada versión/modelo de Antigravity.

Cursor, Claude Code, Copilot en VS Code, Kilo, OpenCode, Gemini y Codex tienen adaptadores según sus formatos documentados y pruebas de generación. Su invocación y comportamiento deben comprobarse en la versión del host utilizada. `generic` ofrece archivos para lectura explícita, sin registrar comandos nativos. Ver [fuentes y formatos](STANDARDS.md).

Para aceptar un host: confirmar descubrimiento de comandos, usar `omni-init` en proyecto nuevo y existente, discutir sin implementar, completar una feature y un bug, registrar una RFC sin código y reanudar el foco en otra sesión. Conservar los resultados reales y declarar cualquier comprobación pendiente.

## Actualizaciones

La actualización admite instalaciones anteriores y copias de desarrollo que ya indiquen 0.5.0: compara archivos administrados aunque coincida el número de versión. `--dry-run` no escribe; `update` conserva contexto, constitución, gates y especificaciones. Las personalizaciones administradas bloquean el reemplazo hasta su revisión. Ver [procedimiento](RELEASING.md#actualizar-proyectos).

Los trabajos completados permanecen como historial. Reabrir o volver a verificar un trabajo antiguo requiere adaptar sus criterios a `acceptance.json`; la actualización no inventa evidencia ni reescribe su resultado.

El cálculo de la huella cambió en rc.1 (evidencia recursiva) y en rc.2 (reglas de ignorado y orden independiente del locale). Antes de completar una spec verificada con un cálculo anterior, ejecutar `verify` de nuevo; no migrar la huella como si se hubieran repetido las comprobaciones. `update` conserva la constitución y deja `specs/.omni/reference/CONSTITUTION.md` para comparar con la guía vigente.

## Rutas de esfuerzo

Para feature y debt, `audit` respeta los artefactos requeridos por `fit`: light no exige plan ni tareas; standard exige plan pero no tareas; full exige ambos. Fit v2 incorpora riesgo, incertidumbre y reversibilidad, y permite bugfix light con reproducción, causa y regresión en bug.md; standard exige además rca.md y el diseño de fix.md, y full también sus tareas. Fit v1 conserva la regla anterior de bugfix full. Los documentos opcionales se conservan en disco y se anuncian como no auditados. Las decisiones necesarias deben estar en el contrato activo, no ocultas en esos documentos. Al promover a full vuelven a ser obligatorios, incluidos sus placeholders y tareas pendientes. Sin fit, se conserva la ruta completa; un fit inválido bloquea la auditoría.

## Límites operativos

- `context-check` y `audit` revisan estructura; el agente debe comprobar el significado de fuentes y requisitos.
- `acceptance.json` v2 exige cobertura de IDs, tipo, estado, método y evidencia. Los criterios UI manuales requieren observaciones de pasos, esperado/real, fecha y artefacto local; los visuales incluyen viewport. Una observación del agente exige capacidad render registrada. La veracidad y suficiencia requieren revisión: ni una cadena ni una captura certifican conformidad de accesibilidad.
- `verify` ejecuta los gates y el catálogo `specs/checks.json`; `complete` rechaza pendientes y cambios posteriores al snapshot. El catálogo incorpora ID, cwd, timeout y tipo. Un criterio automatizado usa `checkIds` o `checkCommands` inequívocos; los criterios UI automatizados exigen checks de tipo ui. La salida distingue declaración y ejecución; el cierre conserva ese alcance en `verification.acceptance`. La relevancia de las assertions sigue requiriendo revisión. El texto de evidencia no introduce comandos ejecutables. Ver [contratos de entrega](DELIVERY.md).
- El snapshot comparte un límite de 20.000 archivos y 256 MiB entre fuentes, contexto y archivos de la spec. Excluye rutas de `.gitignore`, `.git/info/exclude`, `.omnispecignore` y las exclusiones por defecto (dependencias, cachés, salidas de build/test e IDE), además de otras specs y el estado de OmniSpec. Recorre toda la spec activa, también sus subcarpetas de evidencia, sin aplicar reglas de ignorado; solo omite su `verification.json` raíz. Fuera de la carpeta de la spec, un symlink a un archivo del proyecto se atesta por su contenido; se rechazan los symlinks a directorios, fuera del proyecto o hacia `.git/`, `specs/` o `.omni/`, salvo que estén ignorados. Dentro de la spec activa se rechaza cualquier symlink. La comparación distingue mayúsculas en todos los sistemas, de modo que los mismos bytes producen la misma huella en Windows, macOS y Linux (una copia con CRLF tiene bytes distintos), y no lee reglas de carpetas superiores. Los registros locales son editables; la huella detecta cambios, no demuestra veracidad ni ausencia de regresiones.
- Las escrituras de varios archivos no son una transacción global. Cada archivo de estado se reemplaza atómicamente y los renombres reintentan errores transitorios de Windows (EPERM/EBUSY/EACCES) causados por antivirus o sincronización. Aun así, se recomienda trabajar fuera de carpetas sincronizadas como OneDrive. Ante un fallo de I/O, revisar `doctor`, backups y la vista previa antes de reintentar.
- Una copia con finales de línea CRLF de los archivos administrados no cuenta como modificación local.
- La línea base de contexto (`context-record`) no distingue CRLF de LF en las entradas de texto: un clon o una copia con otros finales de línea no la deja `STALE`. Las entradas con un byte NUL se comparan por bytes, y la huella de `verify` sí distingue CRLF de LF.
- Un CLI 0.7.x no conoce el scope `CONTEXT_INPUTS_V3` y trata esa línea base como antigua: puede marcarla `STALE`, no vigila `AGENTS.md` ni los archivos de `specs/` citados, y con `context-record` la vuelve a registrar como `CONTEXT_INPUTS_V2`. Todo el equipo debe usar la misma versión de OmniSpec.
- No se garantiza cero alucinaciones, cumplimiento regulatorio ni funcionamiento idéntico de todos los modelos y entornos.

Los registros de verificación usan `version: 3`: identidad completa del catálogo, `checkCwd` relativo, hashes de logs, archivos cambiados durante la ejecución y número de archivos atestados. Los registros anteriores requieren ejecutar `verify` nuevamente antes de completar. La aceptación v1 se conserva; etiquetas UI explícitas del contrato primario exigen evidencia tipada incluso en reportes anteriores. No se convierten automáticamente pruebas declaradas en resultados ejecutados.

Ejemplo de fila automatizada (el comando debe estar previamente aprobado y configurado como gate, y el archivo de prueba debe comprobar ese requisito):

```json
{
  "id": "AC-01",
  "status": "passed",
  "method": "automated",
  "evidence": "El test de acceso comprueba el rechazo de una sesión sin permisos; no acredita revisión visual.",
  "checkCommands": ["node --test test/access.test.mjs"]
}
```

La correspondencia se hace con el comando exacto, incluyendo argumentos. Un comando puede comprobar varios criterios y un criterio puede requerir varios comandos. Una fila manual no se convierte en automatizada porque también haya gates en el proyecto. No renombrar el método para evitar una comprobación fallida: conservar el resultado y corregir o resolver el bloqueo real.

Un timeout falla siempre. La terminación del árbol usa taskkill en Windows y señales al grupo en POSIX; si no puede confirmarse la limpieza dentro de dos segundos adicionales, el registro informa el límite y libera la espera. Pueden quedar procesos activos si el sistema deniega terminarlos; deben revisarse antes de reintentar. No se presenta ese caso como limpieza exitosa.

Cada check conserva un log combinado limitado a 8 MiB; excederlo falla explícitamente. La salida visible es una cola con aviso de truncado. El cierre valida tamaño y hash del log. `status` y `complete` comparten inspección para indicar `READY_TO_COMPLETE`; decisiones requeridas sin resolver y contexto registrado obsoleto bloquean el cierre. Los contratos por capacidad conservan la revisión efectiva mientras una propuesta posterior sigue pendiente. Estos controles acreditan integridad mecánica, no veracidad semántica o calidad universal.
