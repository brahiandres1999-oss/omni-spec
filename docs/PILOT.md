# Piloto de OmniSpec 0.8.0 Preview — 0.8.0-preview.1

Usa una carpeta nueva y vacía para empezar un proyecto desde cero, o una copia controlada de otro proyecto si prefieres evaluar su evolución. Conserva el proyecto anterior como referencia: no lo borres ni lo sobrescribas para preparar la prueba. Trabaja fuera de carpetas sincronizadas (OneDrive, Dropbox), que pueden bloquear archivos mientras OmniSpec los reemplaza. El [estado de la próxima versión](releases/0.8.0-preview.1.md) describe la Preview que se prueba aquí y las validaciones pendientes.

## Preparar el paquete exacto

En PowerShell, comprueba `node --version`; el mínimo es 22.19.0. Ese requisito es del CLI y no elige el stack de la aplicación: el agente debe investigarlo con fuentes oficiales, explicarte las opciones y registrar tu aprobación o delegación.

Genera el tarball desde el repositorio de OmniSpec, fuera de él, y anota su SHA256. `pack:dev` añade a la versión el sufijo `+dev.<fecha y hora UTC>`, así que cada paquete local se distingue del publicado y de los anteriores:

```powershell
$repo = 'C:\dev\omni-spec' # Cambia esta ruta por tu copia del repositorio candidato
$paquete = npm --prefix $repo run --silent pack:dev $env:TEMP | ConvertFrom-Json
$paqueteOmniSpec = $paquete.package
Get-FileHash -LiteralPath $paqueteOmniSpec -Algorithm SHA256
```

Desde la carpeta nueva del piloto:

```powershell
npm exec --offline --yes --package "$paqueteOmniSpec" -- omni-spec version
npm exec --offline --yes --package "$paqueteOmniSpec" -- omni-spec init --agent claude
node specs/.omni/runtime/bin/omni-spec.mjs version
```

Las dos comprobaciones de versión deben indicar `$paquete.version`, con su sufijo: por ejemplo, `0.8.0-preview.1+dev.20261024T235356Z`. Cambia `--agent claude` por el host que uses (`antigravity`, `cursor`, `copilot`, `codex`, `kilo`, `opencode`, `gemini`). `--yes` en npm solo acepta ejecutar el paquete local; no aprueba decisiones de tecnología ni de producto.

El asistente de `init` pregunta idioma y confirmación de la carpeta. Si omites `--agent`, también pregunta qué herramienta usarás. En una terminal interactiva, usa flechas, Espacio para marcar una o varias integraciones y Enter para continuar; Ctrl+A marca todas las integraciones concretas. La opción genérica es exclusiva. `--plain` usa preguntas por líneas, con nombres separados por comas o `generic` si aún no elegiste. Stack, documentación, perfil y checks ya no se solicitan en el instalador: se revisan con el agente cuando se conoce el objetivo. Una decisión ya tomada puede declararse con argumentos, por ejemplo `--profile healthtech`; es un conjunto de controles a revisar, no una certificación.

Para ejecución sin entrada interactiva usa `omni-spec init --yes --agent claude --lang es`. El `--yes` anterior a `--package` es de npm y no sustituye al de OmniSpec. El resultado comprueba integridad local y muestra una invocación por host; si no aparece la skill, pide al agente que lea la ruta exacta mostrada (`.claude/skills/omni-init/SKILL.md` para Claude o `.agents/skills/omni-init/SKILL.md` para Antigravity). `specs/commands/omni-init.md` conserva una entrada breve a la misma skill. Consulta [INSTALLATION](INSTALLATION.md).

Abre la carpeta en el agente y comprueba que descubre las nueve skills locales. Una copia global anterior (por ejemplo, el plugin 0.6.x en `~/.gemini/config/plugins/omni-spec`) puede tener prioridad según el host. Identifica qué versión se usa y resuelve ese conflicto antes de continuar. El runtime del proyecto (`node specs/.omni/runtime/bin/omni-spec.mjs`) permite ejecutar el motor exacto de forma explícita.

## Recorrido

Si la carpeta ya tiene `0.7.0-rc.1` o `rc.2`, utilizar el [procedimiento de migración a Preview](RELEASING.md#copias-locales-de-070-rc1-o-rc2); con `0.8.0-preview.1` es una subida de versión: basta `update --dry-run` y `update`. El recorrido siguiente parte de una instalación nueva o ya actualizada.

1. Invoca `omni-init` sin añadir un prompt de auditoría. Debe reconocer la carpeta, explicar qué falta, registrar la sesión (`session-record`) y preguntar solo por decisiones materiales, sin implementar la aplicación.
2. Explica el objetivo real de tu proyecto y sus restricciones. Revisa las preguntas, el stack y las versiones con fuentes oficiales actuales; acepta una opción o delega una decisión con alcance. Si falta una herramienta (navegador, web), debe quedar registrado y la validación que depende de ella, pendiente.
3. Pide un primer resultado utilizable. El agente debe convertirlo en criterios con tipo (`AC-01 [functional]`, `AC-02 [visual]`), elegir el rigor con `fit` y acordar una dirección visual con referencias antes de extender pantallas. `guide design` y `guide evidence` vienen incluidos.
4. Durante la implementación revisa una superficie representativa y el recorrido real. El agente configura checks por módulo (`checks --from specs/.omni/inputs/checks.json`), ejecuta `verify` y observa la UI responsive, el teclado y los estados relevantes. Si `verify` informa archivos cambiados durante los checks, deben excluirse en `.gitignore` o `.omnispecignore`; no se repite a ciegas.
5. Revisa el resultado con datos aislados. Un build aprobado no significa que el producto o la UI cumplan los criterios. Una entrega parcial muestra lo pendiente; el cierre exige la evidencia correspondiente.

## Si algo falla

Conserva la solicitud y la respuesta, la versión del host y del modelo, `status --json`, la spec, `acceptance.json` y `verification.json` con su log. No incluyas secretos ni datos personales. Corrige y repite la comprobación afectada; no cambies un criterio para que un defecto pase.

El piloto aporta evidencia para decidir el siguiente paso de la Preview. Registrar los límites y los defectos observados; una corrida no certifica todos los proyectos o hosts. Publicación, promoción de canal y despliegue se deciden por separado.
