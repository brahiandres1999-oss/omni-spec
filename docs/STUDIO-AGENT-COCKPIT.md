# Omni Studio: cockpit agéntico

Estado: prototipo (fases 0–2, 2.5 y 2.6). **La Fase 3 · Cockpit multiagente está en curso** (vueltas 1, 2a y 2b
hechas; vuelta 3 en curso; ver su sección). Reemplaza el escenario de dashboards de la fase 4, que queda en el tag `studio-dashboard-v0`.

## Cómo retomar (léelo primero)

Esta sección basta para seguir iterando desde otra sesión, otra máquina u otro agente.

**Dónde estamos.** Rama `feat/studio-agent-cockpit` (base `main`). `git log --oneline -5` muestra el último
commit de vuelta. La próxima vuelta es la primera sin «Hecha» en la tabla «Fase 3 → Vueltas». Hay trabajo sin
commit a propósito: la vuelta 2 de la Fase 2.6 (conversaciones anteriores de Claude), que entra en el commit de la
vuelta 1 de la Fase 3. `specs/.omni/memory.db` aparece sin seguimiento: es la memoria local de Omni, no se
commitea.

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

Lanza Studio **siempre desde tu propia terminal**. Lanzado desde dentro de la app de Claude (que corre en un
contenedor MSIX), Windows le redirige `%APPDATA%` y `%LOCALAPPDATA%`: ve otra lista de proyectos recientes y otra
memoria de modo Studio.

**Comprobar antes de cada commit** (todo debe pasar):

```
node --test test/studio-agents.test.mjs test/studio-conversations.test.mjs
cd apps/studio && npm run typecheck && npm test
npm run lint
```

Si se tocó el host Rust (p. ej. la lista blanca de métodos), además `cargo test --test security` en
`apps/studio/src-tauri`. Con la app abierta el exe bloquea `target/` («Acceso denegado»): usar otra carpeta con
`CARGO_TARGET_DIR`.

`npm test` en la raíz corre toda la suite del motor (más lenta). Incluye G-SLOP-12, que revisa el propio código: un `catch` que
devuelve o calla sin más falla salvo que lleve `// guardian-allow <REGLA>: motivo`. `npm run lint` es `biome ci .`;
`npm run lint:fix` corrige el formato.

**Método de cada vuelta.**
1. El usuario manda una captura de la app real y elige el tema.
2. Se cambia código y tests juntos. Los ids siguen la serie: el próximo test del motor es **AG-24** y el próximo
   de la UI es **CH-19** (SH-xx para el resto del shell, el próximo **SH-15**; SH-11 pasó a ser la página Memoria).
3. Pasan las tres comprobaciones de arriba.
4. El usuario lo prueba en la app (reinicio completo si se tocó el motor) y manda captura.
5. Se actualiza este documento (tabla de vueltas de la Fase 3, hechos verificados) y se hace **un commit por
   vuelta** con el formato `feat(studio): … (phase 3 round N)`. Al fusionar a `main`, el PR se hace con
   *squash*, así que `main` recibe un solo commit.

**Mapa de archivos.**

| Qué | Dónde |
|---|---|
| Driver de Claude Code (spawn, stream-json, permisos, costo) | `src/studio/agents/claude.mjs` |
| Sesiones de Claude Code de la carpeta (listar, leer historial) | `src/studio/agents/claude-sessions.mjs` |
| Índice de conversaciones de Studio (tabla `studio_conversations` en la memoria) | `src/studio/conversations.mjs`; tests AG-18 a AG-20 en `test/studio-conversations.test.mjs` |
| Hub de agentes y métodos `agent.*` | `src/studio/agents/index.mjs`, `src/studio/engine.mjs`, `src/studio/protocol.mjs` |
| Tests del driver (AG-xx) y CLI simulada | `test/studio-agents.test.mjs`, `test-support/fake-claude.mjs` |
| Estado del chat (eventos → transcript, uso, opciones) | `apps/studio/src/stores/chat.ts` |
| Chat y `ChatHeader` (estado del agente) | `apps/studio/src/views/ChatView.tsx` |
| Compositor: modelo y razonamiento, permisos, cola, «+», `@` y `/` | `apps/studio/src/views/Composer.tsx` (tests CH-15 a CH-18) |
| Ajustes (modal) y su estado | `apps/studio/src/shell/SettingsDialog.tsx`, `apps/studio/src/stores/settings.ts` (test SH-14) |
| Centro: una página a la vez, ruta «Proyecto / Título» y `ChatHeader` | `apps/studio/src/shell/Stage.tsx` (páginas en `stores/layout.ts`, layout `v3`) |
| Página Memoria y su resumen en el motor | `apps/studio/src/views/MemoryView.tsx`, `src/studio/memory-summary.mjs` (método `memory.summary`, test AG-21) |
| Panel derecho «Resumen» (Revisión, Archivos, Terminal) | `apps/studio/src/shell/Inspector.tsx` (tests SH-03, SH-12) |
| Revisión de esta conversación (Cambios e Impacto) | `apps/studio/src/views/ConversationReview.tsx`, `apps/studio/src/stores/conversation-review.ts` (test SH-13) |
| Panel izquierdo: «Nueva conversación», buscador, árbol Proyectos → Conversaciones | `apps/studio/src/shell/Rail.tsx`, store `apps/studio/src/stores/conversations.ts`, tests SH-04 y CH-11 a CH-14 |
| «Retomar sesión de la terminal…» | `apps/studio/src/shell/TerminalSessionsDialog.tsx` |
| Proyectos recientes, quitar uno y selector de carpetas (host) | `apps/studio/src-tauri/src/recent.rs`, `commands.rs` (`recent_remove`, `project_pick`); tests RP-01 a RP-04 |
| Todos los textos de la UI | `apps/studio/src/i18n/messages.es.ts` (sección `chat`) |
| Tests de la UI del chat (CH-xx) | `apps/studio/src/views/ChatView.test.tsx` |

**Hechos verificados de la CLI** (Claude Code 2.1.318, 2026-11-06; no hace falta volver a averiguarlos):
- `total_cost_usd` del mensaje `result` es el **total acumulado de la sesión**, no el del turno. `--resume` lo
  arrastra solo si el proceso anterior terminó limpio (deja un `cost-state` en la sesión); si se cortó, la CLI
  cuenta desde cero. `modelUsage` también es acumulado. El costo del turno se obtiene restando el total anterior.
- Una sesión nueva arranca con unos 35–45 k tokens de contexto antes de que el usuario diga nada (prompt de
  sistema, herramientas, CLAUDE.md y skills).
- Cambiar de modelo invalida la caché: el primer turno con el modelo nuevo vuelve a escribir todo el contexto.
  Con Opus eso fueron ≈ US$ 0,28 a precio de lista.
- `--permission-mode` acepta `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk` y `plan` (`default` ya no
  sale en la ayuda). Ninguno pide permiso para leer: `manual` y `default` dejaron pasar un Read con
  `--permission-prompts none`. `bypassPermissions` y `auto` arrancan en `-p` sin más flags.
- El mensaje `system/init` trae `slash_commands`: comandos y skills sin la barra (101 en esta máquina).
- Para volver a comprobarlo: lanzar `claude -p --input-format stream-json --output-format stream-json --verbose
  --model haiku`, enviar dos mensajes por stdin, cerrar, repetir con `--resume <session_id>` y comparar
  `total_cost_usd` con `usage` de cada `result`.

## Qué es

Omni Studio es el entorno visual donde el usuario programa con los agentes que ya usa: Claude Code, Codex,
Antigravity y cualquier agente que hable ACP, cada uno con su propia suscripción. **Omni Studio no es un
agente**: lanza la CLI oficial de cada proveedor y le habla por su protocolo estructurado. Omni (memoria, specs,
gates, guardian) trabaja por detrás y es lo que comparten todos los agentes de un proyecto. Es una app local y
gratuita bajo MIT, sin servicio en la nube ni cuentas propias.

## Reglas que no se negocian

1. **El login es siempre el de la CLI oficial.** Studio nunca lee, guarda ni reenvía tokens, nunca llama a
   endpoints privados de un proveedor y nunca se hace pasar por otra herramienta. Si la CLI no tiene sesión,
   Studio indica cómo iniciarla en la terminal. Cada proveedor entra solo por su CLI o protocolo oficial (ver
   «Fase 3 → Agentes y reglas de los proveedores»).
2. **Cero archivos en el proyecto en modo Studio.** Si el repositorio no tiene `specs/manifest.json`, el
   estado de Omni vive en `%LOCALAPPDATA%\OmniStudio\workspaces\<id>\` (`OMNI_STUDIO_HOME` lo cambia).
   El agente sí edita el código cuando el usuario lo aprueba; Omni no deja rastro. Tampoco se escribe en la
   configuración global de un agente (`~/.claude`, `~/.codex`, `~/.gemini`): Omni llega por parámetros de cada
   sesión.
3. **Por defecto, nada se escribe ni se ejecuta sin aprobación**, salvo lo que la propia CLI permite sin
   preguntar (lecturas). Cada pedido de permiso llega a la UI como una tarjeta Aprobar / Rechazar. Cada
   conversación puede subir de nivel a propósito (Fase 3, Q8).

## Fase 3 · Cockpit multiagente (decidida el 2026-11-06)

Reemplaza las fases 3–6 del plan original. Salió de un interrogatorio de 29 preguntas (Q1…Q29) con capturas de
Antigravity como referencia de **estructura e interacciones**, no de identidad visual (la identidad es
`docs/STUDIO-DESIGN-SYSTEM.md`). Cada decisión lleva el número de su pregunta.

### Decisiones

**Panel izquierdo** (Q2–Q5, Q11, Q18, Q20, Q29)
- Arriba, «Nueva conversación» (Ctrl+N) y tres páginas que se abren en el centro: **Specs** (tablero y gates; en
  modo Studio explica cómo instalar OmniSpec), **Memoria** (lo que comparten los agentes) y **Uso**. Un buscador de
  conversaciones por título abarca todos los proyectos.
- Debajo, el árbol **Proyectos → Conversaciones**. Los proyectos son una lista explícita (botón de carpeta para
  agregar; se pueden ocultar), sembrada con los recientes y ordenada por actividad. El proyecto abierto aparece
  desplegado; al pasar el ratón sobre otro aparece «+» para empezar una conversación ahí.
- Solo aparecen conversaciones iniciadas desde Studio. Cada proyecto tiene «Retomar sesión de la terminal…», con
  buscador, para traer una sesión externa del agente.
- Título: primera línea del primer mensaje, y luego el que dé el agente si lo da. Renombrar con doble clic o ⋮;
  «Archivar» la oculta. Studio nunca borra el historial de un agente.
- Las specs salen del panel. Abajo, Ajustes abre una ventana modal: General (permisos por defecto, cola),
  Agentes (instalados, con sesión o no, cómo iniciarla), Apariencia, Atajos, Notificaciones, Personalizaciones
  (skills) y Proyectos.
- Atajos: Ctrl+N nueva conversación, Ctrl+K buscar, Ctrl+B panel izquierdo, Ctrl+J panel derecho.

**Conversaciones** (Q6, Q7, Q12, Q13, Q17, Q19)
- Cada conversación pertenece a un agente; dentro se cambian modelo y razonamiento. Cambiar de empresa es una
  conversación nueva.
- Siguen trabajando en segundo plano al cambiar de conversación o de proyecto. Cada una muestra un punto de
  estado (trabajando, esperando aprobación, terminada sin leer) y Windows avisa cuando una pide aprobación o
  termina sin que la estés mirando.
- En modo proyecto se pueden ligar a una spec: chip «Spec 013» junto al título; desde una tarjeta del tablero,
  «Trabajar en esta spec».
- Varios agentes trabajan en el **mismo árbol de trabajo**; Omni avisa en ambas conversaciones (y en la tarjeta de
  aprobación) cuando una toca un archivo que otra conversación viva ya cambió.
- Con el agente trabajando, Enter pone el mensaje **en cola** (visible, editable, cancelable); Ctrl+Enter
  interrumpe el turno y lo envía.

**Centro y panel derecho** (Q10, Q11, Q14–Q16)
- Arriba, la ruta «Proyecto / Título». El compositor de una conversación nueva muestra proyecto y rama (solo
  lectura) y, abajo, **Modelo agrupado por agente** con submenú de razonamiento (elegir el modelo elige el agente),
  Permisos y «+» (archivos, carpetas, menciones, acciones). Tras el primer mensaje, proyecto y agente quedan fijos.
- Panel derecho **«Resumen»**: cerrado por defecto y nunca se abre solo. El botón de la cabecera muestra +N −M;
  un clic abre un resumen flotante y «Fijar» lo acopla. Contiene: **Revisión de esta conversación** (diff de los
  archivos que tocó, aprobar o revertir, e «Impacto», lo que era Cartografía), Archivos (con «Cambios de git» del
  repo entero), Terminal, Tareas en segundo plano y Archivos modificados.
- Desaparecen las pestañas «Chat · Diffs · Más vistas», el Dock y el Inspector. FinOps pasa a la página Uso y
  Skills a Ajustes › Personalizaciones.

**Agentes** (Q8, Q22–Q25)
- Tres drivers con el mismo vocabulario de `agent.event`: **Claude Code** por stream-json directo (como hoy, no el
  adaptador ACP), **Codex** por `codex app-server`, y **ACP genérico** para Antigravity (`agy acp`) y cualquier otro
  agente ACP (OpenCode, Cline, Copilot, Cursor).
- **Antigravity es experimental y viene apagado**: se enciende en Ajustes › Agentes después de un aviso que
  explica la postura de Google. Nunca viene encendido en una versión pública sin un OK escrito de Google. Solo
  por ACP y con el MCP por sesión; nunca tocando `~/.gemini/config` (lo que hace Deska).
- **Modelos y niveles de razonamiento los informa el agente**: Claude en su `initialize`, Codex en `model/list`,
  ACP en sus config options. Studio guarda la última lista conocida para pintar el selector antes de arrancar; sin
  niveles informados no hay submenú.
- **Permisos por conversación**: Preguntar siempre, Predeterminado (pregunta lo sensible), Automático (el agente
  decide, en su sandbox si lo tiene), Sin restricciones, y Planificar (solo lectura). Cada nivel se traduce al
  modo propio del agente; si un agente no lo tiene, no aparece. «Permitir siempre» usa la opción nativa del
  agente; Studio no tiene motor de reglas propio. Studio arranca en «Preguntar siempre»; tu predeterminado se
  cambia en Ajustes y «Sin restricciones» pinta el selector de rojo.
- Una cuenta por agente: la que tenga iniciada su CLI.

**Memoria compartida y uso** (Q26, Q27)
- El MCP de Omni se conecta a cada conversación al arrancarla (Claude `--mcp-config '<json>'`, Codex
  `-c mcp_servers.omni…`, ACP `mcpServers`), en los dos modos y sin escribir archivos, más una instrucción corta por
  sesión que dice cuándo consultar y cuándo registrar (Claude `--append-system-prompt`, Codex
  `developerInstructions`, ACP `systemPrompt`).
- Herramientas: buscar contexto, registrar decisiones, **registrar aprendizajes** (patrones, trampas,
  convenciones; nuevo), spec activa y gates, impacto, y **quién trabaja en qué** (conversaciones vivas del
  proyecto, su agente y los archivos que tocaron; nuevo, lo alimenta Studio).
- El índice de conversaciones vive en la memoria de cada proyecto, así un agente puede ver qué hizo otro.
- Página Uso: contexto y costo por conversación para todos; ventanas de límite (5 h, semanal) solo cuando el
  agente las da por su canal oficial (Codex sí; Claude por verificar; Antigravity no, ACP no trae cuotas).

**Fuera de esta fase:** aislar una conversación en un worktree, «Continuar con otro agente» (traspaso con
resumen), varias cuentas por agente y una versión comercial.

### Vueltas (Q28)

| Vuelta | Contenido | Estado |
|---|---|---|
| 1 · Panel izquierdo | Árbol Proyectos → Conversaciones, selector de carpetas, índice en la memoria, títulos, renombrar, archivar, buscador, «Retomar sesión de la terminal…» (Claude), specs fuera del panel. Su commit incluye el trabajo pendiente de la Fase 2.6 vuelta 2 | **Probada en la app el 2026-11-06**: todo funciona salvo Ctrl+N, que abría una ventana nueva de WebView2 (corregido; falta volver a probarlo) |
| 2a · Estructura | Fuera pestañas y Dock; ruta «Proyecto / Título» arriba; páginas Specs, Memoria y Uso en el panel izquierdo; panel derecho «Resumen» (Revisión, Archivos, Terminal) cerrado por defecto; Ctrl+B y Ctrl+J | **Hecha**: commit `bf154d8`, probada en la app |
| 2b · Compositor y revisión | Modelo agrupado por agente con razonamiento, permisos, cola y «+» en el compositor; Revisión de esta conversación con +N −M e Impacto; Ajustes modal con Skills en Personalizaciones | **Hecha** (pruebas que requieren turno de LLM quedan en el checklist acumulativo hasta integrar más agentes) |
| 3 · En paralelo | Varias conversaciones vivas por proyecto y varios proyectos (un motor por proyecto), puntos de estado, avisos de Windows, aviso de choque | |
| 4 · Codex | Driver `app-server`: modelos y razonamiento, permisos, historial para retomar, límites en Uso | |
| 5 · Memoria compartida | MCP de Omni en los dos modos, conectado por sesión en Claude y Codex; aprendizajes y «quién trabaja en qué» | |
| 6 · ACP y Antigravity | Driver ACP genérico; Antigravity experimental; modelos de Claude leídos de su `initialize` | |

Orden: primero lo visible; el paralelo antes que Codex para que Claude y Codex trabajen juntos el día que llegue
Codex; la memoria después, para probarla con dos proveedores.

**Vuelta 1 · por comprobar en la app** (reinicio completo: cambiaron el motor y el host Rust, que ahora trae
`tauri-plugin-dialog`):
1. El panel izquierdo empieza con «Nueva conversación» y el buscador; debajo, «Proyectos» con el abierto desplegado
   y sus conversaciones. Las de antes de esta vuelta no aparecen: el índice empieza vacío y se llena con cada
   conversación nueva o con «Retomar sesión de la terminal…».
2. Escribir un mensaje en una conversación nueva: aparece en el árbol con la primera línea como título.
3. Doble clic renombra; ⋮ archiva; ⋮ del proyecto › «Mostrar archivadas».
4. «Retomar sesión de la terminal…» lista las sesiones de Claude Code de la carpeta que aún no están en Studio.
5. El botón de carpeta agrega un proyecto; ⋮ › «Quitar de la lista» lo saca (su carpeta no se toca).
6. Clic en una conversación de otro proyecto: se abre ese proyecto y luego la conversación.
7. Ctrl+N abre una conversación nueva. WebView2 reserva ese atajo para «ventana nueva»: el host rechaza toda ventana
   nueva (`on_new_window` en `lib.rs`, test WN-05) y los enlaces web del chat se abren en el navegador.
8. Pendiente de la Fase 2.6: el aviso de cambio de modelo.

**Vuelta 2a · por comprobar en la app** (reinicio completo: cambiaron el motor y el host):
1. No hay pestañas ni Dock. Arriba del centro, «ClubGixxerMedellin › título de la conversación» (o «Nueva conversación»).
2. En el panel izquierdo, debajo del buscador: Specs, Memoria y Uso abren su página en el centro; un clic en una
   conversación vuelve al chat.
3. Memoria muestra cuántos aprendizajes, decisiones, conversaciones y módulos guarda el proyecto (hoy casi todo en
   cero salvo el grafo: los agentes empiezan a escribir en la vuelta 5).
4. El panel derecho «Resumen» arranca cerrado y no se abre solo; Ctrl+J o el botón del final de la fila lo abren,
   con Revisión, Archivos y Terminal. Un archivo cambiado en Archivos se abre en Revisión.
5. Ctrl+B oculta y muestra el panel izquierdo.
6. «Nueva Spec» (Ctrl+K) abre el chat con `/omni-specify ` escrito.
7. Cartografía, Diffs y Skills siguen en Ctrl+K hasta la vuelta 2b.

**Vuelta 2b · por comprobar en la app** (reinicio completo: cambió el motor):
1. El compositor tiene, de izquierda a derecha: «+», Modelo («Opus · alto») y Permisos. El menú de Modelo agrupa los
   modelos bajo «Claude Code» y abajo trae el submenú «Razonamiento».
2. Permisos ofrece Preguntar siempre (con lo que arranca toda conversación), Predeterminado, Automático, Sin
   restricciones (la pastilla se pone roja) y Planificar. Cambiarlo reinicia la CLI con `--resume` en el próximo
   mensaje; la conversación sigue. Comprobar que «Planificar» no edita y que «Predeterminado» aplica una edición sin
   tarjeta pero pide permiso para un comando.
3. Con el agente trabajando, Enter deja el mensaje «En cola» encima del cuadro (lápiz para editarlo, × para
   quitarlo) y sale solo al terminar el turno; Ctrl+Enter detiene el turno y lo envía primero.
4. `@` muestra archivos del proyecto y `/` (solo al principio del mensaje) los comandos y skills; la lista de `/`
   se completa tras el primer mensaje de la primera conversación y se recuerda. El «+» inserta cualquiera de los dos.
5. Cuando el agente edita, el botón del panel en la fila de arriba muestra +N −M. Resumen › Revisión › Cambios lista
   solo esos archivos con su diff; Impacto da el Blast Radius de cada uno y «Ver el mapa de módulos» abre la antigua
   Cartografía en grande.
6. Resumen › Archivos tiene «Árbol» y «Cambios de git» (el diff de todo el repo, la antigua página Diffs). Un
   archivo cambiado del árbol abre ahí.
7. Ajustes (abajo del panel izquierdo o Ctrl+K) es una ventana con General, Agentes, Apariencia, Atajos,
   Notificaciones, Personalizaciones (las skills) y Proyectos. Lo elegido en General › Permisos vale para la próxima
   conversación nueva.
8. Cartografía, Diffs y Skills ya no aparecen en Ctrl+K.

**Límites conocidos de la vuelta 2b**: «+» solo menciona archivos del proyecto; adjuntar un archivo de fuera o una
imagen necesita un comando nuevo del host (selector de archivos) y queda pendiente. «Aprobar o revertir» desde
Revisión tampoco está: la revisión por hunks sigue en Cambios de git. Apariencia solo informa el tema (no hay tema
claro) y las Notificaciones se guardan, pero los avisos llegan en la vuelta 3. El contador +N −M cuenta las líneas
de las ediciones del agente; un Write sobre un archivo existente cuenta todo como agregado porque el contenido
anterior no viaja en el evento. La Revisión se arma con los eventos del chat abierto: una conversación retomada
muestra lo que trae su historial (los últimos 400 eventos).

**Límites conocidos de la vuelta 1** (se resuelven más adelante): cambiar de proyecto todavía reinicia el motor y
corta la conversación en curso (vuelta 3); «Retomar sesión de la terminal…» solo está en el proyecto abierto;
Ctrl+B y Ctrl+J para los paneles llegan con el layout (vuelta 2).

### Notas de arquitectura (verificadas el 2026-11-06)

- **Índice de conversaciones (vuelta 1).** La tabla `sessions` de la memoria (`id, host, model, started_at,
  ended_at, capabilities_json`, `src/memory.mjs:30-37`) no tiene título, archivado ni actividad. Subir
  `MEMORY_SCHEMA_VERSION` rompería los runtimes de OmniSpec ya instalados en repos, que rechazan cualquier otra
  versión (`src/memory.mjs:279-301`). Por eso el índice va en una tabla nueva creada al primer uso, sin cambiar la
  versión, como ya hace `circuit_breakers` (`src/circuit-breaker.mjs:305-320`). Para listar conversaciones de
  proyectos no abiertos, el motor abre en solo lectura la memoria de cada uno (ruta según su modo, `resolveWorkspace`).
- **Proyectos (vuelta 1).** Los recientes viven en `%APPDATA%\OmniStudio\recent.json` (`recent.rs`, máximo 10,
  el más reciente primero). No hay selector de carpetas: hoy un proyecto nuevo solo entra por argumento de línea de
  comandos o segunda instancia (`lib.rs:175-178`); hace falta `tauri-plugin-dialog`.
- **Motores (vuelta 3).** El host guarda un solo `Supervisor` (`commands.rs:44-46`) y `open_project` mata el motor
  anterior (`engine.rs:497-524`). Hay que pasar a un mapa raíz → motor y llevar la raíz en `engine_call`,
  `engine_stderr`, `fs_rescan`, `pty_open` y en los eventos. Un motor por proyecto y no uno para todos:
  `node:sqlite` es síncrono y una espera de 5 s en una memoria frenaría a todos los proyectos. El hub de agentes
  necesita un id de conversación en cada método `agent.*` (hoy hay un solo driver por motor).
- **Memoria (vuelta 5).** La base funciona: WAL, `busy_timeout` 5000, escrituras en `BEGIN IMMEDIATE`; sus tests
  incluyen 6 procesos × 200 transacciones sin `SQLITE_BUSY`. Pero hoy solo guarda el grafo de código: nadie
  escribe `observations`, `sessions` ni `token_usage_events`. El MCP (`src/mcp-server.mjs`, `omni-spec mcp`)
  tiene `omni_search_context`, `omni_get_active_spec`, `omni_check_blast_radius` y `omni_record_decision`; exige
  `specs/manifest.json` y siempre usa `<root>/specs/.omni/memory.db`, así que no sirve en modo Studio. No hay
  reclamos de archivos: `docs/locking.md` solo serializa escrituras del CLI de OmniSpec.

### Agentes y reglas de los proveedores (verificado el 2026-11-06)

| Agente | En esta máquina | Protocolo | Modelos y razonamiento | Permisos | MCP por sesión, sin archivos | Historial |
|---|---|---|---|---|---|---|
| Claude Code | 2.1.318 | `claude -p` stream-json | Respuesta de control `initialize`: `models[].supportedEffortLevels`; `--model`, `--effort` | `--permission-mode` acceptEdits, auto, bypassPermissions, manual, dontAsk, plan | `--mcp-config '<json>'` | `~/.claude/projects/<carpeta>/<id>.jsonl` (cada registro con `cwd`) |
| Codex | 0.166.0 | `codex app-server` (JSON-RPC por stdio) | `model/list` con `supportedReasoningEfforts`; `turn/start {model, effort}` | Pares aprobación/sandbox, de `untrusted`/`read-only` a `never`/`danger-full-access`; aprobaciones `item/*/requestApproval` | `-c mcp_servers.<nombre>.command=…` | `~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl`; `thread/list`, `thread/resume` |
| Antigravity (`agy`) | 1.5.1 | `agy acp` (desde 1.5.0, 2026-11-04) | Config options de ACP (`model`, `thought_level`) | Modos accept-edits, auto, plan y sin permisos | ACP `mcpServers` (falta confirmar que `agy acp` lo acepta) | `~/.gemini/antigravity-cli/conversations/` |

- Gemini CLI no está instalado, y desde el 2026-06-18 las cuentas personales de Google usan Antigravity CLI en su
  lugar. También están instalados OpenCode 1.19.5 (`opencode acp`) y Cline 3.0.61 (`--acp`), útiles para probar
  el driver ACP.
- **ACP v1** (esquema 1.29.1): `session/new|load|resume|list|close`, `session/set_config_option` (categorías
  `model`, `thought_level`, `mode`); `session/set_model` se eliminó el 2026-06-01 y los modos están en retirada;
  `usage_update` trae contexto usado, tamaño y costo, pero no cuotas; todo agente debe aceptar MCP por stdio.
- **Anthropic** (code.claude.com/docs/en/agent-sdk/overview y /legal-and-compliance): sin aprobación previa no se
  permite que un producto de terceros ofrezca el login de claude.ai, tampoco mediante el Agent SDK ni su adaptador
  ACP; sí está permitido que el usuario inicie sesión en el binario `claude` sin modificar. Usar Claude Code dentro
  de un producto implica aceptar sus Commercial Terms: revisarlos antes de una versión pública.
- **OpenAI** (learn.chatgpt.com/docs/app-server): el login de ChatGPT por `app-server` nunca se ha permitido en
  servicios comerciales u hospedados; las apps locales o de código abierto sí pueden usarlo.
- **Google** (antigravity.google/terms, /docs/faq, /docs/ide/extensions/acp): los términos llaman incumplimiento a
  usar software de terceros para acceder al servicio, y el FAQ dice que envolver `agy` en apps de terceros no está
  soportado en planes personales; a la vez, su documentación dice que cualquier cliente ACP puede lanzar `agy`. Por
  eso Antigravity entra como experimental y apagado.
- **Lo que no se copia de Deska:** leer tokens para consultar el uso (`api.anthropic.com/api/oauth/usage`,
  `chatgpt.com/backend-api/wham/usage`) y escribir hooks y MCP en `~/.gemini/config`.

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
       --include-partial-messages --permission-prompt-tool stdio --permission-mode <modo>
```

- Permisos de Studio → `--permission-mode` (`CLAUDE_PERMISSION_MODES`): Preguntar siempre → `manual`,
  Predeterminado → `acceptEdits`, Automático → `auto`, Sin restricciones → `bypassPermissions`, Planificar →
  `plan`. Como el modelo y el esfuerzo, cambiarlo reinicia la CLI con `--resume`.

- Entrada (una línea JSON por mensaje): `{"type":"user","message":{"role":"user","content":[…]}}`.
- Permisos: la CLI envía `control_request` con `subtype: "can_use_tool"`; Studio responde
  `control_response` con `behavior: "allow"` (con `updatedInput`) o `"deny"` (con `message`).
- Cancelar: `control_request` con `subtype: "interrupt"`.
- El proceso vive mientras dura la conversación; `agent.reset` empieza otra.

## IPC nuevo

| Método | Dirección | Qué hace |
|---|---|---|
| `agent.status` | host→engine | Agentes disponibles, estado y modo del workspace |
| `agent.prompt` | host→engine | Envía un mensaje con `model`, `effort` y `permission` (`ask`, `default`, `auto`, `bypass`, `plan`); responde enseguida, el resto llega por eventos |
| `agent.cancel` | host→engine | Interrumpe el turno en curso |
| `agent.permission` | host→engine | Respuesta a un pedido de permiso |
| `agent.reset` | host→engine | Cierra la conversación y empieza una nueva |
| `agent.sessions` | host→engine | Conversaciones anteriores de la carpeta, la más reciente primero: `{id, title, updatedAt}` |
| `agent.resume` | host→engine | Carga una conversación anterior (`sessionId`): devuelve su historial como `agent.event` (más `user` para los prompts), su título, el contexto y el costo guardados; el próximo mensaje la continúa con `--resume`. Si venía de la terminal, entra en el índice |
| `memory.summary` | host→engine | Lo que guarda la memoria del proyecto: conteos, últimos aprendizajes y decisiones, modo y ruta |
| `conversations.list` | host→engine | Conversaciones de Studio de cada proyecto (`roots`), la de actividad más reciente primero. La del proyecto abierto sale de su memoria; las otras se leen sin crear nada |
| `conversations.rename` / `conversations.archive` | host→engine | Renombra o archiva una conversación de cualquier proyecto de la lista; nunca toca el historial del agente |
| `recent.remove` / `project.pick` | host (Rust) | Quita un proyecto de la lista (sin tocar su carpeta) / abre el selector de carpetas nativo |
| `agent.event` | engine→host | Eventos normalizados: `status`, `init`, `text`, `tool`, `tool_result`, `permission`, `result`, `error` |

`init` lleva `commands`, los comandos y skills que la CLI acepta (la lista de `/`). `result` lleva `costUsd` (lo que costó ese turno) y `sessionCostUsd` (el total de la conversación). Claude Code
informa `total_cost_usd` como acumulado de la sesión, y `--resume` lo arrastra, así que el driver calcula el
costo del turno restando el total anterior.

Un método nuevo toca cinco sitios: `src/studio/protocol.mjs` (fuente de verdad), `schema/studio-ipc.schema.json`
(`npm run build:studio-schema`), `apps/studio/src/ipc/generated.ts` (`npm run gen:ipc` en `apps/studio`), la lista
blanca del host `apps/studio/src-tauri/src/security.rs` y la lista de PR-15 en `test/studio-protocol.test.mjs`. Si
tiene efectos, también `MUTATIONS` en `apps/studio/src/ipc/client.ts`.

### Conversaciones anteriores

Claude Code guarda cada sesión en `<config>/projects/<carpeta>/<sessionId>.jsonl` (`<config>` es
`CLAUDE_CONFIG_DIR` o `~/.claude`; `<carpeta>` es la ruta absoluta con todo lo que no sea letra o dígito cambiado
por `-`, p. ej. `C:\dev\ClubGixxerMedellin` → `C--dev-ClubGixxerMedellin`). Lo lee `src/studio/agents/claude-sessions.mjs`:
- Título: el último `custom-title` que la CLI le puso; si no hay, la primera línea del primer prompt. Para listar
  solo se leen los primeros 256 KB y los últimos 64 KB de cada archivo (hay sesiones de 14 MB).
- Prompts: registros `user` sin `isMeta` ni `isSidechain` con texto; un comando se muestra como se escribió
  (`/omni-plan login`). Lo que la CLI inyecta lleva `isMeta: true` y no se muestra.
- Respuestas y herramientas: los registros `assistant` y `user` pasan por el mismo `translateClaudeMessage` que el
  vivo. Cada bloque viene en su propio registro con el mismo id de mensaje, así que se usa el `uuid` del registro.
- Costo: el último `cost-state.totalCostUSD`. Solo existe si el proceso anterior terminó limpio; Studio corta la
  CLI al cambiar de modelo o de conversación, así que muchas sesiones no lo tienen y entonces la CLI reanuda
  contando desde cero (el driver lo resuelve: ver `costOf`).
- Se muestran los últimos 400 eventos. Studio nunca lee el registro `session-owner` ni credenciales.

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

## Fase 2.6 · Pendientes de la revisión del 2026-11-06 (cerrada)

Lista de la primera revisión con capturas reales. Lo que quedó abierto pasó a la Fase 3 (indicado en cada punto).

**Registro de vueltas**

| Vuelta | Temas | Probado en la app | Commit |
|---|---|---|---|
| 1 · Cabecera | P0.1, P0.2, P1.3 y costo de P1.6 | Fila única y costo (captura del 2026-11-06). El aviso de cambio de modelo solo está cubierto por tests (CH-09) | `feat(studio): one status row, pending model notice and per-turn cost (phase 2.6 round 1)` |
| 2 · Conversaciones | P1.4, P2.7 | Lector probado contra las sesiones reales de ClubGixxerMedellin (6 conversaciones, títulos e historial de 116 eventos); en la app se vio la lista, y de ahí salió la Fase 3. Sin commit propio: entra en el de la Fase 3 vuelta 1 | — |

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
4. ~~Panel izquierdo: conversaciones con «Nueva conversación» como acción principal; specs y «Nueva Spec»
   secundarias.~~ Primera versión en la vuelta 2 (lista plana de conversaciones de Claude de la carpeta). Al verla
   se rediseñó como árbol Proyectos → Conversaciones: Fase 3, vuelta 1.
5. Inspector derecho cerrado por defecto. → Fase 3, vuelta 2 (panel «Resumen», que nunca se abre solo).
6. Hacer visible el gasto. Avance: el costo se ve siempre en la cabecera, y el aviso de cambio de modelo explica
   que el nuevo modelo vuelve a leer todo el contexto. → El resto, en la página Uso (Fase 3, vueltas 2 y 4).

**P2 · Capacidades de cockpit**
7. ~~Retomar conversaciones anteriores (sesiones de Claude Code con `--resume`).~~ Hecho (vuelta 2): ver
   «Conversaciones anteriores». Límite conocido: el historial no recupera modelo ni ventana de contexto hasta el
   primer turno nuevo. En la Fase 3 pasa a «Retomar sesión de la terminal…».
8. ~~Mencionar archivos con `@`~~ (Fase 3, vuelta 2b). Pegar imágenes y adjuntar archivos de fuera: pendiente.
9. ~~Comandos con `/`, incluidos los `/omni-*`.~~ Hecho en la Fase 3, vuelta 2b.
10. ~~Panel «Cambios del turno».~~ Hecho en la Fase 3, vuelta 2b (Revisión de esta conversación).
