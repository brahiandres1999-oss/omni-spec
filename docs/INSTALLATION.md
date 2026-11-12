# Instalación y primera entrega al agente

Este contrato corresponde a la versión oficial estable [OmniSpec 0.9.0](releases/0.9.0.md), distribuida globalmente en el canal npm `latest`. No requiere dependencias de terceros (`dependencies: {}`) y está lista para inicializar proyectos desde cero o gobernar proyectos existentes como Motor Universal de Ingeniería Agéntica (*Universal Agentic Engineering Engine*).

## Punto de entrada oficial

Con Node.js >=22.19.0 (requerido por el motor nativo `node:sqlite` con motor `DatabaseSync` y soporte FTS5; compatible con Node 24 Current y Node 22 LTS), abre una terminal en la carpeta del proyecto y ejecuta:

```sh
npx --yes omni-spec init
```

El primer `--yes` es de npm: acepta descargar y ejecutar la versión oficial de `omni-spec` sin confirmaciones redundantes del gestor, pero no contesta las preguntas del asistente interactivo de OmniSpec. No preselecciona tecnologías ni aprueba commits o publicaciones. No es obligatorio instalar el paquete de forma global.

### Gestores alternativos y ejecución multiplataforma

OmniSpec 0.9.0 soporta de forma nativa los principales ejecutores y gestores de paquetes del ecosistema moderno:

```sh
# Usando pnpm
pnpm dlx omni-spec init

# Usando Bun (1.1+ / 1.2+)
bunx omni-spec init

# Usando Yarn Modern (Berry / v4)
yarn dlx omni-spec init

# Instalación global permanente (npm, pnpm o bun)
npm install -g omni-spec
omni-spec init
```

El mismo recorrido interactivo sirve para cualquier nivel de experiencia:

1. **Idioma**: Elegir inglés o español, salvo que ya se haya indicado `--lang en|es` o exista un idioma guardado previamente en el proyecto.
2. **Detección de entorno**: Leer la carpeta de destino y el estado detectado: carpeta nueva, archivos existentes o instalación previa de OmniSpec.
3. **Selección de herramientas con IA**: Salvo argumento `--agent` o selección existente. En la interfaz visual de terminal, usar flechas y Espacio para marcar una o varias; Enter confirma y Ctrl+A selecciona todas las integraciones concretas. La opción genérica es exclusiva. En modo de texto (`--plain`) se aceptan nombres separados por comas, `all`, `generic` o `plugin`.
4. **Kit de componentes UI**: Si un módulo del proyecto presenta señal de interfaz de usuario (Tailwind CSS, frameworks como React, Vue, Svelte, Astro, Nuxt, `components.json` o un kit reconocido), no hay una selección guardada y no se indicó `--ui-components`, elegir el kit (`shadcn`, `radix`, `headlessui`, `preline`, `flyonui` o `none`). Sin señal o al reinicializar, este paso se omite.
5. **Confirmación y preparación**: Confirmar la preparación de la carpeta. Las respuestas inválidas se vuelven a preguntar; cancelar o cerrar la entrada antes de confirmar no escribe archivos en disco.
6. **Instalación según el modo arquitectónico**: En modo local/multi-agente, instala el runtime local en `specs/.omni/runtime/`, plantillas editables en `specs/_templates/`, contexto inicial en `specs/project-context.md` y adaptadores de agentes. En modo plugin de Antigravity (`--agent plugin`), aplica una huella ultra-limpia omitiendo runtime y plantillas locales en el repositorio.
7. **Invocación en el agente**: Abrir la carpeta en la herramienta elegida y utilizar la invocación mostrada por el instalador (ej. `/omni-init` o `$omni-init`).

No se pregunta stack, estándar de documentación, perfil regulatorio ni quality gates durante este recorrido inicial. Esas decisiones requieren conocer el propósito del proyecto y se discuten de forma asistida con el agente. El nombre inicial se deriva de la carpeta y puede declararse con `--name`. Las declaraciones `--stack`, `--doc`, `--profile`, `--gates` y `--ui-components` (`shadcn`, `radix`, `headlessui`, `preline`, `flyonui`, `none`) están disponibles por CLI y se resumen antes de confirmar. No se ejecuta el texto de esos checks durante la instalación.

## Modos de instalación: Plugin vs Local / Multi-Agente

OmniSpec 0.9.0 ofrece dos modos arquitectónicos de despliegue según el flujo y las herramientas del equipo:

### 1. Modo Plugin de Antigravity (`--agent plugin`)
- **Huella ultra-limpia (*zero-footprint*)**: Diseñado para desarrolladores que trabajan en Google Antigravity con el plugin oficial instalado.
- **Sin duplicación en el repositorio**: `init` y `update` **NO** copian `specs/.omni/runtime/` ni `specs/_templates/` dentro del repositorio del proyecto. Las plantillas, validadores de esquemas y binarios se resuelven directamente desde el bundle centralizado del plugin.
- **Gestión centralizada**: El ciclo de vida del plugin en la máquina se administra mediante:
  ```sh
  omni-spec plugin install    # Instala o enlaza el plugin en la configuración global
  omni-spec plugin status     # Comprueba el estado, versión y descubrimiento del plugin
  omni-spec plugin update     # Actualiza el plugin centralizado a la última versión
  ```
- **Migración con `clean`**: Para convertir un proyecto que utilizaba runtime local o adaptadores previos a modo plugin ultra-limpio, ejecuta:
  ```sh
  omni-spec clean --dry-run             # Previsualiza archivos administrados a retirar
  omni-spec clean --accept-updates      # Retira runtime y skills locales, preservando specs y contexto
  ```

### 2. Modo Local / Multi-Agente (`antigravity`, `claude`, `cursor`, `codex`, `copilot`, `kilo`, `opencode`, `gemini`, `generic`, `all`)
- **Autonomía por proyecto**: Genera los adaptadores correspondientes en `.claude/skills/`, `.cursor/skills/`, `.agents/skills/`, etc., y sincroniza directivas en `AGENTS.md` o `CLAUDE.md`.
- **Runtime y plantillas locales**: Despliega el motor CLI portable en `specs/.omni/runtime/` y las plantillas por arquetipo en `specs/_templates/`.
- **Restauración en clones**: `specs/.omni/runtime/` no se sube a Git (ignorado por `specs/.gitignore`). Al clonar el repositorio en una máquina nueva, el runtime local se restaura con:
  ```sh
  npx omni-spec@<versión de specs/manifest.json> update
  ```
  *(Nota: ejecutar `init` en un clon existente está bloqueado para proteger la configuración; usa siempre `update`).*

## Memoria Persistente Externa y Compuertas Guardian

Para erradicar la sobrecarga de archivos temporales y garantizar la limpieza de Git, OmniSpec 0.9.0 introduce dos mecanismos fundamentales:

1. **Memoria FTS5 fuera del repositorio**: El estado del proyecto (`sessions`, `decisions`, `context`), los historiales (`context_history`, `decision_history`) y las observaciones heurísticas (`pattern`, `gotcha`, `convention`, `constraint`) se persisten en una base de datos SQLite externa:
   - En Windows: `%LOCALAPPDATA%\OmniSpec\workspaces\<id>\memory.db`
   - En Linux/macOS: `$XDG_STATE_HOME/omnispec/workspaces/<id>/memory.db` (o `~/.local/state/omnispec/...`)
   Esto elimina `specs/project-state.json`, carpetas de historial y archivos temporales dentro del árbol de trabajo.
2. **Hook Pre-commit con Omni-Guardian**: Ejecuta:
   ```sh
   omni-spec guardian install
   ```
   Esto configura el hook `.git/hooks/pre-commit` con ejecución segura sin shell (`spawn(..., { shell: false })`), bloqueando commits si existen violaciones de calidad, pruebas vacías (*Hollow-Guard*) o falta de atestación criptográfica HMAC-SHA256 en verificaciones activas.

## Componentes y Guías del Sistema (`omni-spec guide`)

OmniSpec 0.9.0 no requiere ni distribuye *companions* externos de terceros. La arquitectura visual y los recursos metodológicos se consultan directamente mediante el comando CLI `omni-spec guide <design|setup|evidence>` (o a través del runtime local `node specs/.omni/runtime/bin/omni-spec.mjs guide <design|setup|evidence>`):

- `omni-spec guide design`: Directrices de interfaz de usuario, tokens de diseño y calidad frontend.
- `omni-spec guide setup`: Procedimientos de preparación de entorno y herramientas.
- `omni-spec guide evidence`: Esquemas formales y ejemplos de registros de evidencia JSON.

`--ui-components` acepta `shadcn`, `radix`, `headlessui`, `preline`, `flyonui` o `none`. Funciona con `init --yes` aunque el proyecto todavía no tenga dependencias de UI. La selección queda registrada en `manifest.ui.components` y se conserva al repetir `init` sin nuevos flags.

La guía de diseño oficial (`omni-spec guide design`) establece el estándar de artesanía visual:
- **4 Estados Obligatorios**: Toda vista interactiva debe contemplar explícitamente *Loading* (skeletons contextuales con CLS = 0), *Empty* (explicación clara con acción inmediata / CTA), *Error* (mensaje amigable con mecanismo de reintento) y *Protected / Ideal* (vista completa autorizada o estado restringido sin permisos).
- **Anti-Cliché & Tipografía Deliberada**: Prohibidos los degradados azul/púrpura genéricos, resplandores difusos artificiales y el anidamiento excesivo de tarjetas con sombras (*card-itis*). Se prioriza la jerarquía visual mediante tipografía y whitespace deliberado.
- **Tokens Semánticos y Accesibilidad**: Contraste WCAG 2.1 AA medible, paletas de color con roles funcionales y soporte completo de navegación por teclado y lectores de pantalla.

## Terminales, agentes y automatización

Con entrada interactiva, OmniSpec hace las mismas preguntas aunque se lance desde una terminal del editor o desde un agente. No infiere capacidades de la sesión ni utiliza claves de proveedores.

La interfaz de terminal utiliza un logo de caracteres estático, una pregunta activa y selección con teclado. Su densidad se adapta al espacio disponible; se omite el logo en pantallas pequeñas para mantener legibles las opciones. La lista muestra una ventana alrededor de la opción enfocada cuando no cabe completa. Esc o Ctrl+C cancelan antes de instalar; se restauran cursor y modo de entrada. Los estados de progreso corresponden a operaciones reales, sin porcentajes estimados ni pausas de presentación.

Si el destino, las declaraciones o los avisos ocupan más espacio, PgUp/PgDn permite recorrer sus líneas completas. Las opciones de confirmar o cancelar y la ayuda permanecen visibles; el contador indica qué parte de los detalles se está mostrando.

La interfaz visual requiere entrada y salida TTY y un tamaño mínimo de 40 columnas por 18 filas. `--plain`, `TERM=dumb`, CI o salida redirigida usan texto por líneas. `NO_COLOR` desactiva colores sin cambiar el recorrido. `--json` conserva JSON sin controles ANSI. No se modifica el historial anterior ni se requieren paquetes de UI externos.

```sh
npx --yes omni-spec init --plain
```

Si no hay entrada interactiva disponible, falla con instrucciones concretas antes de instalar. Para ejecución desatendida o automatización de scripts:

```sh
npx --yes omni-spec init --yes --agent codex --lang es
npx --yes omni-spec init --yes --agent cursor,claude --lang es
npx --yes omni-spec init --yes --agent generic --lang es --json
```

El segundo `--yes` es de OmniSpec y acepta preparar la carpeta con los datos declarados. Sin `--agent`, el modo automático conserva la integración existente o usa `generic`; no selecciona silenciosamente un host. `--json` requiere `init --yes` para que la salida no se mezcle con preguntas. La salida incluye `installation` con `FILES_READY`, integridad `PASSED`, `agentDiscovery: NOT_CHECKED`, `projectOnboarding: PENDING`, versión, idioma, invocaciones y ruta de recuperación.

## Adaptadores y sincronización de agentes

OmniSpec 0.9.0 ofrece 10 adaptadores estandarizados:
- **Antigravity**: Instalación de 9 skills en `.agents/skills/` y subagente auditor en `.agents/agents/omni-auditor.md`. En modo plugin, enlaza directamente al plugin centralizado validado (`plugin.json`) sin duplicar archivos en el repositorio.
- **Claude Code**: Genera `.claude/skills/` y administra la sección gestionada en `CLAUDE.md`. Si un proyecto contiene `CLAUDE.md`, Claude Code prioriza este archivo sobre `AGENTS.md`; OmniSpec sincroniza ambos para garantizar que las directivas de gobernanza permanezcan activas.
- **Cursor**: Genera `.cursor/skills/` y mantiene la sección de instrucciones en `.cursorrules` o `AGENTS.md`.
- **Codex**: Genera `.agents/skills/` e inyecta la sección gestionada en `AGENTS.md` para invocación vía `$omni-init`.
- **GitHub Copilot**: Sincroniza `.agents/skills/` y directivas compatibles con agentes en VS Code.
- **Kilo & OpenCode**: Configura `.kilo/skills/` y `.opencode/skills/` con metadatos de slash commands nativos.
- **Gemini CLI**: Genera `.gemini/skills/` y comandos TOML en `.gemini/commands/`.
- **Generic & Plugin**: Archivos Markdown directos para cualquier LLM o conexión con plugins externos.

## Recuperación cuando no aparece la skill

La existencia de archivos no demuestra que el host los haya descubierto. Actualiza o reabre el workspace y utiliza el selector de skills del host. Codex usa `$omni-init`; otras integraciones muestran su invocación específica. Si sigue sin aparecer, pide en el chat:

```text
Lee .agents/skills/omni-init/SKILL.md y sigue sus instrucciones.
Confirma la versión del runtime local y usa el idioma de esta conversación.
```

El instalador muestra la ruta exacta de la integración elegida: `.agents/skills/` para Antigravity, Codex y Copilot; `.claude/skills/` para Claude, etc. `specs/commands/omni-init.md` queda como una entrada breve que apunta a esas skills, sin copiar sus instrucciones. En modo `generic`, los nueve prompts de `specs/commands/` sí son la fuente principal; en modo plugin, la entrada indica la ruta del plugin instalado y cómo proceder si falta. Una copia anterior administrada se reemplaza por la entrada breve al actualizar; una copia personalizada se conserva como conflicto a revisar.

El agente debe poder leer la carpeta y disponer de las herramientas necesarias; la alternativa explícita no concede capacidades ausentes. Si solo puede leer texto, la ejecución de comandos seguirá pendiente.

## Auditor y archivos internos

La integración de Antigravity instala `.agents/agents/omni-auditor.md`, además de las nueve skills. El auditor utiliza el sandbox del host. El plugin mantiene su definición en `agents/omni-auditor.md`; los demás hosts conservan el rol en `specs/.omni/runtime/agents/omni-auditor.md` para revisión en la sesión actual si no hay un subagente disponible. Una definición instalada no prueba descubrimiento ni concede permiso para delegar. `/omni-audit` distingue ambas rutas y no afirma que corrió un auditor separado si no fue así.

`specs/manifest.lock/` vacío es normal: solo contiene tickets temporales mientras un comando modifica el estado y vuelve a quedar vacío al terminar. No es un archivo de configuración ni algo que deba rellenar el usuario. La exclusión de Git y el mecanismo de concurrencia se conservan; ver [concurrencia y coordinación](DELIVERY.md#concurrencia-y-coordinacion-de-procesos). `clean` retira únicamente la definición administrada del auditor junto a las skills/runtime de OmniSpec y actualiza la entrada al plugin; conserva agentes propios y archivos personalizados.

`specs/.omni/runtime/` no se versiona: la sección administrada de `specs/.gitignore` lo excluye. En un proyecto configurado en modo local/multi-agente, en un clon se restaura con `npx omni-spec@<versión de specs/manifest.json> update` (no con `init`). En proyectos configurados en **modo plugin (`--agent plugin`)**, `specs/.omni/runtime/` no existe ni se restaura, ya que las operaciones se delegan al plugin instalado. Ver [compatibilidad](COMPATIBILITY.md#actualizaciones-y-migraciones).

El siguiente bloque es el onboarding conversacional: comprender el objetivo, revisar decisiones y registrar contexto. Init no crea una aplicación, ejecuta sus scripts, comprueba su comportamiento ni publica contenido.

## Carpetas y reinstalación

| Situación | Comportamiento |
| --- | --- |
| Carpeta nueva | Decisiones de producto/stack pendientes; sin checks inventados. |
| Proyecto con archivos | Conservar aplicación; scripts detectados como candidatos NOT_RUN, no gates implícitos. |
| Misma versión ya instalada | Conservar configuración, idioma, contexto propio y especificaciones; mostrar cómo retomar trabajo activo. Las ediciones de archivos administrados bloquean su reemplazo. |
| Otra versión instalada | Rechazar migración/downgrade mediante init; indicar CLI correspondiente o `update --dry-run`. |
| Subcarpeta de otro proyecto OmniSpec | Rechazar instalación anidada e indicar la raíz. |
| Raíz del disco, home o directorio symlink | Pedir una carpeta de proyecto normal antes de instalar. |
| Respuestas inválidas | Volver a preguntar; nunca aceptar una opción diferente silenciosamente. |
| Cancelación o EOF | Sin archivos de instalación nuevos. |
| Error de permisos o escritura | Salida no exitosa; no declarar instalación lista. Puede haber escritura parcial: revisar `doctor` y `update --dry-run` antes de reintentar. |
| Skill ausente en el host | Mantener descubrimiento pendiente y ofrecer lectura explícita del prompt local. |

`--force` conserva su semántica explícita de reemplazar constitución/plantillas administradas, preservando las especificaciones; se advierte antes de la confirmación interactiva. No es un remedio automático para conflictos. `init` no inicializa Git ni cambia su configuración, crea commits o remotos, hace push ni despliega.
