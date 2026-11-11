# Compatibilidad y verificación — OmniSpec 0.9.0 Oficial Estable

La versión oficial de producción es **0.9.0**, publicada globalmente en el canal npm `latest` y GitHub Releases el 2026-11-11. Ver [notas de la versión 0.9.0](releases/0.9.0.md).

OmniSpec instala flujos de especificación y revisión por proyecto, con soporte nativo de Plugin en Google Antigravity y adaptadores para los principales agentes de IA y herramientas de terminal. Conserva contexto y especificaciones al actualizar y exige auditoría, cobertura declarada de criterios y un registro de verificación formal firmado criptográficamente antes de cerrar trabajo. No garantiza precisión al primer intento ni certifica la aplicación o el razonamiento de un modelo por instalarse.

## Runtimes y gestores de paquetes

OmniSpec 0.9.0 mantiene una estricta política de **Zero Runtime Dependencies** (`dependencies: {}`), eliminando riesgos de vulnerabilidades en la cadena de suministro y permitiendo compatibilidad directa entre diferentes runtimes y gestores:

| Entorno / Gestor | Comando recomendado | Compatibilidad verificada |
| :--- | :--- | :--- |
| **Node.js** | `npx --yes omni-spec init` | Node.js >=22.19.0, Node 22 LTS, Node 24 Current. Requerido por el motor nativo `node:sqlite` (`DatabaseSync` con FTS5). |
| **Bun** | `bunx omni-spec init` | Bun 1.1+ y 1.2+. Compatible con `process.versions.bun` sin falsos positivos de versión Node. |
| **pnpm** | `pnpm dlx omni-spec init` | pnpm v9+ y v10+. Detección de `pnpm-lock.yaml`. |
| **Yarn** | `yarn dlx omni-spec init` | Yarn Berry / Modern v4+. Detección de `yarn.lock`. |
| **Global CLI** | `npm i -g omni-spec` → `omni-spec init` | Disponible en cualquier shell interactivo del sistema. |

### Justificación de Node.js >=22.19.0

El requisito de Node.js `>=22.19.0` responde a la necesidad de utilizar la API nativa de base de datos relacional `node:sqlite` mediante el motor síncrono `DatabaseSync`. Esta capacidad nativa proporciona:
- Tablas virtuales **FTS5** (Full-Text Search) para la memoria persistente heurística y búsqueda rápida de contexto.
- Indexación relacional atómica con soporte de transacciones inmediatas (`BEGIN IMMEDIATE`) para la cartografía políglota y grafos de dependencias.
- Eliminación absoluta de paquetes nativos compilados de terceros (`better-sqlite3`, `sqlite3`), garantizando cero dependencias y máxima portabilidad en Windows, Linux y macOS.

### Detección de herramientas modernas y lockfiles

El motor de detección contextual (`src/detector.mjs`) reconoce:
- **Ecosistema JS/TS**: npm (`package-lock.json`), pnpm (`pnpm-lock.yaml`), yarn (`yarn.lock`), Bun binario (`bun.lockb`) y Bun textual moderno (`bun.lock`). Frameworks modernos como Astro, Svelte, Nuxt, Next.js, Vite, Remix.
- **Ecosistema Python**: uv (`uv.lock`), Poetry (`poetry.lock`), Pipenv (`Pipfile.lock`), pip estándar (`requirements.txt`, `pyproject.toml`).
- **Ecosistema Backend**: Maven (`pom.xml`), Gradle (`build.gradle`, `build.gradle.kts`), Go (`go.mod`), Rust (`Cargo.lock`), Ruby (`Gemfile.lock`), .NET (`*.sln`, `*.csproj`).
- **Monorepos**: pnpm workspaces (`pnpm-workspace.yaml`), Turborepo (`turbo.json`), Lerna, npm/yarn workspaces.

## Cartografía Políglota y Análisis de Impacto (`src/cartography/`)

OmniSpec 0.9.0 incorpora un subsistema de cartografía estática de código que construye el grafo de dependencias de la aplicación sin recurrir a dependencias externas pesadas.

### Matriz de soporte multi-lenguaje (Lexer DFA Pushdown y Resolvedor)

| Lenguaje / Ecosistema | Mecanismo de análisis | Capacidades soportadas |
| :--- | :--- | :--- |
| **TypeScript / JavaScript** | Lexer DFA determinista (`lexer.mjs`, `resolver.mjs`) | ESM (`import`, `export`), dynamic `import()`, CommonJS (`require()`), subpath exports (`package.json`), resolución de `paths` en `tsconfig.json`/`jsconfig.json`, workspaces (`pnpm`, `npm`, `yarn`), desenrollado de *barrel files* (`barrel_symbol_routes`), bridging de esquemas Prisma y migraciones SQL. |
| **Python** | Lexer DFA multilínea | Sentencias `import`, `from ... import`, resolución de rutas relativas (`.` y `..`), soporte para `src/` layout y roots de módulo. |
| **Go** | Lexer pushdown de bloques | Declaraciones `import (...)`, módulos internos declarados en `go.mod` y paquetes de la librería estándar. |
| **Rust** | Lexer DFA de módulos | Sentencias `use`, declaraciones `mod`, rutas de crates (`crate::...`, `super::...`) y miembros de workspaces en `Cargo.toml`. |
| **Java** | Lexer léxico de paquetes | Declaraciones `package` e `import`, resolución de jerarquías de paquetes para Maven y Gradle. |

### Comandos de cartografía
- `omni-spec cartography [--json]`: Escanea el repositorio, indexa las dependencias de módulos de forma incremental en `memory.db` y registra tiempos de modificación y hashes.
- `omni-spec blast-radius <archivo|archivo#simbolo> [--json]`: Evalúa el radio de impacto transitivo a partir de un archivo o símbolo específico, identificando todos los módulos dependientes directos e indirectos, profundidad máxima y advirtiendo sobre posibles roturas antes de iniciar una modificación.

## Omni-Guardian y Ejecución Segura (`src/guardian.mjs`)

Omni-Guardian proporciona ejecución segura y gobernanza dura sobre las operaciones de construcción y verificación:

- **Ejecución segura sin shell (`spawn(..., { shell: false })`)**: Todas las comprobaciones y gates se ejecutan sin invocar intérpretes de comandos intermedios. Esto neutraliza por completo la vulnerabilidad de inyección de comandos en entornos Windows mediante archivos `.cmd` y `.bat` (CVE-2024-27980).
- **Lista permitida estricta de binarios (*binary allowlist*)**: Solo se permite la invocación de ejecutores reconocidos del entorno de desarrollo: `node`, `npm`, `pnpm`, `yarn`, `bun`, `deno`, `python`, `pytest`, `uv`, `mvn`, `gradle`, `go`, `cargo`, `dotnet`.
- **Bloqueo determinista de operadores de shell**: Se interceptan y rechazan comandos que intenten encadenar ejecución o redirigir entradas/salidas mediante `&&`, `||`, `;`, `|`, `&`, `>`, `<`.
- **Pre-commit Hook gestionado**:
  - `omni-spec guardian install`: Instala el hook `.git/hooks/pre-commit`.
  - `omni-spec guardian check`: Valida archivos en stage contra las políticas de calidad y aserciones.
  - `omni-spec guardian uninstall`: Desinstala el hook gestionado.

## Verificación Criptográfica v4 y Hollow-Guard

El subsistema de verificación de OmniSpec 0.9.0 eleva las garantías de cumplimiento técnico:

### Atestación Criptográfica HMAC-SHA256 (`src/attestation.mjs`)
Los registros de verificación (`specs/<slug>/verification.json`) evolucionan a la versión **v4**:
- Cada resultado de verificación ejecutado por `omni-spec verify <id>` es firmado digitalmente con un código de autenticación de mensajes basado en hash (**HMAC-SHA256**).
- La firma vincula la huella del árbol de archivos verificado, el catálogo de checks ejecutados, la fecha y el estado de los criterios. Cualquier modificación manual posterior invalida la atestación.
- **Almacenamiento seguro de claves (`src/secure-store.mjs`)**:
  - En Windows: La clave simétrica de atestación se protege mediante la API nativa de protección de datos de Windows (DPAPI) en `%LOCALAPPDATA%\OmniSpec\keys\attestation.key`.
  - En Linux/macOS: Se almacena con permisos de archivo estrictos `0600` en `$XDG_STATE_HOME/omnispec/keys/attestation.key` (o `~/.local/state/omnispec/keys/attestation.key`).

### Hollow-Guard Anti-Slop (`src/hollow-guard.mjs`)
`omni-spec verify` invoca automáticamente el interceptor Hollow-Guard sobre las pruebas creadas o modificadas en el trabajo activo:
- **Bloqueo de tests sin aserciones**: Rechaza suites de prueba que solo instancian clases o invocan métodos sin ejecutar comprobaciones (`assert`, `expect`, `should`).
- **Bloqueo de tautologías vacías**: Detecta y rechaza aserciones triviales o complacientes como `assert.ok(true)`, `expect(true).toBe(true)`, `expect(1).toBe(1)` o similares.
- **Aislamiento de código real**: Valida que la prueba importe y ejercite código real del proyecto en lugar de limitarse a probar mocks ficticios desacoplados.

## Plataformas y sistemas operativos

La suite de verificación y empaquetado contempla soporte formal en:
- **Windows**: Probado en Windows 11 (PowerShell y CMD). Normalización bidireccional de rutas con backslash, manejo de políticas de ejecución restringidas y reintentos automáticos de I/O (`fs-retry.mjs`) ante bloqueos transitorios por antivirus o indexación (EPERM/EBUSY/EACCES).
- **macOS / Linux**: Probado en Ubuntu LTS y entornos POSIX. Compatible con señales de proceso estándar (SIGINT, SIGTERM) y grupos de procesos para limpieza estricta de subprocesos.

`npm run test:package` recorre proyectos nuevos, existentes, con fallos, stacks desconocidos, monorepos y documentos sin código. También verifica los cuatro tipos de trabajo y el rechazo de cierres sin evidencia reproducible.

## Adaptadores de agentes soportados

OmniSpec 0.9.0 incluye 10 adaptadores probados en generación e integración:

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

## Actualizaciones y migraciones

La actualización admite instalaciones anteriores y copias de desarrollo: compara archivos administrados aunque coincida el número de versión. `--dry-run` no escribe; `update` conserva contexto, constitución, gates y especificaciones. Las personalizaciones administradas bloquean el reemplazo hasta su revisión explícita.

La gestión del runtime local depende del modo configurado:
- **Modo Plugin de Antigravity (`--agent plugin`)**: No utiliza ni copia `specs/.omni/runtime/` ni `specs/_templates/` al repositorio. Los proyectos en este modo no requieren restaurar runtime tras clonar. Para migrar un proyecto existente con runtime local al modo plugin de huella cero, se utiliza:
  ```sh
  omni-spec clean --dry-run
  omni-spec clean --accept-updates
  ```
- **Modo Local / Multi-Agente**: La sección administrada de `specs/.gitignore` ignora `specs/.omni/runtime/`. En un clon sin runtime, `npx omni-spec@<versión del manifiesto> update` lo recrea idéntico al paquete publicado; `init` no lo restaura. `doctor` resume en una línea un runtime ausente o de otra versión, con el comando de restauración. `status` avisa, sin bloquear, cuando la versión del CLI difiere de la del manifiesto.

Los trabajos completados permanecen como historial inmutable. Reabrir o volver a verificar un trabajo antiguo requiere adaptar sus criterios a `acceptance.json`; la actualización no inventa evidencia ni reescribe su resultado.

## Nuevos Comandos CLI en OmniSpec 0.9.0

OmniSpec 0.9.0 expande el CLI con herramientas dedicadas a seguridad, persistencia, cartografía y gobernanza:

| Comando | Sintaxis principal | Propósito y comportamiento |
| :--- | :--- | :--- |
| **`mcp`** | `omni-spec mcp` | Inicia el servidor MCP (*Model Context Protocol*) nativo sobre stdio, exponiendo herramientas para inspección de especificaciones, memoria heurística y cartografía a agentes compatibles. |
| **`guardian`** | `omni-spec guardian <install\|uninstall\|check>` | Administra y ejecuta el hook `pre-commit` con ejecución segura sin shell y verificación anti-slop. |
| **`cartography`** | `omni-spec cartography [--json]` | Indexa el grafo de dependencias de módulos de forma incremental en `memory.db`. |
| **`blast-radius`** | `omni-spec blast-radius <archivo\|archivo#simbolo> [--json]` | Calcula el radio de impacto transitivo y advierte sobre módulos afectados. |
| **`memory`** | `omni-spec memory <add\|search\|list>` | Consulta y almacena observaciones heurísticas (`pattern`, `gotcha`, `convention`, `constraint`) en `memory.db`. |
| **`login`** | `omni-spec login --provider <nombre>` | Verifica y orienta la autenticación con proveedores soportados en el host. |
| **`auth`** | `omni-spec auth status [--json]` | Reporta el estado de la tienda segura de credenciales y proveedores configurados. |
| **`approve`** | `omni-spec approve <id> --gate <1\|2> --actor <nombre>` | Registra formalmente la aprobación humana de compuertas de gobernanza. |
| **`tasks migrate`** | `omni-spec tasks migrate <id>` | Migra tareas Markdown hacia el esquema estructurado `tasks.json`. |
| **`clean`** | `omni-spec clean [--dry-run] [--accept-updates]` | Retira runtime y artefactos administrados locales para migrar de modo proyecto a modo plugin ultra-limpio. |

## Límites operativos y garantías

- `context-check` y `audit` revisan estructura y consistencia declarativa; el agente debe comprobar el significado de fuentes y requisitos.
- **Bloqueo de onboarding en cierre**: `verify` y `complete` bloquean el cierre de cualquier especificación si el estado de onboarding en `context-record` permanece como `NOT_RECORDED`.
- `acceptance.json` exige cobertura de IDs, tipo, estado, método y evidencia. Los criterios UI manuales requieren observaciones de pasos, esperado/real, fecha y artefacto local; los visuales incluyen viewport. Una observación del agente exige capacidad render registrada. La veracidad y suficiencia requieren revisión humana.
- `verify` ejecuta los gates y el catálogo `specs/checks.json` mediante Omni-Guardian seguro; genera atestación criptográfica HMAC-SHA256 en `verification.json` v4 y valida que no existan tests vacíos con Hollow-Guard.
- `complete` rechaza criterios pendientes y cambios de archivos posteriores al snapshot. El catálogo incorpora ID, cwd, timeout y tipo. Un criterio automatizado usa `checkIds` o `checkCommands` inequívocos.
- El snapshot comparte un límite de 20.000 archivos y 256 MiB entre fuentes, contexto y archivos de la spec. Excluye rutas de `.gitignore`, `.git/info/exclude`, `.omnispecignore` y las exclusiones por defecto (dependencias, cachés, salidas de build/test e IDE).
- Las escrituras de estado son atómicas y cuentan con reintentos para entornos Windows con indexadores o antivirus activos.
- No se garantiza cero alucinaciones ni cumplimiento normativo sin auditoría humana y pruebas ejecutables en entornos reales.
