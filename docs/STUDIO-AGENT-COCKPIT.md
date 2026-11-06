# Omni Studio: cockpit agéntico

Estado: prototipo (fases 0–2). Reemplaza el escenario de dashboards de la fase 4, que queda en el tag
`studio-dashboard-v0`.

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

Los eventos son independientes del proveedor: los próximos drivers (Codex `app-server`, ACP) emiten los
mismos tipos y la UI no cambia.

## Criterios de aceptación del prototipo

1. Abrir un repositorio sin OmniSpec deja `git status` igual que antes.
2. El chat muestra el texto de Claude en vivo, cada herramienta que usa y su resultado.
3. Una edición o comando pide aprobación; Rechazar evita el cambio y Aprobar lo aplica.
4. Sin sesión de Claude Code, la UI explica cómo iniciarla y no se cae.

## Fuera de este prototipo

Inyección de Omni en la sesión (MCP y reglas, fase 3), drivers de Codex y ACP (fases 4 y 6), layout
completo (fase 5).
