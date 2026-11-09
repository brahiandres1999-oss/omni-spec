# Inventario para 0.9.0-preview.1

Estado real del repositorio el 2026-11-08, en la rama `feat/studio-agent-cockpit`. Versión actual: 0.8.1 en todos los archivos. Desde `v0.8.1` hay 23 commits y, además, trabajo sin commitear.

Documento de trabajo, no se publica.

---

## 1. Cómo está armado el producto

| Pieza | Qué es | Cómo se distribuye |
|---|---|---|
| **Motor / CLI** (`bin/`, `src/`) | El CLI `omni-spec`, el MCP, la memoria, la cartografía y la parte de agentes de Studio (`src/studio/`) | Paquete npm (`.tgz`) |
| **Omni Studio** (`apps/studio/`) | App de escritorio para Windows (Tauri + React). Lleva el motor dentro, como recurso | Instalador NSIS `.exe`. **No va en npm** |

Studio necesita el motor, y el instalador lo copia dentro. Las cuatro versiones (`package.json`, `apps/studio/package.json`, `Cargo.toml` y `tauri.conf.json`) tienen que coincidir: el test PK-05 lo comprueba.

---

## 2. Resultado de las pruebas (hoy)

| Suite | Resultado |
|---|---|
| Motor (`npm test`) | **1022 pasan, 1 falla, 3 omitidas.** Falla EN-10: `project.snapshot` tarda 310 ms y el límite es 150. Es un umbral de rendimiento en esta máquina, no un error funcional. |
| Lint (`npm run lint`) | **2 errores**, solo de formato: `ChatView.tsx` y `QuestionPanel.tsx`. Se arreglan con `npm run lint:fix`. |
| Paquete (`npm run test:package`) | Pasa. Nota: `liveAgentChatTested: false`. |
| Studio, Vitest | 124 de 124 pasan. |
| Studio, Rust (`cargo test`) | **No se pudo correr.** `omni-studio.exe` estaba abierto y Windows bloqueó el archivo. Hay que cerrar Studio y volver a correrlo. |
| Studio, E2E (Playwright) | Desactualizado: recorre las pestañas del dashboard viejo (Kanban, Cartografía, Diffs, FinOps, Skills). No hay E2E del chat. |

---

## 3. Qué hay en el motor

| Área | Estado | ¿Está en el CHANGELOG? |
|---|---|---|
| Cartografía y blast radius (`src/cartography/`) | ✅ Hecho y probado. No llega a sus objetivos de rendimiento: lexer 1,87 M LOC/s de 3 M; indexado en frío 4,5 s de 0,2 s; 89,6 MB de 60. | Sí |
| Gobernanza: guardian, circuit breaker, atestación HMAC, auth DPAPI | ✅ Hecho y probado | Sí |
| Ceremonia proporcional, fit, configure (specs 025–033) | ✅ Hecho y probado | Sí |
| Memoria v4 (SQLite + Git) | ✅ Hecho y probado | **No** |
| Servidor MCP (`omni-spec mcp [--studio]`) | ✅ Hecho y probado | **No** (solo la herramienta de blast radius) |
| Motor de Studio (JSON-RPC por named pipe) | ✅ Hecho y probado (los tests solo corren en Windows) | **No** |
| Driver de Claude | ✅ Funciona. Los turnos con modelo real solo se probaron a mano. | **No** |
| Driver de Codex (app-server) | ✅ Funciona. Igual que Claude: turnos reales solo a mano. | **No** |
| Driver ACP (OpenCode, Cline) | 🟡 Funciona, sin probar a fondo en la app | **No** |
| Antigravity (`agy acp`) | 🧪 Experimental, apagado por defecto. No está confirmado que acepte el MCP de Omni. | **No** |
| `omni-spec --help` | 🟡 Lista los comandos nuevos, pero no menciona `--agent studio` | — |

### Sin commitear (trabajo en curso)

| Pieza | Estado |
|---|---|
| **Panel de preguntas** (`ask-channel.mjs`, herramienta `omni_ask_user`, `QuestionPanel.tsx`) | 🟡 Casi listo. Los botones "Skip" y "Submit" están en inglés y fuera de i18n. El dictado por voz es un "próximamente". |
| **Borrar conversación** (`session-files.mjs`) | 🟡 Funciona: manda a la Papelera de reciclaje el historial del propio agente. ⚠️ **Contradice** la regla de `STUDIO-AGENT-COCKPIT.md:151` ("Studio nunca borra el historial de un agente"). La ruta de la Papelera no tiene test. |
| **Modo de instalación "studio"** (`init --agent studio`) | 🟡 Escribe `CONSTITUTION.md`, `project-context.md`, el manifiesto y `specs/.gitignore` en el proyecto. ⚠️ Choca con la visión de "cero archivos en el proyecto del usuario". Tiene pocos tests directos. |
| Carpetas sin Git (`NOT_A_REPOSITORY`) | 🟡 Funciona, sin tests |
| Workflows `/omni-*` en Studio, arreglo del slot al reanudar, cambios en ACP, limpieza del lock | ✅ Parece terminado |

---

## 4. Qué hay en Studio

### Pantallas

| Vista | Estado |
|---|---|
| Chat, Composer, panel de preguntas, revisión de la conversación | ✅ Es el corazón del cockpit |
| Barra lateral, barra de título, Ajustes, terminal | ✅ Funcionan. En Ajustes › Agentes solo se ve si el binario existe, no si tenés sesión iniciada. |
| Memoria | ✅ Simple. No tiene tests. |
| Specs (tablero Kanban) | 🟠 Resto del dashboard viejo. Solo tiene sentido en modo proyecto. |
| Uso (FinOps) | 🟠 Resto del dashboard viejo con los límites de Codex pegados encima. Es la mejor candidata a rehacerse. |
| Revisión › Impacto (cartografía con d3) | 🟠 Resto del dashboard viejo, pesado para una sub-pestaña |
| Archivos › Cambios de git, Ajustes › Personalizaciones | 🟠 Restos del dashboard viejo, reubicados |

### Agentes

| | Claude | Codex | OpenCode/Cline | Antigravity |
|---|---|---|---|---|
| Enviar y streaming | ✅ | ✅ | ✅ | ✅ |
| Modelos | ✅ | ✅ | ✅ (sin esfuerzo) | ✅ |
| Límites de uso | Solo contexto y costo | ✅ Ventanas reales | Solo contexto | ❌ |
| Reanudar sesión de la terminal | ✅ | ✅ | ❌ | ❌ |
| Permisos | ✅ | ✅ | ✅ | ✅ |
| Saber de antemano si hay login | ❌ (solo aparece un error `AUTH_REQUIRED`) | ❌ | ❌ | ❌ |

### Instalador

| Punto | Estado |
|---|---|
| Formato | NSIS, por usuario, descarga WebView2 si hace falta |
| Firma de código | ❌ No firmado: Windows mostrará el aviso de SmartScreen |
| Auto-actualización | ❌ No existe |
| **Node.js** | ⚠️ **No va incluido.** El equipo necesita `node.exe` ≥ 22.19 en el PATH. En tu máquina da igual; para cualquier otra persona es un bloqueo. |
| Último instalador generado | `Omni Studio_0.8.1_x64-setup.exe`, del 6 de noviembre. Es **anterior** a las vueltas 3 a 6 del cockpit. |
| Idioma | Solo español (no hay archivo en inglés). Hay textos fuera de i18n: "Skip", "Submit", "El agente" y los errores de los drivers. |

---

## 5. Documentación

| Documento | Estado |
|---|---|
| `README.md` | ❌ Dice 0.8.1 `latest`. No menciona cartografía, MCP ni Studio. |
| `CHANGELOG.md` | 🟡 `[Unreleased]` cubre las fases 2 y 3. **No hay nada de Studio, los drivers, la memoria ni el MCP.** |
| `docs/releases/0.9.0-preview.1.md` | ❌ No existe (es obligatorio) |
| `INSTALLATION`, `ONBOARDING`, `COMPATIBILITY`, `PILOT`, `ROADMAP`, `RELEASING` | ❌ Todos dicen 0.8.1 y ninguno menciona Studio |
| `docs/STUDIO-AGENT-COCKPIT.md` | 🟡 Al día, pero el encabezado dice "vuelta 4 en curso". No cubre las preguntas ni el borrado. |
| `apps/studio/README.md` | ❌ Sigue siendo la plantilla de Tauri |
| Documento para usuarios sobre Studio (qué es, cómo instalarlo) | ❌ No existe |
| Idioma | Docs de usuario en español; `CHANGELOG` en inglés. Es coherente con lo que ya hay. |

---

## 6. Clasificación: qué hacer y cuándo

### A. Bloquea la preview local (hay que hacerlo sí o sí)
1. Terminar el trabajo sin commitear: pasar "Skip" y "Submit" a i18n y correr `lint:fix`. Después, commit.
2. Decidir qué hacer con el test EN-10 (310 ms frente a 150): ajustar el umbral o mejorar el rendimiento.
3. Correr `cargo test` con Studio cerrado.
4. Añadir `/specs/` al `.gitignore` de la raíz (ahí está tu `memory.db` local).
5. Subir la versión a `0.9.0-preview.1` en `package.json`, `package-lock.json`, `plugin.json`, `apps/studio/package.json`, `Cargo.toml` y `tauri.conf.json`. También `publishConfig.tag` a `preview`.
6. Actualizar el banner SVG (versión 0.9.0 y la palabra "Preview") y el título del README.
7. `CHANGELOG`: añadir lo que falta (Studio, drivers, memoria, MCP) y pasar `[Unreleased]` a `[0.9.0-preview.1]`.
8. Escribir `docs/releases/0.9.0-preview.1.md`, con una sección honesta de **limitaciones conocidas**.
9. Generar el `.tgz` del motor y un instalador nuevo de Studio.

### B. Decisiones tuyas (de producto, no técnicas)
1. **Borrar conversación:** ¿Studio puede mandar a la Papelera el historial del agente? Si sí, hay que cambiar la regla del documento. Si no, hay que quitar esa parte.
2. **`init --agent studio` escribe archivos en el proyecto:** ¿se acepta, o se lleva todo a la carpeta por usuario para cumplir "cero archivos"?
3. **¿La preview incluye Studio o solo el motor?** Para uso local da igual. Si alguien más va a instalar Studio, Node.js tiene que ir incluido o documentado como requisito.

### C. Conviene antes de una 0.9.0 estable (en la preview, solo anotado)
- Documentación de Studio para usuarios y README de `apps/studio`.
- Poner al día `INSTALLATION`, `ROADMAP`, `COMPATIBILITY` y `RELEASING`.
- Rehacer o quitar las vistas heredadas del dashboard: Uso, Specs e Impacto.
- E2E del chat y quitar el E2E del dashboard viejo.
- Detectar si hay login antes de abrir una conversación.
- Incluir Node.js en el instalador.

### D. Puede esperar más
- Firma de código y auto-actualización.
- Interfaz en inglés.
- Rendimiento de la cartografía.
- Reanudar sesiones de ACP y Antigravity.
- Dictado por voz.
