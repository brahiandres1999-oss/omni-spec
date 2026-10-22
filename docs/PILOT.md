# Piloto local con OmniSpec 0.7.0-rc.1

Usar una carpeta nueva y vacía para empezar IPS desde cero, o una copia controlada de otro proyecto si se prefiere evaluar evolución. Conservar el proyecto anterior como referencia; no borrar ni sobrescribirlo para preparar esta prueba. El piloto lo ejecuta el usuario, después de elegir dónde trabajar.

## Comprobar el candidato

En PowerShell, comprobar `node --version`. El mínimo de este candidato es 22.19.0. Este requisito del CLI no selecciona el stack de la aplicación: el agente debe investigarlo con fuentes oficiales, explicar opciones y conservar aprobación o delegación real.

El paquete preparado está en `.research/pilot/omni-spec-0.7.0-rc.1.tgz` dentro del repositorio de OmniSpec. Su SHA256 es:

```text
252afeccd89ca59dd4eb5d31c0dea72ac62110b83c4dffc29135a07e0bd6ce6d
```

Desde la carpeta nueva elegida para el piloto, ejecutar:

```powershell
$paqueteOmniSpec = 'C:\Users\brahi\OneDrive\Escritorio\TdeA\4to semestre\Construccion3\omni-spec\.research\pilot\omni-spec-0.7.0-rc.1.tgz'
Get-FileHash -LiteralPath $paqueteOmniSpec -Algorithm SHA256
npm exec --offline --yes --package "$paqueteOmniSpec" -- omni-spec version
npm exec --offline --yes --package "$paqueteOmniSpec" -- omni-spec init --agent antigravity
node specs/.omni/runtime/bin/omni-spec.mjs version
```

Ambas comprobaciones de versión deben indicar `0.7.0-rc.1`. `--yes` en npm acepta instalar el paquete local para ejecutar el CLI; no aprueba decisiones de tecnología ni de producto. `init` pregunta sus opciones de instalación. Si se elige Codex u otro host, cambiar `--agent antigravity` por el adaptador correspondiente antes de instalar. Consultar la ayuda del paquete cuando sea necesario.

Abrir la carpeta en el agente elegido y comprobar que descubre las nueve skills locales. Una copia global anterior del plugin puede prevalecer según el host: identificar la versión/ruta que se está usando y resolver ese conflicto antes de continuar. El piloto no requiere reemplazar la instalación global ni publicar nada. El runtime del proyecto permite ejecutar el motor exacto de forma explícita.

## Recorrido del usuario

1. Invocar `omni-init` según el formato del host, sin agregar un prompt de auditoría. Debe reconocer lo existente, explicar qué falta y preguntar solo por decisiones materiales. No debe implementar la aplicación durante ese reconocimiento.
2. Explicar el objetivo real de IPS y sus restricciones. Revisar las preguntas, stack y versiones con fuentes oficiales actuales; aceptar una opción o delegar una decisión con alcance. La ausencia de una herramienta se registra y mantiene pendiente su validación dependiente.
3. Pedir un primer resultado utilizable. El agente debe convertirlo en criterios observables, elegir rigor proporcional y acordar una dirección visual con referencias pertinentes antes de extender pantallas. El recurso `guide design` está incluido; no se exige instalar una skill externa.
4. Durante la implementación, revisar una superficie representativa y el recorrido real. El agente debe ejecutar los checks autorizados por módulo, observar UI responsive/teclado/estados relevantes y corregir lo que falle. Documentación de API y convención de commits deben respetar las decisiones del proyecto.
5. Revisar el resultado con datos aislados. Un build aprobado no significa que el producto o la UI satisfagan los criterios. La entrega parcial muestra lo pendiente; el cierre exige la evidencia correspondiente.

Ante un problema, conservar solicitud/respuesta, versión del host/modelo, `status --json`, spec, aceptación y el registro/log de verificación. No incluir secretos ni datos personales. Corregir y repetir la comprobación afectada; no cambiar un criterio para hacer pasar un defecto.

La aceptación de este piloto permitirá decidir el siguiente paso. No ejecutar push, release, publicación npm ni despliegue por haber terminado el piloto: la restricción de trabajo local sigue vigente hasta instrucción expresa del usuario.
