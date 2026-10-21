# Publicación e instalación de OmniSpec

Versión preparada: **0.6.1**, etiqueta Git `v0.6.1`, canal npm `latest`. Es la versión con soporte nativo de Plugin Manager (`npx omni-spec plugin install/update`), modo Zero-Bloat y comando de limpieza `clean`. Publicar en GitHub no publica automáticamente en npm.

Decisión del mantenedor: conservar GitHub privado y publicar npm más adelante, cuando exista una cuenta. Las releases y archivos de GitHub requieren acceso al repositorio; no están disponibles de forma anónima por URL. Se puede descargar el tarball con una sesión autorizada y ejecutarlo o instalarlo localmente. Un futuro paquete público npm distribuirá sus fuentes incluidas, sin cambiar la visibilidad del historial de GitHub.

## Release en GitHub

1. Ejecutar `npm test`, `npm run test:package`, `npm run release:check` y `git diff --check`.
2. Revisar y crear el commit con código, pruebas, workflows y documentación. Excluir `artifacts/`.
3. Crear una etiqueta anotada `v0.6.1` sobre ese commit y enviar commit y etiqueta. No mover una etiqueta ya publicada para cambiar sus bytes.
4. El workflow `release.yml` valida Ubuntu/Windows con Node 18.19, 20, 22 y 24, comprueba la correspondencia versión/etiqueta/notas y crea una GitHub release normal cuando todo pasa (prerelease solo para etiquetas con sufijo).
5. La release adjunta `omni-spec-0.6.0.tgz` y `omni-spec-0.6.0.tgz.sha256`. Comprobar el resultado del workflow, no solo que exista la etiqueta.

`npm run release:pack` produce los mismos tipos de artefactos localmente en `artifacts/release/`. El checksum identifica cada archivo concreto; no se promete que dos empaquetados separados tengan bytes idénticos. El workflow npm descarga y verifica el archivo concreto publicado en GitHub.

## Primera publicación en npm, sin cuenta previa

`npx` no es un registro distinto: ejecuta paquetes. Para usar `npx omni-spec@latest`, el paquete debe estar publicado en npm. Hasta entonces descargar el tarball de la release privada y ejecutar `npx --package=/ruta/al/archivo.tgz omni-spec ...` o instalarlo globalmente mediante `npm install -g /ruta/al/archivo.tgz`. No poner tokens ni credenciales en URLs.

1. Crear una cuenta en [npm](https://www.npmjs.com/signup), verificar el correo y configurar la autenticación que solicite npm para publicar. No compartir contraseña, códigos de un solo uso ni tokens con el agente.
2. En una terminal propia ejecutar `npm login --auth-type=web --registry=https://registry.npmjs.org/` y completar el navegador. `npm whoami --registry=https://registry.npmjs.org/` confirma la identidad.
3. Descargar el tarball y checksum de la GitHub release y comprobar SHA-256. En PowerShell: `Get-FileHash ./omni-spec-0.6.0.tgz -Algorithm SHA256`; comparar con el archivo `.sha256`.
4. Publicar ese archivo:

```sh
npm publish ./omni-spec-0.6.0.tgz --tag latest --access public --registry=https://registry.npmjs.org/
```

5. Completar la autenticación adicional que npm solicite. Comprobar `npm view omni-spec@0.6.0 version dist.integrity` y probar el comando por nombre en un proyecto desechable.

La consulta del nombre devolvió 404 durante la preparación; no reserva su disponibilidad ni garantiza permiso de publicación. Si npm rechaza el nombre, elegir un ámbito propio, por ejemplo `@tu-usuario/omni-spec`, y preparar otra versión coherente con ese nombre y sus comandos. No modificar silenciosamente un tarball o etiqueta ya publicados. npm no permite reutilizar una combinación nombre/versión publicada.

## Publicaciones posteriores mediante GitHub Actions

Después de tener el paquete y acceso a sus ajustes en npm, configurar un **Trusted Publisher** para:

- Organización/usuario GitHub: `brahiandres1999-oss`.
- Repositorio: `omni-spec`.
- Archivo workflow: `publish-npm.yml`.

El workflow existe pero no se ejecuta al crear una release: se inicia manualmente en Actions con la etiqueta existente. Usa Node 24, npm 11 y OIDC (`id-token: write`); requiere haber configurado la relación de confianza en npm. Descarga el tarball de GitHub, valida el checksum y publica en `next` para prerelease o `latest` para estable, sin un token npm persistente. La configuración de esa cuenta no se crea desde el repositorio.

La generación automática de provenance de npm tiene requisitos propios, entre ellos repositorio público; no se promete esa atestación desde este repositorio privado. La publicación del paquete y su integridad por checksum son comprobaciones distintas de provenance.

Mantener `publishConfig.tag` en `latest` para versiones normales y `next` para prereleases; para cada versión actualizar `package.json`, el encabezado README, changelog y `docs/releases/<version>.md`. `release:check` rechaza inconsistencias. Las publicaciones por npm son permanentes para esa combinación nombre/versión.

## Uso desde npm una vez publicado

```sh
# Sin instalación global
npx --yes omni-spec@0.6.0 init --yes --agent antigravity

# CLI global opcional; no inicializa todos los proyectos automáticamente
npm install --global omni-spec@latest
omni-spec init --yes --agent antigravity
```

Cada `init` copia el runtime al proyecto. La instalación global solo facilita el comando de bootstrap/actualización. Un proyecto Python, Java o de otro stack no necesita un `package.json` de aplicación para utilizar ese runtime.

## Actualizar proyectos

Abrir la raíz del proyecto destino. Una vez disponible la versión en npm:

```sh
npx --yes omni-spec@0.6.0 update --dry-run
npx --yes omni-spec@0.6.0 update
```

Sin npm por nombre, ejecutar el CLI de una copia nueva de OmniSpec o usar el tarball descargado desde la release privada:

```sh
npx --yes --package="/ruta/al/omni-spec-0.6.0.tgz" omni-spec update --dry-run
```

Después de revisar, repetir sin `--dry-run`. Se conservan contexto, constitución, especificaciones y selección de agente. Archivos administrados personalizados bloquean la operación; `--accept-updates` acepta su reemplazo con copia de respaldo después de revisar conflictos. Recargar el agente después de actualizar skills/comandos.

Actualizar el CLI global (`npm install -g omni-spec@latest`) no actualiza las copias de los proyectos; ejecutar `omni-spec update` dentro de cada uno. Ejecutar el `update` del runtime viejo utiliza los recursos viejos, no descarga una versión nueva.

### Copias de desarrollo que ya dicen 0.5.0

Usar el mismo procedimiento: CLI nuevo, `update --dry-run` y `update`. El actualizador compara archivos aunque coincida el número de versión; no requiere `--allow-downgrade` para pasar de una copia 0.5.0 a esta publicación 0.5.0. También permite subir desde 0.5.0-rc.1 sin esa opción. Se preservan los trabajos completados y sus registros de verificación; no se les atribuyen comprobaciones nuevas.

### Especificaciones anteriores al registro por criterio

`update` no reescribe las especificaciones. Para volver a verificar/completar una antigua, el agente debe asignar IDs `AC-01`, `AC-02`, etc. en su artefacto principal y crear `acceptance.json` con esos mismos IDs, método (`automated`, `manual`, `inspection`, `decision`), estado y evidencia específica. Una RFC sin otros criterios usa `DECISION`. Un estado distinto de `passed`, una fila ausente o un ID inventado bloquea el cierre.

Una evidencia manual concreta es válida cuando corresponde. Una inspección de código no demuestra una interacción ejecutada o conformidad de accesibilidad. Una afirmación falsa puede llenar el JSON: la revisión de significado sigue siendo necesaria. Modificar criterios o evidencia invalida la huella de verificación y exige otra ejecución de `verify`.

## Fuentes oficiales

- [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/): publicación, acceso y versiones no reutilizables.
- [npx](https://docs.npmjs.com/cli/v11/commands/npx/): ejecución de paquetes.
- [Trusted publishing](https://docs.npmjs.com/trusted-publishers/): configuración OIDC y requisitos de npm/runtime.
- [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html): orden de versiones prerelease y estables.
