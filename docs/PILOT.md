# Piloto local con OmniSpec 0.7.0-rc.2

Usa una carpeta nueva y vacía para empezar IPS desde cero, o una copia controlada de otro proyecto si prefieres evaluar su evolución. Conserva el proyecto anterior como referencia: no lo borres ni lo sobrescribas para preparar la prueba. Trabaja fuera de carpetas sincronizadas (OneDrive, Dropbox), que pueden bloquear archivos mientras OmniSpec los reemplaza.

## Preparar el paquete exacto

En PowerShell, comprueba `node --version`; el mínimo es 22.19.0. Ese requisito es del CLI y no elige el stack de la aplicación: el agente debe investigarlo con fuentes oficiales, explicarte las opciones y registrar tu aprobación o delegación.

Genera el tarball desde el repositorio de OmniSpec, fuera de él, y anota su SHA256:

```powershell
$repo = 'C:\Users\brahi\OneDrive\Escritorio\TdeA\4to semestre\Construccion3\omni-spec'
npm pack $repo --pack-destination $env:TEMP
$paqueteOmniSpec = Join-Path $env:TEMP 'omni-spec-0.7.0-rc.2.tgz'
Get-FileHash -LiteralPath $paqueteOmniSpec -Algorithm SHA256
```

Desde la carpeta nueva del piloto:

```powershell
npm exec --offline --yes --package "$paqueteOmniSpec" -- omni-spec version
npm exec --offline --yes --package "$paqueteOmniSpec" -- omni-spec init --agent claude
node specs/.omni/runtime/bin/omni-spec.mjs version
```

Las dos comprobaciones de versión deben indicar `0.7.0-rc.2`. Cambia `--agent claude` por el host que uses (`antigravity`, `cursor`, `copilot`, `codex`, `kilo`, `opencode`, `gemini`). `--yes` en npm solo acepta ejecutar el paquete local; no aprueba decisiones de tecnología ni de producto.

En el asistente de `init`:

- **Stack:** elige `Undecided / custom stack` (8). El agente lo investigará y te lo propondrá; un preset elegido antes queda escrito en la constitución.
- **Perfil:** si IPS maneja datos de salud, elige `healthtech`. Son controles a revisar, no una certificación.
- **Quality gates:** deja `none`. Los checks se configuran cuando existan comandos reales.

Abre la carpeta en el agente y comprueba que descubre las nueve skills locales. Una copia global anterior (por ejemplo, el plugin 0.6.x en `~/.gemini/config/plugins/omni-spec`) puede tener prioridad según el host. Identifica qué versión se usa y resuelve ese conflicto antes de continuar. El runtime del proyecto (`node specs/.omni/runtime/bin/omni-spec.mjs`) permite ejecutar el motor exacto de forma explícita.

## Recorrido

1. Invoca `omni-init` sin añadir un prompt de auditoría. Debe reconocer la carpeta, explicar qué falta, registrar la sesión (`session-record`) y preguntar solo por decisiones materiales, sin implementar la aplicación.
2. Explica el objetivo real de IPS y sus restricciones. Revisa las preguntas, el stack y las versiones con fuentes oficiales actuales; acepta una opción o delega una decisión con alcance. Si falta una herramienta (navegador, web), debe quedar registrado y la validación que depende de ella, pendiente.
3. Pide un primer resultado utilizable. El agente debe convertirlo en criterios con tipo (`AC-01 [functional]`, `AC-02 [visual]`), elegir el rigor con `fit` y acordar una dirección visual con referencias antes de extender pantallas. `guide design` y `guide evidence` vienen incluidos.
4. Durante la implementación revisa una superficie representativa y el recorrido real. El agente configura checks por módulo (`checks --from specs/.omni/inputs/checks.json`), ejecuta `verify` y observa la UI responsive, el teclado y los estados relevantes. Si `verify` informa archivos cambiados durante los checks, deben excluirse en `.gitignore` o `.omnispecignore`; no se repite a ciegas.
5. Revisa el resultado con datos aislados. Un build aprobado no significa que el producto o la UI cumplan los criterios. Una entrega parcial muestra lo pendiente; el cierre exige la evidencia correspondiente.

## Si algo falla

Conserva la solicitud y la respuesta, la versión del host y del modelo, `status --json`, la spec, `acceptance.json` y `verification.json` con su log. No incluyas secretos ni datos personales. Corrige y repite la comprobación afectada; no cambies un criterio para que un defecto pase.

La aceptación de este piloto decide el siguiente paso. Terminar el piloto no autoriza push, release, publicación en npm ni despliegue: la restricción de trabajo local sigue vigente hasta una instrucción expresa.
