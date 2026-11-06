# Omni Studio: cockpit agéntico

Estado: prototipo (fases 0–2 y 2.5, más la vuelta 1 de «Pendientes»). Reemplaza el escenario de dashboards de la
fase 4, que queda en el tag `studio-dashboard-v0`.

## Cómo retomar (léelo primero)

Esta sección basta para seguir iterando desde otra sesión, otra máquina u otro agente.

**Dónde estamos.** Rama `feat/studio-agent-cockpit` (base `main`). `git log --oneline -5` muestra el último
commit de vuelta. La próxima vuelta es la indicada en «Pendientes → Siguiente vuelta». `specs/.omni/memory.db`
aparece sin seguimiento: es la memoria local de Omni, no se commitea.

**Requisitos.** Node ≥ 22.19 (hoy 24.x), Rust y el toolchain de Tauri v2, WebView2, y Claude Code en el PATH con
sesión iniciada (`claude` y luego `/login` en una terminal). El driver busca `claude.exe` o el shim `claude.cmd`
de npm; `OMNI_STUDIO_CLAUDE_BIN` fuerza otra ruta.

**Lanzar la app.**

```
cd apps/studio
npm run tauri dev
```

En modo debug el host ejecuta el motor desde este checkout (`bin/omni-spec.mjs`). Qué se recarga solo:

| Cambias | Se ve | Cómo |
|---|---|---|
| `apps/studio/src/**` (UI React) | Al guardar | Vite recarga la ventana |
| `src/studio/**` (motor Node: drivers, IPC) | **Solo al reiniciar** | Cerrar la app y volver a lanzar `npm run tauri dev` |
| `apps/studio/src-tauri/**` (host Rust) | Al guardar | `tauri dev` recompila y reabre |

Si un cambio del motor «no aparece», casi siempre falta ese reinicio completo (así se diagnosticó P0.2).

**Comprobar antes de cada commit** (todo debe pasar):

```
node --test test/studio-agents.test.mjs
cd apps/studio && npm run typecheck && npm test
npm run lint
```

`npm test` en la raíz corre toda la suite del motor (más lenta). `npm run lint` es `biome ci .`;
`npm run lint:fix` corrige el formato.

**Método de cada vuelta.**
1. El usuario manda una captura de la app real y elige el tema.
2. Se cambia código y tests juntos. Los ids siguen la serie: el próximo test del driver es **AG-16** y el próximo
   de la UI es **CH-11**.
3. Pasan las tres comprobaciones de arriba.
4. El usuario lo prueba en la app (reinicio completo si se tocó el motor) y manda captura.
5. Se actualiza este documento (Pendientes, «Siguiente vuelta», hechos verificados) y se hace **un commit por
   vuelta** con el formato `feat(studio): … (phase 2.6 round N)`. Al fusionar a `main`, el PR se hace con
   *squash*, así que `main` recibe un solo commit.

**Mapa de archivos.**

| Qué | Dónde |
|---|---|
| Driver de Claude Code (spawn, stream-json, permisos, costo) | `src/studio/agents/claude.mjs` |
| Hub de agentes y métodos `agent.*` | `src/studio/agents/index.mjs`, `src/studio/engine.mjs`, `src/studio/protocol.mjs` |
| Tests del driver (AG-xx) y CLI simulada | `test/studio-agents.test.mjs`, `test-support/fake-claude.mjs` |
| Estado del chat (eventos → transcript, uso, opciones) | `apps/studio/src/stores/chat.ts` |
| Chat, compositor y `ChatHeader` (estado del agente) | `apps/studio/src/views/ChatView.tsx` |
| Fila de pestañas donde vive `ChatHeader` | `apps/studio/src/shell/Stage.tsx` |
| Todos los textos de la UI | `apps/studio/src/i18n/messages.es.ts` (sección `chat`) |
| Tests de la UI del chat (CH-xx) | `apps/studio/src/views/ChatView.test.tsx` |

**Hechos verificados de la CLI** (Claude Code 2.1.318, 2026-11-06; no hace falta volver a averiguarlos):
- `total_cost_usd` del mensaje `result` es el **total acumulado de la sesión**, no el del turno, y `--resume` lo
  arrastra. `modelUsage` también es acumulado. El costo del turno se obtiene restando el total anterior.
- Una sesión nueva arranca con unos 35–45 k tokens de contexto antes de que el usuario diga nada (prompt de
  sistema, herramientas, CLAUDE.md y skills).
- Cambiar de modelo invalida la caché: el primer turno con el modelo nuevo vuelve a escribir todo el contexto.
  Con Opus eso fueron ≈ US$ 0,28 a precio de lista.
- Para volver a comprobarlo: lanzar `claude -p --input-format stream-json --output-format stream-json --verbose
  --model haiku`, enviar dos mensajes por stdin, cerrar, repetir con `--resume <session_id>` y comparar
  `total_cost_usd` con `usage` de cada `result`.

## Qué es

Omni Studio es el entorno visual donde el usuario programa con los agentes que ya usa (Claude Code,
luego Codex, Copilot CLI y Gemini CLI). **Omni Studio no es un agente**: lanza la CLI oficial de cada
proveedor y le habla por su protocolo estructurado. Omni (memoria, specs, gates, guardian) trabaja por
detrás.

## Reglas que no se negocian

1. **El login es siempre el de la CLI oficial.** Studio nunca lee, guarda ni reenvía tokens, y nunca se
   hace pasar por otra herramienta. Si la CLI no tiene sesión, Studio indica cómo iniciarla en la terminal.
2. **Cero archivos en el proyecto en modo Studio.** Si el repositorio no tiene `specs/manifest.json`, el
   estado de Omni vive en `%LOCALAPPDATA%\OmniStudio\workspaces\<id>\` (`OMNI_STUDIO_HOME` lo cambia).
   El agente sí edita el código cuando el usuario lo aprueba; Omni no deja rastro.
3. **Nada se escribe ni se ejecuta sin aprobación** salvo lo que la propia CLI permite sin preguntar
   (lecturas). Cada pedido de permiso llega a la UI como una tarjeta Aprobar / Rechazar.

## Modos del motor

| Modo | Cuándo | Estado de Omni |
|---|---|---|
| `project` | Existe `specs/manifest.json` (OmniSpec instalado en el repo, como hoy) | `<repo>/specs/` |
| `studio` | No existe | `%LOCALAPPDATA%\OmniStudio\workspaces\<sha256(ruta)[0:16]>\` |

En modo `studio` las vistas que dependen de specs (Kanban, gates, revisión por spec, alternar skills)
responden `OMNISPEC_NOT_INSTALLED` en vez de escribir en el repositorio.

## Driver de Claude Code

```
claude -p --input-format stream-json --output-format stream-json --verbose
       --include-partial-messages --permission-mode default --permission-prompt-tool stdio
```

- Entrada (una línea JSON por mensaje): `{"type":"user","message":{"role":"user","content":[…]}}`.
- Permisos: la CLI envía `control_request` con `subtype: "can_use_tool"`; Studio responde
  `control_response` con `behavior: "allow"` (con `updatedInput`) o `"deny"` (con `message`).
- Cancelar: `control_request` con `subtype: "interrupt"`.
- El proceso vive mientras dura la conversación; `agent.reset` empieza otra.

## IPC nuevo

| Método | Dirección | Qué hace |
|---|---|---|
| `agent.status` | host→engine | Agentes disponibles, estado y modo del workspace |
| `agent.prompt` | host→engine | Envía un mensaje; responde enseguida, el resto llega por eventos |
| `agent.cancel` | host→engine | Interrumpe el turno en curso |
| `agent.permission` | host→engine | Respuesta a un pedido de permiso |
| `agent.reset` | host→engine | Cierra la conversación y empieza una nueva |
| `agent.event` | engine→host | Eventos normalizados: `status`, `init`, `text`, `tool`, `tool_result`, `permission`, `result`, `error` |

`result` lleva `costUsd` (lo que costó ese turno) y `sessionCostUsd` (el total de la conversación). Claude Code
informa `total_cost_usd` como acumulado de la sesión, y `--resume` lo arrastra, así que el driver calcula el
costo del turno restando el total anterior.

Los eventos son independientes del proveedor: los próximos drivers (Codex `app-server`, ACP) emiten los
mismos tipos y la UI no cambia.

## Criterios de aceptación del prototipo

1. Abrir un repositorio sin OmniSpec deja `git status` igual que antes.
2. El chat muestra el texto de Claude en vivo, cada herramienta que usa y su resultado.
3. Una edición o comando pide aprobación; Rechazar evita el cambio y Aprobar lo aplica.
4. Sin sesión de Claude Code, la UI explica cómo iniciarla y no se cae.

## Fase 2.5: pulido del chat

- Respuestas en Markdown (GFM) con código resaltado por highlight.js y botón de copiar; sin HTML crudo.
- Modelo y esfuerzo en el compositor. Solo valores que la CLI acepta: alias `fable`, `opus`, `sonnet`,
  `haiku` (`--model`) y `low`…`max` (`--effort`). Cambiarlos reinicia la CLI con `--resume` sobre la misma
  sesión, así la conversación continúa. La elección se recuerda por usuario.
- Medidor de contexto: tokens del último mensaje (entrada, caché y salida) contra `modelUsage[modelo].contextWindow`.
  El costo es una estimación a precio de lista cuando `costBasis` es `list` (con suscripción no se cobra por token).
- Ediciones como diff de líneas; Kanban, Cartografía, FinOps y Skills pasan a «Más vistas».
- Un agente solo aparece en el selector cuando su driver existe (hoy, Claude Code).

## Pendientes (revisión del 2026-11-06 con capturas reales)

Método: ver «Cómo retomar → Método de cada vuelta».

**Registro de vueltas**

| Vuelta | Temas | Probado en la app | Commit |
|---|---|---|---|
| 1 · Cabecera | P0.1, P0.2, P1.3 y costo de P1.6 | Fila única y costo (captura del 2026-11-06). El aviso de cambio de modelo solo está cubierto por tests (CH-09) | `feat(studio): one status row, pending model notice and per-turn cost (phase 2.6 round 1)` |

**Siguiente vuelta: 2 · Conversaciones (P1.4 + P2.7).** Van juntas porque un historial que no se puede retomar no
sirve. Punto de partida: el driver ya reanuda con `--resume <sessionId>` cuando cambia modelo o esfuerzo
(`session.sessionId` en `claude.mjs`). Falta (a) listar las sesiones anteriores de la carpeta y (b) un
`agent.resume` que arranque la CLI sobre la elegida y repinte su historial. Antes de diseñar, verificar dónde y en
qué formato guarda la CLI las sesiones (se supone que en `~/.claude/projects/<carpeta>/*.jsonl`, sin confirmar) y
respetar la regla 1: leer el historial, nunca credenciales. Primero comprobar en la app el aviso de cambio de
modelo de la vuelta 1.

Orden previsto después: 3 · Inspector y cambios del turno (P1.5 + P2.10), 4 · Compositor (P2.8 + P2.9).

**P0 · Confusiones y posibles errores**
1. ~~La cabecera muestra el modelo en ejecución y el selector el elegido, sin explicar cuándo cambia.~~ Hecho: el
   compositor dice «Opus 5.5 ahora → Haiku desde tu próximo mensaje» (y lo mismo con el esfuerzo) hasta que
   envías; la cabecera muestra el modelo en uso con su nombre corto.
2. ~~El medidor de contexto no apareció tras un turno.~~ Resuelto: con la app reiniciada del todo sí aparece; no
   era un error. Al comprobarlo salió otro: la cabecera sumaba totales acumulados (US$ 0,0110 cuando el real era
   0,0076). Hecho: cada turno muestra su costo y la cabecera el total de la conversación.

**P1 · Menos marco, más foco**
3. ~~Fusionar la barra de pestañas (Chat · Diffs · Más vistas) y la cabecera del chat en una sola fila.~~ Hecho:
   el estado del agente va a la derecha de las pestañas y se acorta cuando la fila se estrecha.
4. Panel izquierdo: conversaciones (historial) con «Nueva conversación» como acción principal; la lista de specs
   y «Nueva Spec» pasan a secundarias.
5. Inspector derecho cerrado por defecto; se abre solo cuando el agente ejecuta comandos, o muestra los archivos
   cambiados del turno.
6. Hacer visible el gasto: el primer turno con Opus costó ≈ US$ 0,28 a precio de lista por cargar el contexto.
   Avance: el costo se ve siempre en la cabecera, y el aviso de cambio de modelo explica (en su tooltip) que el
   nuevo modelo vuelve a leer todo el contexto. Falta decidir si conviene avisar antes de un turno caro.

**P2 · Capacidades de cockpit**
7. Retomar conversaciones anteriores (sesiones de Claude Code con `--resume`).
8. Mencionar archivos con `@` y pegar imágenes.
9. Comandos con `/`, incluidos los `/omni-*`.
10. Panel «Cambios del turno»: archivos tocados con su diff y aprobar todo de una vez.

## Fuera de este prototipo

Inyección de Omni en la sesión (MCP y reglas, fase 3), drivers de Codex y ACP (fases 4 y 6), layout
completo (fase 5).
