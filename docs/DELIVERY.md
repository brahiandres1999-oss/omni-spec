# Entrega con estado y evidencia

El candidato 0.7.0-rc.1 conserva formatos anteriores y añade contratos explícitos. La versión es local hasta decidir su publicación después del piloto. No confundir el paquete instalado con una versión anterior disponible en npm o un plugin global.

## Empezar y reanudar

Ejecuta el CLI del paquete elegido con `version`, inicializa y utiliza la skill omni-init según la invocación del host. El inicio inspecciona sin ejecutar scripts de aplicación; registra contexto, preguntas/decisiones y capacidades reales. `guide setup` y `guide design` entregan procedimientos incluidos en el paquete, sin instalar skills adicionales.

`status --json` conserva el manifest y añade `progress`: estado de entrega, frescura del contexto, bloqueos y próxima acción. Es una recomendación basada en evidencia disponible, no permiso para ejecutar comandos ni publicar. `READY_TO_COMPLETE` utiliza la misma revisión que `complete`, incluida integridad de logs y aceptación.

Después de reconciliar fuentes y revisar las afirmaciones del contexto, usa `context-record`. Se guarda la huella de entradas y se conserva el baseline anterior. Cuando cambian archivos, el contexto queda `STALE` y bloquea verify/complete hasta revisarlo. No cambies requisitos para hacer coincidir automáticamente un defecto de código. Las instalaciones anteriores sin baseline se muestran `NOT_RECORDED`; el onboarding debe crear uno antes del recorrido del piloto.

## Sesión y decisiones

Guarda la entrada JSON dentro del proyecto y utiliza `session-record --from specs/.omni/session-input.json`:

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

No copies ese ejemplo como observación real. Estado disponible/ausente/desconocido depende de la sesión; registrar un dato no concede una herramienta. El fallback de preguntas es chat/consola. Una observación del agente requiere la capacidad render disponible y una fecha posterior a su observación de sesión.

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

Los comandos y carpetas deben existir en el proyecto real. No instalar un runner para cumplir el ejemplo. Los qualityGates anteriores siguen funcionando con IDs gate-N desde raíz; los comandos ambiguos entre módulos deben referenciarse por ID. `verify` registra cwd, tiempos, exit code, error de entorno/aplicación, timeout y log combinado. La salida guardada se limita a 8 MiB: excederla falla explícitamente. La cola visible indica truncado; complete comprueba hash y tamaño del log completo conservado.

## Aceptación funcional y visual

Para nuevo trabajo utiliza acceptance.json schemaVersion 2, con criterios id, kind, status, method y evidence. Kinds: functional, visual, interaction, accessibility, decision. Mantén etiquetas como `AC-01 [visual]` en el contrato primario; no se pueden eliminar desde un reporte legacy para pasar una revisión más débil.

Automatizado: referencia checkIds o checkCommands exactos. Un criterio UI necesita check de kind ui que realmente lo ejercite; etiquetar un build como ui no crea assertions ni demuestra relevancia. El agente/revisor debe comprobar esa relación semántica.

Manual UI: registra observations con actor agent/human, observer, surface, environment, steps, expected, actual, result passed, observedAt y artifact local dentro de la spec. Para visual añade viewport width/height medido. Si actor es agent, usa la sesión render observada y su sessionId. No inventes timestamps de interacción a partir de una fecha posterior de redacción. Screenshots y trazas complementan pasos/resultados; no certifican verdad ni accesibilidad completa. Sin comprobación real, conserva pending/failed/blocked y no completes.

## Rigor, contratos y cierre

Fit v1 se conserva; para nuevas clasificaciones el CLI propone v2 con riesgo, incertidumbre y reversibilidad además de alcance. Un cambio crítico de un archivo puede exigir full; un bugfix claro, local, cubierto y reversible puede ser light. En light, bug.md contiene reproducción, causa y regresión; los rca/fix opcionales permanecen sin bloquear. No son umbrales científicamente universales.

Después de verify aprobado, `complete <id>` revisa frescura, tareas, criterios, identidad y resultados de checks/logs. Una RFC registra decisión en su formato, sin ejecución de código obligatoria. Una entrega parcial mantiene criterios pendientes y estado de verificación pendiente; no se convierte en COMPLETED por terminar un subconjunto.

`contracts` muestra contratos de capacidad e historial. `contract-record <id> --from <archivo>` exige expectedRevision, una decisión explícita y sourceSpec. Se pueden registrar propuestas; activar/retirar requiere una spec completada y evidencia. Una propuesta posterior conserva el contrato vigente hasta aprobar su reemplazo. No se deriva el contrato copiando el código.

Actualizar/reinicializar preserva estos registros y decisiones propias. Los registros de verificación anteriores sin la identidad completa del catálogo exigen una nueva ejecución. Una rama o un commit conservan trabajo, no prueban estabilidad. El piloto debe usar datos y servicios de prueba y revisar el resultado con el usuario antes de publicar.
