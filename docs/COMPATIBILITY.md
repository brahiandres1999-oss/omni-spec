# Compatibilidad y verificación — OmniSpec 0.8.0 Oficial Estable

La versión oficial de producción es **0.8.0**, publicada globalmente en el canal npm `latest` y GitHub Releases el 2026-10-30.

OmniSpec instala flujos de especificación y revisión por proyecto, con soporte nativo de Plugin en Google Antigravity y adaptadores para los principales agentes de IA y herramientas de terminal. Conserva contexto y especificaciones al actualizar y exige auditoría, cobertura declarada de criterios y un registro de verificación formal antes de cerrar trabajo. No garantiza precisión al primer intento ni certifica la aplicación o el razonamiento de un modelo por instalarse.

## Runtimes y gestores de paquetes

OmniSpec 0.8.0 mantiene una estricta política de **Zero Runtime Dependencies** (`dependencies: {}`), eliminando riesgos de vulnerabilidades en la cadena de suministro y permitiendo compatibilidad directa entre diferentes runtimes y gestores:

| Entorno / Gestor | Comando recomendado | Compatibilidad verificada |
| :--- | :--- | :--- |
| **Node.js** | `npx --yes omni-spec init` | Node.js >=22.19.0, Node 22 LTS, Node 24 Current. |
| **Bun** | `bunx omni-spec init` | Bun 1.1+ y 1.2+. Compatible con `process.versions.bun` sin falsos positivos de versión Node. |
| **pnpm** | `pnpm dlx omni-spec init` | pnpm v9+ y v10+. Detección de `pnpm-lock.yaml`. |
| **Yarn** | `yarn dlx omni-spec init` | Yarn Berry / Modern v4+. Detección de `yarn.lock`. |
| **Global CLI** | `npm i -g omni-spec` → `omni-spec init` | Disponible en cualquier shell interactivo del sistema. |

### Detección de herramientas modernas y lockfiles

El motor de detección contextual (`src/detector.mjs`) reconoce:
- **Ecosistema JS/TS**: npm (`package-lock.json`), pnpm (`pnpm-lock.yaml`), yarn (`yarn.lock`), Bun binario (`bun.lockb`) y Bun textual moderno (`bun.lock`). Frameworks modernos como Astro, Svelte, Nuxt, Next.js, Vite, Remix.
- **Ecosistema Python**: uv (`uv.lock`), Poetry (`poetry.lock`), Pipenv (`Pipfile.lock`), pip estándar (`requirements.txt`, `pyproject.toml`).
- **Ecosistema Backend**: Maven (`pom.xml`), Gradle (`build.gradle`, `build.gradle.kts`), Go (`go.mod`), Rust (`Cargo.lock`), Ruby (`Gemfile.lock`).
- **Monorepos**: pnpm workspaces (`pnpm-workspace.yaml`), Turborepo (`turbo.json`), Lerna, npm/yarn workspaces.

## Plataformas y sistemas operativos

La suite de verificación y empaquetado contempla soporte formal en:
- **Windows**: Probado en Windows 11 (PowerShell y CMD). Normalización bidireccional de rutas con backslash, manejo de políticas de ejecución restringidas y reintentos automáticos de I/O (`fs-retry.mjs`) ante bloqueos transitorios por antivirus o indexación (EPERM/EBUSY/EACCES).
- **macOS / Linux**: Probado en Ubuntu LTS y entornos POSIX. Compatible con señales de proceso estándar (SIGINT, SIGTERM) y grupos de procesos para limpieza estricta de subprocesos.

`npm run test:package` recorre proyectos nuevos, existentes, con fallos, stacks desconocidos, monorepos y documentos sin código. También verifica los cuatro tipos de trabajo y el rechazo de cierres sin evidencia reproducible.

## Adaptadores de agentes soportados

OmniSpec 0.8.0 incluye 10 adaptadores probados en generación e integración:

1. **Antigravity**: Integración principal. Soporta modo workspace (`.agents/skills/` y `.agents/agents/omni-auditor.md`) y modo Plugin empaquetado (`plugin.json`), inyección de constitución con `trigger: always_on` y auditor sandboxeado.
2. **Claude Code**: Adaptador para `.claude/skills/` y sincronización gestionada de `CLAUDE.md`. Si un proyecto contiene `CLAUDE.md`, Claude Code ignora `AGENTS.md`; OmniSpec administra su bloque en ambos archivos para garantizar continuidad de gobernanza.
3. **Cursor**: Adaptador para `.cursor/skills/` y sección gestionada en `.cursorrules` / `AGENTS.md`.
4. **Codex**: Adaptador para `.agents/skills/` e inyección de directivas en `AGENTS.md` para invocación `$omni-init`.
5. **GitHub Copilot**: Sincronización de `.agents/skills/` compatible con agentes de VS Code.
6. **Kilo**: Adaptador para `.kilo/skills/` y `.kilo/commands/` para comandos slash documentados.
7. **OpenCode**: Adaptador para `.opencode/skills/` con metadatos de slash command (`metadata: {"opencode/slash": "true"}`).
8. **Gemini CLI**: Adaptador para `.gemini/skills/` y archivos TOML en `.gemini/commands/`.
9. **Generic**: Generación de plantillas y prompts en `specs/commands/` para cualquier modelo o interfaz de chat sin extensiones.
10. **Plugin**: Enlace y gobernanza directa mediante el plugin oficial instalado.

Para aceptar un host: confirmar descubrimiento de comandos, usar `omni-init` en proyecto nuevo y existente, discutir sin implementar, completar una feature y un bug, registrar una RFC sin código y reanudar el foco en otra sesión. Conservar los resultados reales y declarar cualquier comprobación pendiente.

## Actualizaciones y migraciones

La actualización admite instalaciones anteriores y copias de desarrollo: compara archivos administrados aunque coincida el número de versión. `--dry-run` no escribe; `update` conserva contexto, constitución, gates y especificaciones. Las personalizaciones administradas bloquean el reemplazo hasta su revisión explícita.

La sección administrada de `specs/.gitignore` ignora `specs/.omni/runtime/`. En un clon sin runtime, `npx omni-spec@<versión del manifiesto> update` lo recrea idéntico al paquete publicado; `init` no lo restaura. `doctor` resume en una línea un runtime ausente o de otra versión, con el comando de restauración. `status` avisa, sin bloquear, cuando la versión del CLI difiere de la del manifiesto.

Los trabajos completados permanecen como historial inmutable. Reabrir o volver a verificar un trabajo antiguo requiere adaptar sus criterios a `acceptance.json`; la actualización no inventa evidencia ni reescribe su resultado.

## Límites operativos y garantías

- `context-check` y `audit` revisan estructura y consistencia declarativa; el agente debe comprobar el significado de fuentes y requisitos.
- `acceptance.json` v2 exige cobertura de IDs, tipo, estado, método y evidencia. Los criterios UI manuales requieren observaciones de pasos, esperado/real, fecha y artefacto local; los visuales incluyen viewport. Una observación del agente exige capacidad render registrada. La veracidad y suficiencia requieren revisión humana.
- `verify` ejecuta los gates y el catálogo `specs/checks.json`; `complete` rechaza criterios pendientes y cambios de archivos posteriores al snapshot. El catálogo incorpora ID, cwd, timeout y tipo. Un criterio automatizado usa `checkIds` o `checkCommands` inequívocos.
- El snapshot comparte un límite de 20.000 archivos y 256 MiB entre fuentes, contexto y archivos de la spec. Excluye rutas de `.gitignore`, `.git/info/exclude`, `.omnispecignore` y las exclusiones por defecto (dependencias, cachés, salidas de build/test e IDE).
- Las escrituras de estado son atómicas y cuentan con reintentos para entornos Windows con indexadores o antivirus activos.
- No se garantiza cero alucinaciones ni cumplimiento normativo sin auditoría humana y pruebas ejecutables en entornos reales.
