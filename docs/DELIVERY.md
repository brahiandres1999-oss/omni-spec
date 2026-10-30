# Entrega con estado y evidencia

[OmniSpec 0.8.0](releases/0.8.0.md) oficial estable conserva formatos compatibles y consolida contratos de entrega explícitos. Su publicación en el canal npm `latest` establece el estándar de producción. No confundir el paquete instalado con versiones anteriores o plugins globales desactualizados.

## Empezar y reanudar

Ejecuta el CLI del paquete elegido con `version`, inicializa y utiliza la skill omni-init según la invocación del host. El inicio inspecciona sin ejecutar scripts de aplicación; registra contexto, preguntas/decisiones y capacidades reales. `guide setup`, `guide design` y `guide evidence` entregan procedimientos y formas exactas de registro incluidos en el paquete, sin instalar skills adicionales.

`status --json` conserva el manifest y añade `progress`: estado de entrega, frescura del contexto, bloqueos, próxima acción y `readSet`. `readSet.files` lista los archivos de la spec activa que exige su ruta de fit, más `acceptance.json` y `verification.md`; `readSet.avoid`, lo que el agente no necesita abrir: las demás specs, el `verification.json` de la activa, `specs/.omni/`, `specs/_templates/`, `specs/project-state.json` y `specs/contracts.json`. La salida omite `verification.acceptance` de las specs distintas de la activa y las decisiones cuyo `appliesTo` solo nombra specs cerradas que no son la activa; `progress.omitted` dice cuántas omitió, y `status --json --all` las devuelve completas. Los archivos no cambian, y los bloqueos, la próxima acción y el estado de entrega se calculan con todas las decisiones. Es una recomendación basada en evidencia disponible, no permiso para ejecutar comandos ni publicar. `READY_TO_COMPLETE` utiliza la misma revisión que `complete`, incluida integridad de logs y aceptación.

Después de reconciliar fuentes y revisar las afirmaciones del contexto, usa `context-record`. Se guarda la huella de las entradas de contexto y se conserva el baseline anterior. Las entradas son `specs/project-context.md`, los archivos locales que enlaza, manifiestos de build/dependencias/runtime (por ejemplo `package.json`, `pom.xml`, `build.gradle*`, `pyproject.toml`, `Dockerfile`, `tsconfig*.json`), CI (`.github/workflows/*`) e instrucciones de agentes (`AGENTS.md` sin su sección administrada, `CONSTITUTION.md`, `CLAUDE.md`, `README.md`). Cuando cambia una de ellas, el contexto queda `STALE` y bloquea verify/complete hasta revisarlo; editar código fuente no lo deja obsoleto. Las rutas ignoradas no cuentan. No cambies requisitos para hacer coincidir automáticamente un defecto de código. Las instalaciones anteriores sin baseline se muestran `NOT_RECORDED`; el onboarding debe crear uno antes del recorrido del piloto.

## Sesión y decisiones

Registra la sesión al empezar a trabajar con `session-record --from <archivo>`. El archivo puede estar en `specs/.omni/inputs/` (ignorado por Git y fuera de las huellas), en un directorio temporal o llegar por stdin con `--from -`. No lo dejes en la raíz: formaría parte del código verificado.

```json
{
  "host": "Nombre y versión observada del agente",
  "capabilities": {
    "questions": {"status":"available","source":"Herramienta nativa expuesta y permitida en la sesión"},
    "web": {"status":"unavailable","source":"No se expone investigación web en este entorno"},
    "render": {"status":"unknown","source":"Aún no se ha inspeccionado"}
  }
}
```

No copies ese ejemplo como observación real. Estado disponible/ausente/desconocido depende de la sesión; registrar un dato no concede una herramienta. El fallback de preguntas es chat/consola. Una observación del agente requiere una sesión registrada con render disponible cuya ventana la contenga: desde su inicio hasta el inicio de la sesión siguiente. Las sesiones anteriores se conservan, así que una evidencia válida no caduca por registrar una sesión nueva. La comparación usa precisión de segundos. Registrar una sesión no cambia la huella de verificación.

`decision-record --from <archivo>` conserva id, topic, status, value, basis y required. Los estados aprobados/delegados requieren la respuesta o delegación real en basis. Una selección de tecnología exige fuentes oficiales con url, consultedAt, appliesTo y authority official. La estructura no verifica la autoridad de una página ni compatibilidad ejecutada. Una modificación de respuesta usa expectedRevision actual y conserva la anterior. Las decisiones requeridas pendientes, provisionales o vencidas bloquean cierre; no se asume aprobación por silencio.

## Checks por módulo

Prepara el catálogo y guárdalo con `checks --from <archivo>`. Ese comando valida y configura; no ejecuta. Los comandos requieren revisión/autorización aplicables a su efecto.

```json
{
  "schemaVersion":1,
  "checks":[
    {"id":"api-tests","command":"npm test","cwd":"api","timeoutMs":120000,"kind":"automated"},
    {"id":"ui-journey","command":"npm run test:e2e","cwd":"web","timeoutMs":180000,"kind":"ui"}
  ]
}
```

Los comandos y carpetas deben existir en el proyecto real. No instalar un runner para cumplir el ejemplo.

### Salidas generadas y huella

`verify` liga el resultado a una huella del proyecto y falla si algo cambia mientras corren los checks. Las salidas generadas quedan fuera por:

1. Exclusiones por defecto en cualquier profundidad: `node_modules/`, `dist/`, `build/`, `target/`, `coverage/`, `.gradle/`, `.idea/`, `.vscode/`, `test-results/`, `playwright-report/`, `.next/`, `.angular/`, `.turbo/`, `.cache/`, `*.tsbuildinfo`, `.eslintcache`, entre otras.
2. `.gitignore` de la raíz y de subcarpetas, y `.git/info/exclude` del propio proyecto.
3. `.omnispecignore` en la raíz, con sintaxis de `.gitignore`, evaluado al final. Sirve para excluir una salida concreta (`junit.xml`) o volver a incluir una carpeta por defecto que contiene código (`!build/`).

Si un check escribe una ruta no ignorada, el registro la lista en `changedDuringVerification` y `status` muestra `VERIFICATION_SOURCE_CHANGED`. Exclúyela y vuelve a verificar; no repitas a ciegas. Los archivos ignorados no se atestan aunque Git los versione. Las reglas de carpetas superiores no se aplican, para que un repositorio padre no pueda desactivar la atestación. El registro indica cuántos archivos del proyecto se atestaron (`attestedFiles`). Los qualityGates anteriores siguen funcionando con IDs gate-N desde raíz; los comandos ambiguos entre módulos deben referenciarse por ID. `verify` registra cwd, tiempos, exit code, error de entorno/aplicación, timeout y log combinado. La salida guardada se limita a 8 MiB: excederla falla explícitamente. La cola visible indica truncado; complete comprueba hash y tamaño del log completo conservado.

## Aceptación funcional y visual

Para nuevo trabajo utiliza acceptance.json schemaVersion 2, con criterios id, kind, status, method y evidence. Kinds: functional, visual, interaction, accessibility, decision. Mantén etiquetas como `AC-01 [visual]` en el contrato primario; no se pueden eliminar desde un reporte legacy para pasar una revisión más débil.

Automatizado: referencia checkIds o checkCommands exactos. Un criterio UI necesita check de kind ui que realmente lo ejercite; etiquetar un build como ui no crea assertions ni demuestra relevancia. El agente/revisor debe comprobar esa relación semántica.

Manual UI: registra observations con actor agent/human, observer, surface, environment, steps, expected, actual, result passed, observedAt y artifact local dentro de la spec. Para visual añade viewport width/height medido. Si actor es agent, registra antes la sesión con render disponible y usa su sessionId o una hora posterior a ese registro. No inventes timestamps de interacción a partir de una fecha posterior de redacción. Screenshots y trazas complementan pasos/resultados; no certifican verdad ni accesibilidad completa. Sin comprobación real, conserva pending/failed/blocked y no completes.

## Rigor, contratos y cierre

Fit v1 se conserva; para nuevas clasificaciones el CLI propone v2 con riesgo, incertidumbre y reversibilidad además de alcance. Un cambio crítico de un archivo puede exigir full; un bugfix claro, local, cubierto y reversible puede ser light. En light, bug.md contiene reproducción, causa y regresión; los rca/fix opcionales permanecen sin bloquear. No son umbrales científicamente universales.

Después de verify aprobado, `complete <id>` revisa frescura, tareas, criterios, identidad y resultados de checks/logs. Una RFC registra decisión en su formato, sin ejecución de código obligatoria. Una entrega parcial mantiene criterios pendientes y estado de verificación pendiente; no se convierte en COMPLETED por terminar un subconjunto.

`contracts` muestra contratos de capacidad e historial. `contract-record <id> --from <archivo>` exige expectedRevision, una decisión explícita y sourceSpec. Se pueden registrar propuestas; activar/retirar requiere una spec completada y evidencia. Una propuesta posterior conserva el contrato vigente hasta aprobar su reemplazo. No se deriva el contrato copiando el código. `contracts --active` lista solo los contratos activos con su instantánea vigente, sin historial; una propuesta pendiente se reconoce por `revision > effectiveRevision`, y `contracts <id>` la muestra completa.

Actualizar/reinicializar preserva estos registros y decisiones propias. Los registros de verificación anteriores a la versión 3 exigen una nueva ejecución de `verify`. La versión 3 guarda el `checkCwd` relativo, de modo que mover la carpeta del proyecto no invalida la verificación. Una rama o un commit conservan trabajo, no prueban estabilidad. El piloto debe usar datos y servicios de prueba y revisar el resultado con el usuario antes de publicar.

## Concurrencia

Los checks corren bajo `specs/.omni/verify.lock`, separado del bloqueo del manifiesto. Durante una verificación, `status`, `session-record` y `decision-record` responden sin esperar. Si una decisión o el contexto cambian mientras corren los checks, la verificación falla y lo indica. `complete` rechaza ejecutarse mientras haya una verificación en curso. Ver [coordinación local](locking.md).

## Git y estado local

`init` y `update` mantienen una sección administrada en `specs/.gitignore` para el estado local y el runtime portable: `specs/.omni/verification-logs/`, `backups/`, `inputs/`, `runtime/`, bloqueos y temporales. `update` restaura el runtime con la versión del manifiesto. Las especificaciones, `acceptance.json`, `verification.json`, el contexto, las decisiones y los contratos siguen versionados. Las reglas propias del archivo se conservan.

`clean` (modo plugin de Antigravity) elimina solo copias administradas sin modificar del runtime, las skills `omni-*` y `.agents/agents/omni-auditor.md`. Actualiza la entrada de onboarding para apuntar al plugin. Conserva agentes/skills propios y archivos no registrados; las personalizaciones bloquean el reemplazo salvo aceptación explícita con respaldo.
