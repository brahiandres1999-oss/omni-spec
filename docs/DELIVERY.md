# Entrega con estado y evidencia

[OmniSpec 0.9.0](releases/0.9.0.md) oficial estable evoluciona el marco hacia un **Motor Universal de Ingeniería Agéntica**, consolidando contratos proporcionales (`fit`), arquitectura de huella cero (*Zero-Footprint*) con base de datos externa SQLite FTS5, compuertas de seguridad deterministas (`Omni-Guardian` y `Hollow-Guard`) y atestación criptográfica HMAC-SHA256 en los registros de verificación. Su publicación en el canal npm `latest` establece el estándar oficial de producción. No confundir el paquete instalado con versiones anteriores o plugins globales desactualizados.

## Empezar y reanudar

Ejecuta el CLI con `omni-spec version`, inicializa el repositorio con `omni-spec init` y utiliza la skill `/omni-init` según el host configurado. El inicio inspecciona la estructura del proyecto sin ejecutar scripts no autorizados; registra contexto, preguntas, decisiones y capacidades reales. Las utilidades `guide setup`, `guide design` y `guide evidence` proporcionan procedimientos exactos incluidos en el paquete sin requerir skills adicionales.

`status --json` conserva el manifiesto y añade `progress`: estado de entrega, frescura del contexto, bloqueos activos, próxima acción recomendada, conjunto de lectura (`readSet`) y memoria activa de la sesión (`progress.memory`).
- `readSet.files`: lista los archivos de la especificación activa requeridos por su ruta de `fit`, junto con `acceptance.json` y `verification.md`.
- `readSet.avoid`: indica lo que el agente no necesita inspeccionar innecesariamente para optimizar contexto: las demás especificaciones, el `verification.json` de la activa (cuyos resultados ya sintetiza `status`), `specs/.omni/`, `specs/_templates/` y `specs/contracts.json`.
- `progress.memory`: inyecta automáticamente observaciones persistentes relevantes (`gotcha`, `convention`, `constraint`, `pattern`) recuperadas desde la base de datos externa del espacio de trabajo.
- `status --json --all`: devuelve la totalidad de decisiones y criterios históricos.

Tras reconciliar las fuentes y validar las afirmaciones de arquitectura, ejecuta `context-record`. Este comando almacena la huella criptográfica de las entradas de contexto (`specs/project-context.md`, enlaces locales, manifiestos de build/dependencias como `package.json`, `pom.xml`, `pyproject.toml`, flujos de CI e instrucciones de agentes como `CONSTITUTION.md` o `README.md`) y conserva el baseline anterior. Cualquier modificación en estas entradas marca el contexto como `STALE`, bloqueando `verify` y `complete` hasta su re-evaluación; las ediciones de código fuente no invalidan el contexto. Si el proyecto se encuentra en `NOT_RECORDED`, `context-record` es un paso obligatorio antes de iniciar tareas o verificaciones.

## Sesión y decisiones (Arquitectura Zero-Footprint)

OmniSpec 0.9.0 adopta una arquitectura de huella cero: el estado del proyecto, las sesiones de trabajo, las decisiones de arquitectura y sus respectivos historiales ya no se almacenan dentro del repositorio en `specs/project-state.json`, `specs/decisions/` ni carpetas temporales `specs/.omni/inputs/`. Toda la persistencia reside de forma aislada en la base de datos relacional SQLite con búsqueda de texto completo FTS5 ubicada en:

```
%LOCALAPPDATA%\OmniSpec\workspaces\<id>\memory.db   (Windows)
~/.local/share/OmniSpec/workspaces/<id>/memory.db   (POSIX)
```

Tanto `session-record` como `decision-record` admiten parámetros directos por línea de comandos o mediante `--json-input` (además de `--from <archivo|->`), eliminando la necesidad de generar archivos JSON efímeros en el repositorio:

- **Registro de sesión:**
  ```bash
  omni-spec session-record --host "Antigravity/1.0" --questions available --web unavailable --render available
  ```
  O con estructura JSON directa:
  ```bash
  omni-spec session-record --json-input '{"host":"Claude Code/1.0","capabilities":{"questions":{"status":"available"},"render":{"status":"unavailable"}}}'
  ```
  Los estados posibles son `available`, `unavailable` y `unknown`. Registrar una capacidad documenta una observación real de la sesión activa, no concede herramientas al entorno. Las observaciones manuales de interfaz de usuario realizadas por un agente exigen una sesión previa registrada con capacidad `render: available`.

- **Registro de decisiones:**
  ```bash
  omni-spec decision-record --topic "database" --status "approved" --basis "Aprobado por el usuario en chat" --sources "https://docs.db.example/spec"
  ```
  O mediante `--json-input`:
  ```bash
  omni-spec decision-record --json-input '{"id":"DEC-01","topic":"auth","status":"approved","value":"jwt","basis":"Delegación técnica confirmada"}'
  ```
  Estados permitidos: `proposed`, `approved`, `delegated`, `rejected`, `postponed`. Las decisiones en estado `approved` o `delegated` exigen registrar la base o respuesta explícita en `basis`. Las elecciones tecnológicas exigen fuentes oficiales documentadas (`url`, `consultedAt`, `authority: "official"`). Las decisiones obligatorias que permanezcan pendientes o provisionales bloquean la finalización de la especificación.

## Ciclo de vida, tareas canónicas y gobierno humano

El flujo de trabajo en 0.9.0 se estructura bajo contratos verificables:

1. **Creación desacoplada (`create`):**
   Al invocar `omni-spec create <id> --type <feature|bugfix|debt|rfc>`, la especificación se crea inicialmente en estado `[Route: UNCLASSIFIED]` con su artefacto primario correspondiente. No se generan plantillas rígidas ni tareas prematuras hasta formalizar su clasificación técnica.

2. **Clasificación proporcional (`fit`):**
   La clasificación con `omni-spec fit <id>` evalúa alcance, riesgo, incertidumbre y reversibilidad (vía `fit.json` schemaVersion 2). Determina la ruta aplicable:
   - `light`: Para cambios atómicos, locales y de bajo riesgo (1-2 archivos).
   - `standard`: Para funcionalidades convencionales y refactors acotados.
   - `full`: Para modificaciones de alto riesgo, cambios arquitectónicos o impacto transversal en dependencias.

3. **Tareas canónicas (`tasks.json`):**
   El desglose de trabajo se almacena y valida en `specs/<id>/tasks.json` como fuente de verdad estructurada por máquina. El archivo `specs/<id>/tasks.md` es una proyección determinista generada en Markdown para lectura humana. Los proyectos o especificaciones existentes pueden actualizarse mediante `omni-spec tasks migrate <id>`.

4. **Compuertas de gobierno humano (`humanGates`):**
   Cuando la gobernanza del proyecto tiene activado `governance.humanGates: true`, las especificaciones en ruta `full` imponen dos compuertas estrictas que requieren aprobación explícita:
   - **Compuerta 1 (Gate 1 - Aprobación de Diseño):** Bloquea el paso a implementación hasta registrar `omni-spec approve <id> --gate 1 --actor <nombre>`.
   - **Compuerta 2 (Gate 2 - Aprobación de Verificación):** Bloquea `complete` tras superar los checks hasta registrar `omni-spec approve <id> --gate 2 --actor <nombre>`.

## Checks de ejecución y barreras de seguridad (Omni-Guardian y Hollow-Guard)

Los checks se registran en `specs/manifest.json` mediante `omni-spec checks --from <archivo>`. Su ejecución durante `omni-spec verify <id>` está blindada por dos barreras deterministas:

### Omni-Guardian (`src/guardian.mjs`)
Toda ejecución de checks pasa obligatoriamente por el gate léxico de Omni-Guardian:
- **Ejecución sin shell:** Los procesos se invocan mediante `spawn(..., { shell: false })`, garantizando que argumentos entre comillas sean tratados como cadenas de texto inertes y neutralizando inyecciones por expansión.
- **Bloqueo inmediato de operadores:** Se prohíbe taxativamente el encadenamiento, redirección o sustitución de comandos en una sola línea (`&&`, `|`, `;`, `>`, `<`, `$()`, comillas invertidas) arrojando el error `GUARDIAN_SHELL_OPERATOR`. Cada comando debe declararse como un check atómico independiente en el catálogo.
- **Lista blanca de binarios (`DEFAULT_ALLOWED_BINARIES`):** Solo se permite invocar herramientas de desarrollo reconocidas (`node`, `npm`, `npx`, `pnpm`, `yarn`, `bun`, `deno`, `git`, `vitest`, `jest`, `playwright`, `tsc`, `biome`, `eslint`, `python`, `python3`, `pytest`, `uv`, `ruff`, `mypy`, `mvn`, `mvnw`, `gradle`, `gradlew`, `java`, `javac`, `go`, `cargo`, `rustc`, `dotnet`) o los definidos en `guardian.allowedBinaries`. Los intérpretes de comandos (`cmd`, `powershell`, `pwsh`, `bash`, `sh`, `wsl`) y herramientas de administración de sistema están bloqueados de forma incondicional (`FORBIDDEN_BINARIES`).

### Hollow-Guard (`src/hollow-guard.mjs`)
Constituye la barrera contra pruebas fraudulentas o vacías (*anti-hollow test guard*):
- Inspecciona léxicamente los archivos de pruebas modificados durante la especificación.
- Bloquea la verificación si detecta suites de prueba sin aserciones, aserciones tautológicas constantes (por ejemplo `assert.ok(true)`, `expect(true).toBe(true)`, `assertEquals(1, 1)`) o archivos de prueba que no importan ni invocan código del proyecto.

### Salidas generadas, huella e integridad
`verify` calcula una huella criptográfica SHA-256 de los archivos fuente del proyecto antes y después de ejecutar los checks:
- Se excluyen del cómputo directorios de dependencias y artefactos de compilación (`node_modules/`, `dist/`, `build/`, `target/`, `.cache/`, entre otros), los patrones de `.gitignore` y las reglas adicionales de `.omnispecignore`.
- Si un check escribe o modifica un archivo no ignorado, la ruta queda registrada en `changedDuringVerification` y la verificación falla con `VERIFICATION_SOURCE_CHANGED`.
- La salida de logs combinados de cada check se limita a 8 MiB; exceder este límite aborta la ejecución para prevenir desbordamientos de memoria.

## Aceptación funcional y visual (acceptance.json schemaVersion 2)

El archivo `specs/<id>/acceptance.json` bajo `schemaVersion: 2` formaliza los criterios de aceptación con los campos `id`, `kind`, `status`, `method` y `evidence`.

- **Tipos de criterio (`kind`):** `functional`, `visual`, `interaction`, `accessibility`, `decision`. Mantén etiquetas como `AC-01 [functional]` en el contrato primario; no se pueden eliminar desde un reporte para relajar revisiones.
- **Automatización obligatoria:** Los criterios con `kind: "functional"` exigen obligatoriamente `method: "automated"` cuando el proyecto cuenta con compuertas o checks configurados. No se admite marcar criterios funcionales como manuales para evadir la ejecución de pruebas.
- **Campo `exercises` obligatorio:** Cuando el riesgo evaluado en `fit.json` sea `high` o `critical`, todo criterio automatizado debe incluir la propiedad `"exercises"` con una descripción de al menos 20 caracteres que justifique explícitamente cómo la prueba ejercita la regla de negocio.
- **Aprobación con límites (`limits`):** Si un criterio se cumple de manera restringida o bajo supuestos operativos aceptados, se debe registrar el estado con la propiedad `"limits"` (`PASSED WITH LIMITS`), explicitando las restricciones técnicas antes de completar la especificación.
- **Observaciones manuales de UI:** En criterios visuales o de interacción no automatizables, las observaciones deben incluir `actor` (`agent` o `human`), `surface`, `environment`, `steps`, `expected`, `actual`, `result: "passed"`, `observedAt` y dimensiones del viewport (`width` y `height`). Si el actor es `agent`, debe existir una sesión previa registrada con capacidad `render: available`.

## Atestación criptográfica y registro de verificación v4 (verification.json)

OmniSpec 0.9.0 implementa la **versión 4** del registro de verificación (`VERIFICATION_RECORD_VERSION = 4`), incorporando atestación criptográfica HMAC-SHA256 para blindar la evidencia contra manipulaciones o generación sintética no autorizada:

- **Clave de atestación externa y protección DPAPI:**
  La atestación utiliza una clave de 256 bits generada localmente fuera del repositorio:
  ```
  %LOCALAPPDATA%\OmniSpec\keys\attestation.key   (Windows, protegida mediante DPAPI CryptProtectData)
  ~/.local/share/OmniSpec/keys/attestation.key   (POSIX, con permisos estrictos 0600)
  ```
  Un agente sin permisos de ejecución fuera del sandbox no puede fabricar firmas válidas; un agente que ejecute código como el mismo usuario de SO puede interactuar con DPAPI, por lo que esta medida defiende contra archivos falsificados, no contra ejecución de código arbitrario.
- **Firmas criptográficas por check y de resumen:**
  - Cada resultado en `results` incluye una firma `attestationSignature` que vincula canónicamente: `version`, `specId`, `fingerprint`, `checkId`, `command`, `cwd` (relativo `checkCwd`), `outputLogHash`, `exitCode`, `processId`, `startedAt`, `timedOut` y `errorType`.
  - El registro raíz incluye `recordSignature`, firmando el consolidado de resultados, checks evaluados, auditoría de Hollow-Guard y el identificador público `attestationKeyId`.
- **Rutas de trabajo relativas (`checkCwd`):**
  `checkCwd` se almacena siempre relativo a la raíz del repositorio, lo que permite mover o clonar la carpeta del proyecto sin invalidar la verificación.
- **Rechazo estricto de registros antiguos o manipulados:**
  `complete` rechaza tajantemente cualquier `verification.json` anterior a la versión 4 o con firmas HMAC discrepantes (`ATTESTATION_INVALID`). Para cerrar la especificación, es indispensable ejecutar `omni-spec verify <id>` bajo el motor 0.9.0.

## Concurrencia y coordinación de procesos

OmniSpec coordina procesos en la misma máquina física y sistema de archivos local sin depender de servicios distribuidos ni daemons externos:

### 1. Bloqueo del manifiesto (`specs/manifest.lock`)
- **Protocolo de tickets de Lamport:** La coordinación de modificaciones sobre el manifiesto y el estado del repositorio sigue una adaptación del algoritmo de panadería de Lamport sobre el sistema de archivos local.
- **Reclamo atómico:** Cada proceso participante crea de forma atómica su directorio identificador `<pid>-<uuid>/`. La presencia del PID en el nombre permite identificar de inmediato a su dueño ante una eventual terminación prematura.
- **Publicación de ticket:** El participante inspecciona los tickets vigentes de sus pares, calcula `max + 1` (utilizando enteros de precisión arbitraria `BigInt`) y publica su número renombrando atómicamente el archivo temporal `ticket.tmp` a `ticket`.
- **Ordenamiento y espera:** El proceso espera a que los procesos en fase de selección concluyan y a que todos los participantes con tuplas `(ticket, claim-name)` menores liberen el recurso antes de realizar escrituras.
- **Limpieza de reclamos huérfanos:** Para limpiar procesos muertos, solo se considera evidencia irrefutable que `process.kill(pid, 0)` retorne el error `ESRCH`. Errores de permisos o la antigüedad del reclamo no se interpretan como muerte del proceso.
- **Eliminación explícita del directorio:** Al liberar el último reclamo activo, la función `releaseLock` ejecuta `rmdir` sobre `specs/manifest.lock`. Como `rmdir` solo elimina carpetas vacías, si no existen reclamos pendientes el directorio de bloqueo se retira por completo, garantizando que **no queden carpetas vacías residuales en el repositorio Git**.

### 2. Bloqueo de verificación (`specs/.omni/verify.lock`)
- Las comprobaciones de `verify` se ejecutan bajo el bloqueo independiente `specs/.omni/verify.lock`, utilizando el mismo protocolo de tickets.
- `verify` retiene el bloqueo del manifiesto (`manifest.lock`) únicamente durante dos periodos breves: en la fase previa de preparación (auditoría, revisión de aceptación e instantánea inicial) y en la fase final de registro (instantánea posterior y generación de `verification.json`). Durante la ejecución prolongada de los checks, el manifiesto queda libre, permitiendo que comandos como `status`, `session-record` o `decision-record` respondan sin demora.
- Si el contexto, las decisiones o los archivos fuente cambian mientras corren los checks, la verificación falla de inmediato indicando las rutas modificadas.
- Solo se permite una verificación concurrente por proyecto; un segundo intento espera aproximadamente 10 segundos antes de fallar con aviso de verificación en curso. `complete` toma el bloqueo de verificación de manera inmediata (`wait: false`), asegurando que jamás compita contra una verificación activa. El orden de adquisición estricto (`verify.lock` y luego `manifest.lock`) previene cualquier interbloqueo (*deadlock*).

### 3. Concurrencia en SQLite y Mutex de autenticación del sistema operativo
- **Persistencia SQLite de alta concurrencia:** La base de datos externa `memory.db` opera en modo WAL (*Write-Ahead Logging*) con `PRAGMA busy_timeout = 5000` (5 segundos de tolerancia activa ante bloqueos). Todas las transacciones de escritura se inician explícitamente con `BEGIN IMMEDIATE` para evitar condiciones de carrera o conversiones tardías de bloqueo. Además, las operaciones críticas están encapsuladas en `withSqliteRetry`, que aplica reintentos con retroceso exponencial (*exponential backoff*) y jitter aleatorio para absorber bloqueos transitorios provocados por minifiltros de antivirus en Windows.
- **Mutex de autenticación a nivel de sistema operativo:** La rotación y actualización de credenciales de autenticación compartidas entre múltiples procesos concurrentes se serializa mediante un mutex nombrado del sistema operativo:
  - En Windows: `Global\OmniSpec_Auth_Mutex` (con degradación controlada a mutex local de sesión si los permisos de cuenta lo requieren).
  - En POSIX: Lockfile consultivo con `flock`.
  Si un proceso termina inesperadamente durante la actualización, el sistema operativo libera automáticamente el mutex marcándolo como abandonado, permitiendo al siguiente proceso tomar el control de forma segura.

## Git y estado local (Zero-Footprint)

`init` y `update` configuran la sección administrada en `specs/.gitignore` para descartar artefactos efímeros de ejecución: `specs/.omni/verification-logs/`, respaldos locales en `backups/` y archivos temporales.

En el modo **Plugin de Antigravity** (`--agent plugin`), OmniSpec opera con huella ultra-limpia:
- No se copian plantillas a `specs/_templates/` ni el runtime a `specs/.omni/runtime/`; las herramientas y esquemas se resuelven directamente desde la instalación global del plugin (`~/.gemini/config/plugins/omni-spec`).
- El comando `omni-spec clean` permite retirar copias locales no modificadas del runtime y adaptadores de proyecto al migrar a la modalidad plugin global, preservando en todo momento configuraciones, especificaciones y archivos personalizados por el usuario.
