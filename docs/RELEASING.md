# Publicación e instalación de OmniSpec

Versión oficial: **OmniSpec 0.8.1**, canal npm `latest`, GitHub Releases oficial. Publicada el 2026-10-30. Las [notas de lanzamiento](releases/0.8.1.md) describen cambios, arquitectura y compatibilidad consolidada.

Comprobar cuentas, permisos y estado del registro antes de publicar futuras versiones. Los pasos de esta guía se ejecutan para la versión autorizada por el mantenedor. Un paquete público npm distribuye las fuentes incluidas en su tarball; la visibilidad del repositorio se administra por separado.

## Release en GitHub

### Ruta de integración de 0.8.0-preview.2

1. Revisar el diff de la candidata en `next/0.8`, actualizar notas y roadmap y ejecutar los controles locales. Los trabajos 015/016 permanecen para otra entrega del mismo paquete.
2. Crear un commit con Conventional Commits y enviarlo a `origin/next/0.8`. Abrir un PR con base `main` y comparar el contenido completo de la rama; el PR conserva los límites de aceptación pendientes.
3. Comprobar la CI del último commit del PR antes de integrarlo. Un PR en borrador permite dejar preparado el cambio mientras falten revisiones o autenticación. Conservar `next/0.8` para continuar el desarrollo.
4. Después de integrar, comprobar el commit exacto de `main` y su CI. Crear `v0.8.0-preview.2` sobre ese commit validado; no etiquetar una copia local distinta.
5. Comprobar que el workflow `Release` termina correctamente y publica la prerelease de GitHub con tarball y SHA-256.
6. Ejecutar manualmente `Publish npm (configured trusted publisher required)` desde Actions con esa etiqueta. npm debe tener configurado el Trusted Publisher del repositorio y `publish-npm.yml`. Como alternativa, el mantenedor puede publicar el mismo tarball mediante el flujo manual descrito abajo.
7. Verificar la versión, integridad y canal en npm y probar una instalación desechable por versión exacta. La publicación en `preview` conserva `latest`; promover a estable es una decisión posterior.

La observación de interacción de coexistencia y los recorridos en hosts reales se registran separadamente de la CI. Publicar una Preview no permite declararlos aprobados ni cerrar criterios pendientes sin evidencia.

### Procedimiento y artefactos

1. Ejecutar `npm test`, `npm run test:package`, `npm run release:check` y `git diff --check`.
2. Revisar y crear el commit con código, pruebas, workflows y documentación. Las salidas locales (`artifacts/`, `coverage/`, tarballs) están en `.gitignore` y no se versionan.
3. Crear la etiqueta anotada correspondiente a package.json y enviarla solo después de autorización expresa. Para esta candidata sería `v0.8.0-preview.2`; no se ha creado ni enviado. No mover una etiqueta publicada para cambiar sus bytes.
4. El workflow `release.yml` tiene configurada validación Ubuntu/Windows con Node 22.19, 22, 24 y 26, comprueba versión/etiqueta/notas y distingue prerelease mediante sufijo. La configuración no demuestra una ejecución remota.
5. La release adjunta el tarball y su SHA256 con el nombre derivado de la versión. Comprobar el resultado del workflow, no solo que exista la etiqueta.

`npm run release:pack` produce los mismos tipos de artefactos localmente en `artifacts/release/`. El checksum identifica cada archivo concreto; no se promete que dos empaquetados separados tengan bytes idénticos. El workflow npm descarga y verifica el archivo concreto publicado en GitHub.

## Publicación manual en npm

`npx` ejecuta paquetes de npm. Antes de publicar, probar el tarball local de [PILOT](PILOT.md). Después, `npx --yes omni-spec@preview init` selecciona la Preview y `@0.8.0-preview.2` fija sus bytes por versión. `@latest` sigue seleccionando la publicación normal. No poner tokens ni credenciales en URLs.

1. Crear una cuenta en [npm](https://www.npmjs.com/signup), verificar el correo y configurar la autenticación que solicite npm para publicar. No compartir contraseña, códigos de un solo uso ni tokens con el agente.
2. En una terminal propia ejecutar `npm login --auth-type=web --registry=https://registry.npmjs.org/` y completar el navegador. `npm whoami --registry=https://registry.npmjs.org/` confirma la identidad.
3. Seleccionar el tarball y checksum de la versión autorizada y comprobar SHA-256. En PowerShell: `Get-FileHash ./omni-spec-0.8.0-preview.2.tgz -Algorithm SHA256`; comparar con el archivo `.sha256`.
4. Publicar ese archivo:

```sh
npm publish ./omni-spec-0.8.0-preview.2.tgz --tag preview --access public --registry=https://registry.npmjs.org/
```

5. Completar la autenticación adicional que npm solicite. Comprobar versión e integridad exactas con npm view y probar el comando por nombre en un proyecto desechable.

El nombre `omni-spec` ya está publicado en npm por el mantenedor (versión 0.6.1 en `latest`, consultado el 2026-10-23); publicar una prerelease con `--tag preview` no cambia lo que instala `npx omni-spec` sin versión. Si la cuenta publicadora cambia, confirmar antes su permiso sobre el paquete. No modificar silenciosamente un tarball o etiqueta ya publicados. npm no permite reutilizar una combinación nombre/versión publicada.

## Publicaciones posteriores mediante GitHub Actions

Después de tener el paquete y acceso a sus ajustes en npm, configurar un **Trusted Publisher** para:

- Organización/usuario GitHub: `brahiandres1999-oss`.
- Repositorio: `omni-spec`.
- Archivo workflow: `publish-npm.yml`.

El workflow existe pero no se ejecuta al crear una release: se inicia manualmente en Actions con la etiqueta existente. Usa Node 24, npm 11 y OIDC (`id-token: write`); requiere haber configurado la relación de confianza en npm. Descarga el tarball de GitHub, valida el checksum y usa el canal calculado desde la versión: `preview` para Preview, `next` para otras prereleases y `latest` para versiones normales, sin un token npm persistente. La configuración de esa cuenta no se crea desde el repositorio.

La generación automática de provenance de npm tiene requisitos propios, entre ellos la visibilidad del repositorio; comprobarlos para la publicación concreta. Publicación, checksum y provenance son comprobaciones distintas.

Mantener versión y canal alineados: `0.8.0-preview.N` → `preview`; otras prereleases → `next`; versiones normales → `latest`. Para cada versión actualizar paquete, lockfile, README/banner, changelog y `docs/releases/<version>.md`. `release:check` rechaza inconsistencias. Las publicaciones npm no permiten reutilizar nombre/versión.

## Uso desde npm una vez publicado

```sh
# Sin instalación global
npx --yes omni-spec@0.8.0-preview.2 init --yes --agent antigravity

# CLI global opcional; no inicializa todos los proyectos automáticamente
npm install --global omni-spec@preview
omni-spec init --yes --agent antigravity
```

Cada `init` copia el runtime al proyecto. La instalación global solo facilita el comando de bootstrap/actualización. Un proyecto Python, Java o de otro stack no necesita un `package.json` de aplicación para utilizar ese runtime.

## Actualizar proyectos

Abrir la raíz del proyecto destino. Una vez disponible la versión en npm:

```sh
npx --yes omni-spec@0.8.0-preview.2 update --dry-run
npx --yes omni-spec@0.8.0-preview.2 update
```

Antes de publicar en npm, utilizar una copia del código o su tarball local:

```sh
npx --yes --package="/ruta/al/omni-spec-0.8.0-preview.2.tgz" omni-spec update --dry-run
```

Después de revisar, repetir sin `--dry-run`. Se conservan contexto, constitución, especificaciones y selección de agente. Archivos administrados personalizados bloquean la operación; `--accept-updates` acepta su reemplazo con copia de respaldo después de revisar conflictos. Recargar el agente después de actualizar skills/comandos.

Actualizar el CLI global (`npm install -g omni-spec@preview`) no actualiza las copias de los proyectos; ejecutar `omni-spec update` dentro de cada uno. Ejecutar el `update` del runtime viejo utiliza los recursos viejos, no descarga una versión nueva.

### Copias locales de 0.7.0-rc.1 o rc.2

SemVer ordena `0.8.0-preview.2` después de `0.7.0-rc.1` y `rc.2`: pasar de esas candidatas locales a la Preview actual es una subida de versión y no requiere `--allow-downgrade`. Con el CLI de la Preview, revisar:

```sh
npm exec --offline --yes --package "/ruta/al/omni-spec-0.8.0-preview.2.tgz" -- omni-spec update --dry-run
```

Si la revisión es correcta, repetir sin `--dry-run`. Se conservan contexto, configuración y especificaciones; las personalizaciones administradas siguen sujetas a revisión/respaldo. Desde 0.6.1 tampoco hace falta `--allow-downgrade`.

### Copias de desarrollo que ya dicen 0.5.0

Usar el mismo procedimiento: CLI nuevo, `update --dry-run` y `update`. El actualizador compara archivos aunque coincida el número de versión; subir desde 0.5.0 o 0.5.0-rc.1 a esta candidata no requiere permitir downgrade. Se preservan los trabajos completados y sus registros de verificación; no se les atribuyen comprobaciones nuevas.

### Especificaciones anteriores al registro por criterio

`update` no reescribe las especificaciones. Para volver a verificar/completar una antigua, el agente debe asignar IDs `AC-01`, `AC-02`, etc. en su artefacto principal y crear `acceptance.json` con esos mismos IDs, método (`automated`, `manual`, `inspection`, `decision`), estado y evidencia específica. Una RFC sin otros criterios usa `DECISION`. Un estado distinto de `passed`, una fila ausente o un ID inventado bloquea el cierre.

Una evidencia manual concreta es válida cuando corresponde. Una inspección de código no demuestra una interacción ejecutada o conformidad de accesibilidad. Una afirmación falsa puede llenar el JSON: la revisión de significado sigue siendo necesaria. Modificar criterios o evidencia invalida la huella de verificación y exige otra ejecución de `verify`.

## Fuentes oficiales

- [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/): publicación, acceso y versiones no reutilizables.
- [npx](https://docs.npmjs.com/cli/v11/commands/npx/): ejecución de paquetes.
- [Trusted publishing](https://docs.npmjs.com/trusted-publishers/): configuración OIDC y requisitos de npm/runtime.
- [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html): orden de versiones prerelease y estables.
