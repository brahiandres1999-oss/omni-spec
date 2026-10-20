<p align="center">
  <img src="assets/omni-spec-banner.svg" alt="OmniSpec Banner" width="100%">
</p>

<p align="center">
  <a href="package.json"><img src="https://img.shields.io/badge/version-0.5.1-blue.svg" alt="Version 0.5.1"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/dependencies-0%20(pure%20node)-green.svg" alt="Zero Dependencies"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D18.19.0-black.svg" alt="Node.js >=18.19.0"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-gray.svg" alt="License MIT"></a>
  <a href="https://github.com/brahiandres1999-oss/omni-spec/actions/workflows/ci.yml"><img src="https://github.com/brahiandres1999-oss/omni-spec/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

# OmniSpec 0.5.1

Desarrollo guiado por especificaciones desde el chat de tu agente, con un motor CLI local y sin dependencias npm externas. Requiere Node.js >=18.19.0 y un agente capaz de leer archivos y ejecutar comandos.

**Versión 0.5.1.** Base de desarrollo con instalación por proyecto, nueve flujos, precisión de primer pase (anti-slop backend y frontend) y verificación explícita. Consulta las [notas de versión](docs/releases/0.5.1.md), [compatibilidad y límites](docs/COMPATIBILITY.md) y [fuentes de los adaptadores](docs/STANDARDS.md).

OmniSpec ayuda a reconocer el repositorio, explorar ideas, definir cambios, corregir fallos y conservar decisiones entre sesiones. Separa hechos, hipótesis y preguntas; comprueba estructura documental y exige evidencia antes de cerrar trabajo. No garantiza ausencia de alucinaciones ni certifica cumplimiento regulatorio.

## Contenido

- [Instalar en un proyecto](#instalar-en-un-proyecto)
- [Recorridos desde el chat](#recorridos-desde-el-chat)
- [Agentes y sintaxis](#agentes-y-sintaxis)
- [CLI y evidencia](#cli-y-evidencia)
- [Archivos y actualización](#archivos-y-actualización)
- [Desarrollo y comprobación](#desarrollo-y-comprobación)

## Instalar en un proyecto

El repositorio GitHub se mantiene **privado**. Con una cuenta que tenga acceso, descarga el `.tgz` y su checksum desde la release. Después puedes usar `npx` con el archivo descargado, sin instalar el CLI globalmente. Ejecuta en la raíz del proyecto destino:

```sh
npx --yes --package="/ruta/al/omni-spec-0.5.1.tgz" omni-spec init --yes --agent antigravity
```

Después de la primera publicación del mantenedor en **npm**, también estarán disponibles estos comandos (GitHub y npm son publicaciones separadas):

```sh
# Ejecución puntual desde npm
npx --yes omni-spec@0.5.1 init --yes --agent antigravity

# Instalación global opcional desde npm
npm install --global omni-spec@latest
omni-spec init --yes --agent antigravity
```

`npx` ejecuta paquetes; el registro donde se publica es npm. La versión normal usa el canal `latest`; las candidatas futuras usarán `next`. El alta y primera publicación están explicadas en [RELEASING.md](docs/RELEASING.md).

Antes de publicar en npm también puedes instalar globalmente el archivo descargado: `npm install --global /ruta/al/omni-spec-0.5.1.tgz`. Un enlace de descarga de un repositorio privado no permite instalación anónima; no incluyas credenciales en URLs o comandos compartidos.

Para probar esta copia local, abre una terminal **en el proyecto destino**, nuevo o existente:

```sh
node "/ruta/absoluta/omni-spec/bin/omni-spec.mjs" init --yes --agent antigravity
```

También puedes instalar el tarball local en un proyecto npm:

```sh
npm install --save-dev /ruta/absoluta/omni-spec-0.5.1.tgz
npx --no-install omni-spec init --yes --agent antigravity
```

`init` copia un runtime independiente dentro del proyecto. No necesitas instalar OmniSpec globalmente ni convertir una aplicación Python, Java u otro stack en una aplicación Node. Después del bootstrap:

```sh
node specs/.omni/runtime/bin/omni-spec.mjs status
node specs/.omni/runtime/bin/omni-spec.mjs doctor
node specs/.omni/runtime/bin/omni-spec.mjs context-check --json
```

Abre el proyecto en Antigravity, revisa las skills disponibles y ejecuta:

```text
/omni-init
```

La skill revisa el entorno y completa el contexto con evidencia. En un proyecto vacío ayuda a aclarar objetivos; en uno existente reconoce convenciones, comandos y fallos previos; en uno desconocido registra las dudas sin inventar un stack o runner de pruebas. Puede ser necesario recargar el proyecto para que el agente descubra archivos nuevos. Consulta las instrucciones de tu versión del agente.

`/omni-init` se usa solo, sin un prompt de auditoría adicional. Su alcance predeterminado es leer el repositorio y actualizar `specs/project-context.md`; conserva el código, las decisiones existentes y la configuración de gates. Distingue hechos observados, requisitos declarados, inferencias y resultados ejecutados. No instala dependencias, inicia servicios ni ejecuta scripts de la aplicación durante ese reconocimiento.

El contexto registra fuentes, módulos, objetivos, comandos con directorio y prerrequisitos, requisitos de calidad, cambios previos y pendientes. Los comandos detectados quedan `NOT_RUN`; un runtime de CI no demuestra una versión mínima compatible y una política de accesibilidad no demuestra cumplimiento. `CONTEXT_RECORDED` significa reconocimiento documentado; la aplicación continúa `APPLICATION_NOT_VALIDATED` si no hay resultados ejecutados. En proyectos nuevos con objetivos sin resolver, mantiene `CONTEXT_PENDING` y pregunta solo lo material. Consulta el [contrato de onboarding](docs/ONBOARDING.md).

El agente compara declaraciones por módulo/entorno y registra discrepancias pendientes sin elegir una fuente por suposición. La respuesta final conserva esas limitaciones. Antes de terminar ejecuta `context-check`: revisa estados y enlaces locales del contexto, incluidos archivos y líneas inexistentes o rutas específicas de una computadora. Es una comprobación estructural; el agente también debe comprobar que cada pasaje citado respalda la afirmación. Los enlaces guardados son relativos al documento para funcionar al mover el proyecto.

El bootstrap CLI instala la skill; `/omni-init` realiza el onboarding conversacional después. Un comando no puede aparecer antes de instalar su integración.

## Recorridos desde el chat

| Comando lógico | Propósito |
| --- | --- |
| `omni-init` | Reconocer o revisar el proyecto, sus restricciones y comandos reales. |
| `omni-discuss` | Encontrar, explicar, comparar o proponer con evidencia; una consulta puede terminar sin crear archivos. |
| `omni-specify` | Formalizar una necesidad en feature, bugfix, debt o RFC. |
| `omni-clarify` | Resolver decisiones que afectan al resultado antes de diseñar. |
| `omni-plan` | Diseñar una solución proporcional y su verificación. |
| `omni-tasks` | Crear tareas desde el alcance; no impone capas, bases de datos ni 32 tareas prefabricadas. |
| `omni-audit` | Ejecutar controles documentales y revisar coherencia entre artefactos. |
| `omni-implement` | Implementar el trabajo acordado y registrar resultados reales. |
| `omni-converge` | Contrastar criterios con el resultado, verificar y cerrar si corresponde. |

Ejemplos en Antigravity:

```text
/omni-discuss Encuentra dónde se decide el precio y explica qué opciones tenemos para aplicar descuentos.
/omni-specify Corrige el error al guardar un usuario sin segundo apellido.
/omni-clarify
/omni-plan
/omni-tasks
/omni-audit
/omni-implement
/omni-converge
```

La discusión solo se transforma en trabajo de implementación cuando ese es el objetivo solicitado. No se exige una especificación para cada pregunta. La aclaración temprana no exige tener plan y tareas terminados.

| Tipo | Artefactos | Cierre |
| --- | --- | --- |
| `feature` (`feat`) | `spec.md`, `plan.md`, `tasks.md` | Criterios, tareas y verificación. |
| `bugfix` (`bug`, `fix`) | `bug.md`, `rca.md`, `fix.md` con checklist | Reproducción, causa sustentada, arreglo y regresión. |
| `debt` | `audit.md`, `migration-plan.md`, `tasks.md` | Mejora con comportamiento requerido preservado. |
| `rfc` (`idea`) | `rfc.md` | Decisión ACCEPTED, REJECTED o DEFERRED; no exige código. |

Todos usan `verification.md` para vincular criterios y evidencia, y `acceptance.json` para registrar cada criterio con ID, estado, método y evidencia específica. `verify` y `complete` rechazan criterios pendientes, fallidos, omitidos o inventados aunque los gates generales pasen. Las plantillas dejan pendientes explícitos; el agente debe reemplazarlos con decisiones reales. La veracidad de la evidencia sigue requiriendo revisión: una inspección de código no demuestra por sí sola una interacción, un contraste medido ni compatibilidad universal.

## Agentes y sintaxis

Las ubicaciones se contrastaron con documentación oficial el 2026-10-18. Las pruebas locales comprueban archivos y contenido; la compatibilidad de cada versión del host necesita una prueba en su chat.

| `--agent` | Archivos generados | Invocación |
| --- | --- | --- |
| `antigravity` | `.agents/skills/omni-*/SKILL.md` | `/omni-init` |
| `cursor` | `.cursor/commands/omni-*.md` y regla | `/omni-init` |
| `claude` | `.claude/skills/omni-*/SKILL.md` | `/omni-init` |
| `copilot` | `.github/prompts/omni-*.prompt.md` e instrucciones | `/omni-init` en VS Code Chat |
| `kilo` | `.kilo/commands/omni-*.md` y bloque en `AGENTS.md` | `/omni-init` |
| `opencode` | `.opencode/commands/omni-*.md` y bloque en `AGENTS.md` | `/omni-init` |
| `gemini` | `.gemini/commands/omni-*.toml` | `/omni-init` |
| `codex` | `.agents/skills/omni-*/SKILL.md` y bloque en `AGENTS.md` | `$omni-init` o selector de skills |
| `generic` | `specs/commands/omni-*.md` | Pedir al agente que lea y siga ese archivo; no registra un slash nativo. |

`--agent all` instala los adaptadores concretos. Se pueden seleccionar varios separados por comas. Un nombre desconocido es un error; no se anuncia compatibilidad por haber escrito cero archivos. Copilot en otros hosts no queda certificado por el adaptador de VS Code.

```sh
node specs/.omni/runtime/bin/omni-spec.mjs setup-agent antigravity,cursor
```

La selección se persiste para futuras actualizaciones. Cambiarla no borra configuraciones anteriores. Antigravity y Codex comparten el formato de skills. Ningún adaptador configura un modelo, claves, permisos amplios o instalaciones globales.

## CLI y evidencia

```sh
omni-spec inspect --json
omni-spec create feature gestion-usuarios
omni-spec list
omni-spec focus 001
omni-spec audit 001
omni-spec configure --gates "node check.cjs"
omni-spec verify 001
omni-spec complete 001
```

Estos ejemplos presuponen un binario disponible; el runtime local funciona siempre con `node specs/.omni/runtime/bin/omni-spec.mjs` en su lugar. Desde subdirectorios, el CLI resuelve el manifiesto del proyecto padre.

- `inspect`: inventario sin ejecutar scripts. Recorre hasta tres niveles y 200 directorios; detecta manifiestos comunes y comandos candidatos. No pretende comprender cualquier framework automáticamente.
- `audit`: revisa artefactos, placeholders, estructura y checklist. No ejecuta pruebas ni demuestra corrección semántica.
- `configure --gates`: guarda comandos revisados y actualiza la sección de gates de la constitución. Un argumento vacío los elimina explícitamente. Los comandos se separan por saltos de línea y se ejecutan cada uno desde la raíz; `&&` se conserva dentro de cada comando.
- `verify`: requiere auditoría aprobada, tareas terminadas y evidencia escrita. **Ejecuta los comandos configurados mediante el shell del sistema**; revísalos antes de ejecutarlos. Registra resultados en `verification.json`; no instala runners faltantes.
- `verify --manual "motivo específico"`: solo cuando no hay gates configurados. Registra evidencia manual, no un éxito de pruebas automáticas. Una RFC registra una decisión revisada.
- `complete`: rechaza auditorías fallidas, tareas pendientes, evidencia ausente, pruebas fallidas y cambios posteriores al snapshot verificado.
- `check` / `doctor`: revisan versión e integridad de archivos gestionados. No prueban el chat del agente ni la aplicación.

La verificación compara contenidos de fuente y especificación antes/después y al cerrar. Excluye dependencias, cachés y salidas habituales (`node_modules`, `.git`, `dist`, `build`, etc.); consulta la lista en `src/verification.mjs`. Tiene límites de 20.000 archivos y 256 MiB y rechaza fuentes enlazadas mediante symlinks. Los archivos de evidencia son locales y editables: esto detecta deriva accidental, no constituye una firma o protección contra manipulación deliberada. Las pruebas solo demuestran lo que comprueban.

## Archivos y actualización

```text
CONSTITUTION.md                 Reglas del proyecto, preservadas al actualizar
specs/project-context.md         Contexto y decisiones del usuario/agente
specs/manifest.json              Configuración, foco e historial
specs/_templates/                Plantillas editables con detección de conflictos
specs/<id>-<nombre>/             Artefactos, tareas y evidencia de cada trabajo
specs/.omni/runtime/             CLI portable y esquema local
specs/.omni/managed.json         Huellas de archivos gestionados
specs/.omni/backups/             Respaldos al aceptar reemplazos
```

Para migrar usa el CLI de la **versión nueva** desde el proyecto destino:

```sh
node "/ruta/al/nuevo/omni-spec/bin/omni-spec.mjs" update --dry-run
node "/ruta/al/nuevo/omni-spec/bin/omni-spec.mjs" update
```

La vista previa lista archivos y conflictos sin escribir. Si hay cambios locales o archivos antiguos de propiedad desconocida, la actualización se bloquea conservándolos. Después de revisar:

```sh
node "/ruta/al/nuevo/omni-spec/bin/omni-spec.mjs" update --accept-updates
```

Esa opción respalda los archivos en conflicto antes de reemplazarlos. Las especificaciones activas, la constitución y el contexto no se reemplazan. Los comandos antiguos de otros adaptadores se conservan; revisa posibles duplicados en el selector del host al migrar. `init --force` reemplaza expresamente constitución y plantillas y no es el mecanismo habitual de actualización.

Las copias de desarrollo que ya indiquen `0.5.0` también reciben los archivos actuales con `update`: se comparan sus contenidos aunque coincida la versión. Los trabajos completados siguen en el historial; solo si se vuelven a verificar deben adaptar sus criterios a `acceptance.json`.

Una versión antigua instalada dentro del proyecto no descarga una nueva versión por sí misma. Las actualizaciones son locales y explícitas. No se hacen commits, cambios de rama ni publicaciones.

## Desarrollo y comprobación

```sh
npm test
npm run test:package
```

La segunda orden empaqueta, instala sin red ni scripts de instalación y ejecuta recorridos contra el paquete, no contra imports del código fuente del CLI. Conserva sus proyectos temporales y muestra dónde están para inspección.

La publicación de etiquetas valida la matriz de CI antes de crear la release y adjunta un tarball con SHA-256. El alcance comprobado y las limitaciones están en [COMPATIBILITY.md](docs/COMPATIBILITY.md). Ver [RELEASING.md](docs/RELEASING.md), [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md) y [coordinación local](docs/locking.md).
