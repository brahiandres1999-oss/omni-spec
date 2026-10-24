<p align="center">
  <img src="assets/omni-spec-banner.svg" alt="OmniSpec Banner" width="100%">
</p>

<p align="center">
  <a href="package.json"><img src="https://img.shields.io/badge/version-0.7.0--rc.2-blue.svg" alt="Version 0.7.0-rc.2"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/dependencies-0%20(pure%20node)-green.svg" alt="Zero Dependencies"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D22.19.0-black.svg" alt="Node.js >=22.19.0"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-gray.svg" alt="License MIT"></a>
  <a href="https://github.com/brahiandres1999-oss/omni-spec/actions/workflows/ci.yml"><img src="https://github.com/brahiandres1999-oss/omni-spec/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

---

# OmniSpec 0.7.0-rc.2

> **Desarrollo Guiado por Especificaciones (SDD) para Agentes de IA.**  
> Escribe especificaciones claras, elimina el código de relleno (*AI slop*) y programa con tu agente favorito sin perder el control ni el contexto entre sesiones.

Inspirado en los principios de **Spec-Kit** y **OpenSpec**, OmniSpec es un framework universal, sin dependencias runtime externas, con CLI portable y adaptadores según formatos documentados que vive dentro de tu repositorio. Funciona directamente desde el chat de tu editor preferido (Cursor, VS Code, Claude Code, Antigravity y más), soportando instalación directa como **Plugin nativo en Google Antigravity** y subagentes autónomos de auditoría (`omni-auditor`).

---

> **Candidato local para piloto.** Esta versión aún no se ha publicado: `npx omni-spec` sin versión ejecuta la última publicada en npm (0.6.1). Para probar 0.7.0-rc.2 genera el tarball local como explica el [piloto](docs/PILOT.md). Consulta también [entrega y evidencia](docs/DELIVERY.md).

## ¿Por qué OmniSpec?

Los agentes de IA son rápidos, pero sin un marco estructurado sufren de amnesia de contexto, sobreingeniería en backend (*defensive try/catch traps*, abstracciones prematuras) y clichés visuales genéricos en frontend (*card-itis*, degradados morados, estados vacíos rotos).

OmniSpec resuelve esto con un ciclo de ingeniería riguroso:

- **Criterios de calidad explícitos:** Aporta instrucciones de UI/UX y backend para guiar la implementación y revisión. La calidad visual, accesibilidad y corrección requieren comprobaciones pertinentes; las instrucciones no garantizan un resultado correcto al primer intento.
- **Zero Dependencies & Zero Lock-in:** Node.js nativo (>=22.19.0). No instala paquetes npm pesados ni altera el runtime de proyectos en Python, Go, Rust, Java o TypeScript.
- **Universal Multi-Agent:** Un único comando configura Cursor, GitHub Copilot, Claude Code, Google Antigravity, OpenCode, Kilo, Codex o cualquier LLM con soporte Markdown.
- **Verificación que convive con proyectos reales:** la huella respeta `.gitignore`, `.omnispecignore` y exclusiones por defecto (reportes de Playwright, `.gradle/`, `build/`, IDE). Si un check modifica un archivo no ignorado, `verify` lo nombra en vez de fallar sin explicación.
- **Verificación con alcance declarado:** Ejecuta los gates configurados y vincula el registro al contenido del proyecto y de la spec. `acceptance.json` registra evidencia declarada por criterio; los criterios automatizados deben referenciar gates configurados mediante `checkCommands`, y el CLI los vincula con sus resultados ejecutados. La suficiencia de esas pruebas y la veracidad de evidencia manual requieren revisión. Un snapshot detecta cambios posteriores, no demuestra ausencia de regresiones.

---

## Inicio Rápido (60 segundos)

### 1. Prepara la carpeta donde vas a trabajar

Necesitas Node.js >=22.19.0 y una herramienta con agente de IA. OmniSpec prepara instrucciones y conserva acuerdos en tu proyecto; tu agente conduce la conversación y realiza el trabajo. No necesitas elegir las tecnologías de tu aplicación para instalar OmniSpec.

Abre una terminal en la carpeta del proyecto. Para uno nuevo, crea una carpeta y entra en ella; para uno existente, usa su raíz. El comando de entrada para la versión publicada es:

```sh
npx --yes omni-spec@latest init
```

*(O instálalo globalmente con `npm install -g omni-spec` si prefieres el comando `omni-spec` directo). Mientras 0.7.0 sea candidata, usa el tarball local del [piloto](docs/PILOT.md): el nombre sin versión instala la última publicada.*

En la candidata 0.7.0, el asistente pregunta idioma, herramienta con IA y confirmación de la carpeta. Permite varias herramientas o `generic` si aún no elegiste una. No presupone Antigravity ni pregunta tu nivel de experiencia. Producto, stack, documentación y checks se acuerdan después con el agente. `init` conserva el código existente y no ejecuta scripts de aplicación; los comandos detectados quedan como candidatos en `specs/project-context.md`.

En una terminal compatible verás el logo de caracteres y una pregunta activa: flechas para moverte, Espacio para marcar herramientas y Enter para continuar; Esc o Ctrl+C cancelan. La presentación se ajusta al tamaño disponible. Usa `--plain` para texto por líneas; tuberías, CI y JSON conservan salida sencilla. `NO_COLOR` desactiva los colores. Antigravity recibe también `.agents/agents/omni-auditor.md` para las superficies que admiten ese formato.

El `--yes` **antes** del paquete pertenece a npm: evita su confirmación de descarga, pero el asistente de OmniSpec sigue siendo interactivo. Para automatización, añade el `--yes` de OmniSpec **después** de `init` y declara la integración:

```sh
npx --yes omni-spec@latest init --yes --agent codex --lang es
# También admite --agent cursor,claude o --agent all.
```

Los argumentos `--name`, `--stack`, `--doc`, `--profile` y `--gates` permiten conservar decisiones explícitas sin repetir preguntas. Sin una integración declarada en modo automático se utiliza `generic`, con prompts de lectura explícita. [Todas las variantes de instalación y recuperación](docs/INSTALLATION.md).

### 2. Reconoce el proyecto desde el chat

Abre **esa misma carpeta** en tu herramienta con IA y usa la invocación que muestra el instalador. Por ejemplo, `/omni-init` en Claude o `$omni-init` en Codex. La instalación comprueba integridad local; todavía no confirma que el host descubra las skills.

Si la skill no aparece, actualiza/reabre el proyecto o pega en el chat:

```text
Lee specs/commands/omni-init.md y sigue la ruta de la skill que indica.
Confirma la versión del runtime local y usa el idioma de esta conversación.
```

Explica qué quieres construir o cambiar. El agente reconocerá el punto de partida y registrará objetivos, decisiones pendientes y contexto en `specs/project-context.md`. Instalar OmniSpec no crea ni valida la aplicación. Una instalación ya existente conserva su configuración y trabajo activo; una versión diferente se migra con `update --dry-run`, no con `init`.

La entrada `specs/commands/omni-init.md` apunta a la skill de tu integración; no copia el workflow completo. En modo `generic`, los prompts de `specs/commands/` sí son la vía principal.

### 3. Especifica, construye y verifica

Trabaja de forma interactiva usando los comandos de slash:

```text
/omni-specify Agrega autenticación con Google y Passkeys
/omni-plan
/omni-tasks
/omni-implement
/omni-converge
```

---

## El Flujo de Trabajo (Los 9 Skills)

OmniSpec guía el desarrollo a través de un ciclo continuo de 9 habilidades universales:

| Comando | Fase | Propósito |
| :--- | :--- | :--- |
| `/omni-init` | **Onboarding** | Reconoce la arquitectura, stack, comandos reales y convenciones del repositorio. |
| `/omni-discuss` | **Exploración** | Investiga alternativas, analiza trade-offs y compara enfoques antes de tocar archivos. |
| `/omni-specify` | **Especificación** | Formaliza el alcance y los criterios de aceptación en un arquetipo concreto. |
| `/omni-clarify` | **Alineación** | Pregunta y resuelve dudas materiales y casos borde antes de diseñar la solución. |
| `/omni-plan` | **Arquitectura** | Diseña una solución técnica proporcional, minimalista y con estrategia de testing. |
| `/omni-tasks` | **Planificación** | Desglosa la solución en tareas ejecutables con orden de dependencias. |
| `/omni-audit` | **Control de Calidad** | Audita consistencia documental, completitud y gates antes de escribir código. |
| `/omni-implement` | **Construcción** | Cirugía de código de alta precisión: minimal touch, calidad senior y sin comentarios de relleno. |
| `/omni-converge` | **Verificación** | Ejecuta gates automáticos, valida criterios de aceptación y cierra el trabajo con evidencia. |

---

## Arquetipos de Trabajo

OmniSpec adapta los artefactos generados según la naturaleza exacta de la tarea:

| Arquetipo | Alias | Artefactos generados | Cierre requerido |
| :--- | :--- | :--- | :--- |
| `feature` | `feat` | `spec.md`, `plan.md`, `tasks.md` | Criterios medibles, pruebas unitarias/E2E y verificación. |
| `bugfix` | `bug`, `fix` | `bug.md`, `rca.md`, `fix.md` | Reproducción demostrada, causa raíz (RCA) y test de regresión. |
| `debt` | `refactor` | `audit.md`, `migration-plan.md`, `tasks.md` | Reducción de deuda preservando 100% el comportamiento existente. |
| `rfc` | `idea` | `rfc.md` | Decisión formal consensuada (`ACCEPTED`, `REJECTED`, `DEFERRED`). |

---

## Agentes y Editores Compatibles

OmniSpec genera adaptadores nativos para cada entorno sin dependencias propietarias. Todos los agentes reciben además un bloque gestionado en `AGENTS.md`, que es el único archivo que todos los hosts documentan.

| Agente / Editor | Archivos generados | Cómo se invoca |
| :--- | :--- | :--- |
| **Google Antigravity** | `.agents/skills/omni-*/SKILL.md` o Plugin nativo | `/omni-init` o gestor `/plugin` |
| **Cursor** | `.cursor/skills/omni-*/SKILL.md` + regla de proyecto | `/omni-init` en Cursor Composer / Chat |
| **VS Code (GitHub Copilot)** | `.agents/skills/omni-*/SKILL.md` + instrucciones | `/omni-init` en Chat de Copilot |
| **Claude Code** | `.claude/skills/omni-*/SKILL.md` | `/omni-init` en Claude CLI |
| **Kilo** | `.kilo/skills/omni-*/SKILL.md` + `.kilo/commands/omni-*.md` | `/omni-init` en consola interactiva |
| **OpenCode** | `.opencode/skills/omni-*/SKILL.md` | `/omni-init` en consola interactiva |
| **Gemini CLI** | `.gemini/skills/omni-*/SKILL.md` + `.gemini/commands/omni-*.toml` | `/omni-init` en Gemini Code Assist |
| **Codex** | `.agents/skills/omni-*/SKILL.md` | `$omni-init` o selector de skills |
| **Genérico / Cualquier LLM** | `specs/commands/omni-*.md` | Pide al agente que lea y ejecute el prompt |

`.agents/skills/` es la ruta de interoperabilidad: la leen Antigravity, Copilot, Codex, Cursor, Kilo y OpenCode. El adaptador `antigravity` produce el árbol más portable.

### Uso como Plugin Nativo en Google Antigravity

OmniSpec incluye un manifiesto `plugin.json` en la raíz para ser consumido como un plugin modular con espacio de nombres en Google Antigravity:

```sh
# Enlaza OmniSpec directamente a tu configuración local de plugins de Antigravity:
npm run sync:plugin
```

Esto expone los 9 comandos de slash, la Constitución y el subagente `omni-auditor` en todos tus proyectos dentro de Antigravity sin necesidad de instalar archivos en cada repositorio.

El manifiesto se mantiene dentro del esquema publicado de Antigravity (`$schema`, `name`, `description`). Los campos que el runtime de Antigravity reconoce pero cuyos nombres no están documentados (icono y prompts sugeridos) viven aparte en `plugin.extra.json` hasta que Google publique el contrato. Tras instalar, `omni-spec plugin install` ejecuta `agy plugin validate --strict --json` cuando la CLI de Antigravity está disponible y falla si el bundle no valida.

Para añadir o cambiar adaptadores en cualquier momento:

```sh
npx omni-spec setup-agent cursor,copilot,claude
```

---

## Referencia del CLI

Puedes ejecutar comandos con el runtime embebido en tu repositorio (`node specs/.omni/runtime/bin/omni-spec.mjs <comando>`) o con `npx omni-spec <comando>`. Mientras 0.7.0 no esté publicada, `npx omni-spec` sin versión ejecuta 0.6.1, que no incluye `guide evidence`, `checks`, `session-record` ni `decision-record`: usa el runtime del proyecto o el tarball del [piloto](docs/PILOT.md).

```sh
# Inspección y diagnóstico
npx omni-spec status                 # Muestra el estado del proyecto y trabajo activo
npx omni-spec doctor                 # Verifica integridad de archivos y adaptadores
npx omni-spec inspect --json         # Muestra tecnologías, módulos y comandos detectados

# Gestión de especificaciones
npx omni-spec create feature auth    # Crea manualmente un nuevo trabajo estructurado
npx omni-spec list                   # Lista todas las especificaciones activas y cerradas
npx omni-spec focus 001              # Enfoca el trabajo activo en la spec 001

# Ceremonia proporcional al cambio
npx omni-spec fit 001                # Pregunta y deriva la ruta: light, standard o full

# Contexto, sesión y decisiones
npx omni-spec context-check          # Estructura y enlaces locales del contexto
npx omni-spec context-record         # Guarda el baseline de entradas de contexto
npx omni-spec session-record --from specs/.omni/inputs/session.json   # Capacidades reales del host
npx omni-spec decision-record --from -   # Decisión/delegación leída de stdin
npx omni-spec guide evidence         # Forma exacta de cada JSON (también: guide setup, guide design)

# Calidad y Verificación
npx omni-spec audit 001              # Audita consistencia de artefactos y placeholders
npx omni-spec checks --from specs/.omni/inputs/checks.json   # Catálogo de checks con ID y cwd por módulo
npx omni-spec configure --gates "npm test"  # Gates heredados desde la raíz
npx omni-spec verify 001             # Ejecuta los checks y liga la evidencia a la huella
npx omni-spec complete 001           # Cierra el trabajo tras comprobar evidencia
npx omni-spec contracts              # Contratos de capacidad vigentes y propuestos
```

### Qué atesta `verify`

`verify` ejecuta los checks aprobados y calcula una huella del proyecto. Quedan fuera las rutas de `.gitignore` (raíz y subcarpetas), `.git/info/exclude`, `.omnispecignore` (misma sintaxis, evaluado al final) y exclusiones por defecto como `node_modules/`, `dist/`, `build/`, `target/`, `coverage/`, `.gradle/`, `.idea/`, `.vscode/`, `test-results/` y `playwright-report/`. Si algo no ignorado cambia mientras corren los checks, la verificación falla y lista las rutas. `complete` solo cierra si nada cambió desde entonces. El contexto queda `STALE` cuando cambian sus entradas (manifiestos, CI, instrucciones de agentes o archivos que cita), no cuando cambia el código.

### Spec Fit: cuánta ceremonia merece un cambio

No todo cambio necesita el ciclo completo. `omni-spec fit` deriva la ruta a partir de un
cuestionario **que se pregunta, no que se infiere**. La clasificación es una heurística
explícita; requiere respuestas sustentadas y puede aumentar el rigor según el riesgo:

| Ruta | Artefactos | Cuándo |
| :--- | :--- | :--- |
| **light** | primario + criterios de aceptación | Cambio pequeño, local, sin ambigüedad y ya cubierto por tests |
| **standard** | + diseño | Cambio pequeño **sin** cobertura de tests existente |
| **full** | + desglose de tareas | ≥3 archivos, varios módulos, cambio de contrato, ambigüedad o razonamiento incompleto |

La ruta se **deriva** de `specs/<slug>/fit.json`; nunca se escribe a mano. Sin `fit.json` se
mantiene la ruta completa. Fit v1 conserva su comportamiento anterior. En v2 se evalúan
también riesgo, incertidumbre y reversibilidad: un cambio crítico puede requerir full aunque
afecte un archivo. Un bugfix light documenta reproducción, causa y regresión en bug.md;
standard añade rca.md y fix.md; full añade el desglose de tareas en fix.md.

---

## Estructura en tu Repositorio

OmniSpec mantiene tu proyecto ordenado bajo un único directorio `specs/`:

```text
├── CONSTITUTION.md             # Reglas, estilo e invariantes innegociables del proyecto
└── specs/
    ├── project-context.md      # Arquitectura, decisiones y comandos reales verificados
    ├── manifest.json           # Estado del framework, spec activa e historial
    ├── project-state.json      # Baseline de contexto, sesiones y decisiones
    ├── checks.json             # Catálogo de checks aprobados (ID, cwd, timeout, tipo)
    ├── .gitignore              # Sección administrada para estado local (logs, backups, inputs)
    ├── _templates/             # Plantillas editables por arquetipo
    ├── 001-nombre-del-trabajo/ # Espacio de trabajo de la spec activa
    │   ├── spec.md             # Requerimientos y criterios de aceptación
    │   ├── fit.json            # Respuestas del Spec Fit; de ellas se deriva la ruta
    │   ├── plan.md             # Diseño arquitectónico y estrategia de tests
    │   ├── tasks.md            # Tareas atómicas con checkboxes
    │   ├── acceptance.json     # Criterios vinculados a evidencia verificable
    │   └── verification.md     # Snapshot de validación y resultados de gates
    └── .omni/
        ├── runtime/            # Motor CLI portable independiente
        └── inputs/             # JSON de entrada para --from (ignorado por Git)
```

---

## Actualización Segura de Versiones

Cuando salga una nueva versión de OmniSpec, actualiza tu proyecto sin perder tus especificaciones, tu constitución ni tu contexto:

```sh
# Previsualiza qué archivos cambiarían (modo seguro):
npx omni-spec update --dry-run

# Aplica la actualización de plantillas y adaptadores:
npx omni-spec update
```

> **Garantía de Preservación:** `update` nunca sobreescribe tu `CONSTITUTION.md`, tus especificaciones activas ni `specs/project-context.md`. Las personalizaciones en archivos gestionados bloquean la actualización hasta revisarlas; con `--accept-updates` se respaldan en `specs/.omni/backups/`. Si tu constitución difiere de la guía actual, `update` deja `specs/.omni/reference/CONSTITUTION.md` para compararla.

---

## Estado del Proyecto & Visión

OmniSpec nace como una iniciativa personal con el propósito de contar con un framework de *Spec-Driven Development* verdaderamente adaptable a cualquier necesidad, stack tecnológico y agente de IA, sin ataduras a dependencias externas ni flujos rígidos.

El proyecto se encuentra en **desarrollo activo continuo**. De forma constante se revisan optimizaciones, refinamientos ergonómicos y nuevas capacidades para elevar la precisión del código generado por agentes. Cualquier sugerencia, reporte o caso de uso es bienvenido a través de los [issues del repositorio](https://github.com/brahiandres1999-oss/omni-spec/issues).

---

## Documentación

- [Notas de la versión 0.7.0-rc.2](docs/releases/0.7.0-rc.2.md) · [0.7.0-rc.1](docs/releases/0.7.0-rc.1.md) · [0.6.1](docs/releases/0.6.1.md) · [0.6.0](docs/releases/0.6.0.md)
- [Piloto local con el paquete exacto](docs/PILOT.md)
- [Instalación, automatización y recuperación](docs/INSTALLATION.md)
- [Estado del candidato](docs/LOCAL-CANDIDATE-STATUS.md)
- [Entrega, evidencia y formatos](docs/DELIVERY.md)
- [Contrato de Onboarding (/omni-init)](docs/ONBOARDING.md)
- [Estándares de los Adaptadores de Agentes](docs/STANDARDS.md)
- [Matriz de Compatibilidad y Límites](docs/COMPATIBILITY.md)
- [Coordinación Local y Bloqueos](docs/locking.md)
- [Historial de Cambios (CHANGELOG)](CHANGELOG.md)

---

## Licencia

MIT © [OmniSpec Authors](LICENSE)
