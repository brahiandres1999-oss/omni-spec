# Instalación y primera entrega al agente

Este contrato corresponde a [0.8.0 Preview](releases/0.8.0-preview.2.md), versión `0.8.0-preview.2`, en preparación para publicación. Se distribuirá mediante el canal npm `preview`; no sustituye a la versión normal en `latest`. Para probar los bytes actuales utiliza el tarball de [PILOT](PILOT.md); `latest` todavía corresponde a 0.6.1 (consultado el 2026-10-28).

## Punto de entrada

Para el candidato actual, desde la carpeta destino:

```sh
npm exec --offline --yes --package "/ruta/al/omni-spec-0.8.0-preview.2.tgz" -- omni-spec init
```

Con Node.js >=22.19.0, abre una terminal en la carpeta del proyecto y, cuando la Preview esté publicada, ejecuta:

```sh
npx --yes omni-spec@preview init
```

El primer `--yes` es de npm: acepta obtener el paquete, pero no contesta las preguntas de OmniSpec. No elige tecnologías ni aprueba publicación. No hace falta instalar globalmente.

El mismo recorrido sirve para cualquier nivel de experiencia:

1. Elegir inglés o español, salvo que ya se haya indicado `--lang en|es` o exista un idioma guardado.
2. Leer la carpeta de destino y el estado detectado: carpeta nueva, archivos existentes o instalación previa.
3. Elegir la herramienta con IA, salvo argumento `--agent` o selección existente. En la interfaz visual, usar flechas y Espacio para marcar una o varias; Enter confirma y Ctrl+A selecciona las integraciones concretas. La opción genérica es exclusiva. En modo de texto se aceptan nombres separados por comas, `all` o `generic`. `plugin` se declara explícitamente para usuarios del plugin global de Antigravity; init no instala ese plugin global.
4. Si un módulo del proyecto presenta señal de interfaz de usuario (Tailwind CSS, un framework de UI, `components.json` o un kit reconocido), no hay una selección de UI guardada y no se indicó el flag `--ui-components`, elegir el kit de componentes (`shadcn`, `radix`, `headlessui`, `preline`, `flyonui` o `none`). Sin señal, o al reinicializar con una selección guardada, este paso se omite. El flag sustituye el campo indicado; sin valor guardado, se usa el primer kit detectado o `none`.
5. Confirmar la preparación de esa carpeta. Las respuestas inválidas se vuelven a preguntar; cancelar o cerrar la entrada antes de confirmar no escribe archivos de instalación.
6. Instalar runtime, plantillas, contexto inicial e integración; comprobar los archivos administrados y la versión local.
7. Abrir la misma carpeta en la herramienta elegida y utilizar la invocación mostrada por el instalador.

No se pregunta stack, estándar de documentación, perfil regulatorio ni quality gates durante este recorrido. Esas decisiones requieren conocer el proyecto y se discuten con el agente. El nombre inicial se deriva de la carpeta; puede declararse con `--name`. Las declaraciones `--stack`, `--doc`, `--profile`, `--gates` y `--ui-components` (`shadcn`, `radix`, `headlessui`, `preline`, `flyonui`, `none`) siguen disponibles y se muestran antes de confirmar. No se ejecuta el texto de esos checks durante la instalación.

## Componentes y Guía de Interfaz (`guide design`)

OmniSpec 0.8 no requiere ni distribuye *companions* externos de terceros. La arquitectura visual se gobierna mediante la selección del kit de componentes (`--ui-components`) y la guía de diseño del sistema (`specs/resources/design.md` accesible vía `omni-spec guide design` o `/omni-guide design`).

`--ui-components` acepta `shadcn`, `radix`, `headlessui`, `preline`, `flyonui` o `none`. Funciona con `init --yes` aunque el proyecto todavía no tenga dependencias de UI. La selección queda registrada en `manifest.ui.components` y se conserva al repetir `init` sin nuevos flags.

La guía de diseño oficial (`guide design`) establece el estándar de artesanía visual:
- **4 Estados Obligatorios**: Toda vista interactiva debe contemplar explícitamente *Loading* (skeletons con CLS = 0), *Empty* (explicación y CTA claro), *Error* (mensaje amigable con reintento) y *Protected* (estado restringido o sin permisos).
- **Anti-Cliché & Tipografía Deliberada**: Prohibidos los degradados azul/púrpura genéricos, resplandores difusos artificiales y el anidamiento excesivo de tarjetas con sombras (*card-itis*). Se prioriza la jerarquía mediante tipografía y whitespace.
- **Tokens Semánticos y Accesibilidad**: Contraste WCAG 2.1 AA medible, paletas de color con roles funcionales y soporte completo de navegación por teclado y lectores de pantalla.

## Terminales, agentes y automatización

Con entrada interactiva, OmniSpec hace las mismas preguntas aunque se lance desde una terminal del editor o desde un agente. No infiere capacidades de la sesión ni utiliza claves de proveedores.

La interfaz de terminal utiliza un logo estático de caracteres con las mismas superficies isométricas, orden de dibujo y colores del logo ASCII de OmniPage, una pregunta activa y selección con teclado. Su densidad se adapta al espacio disponible, hasta 69 columnas por 27 filas; al reducir la fuente del terminal habrá más celdas para representarlo. El tamaño de la fuente depende del terminal. La geometría se vuelve a muestrear en cada tamaño, sin eliminar filas del dibujo original. Se omite el logo en pantallas pequeñas para mantener legibles las opciones. La lista muestra una ventana alrededor de la opción enfocada cuando no cabe completa. Esc o Ctrl+C cancelan antes de instalar; se restauran cursor y modo de entrada. El resultado final queda en el historial, agrupado por instalación, siguiente paso, recuperación y alcance. Los estados de progreso corresponden a operaciones reales, sin porcentajes estimados ni pausas de presentación.

Si el destino, las declaraciones o los avisos ocupan más espacio, PgUp/PgDn permite recorrer sus líneas completas. Las opciones de confirmar o cancelar y la ayuda permanecen visibles; el contador indica qué parte de los detalles se está mostrando.

La interfaz visual requiere entrada y salida TTY y un tamaño mínimo de 40 columnas por 18 filas. `--plain`, `TERM=dumb`, CI o salida redirigida usan texto por líneas. `NO_COLOR` desactiva colores sin cambiar el recorrido. `--json` conserva JSON sin controles ANSI. No se modifica el historial anterior ni se requieren paquetes de UI externos.

```sh
npx --yes omni-spec@preview init --plain
```

Si no hay entrada disponible, falla con instrucciones concretas antes de instalar. Para ejecución desatendida:

```sh
npx --yes omni-spec@preview init --yes --agent codex --lang es
npx --yes omni-spec@preview init --yes --agent cursor,claude --lang es
npx --yes omni-spec@preview init --yes --agent generic --lang es --json
```

El segundo `--yes` es de OmniSpec y acepta preparar la carpeta con los datos declarados. Sin `--agent`, el modo automático conserva la integración existente o usa `generic`; no selecciona silenciosamente un host. `--json` requiere `init --yes` para que la salida no se mezcle con preguntas. La salida incluye `installation` con `FILES_READY`, integridad `PASSED`, `agentDiscovery: NOT_CHECKED`, `projectOnboarding: PENDING`, versión, idioma, invocaciones y ruta de recuperación.

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

`specs/manifest.lock/` vacío es normal: solo contiene tickets temporales mientras un comando modifica el estado y vuelve a quedar vacío al terminar. No es un archivo de configuración ni algo que deba rellenar el usuario. La exclusión de Git y el mecanismo de concurrencia se conservan; ver [locking](locking.md). `clean` retira únicamente la definición administrada del auditor junto a las skills/runtime de OmniSpec y actualiza la entrada al plugin; conserva agentes propios y archivos personalizados.

`specs/.omni/runtime/` tampoco se versiona: la sección administrada de `specs/.gitignore` lo excluye, y en un clon se restaura con `npx omni-spec@<versión de specs/manifest.json> update` (no con `init`). Restaurar requiere el paquete de esa versión: normalmente del registro npm, aunque también sirven la caché de npm o un tarball local. Mientras falte, el agente puede usar `npx omni-spec@<versión>`. Una CI que ejecute `node specs/.omni/runtime/bin/omni-spec.mjs` debe restaurarlo en un paso previo. Ver [compatibilidad](COMPATIBILITY.md#actualizaciones).

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
