<p align="center">
  <img src="assets/omni-spec-banner.svg" alt="OmniSpec Banner" width="100%">
</p>

<p align="center">
  <a href="package.json"><img src="https://img.shields.io/badge/version-0.6.1-blue.svg" alt="Version 0.6.1"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/dependencies-0%20(pure%20node)-green.svg" alt="Zero Dependencies"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D18.19.0-black.svg" alt="Node.js >=18.19.0"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-gray.svg" alt="License MIT"></a>
  <a href="https://github.com/brahiandres1999-oss/omni-spec/actions/workflows/ci.yml"><img src="https://github.com/brahiandres1999-oss/omni-spec/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

---

# OmniSpec 0.6.1

> **Desarrollo Guiado por Especificaciones (SDD) para Agentes de IA.**  
> Escribe especificaciones claras, elimina el código de relleno (*AI slop*) y programa con tu agente favorito sin perder el control ni el contexto entre sesiones.

Inspirado en los principios de **Spec-Kit** y **OpenSpec**, OmniSpec es un framework universal, sin dependencias externas y 100% portable que vive dentro de tu repositorio. Funciona directamente desde el chat de tu editor preferido (Cursor, VS Code, Claude Code, Antigravity y más), soportando instalación directa como **Plugin nativo en Google Antigravity** y subagentes autónomos de auditoría (`omni-auditor`).

---

## ¿Por qué OmniSpec?

Los agentes de IA son rápidos, pero sin un marco estructurado sufren de amnesia de contexto, sobreingeniería en backend (*defensive try/catch traps*, abstracciones prematuras) y clichés visuales genéricos en frontend (*card-itis*, degradados morados, estados vacíos rotos).

OmniSpec resuelve esto con un ciclo de ingeniería riguroso:

- **Cero AI Slop (Calidad Senior al Primer Pase):** Inyecta reglas innegociables de UI/UX (jerarquía tipográfica, micro-interacciones, WCAG AA, 4 estados obligatorios: carga, error, vacío y éxito) y de backend pragmático (YAGNI, fail-fast, sin comentarios obvios).
- **Zero Dependencies & Zero Lock-in:** 100% Node.js nativo (>=18.19.0). No instala paquetes npm pesados ni altera el runtime de proyectos en Python, Go, Rust, Java o TypeScript.
- **Universal Multi-Agent:** Un único comando configura Cursor, GitHub Copilot, Claude Code, Google Antigravity, OpenCode, Kilo, Codex o cualquier LLM con soporte Markdown.
- **Verificación Basada en Evidencia:** Nada se marca como terminado sin validación real: gates ejecutados, snapshots contra regresiones y criterios de aceptación vinculados (`acceptance.json`).

---

## Inicio Rápido (60 segundos)

### 1. Inicializa OmniSpec en tu repositorio

Ejecuta directamente con `npx` (sin necesidad de instalación global):

```sh
# Inicializa para tu editor preferido:
npx omni-spec init --agent cursor       # Cursor
npx omni-spec init --agent copilot      # VS Code (GitHub Copilot)
npx omni-spec init --agent claude       # Claude Code
npx omni-spec init --agent antigravity  # Google Antigravity
npx omni-spec init --agent all          # Configura todos los editores soportados
```

*(O instálalo globalmente con `npm install -g omni-spec` si prefieres el comando `omni-spec` directo).*

### 2. Reconoce el proyecto desde el chat

Abre tu editor y escribe en el chat de tu agente:

```text
/omni-init
```

El agente escaneará la arquitectura, comandos reales de test/build y convenciones de tu código, generando `specs/project-context.md` sin tocar tu código ni inventar dependencias.

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

OmniSpec genera adaptadores nativos para cada entorno sin dependencias propietarias:

| Agente / Editor | Archivos generados | Cómo se invoca |
| :--- | :--- | :--- |
| **Cursor** | `.cursor/commands/omni-*.md` + regla de proyecto | `/omni-init` en Cursor Composer / Chat |
| **VS Code (GitHub Copilot)** | `.github/prompts/omni-*.prompt.md` + instrucciones | `/omni-init` en Chat de Copilot |
| **Claude Code** | `.claude/skills/omni-*/SKILL.md` | `/omni-init` en Claude CLI |
| **Google Antigravity** | `.agents/skills/omni-*/SKILL.md` o Plugin nativo | `/omni-init` o gestor `/plugin` |
| **Kilo / OpenCode** | `.kilo/` o `.opencode/` + bloque en `AGENTS.md` | `/omni-init` en consola interactiva |
| **Gemini CLI** | `.gemini/commands/omni-*.toml` | `/omni-init` en Gemini Code Assist |
| **Codex** | `.agents/skills/omni-*/SKILL.md` | `$omni-init` o selector de skills |
| **Genérico / Cualquier LLM** | `specs/commands/omni-*.md` | Pide al agente que lea y ejecute el prompt |

### Uso como Plugin Nativo en Google Antigravity

OmniSpec incluye un manifiesto `plugin.json` en la raíz para ser consumido como un plugin modular con espacio de nombres en Google Antigravity:

```sh
# Enlaza OmniSpec directamente a tu configuración local de plugins de Antigravity:
npm run sync:plugin
```

Esto expone los 9 comandos de slash, la Constitución y el subagente `omni-auditor` en todos tus proyectos dentro de Antigravity sin necesidad de instalar archivos en cada repositorio.

Para añadir o cambiar adaptadores en cualquier momento:

```sh
npx omni-spec setup-agent cursor,copilot,claude
```

---

## Referencia del CLI

Puedes ejecutar comandos directamente con `npx omni-spec <comando>` o mediante el runtime embebido en tu repositorio (`node specs/.omni/runtime/bin/omni-spec.mjs <comando>`):

```sh
# Inspección y diagnóstico
npx omni-spec status                 # Muestra el estado del proyecto y trabajo activo
npx omni-spec doctor                 # Verifica integridad de archivos y adaptadores
npx omni-spec inspect --json         # Muestra tecnologías, módulos y comandos detectados

# Gestión de especificaciones
npx omni-spec create feature auth    # Crea manualmente un nuevo trabajo estructurado
npx omni-spec list                   # Lista todas las especificaciones activas y cerradas
npx omni-spec focus 001              # Enfoca el trabajo activo en la spec 001

# Calidad y Verificación
npx omni-spec audit 001              # Audita consistencia de artefactos y placeholders
npx omni-spec configure --gates "npm test"  # Configura los gates de calidad obligatorios
npx omni-spec verify 001             # Ejecuta los gates y genera el snapshot de evidencia
npx omni-spec complete 001           # Cierra el trabajo tras comprobar evidencia
```

---

## Estructura en tu Repositorio

OmniSpec mantiene tu proyecto ordenado bajo un único directorio `specs/`:

```text
├── CONSTITUTION.md             # Reglas, estilo e invariantes innegociables del proyecto
└── specs/
    ├── project-context.md      # Arquitectura, decisiones y comandos reales verificados
    ├── manifest.json           # Estado del framework, spec activa e historial
    ├── _templates/             # Plantillas editables por arquetipo
    ├── 001-nombre-del-trabajo/ # Espacio de trabajo de la spec activa
    │   ├── spec.md             # Requerimientos y criterios de aceptación
    │   ├── plan.md             # Diseño arquitectónico y estrategia de tests
    │   ├── tasks.md            # Tareas atómicas con checkboxes
    │   ├── acceptance.json     # Criterios vinculados a evidencia verificable
    │   └── verification.md     # Snapshot de validación y resultados de gates
    └── .omni/
        └── runtime/            # Motor CLI portable independiente
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

> **Garantía de Preservación:** `update` nunca sobreescribe tu `CONSTITUTION.md`, tus especificaciones activas ni `specs/project-context.md`. Si hay personalizaciones en plantillas gestionadas, OmniSpec genera un respaldo automático en `specs/.omni/backups/`.

---

## Estado del Proyecto & Visión

OmniSpec nace como una iniciativa personal con el propósito de contar con un framework de *Spec-Driven Development* verdaderamente adaptable a cualquier necesidad, stack tecnológico y agente de IA, sin ataduras a dependencias externas ni flujos rígidos.

El proyecto se encuentra en **desarrollo activo continuo**. De forma constante se revisan optimizaciones, refinamientos ergonómicos y nuevas capacidades para elevar la precisión del código generado por agentes. Cualquier sugerencia, reporte o caso de uso es bienvenido a través de los [issues del repositorio](https://github.com/brahiandres1999-oss/omni-spec/issues).

---

## Documentación

- [Notas de la versión 0.6.0 (Plugin Antigravity & Subagentes)](docs/releases/0.6.0.md)
- [Notas de la versión 0.5.1](docs/releases/0.5.1.md)
- [Contrato de Onboarding (/omni-init)](docs/ONBOARDING.md)
- [Estándares de los Adaptadores de Agentes](docs/STANDARDS.md)
- [Matriz de Compatibilidad y Límites](docs/COMPATIBILITY.md)
- [Coordinación Local y Bloqueos](docs/locking.md)
- [Historial de Cambios (CHANGELOG)](CHANGELOG.md)

---

## Licencia

MIT © [OmniSpec Authors](LICENSE)
