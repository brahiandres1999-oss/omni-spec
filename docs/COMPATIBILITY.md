# Compatibilidad y verificación

OmniSpec instala flujos de especificación y revisión por proyecto, con soporte de Plugin en Google Antigravity y adaptadores para otros hosts. Conserva contexto y especificaciones al actualizar y exige auditoría, cobertura declarada de criterios y un registro de verificación antes de cerrar trabajo. No garantiza precisión al primer intento ni certifica la aplicación o el razonamiento de un modelo por instalarse.

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

La cobertura recursiva de evidencia cambia el cálculo del fingerprint. Antes de completar una spec verificada con el cálculo anterior, ejecutar `verify` de nuevo; no migrar la huella como si se hubieran repetido las comprobaciones.

## Rutas de esfuerzo

Para feature y debt, `audit` respeta los artefactos requeridos por `fit`: light no exige plan ni tareas; standard exige plan pero no tareas; full exige ambos. Los documentos opcionales se conservan en disco y se anuncian como no auditados. Las decisiones necesarias deben estar en el contrato activo, no ocultas en esos documentos. Al promover a full vuelven a ser obligatorios, incluidos sus placeholders y tareas pendientes. Sin fit, se conserva la ruta completa; un fit inválido bloquea la auditoría.

## Límites operativos

- `context-check` y `audit` revisan estructura; el agente debe comprobar el significado de fuentes y requisitos.
- `acceptance.json` exige cobertura de IDs, estado, método y evidencia. La veracidad de esa evidencia requiere revisión; una cadena de texto no demuestra una interacción o conformidad de accesibilidad.
- `verify` ejecuta los gates configurados y registra su resultado; `complete` rechaza pendientes y cambios posteriores al snapshot. El campo `mode` describe el modo de verificación de gates, no una ejecución por criterio. La salida de ambos comandos distingue evidencia declarada y ejecución; el cierre conserva ese alcance en `verification.acceptance` del manifest. Un criterio `automated` exige `checkCommands`, una lista de comandos exactos ya configurados como gates. El registro vincula cada comando con PASSED, FAILED o NOT_RUN; el cierre exige todos los checks aplicables aprobados. La relevancia y suficiencia de sus assertions siguen requiriendo revisión. El texto de evidencia no introduce comandos ejecutables.
- El snapshot comparte un límite de 20.000 archivos y 256 MiB entre fuentes, contexto y archivos de la spec. Excluye dependencias/cachés/salidas del árbol de código y otras specs, pero recorre toda la spec activa, también sus subcarpetas de evidencia; solo omite su `verification.json` raíz. Rechaza symlinks dentro del material cubierto. Los registros locales son editables; la huella detecta cambios, no demuestra veracidad ni ausencia de regresiones.
- Las escrituras de varios archivos no son una transacción global. Ante un fallo de I/O, revisar `doctor`, backups y la vista previa antes de reintentar.
- No se garantiza cero alucinaciones, cumplimiento regulatorio ni funcionamiento idéntico de todos los modelos y entornos.

Los registros de verificación usan ahora `version: 2`: los anteriores requieren ejecutar `verify` nuevamente antes de completar. Las filas manuales y de decisión conservan su formato; las automatizadas deben añadir `checkCommands`. No se convierten automáticamente pruebas declaradas en resultados ejecutados.

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
