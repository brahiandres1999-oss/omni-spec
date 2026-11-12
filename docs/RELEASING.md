# Publicación y Gestión de Releases de OmniSpec

> **Guía exclusiva para mantenedores del repositorio.**  
> Esta guía documenta el protocolo operativo para empaquetar, etiquetar, publicar y distribuir versiones oficiales de OmniSpec.  
> Para instrucciones de instalación, inicialización de proyectos, actualización o migración dirigidas a usuarios finales, consulta la [Guía de Instalación](INSTALLATION.md).

Versión oficial actual: **OmniSpec 0.9.0** (canal npm `latest`, GitHub Releases oficial).  
Consulta las [Notas de lanzamiento de 0.9.0](releases/0.9.0.md) para detalles de arquitectura, cartografía AST, memoria SQLite/FTS5 externa y contratos proporcionales.

---

## Flujo Oficial de Publicación

El proceso de liberación de una nueva versión se ejecuta siguiendo estrictamente los siguientes pasos ordenados.

### 1. Creación de la rama de release

Toda versión se prepara a partir de la rama principal (`main`) en una rama dedicada con la convención de nomenclatura `release/vX.Y.Z`:

```bash
git checkout main
git pull origin main
git checkout -b release/v0.9.0
```

### 2. Ejecución y validación de compuertas de calidad locales

Antes de consolidar o etiquetar cualquier cambio, todas las compuertas de calidad y consistencia deben ejecutarse en local y superarse con cero errores y cero advertencias:

```bash
# 1. Suite de pruebas unitarias e integración (runner nativo de Node.js)
npm test

# 2. Análisis estático y formateo con Biome
npm run lint

# 3. Smoke test integral del empaquetado y bootstrap aislado
npm run test:package

# 4. Verificación estricta de coherencia de versión, metadatos, banner y changelog
npm run release:check

# 5. Sincronización de esquemas, documentación y activos de OmniPage
npm run sync:page
```

> **Regla de integridad:** `npm run release:check` valida que `dependencies` en `package.json` permanezca estrictamente vacío (cero dependencias externas en producción), que la versión coincida exactamente en `package.json`, `package-lock.json`, `plugin.json`, `README.md`, `CHANGELOG.md` y `assets/omni-spec-banner.svg`, y que el archivo de notas correspondiente en `docs/releases/X.Y.Z.md` exista físicamente.

### 3. Consolidación en un único commit squashed

Todos los cambios del release deben consolidarse en un único commit estructurado bajo la especificación [Conventional Commits](https://www.conventionalcommits.org/):

```bash
git add .
git commit -m "feat(release): 0.9.0 — Universal Agentic Engineering Engine"
```

- **Autoría:** El commit debe ser firmado y atribuido exclusivamente al mantenedor oficial.
- **Sin coautorías de IA:** Omitir estrictamente cualquier trailer automático de coautoría (`Co-authored-by: ...`), identificadores de chat o enlaces efímeros de sesión.

### 4. Creación de la etiqueta anotada

Crear la etiqueta Git anotada correspondiente a la versión SemVer exacta:

```bash
git tag -a v0.9.0 -m "Release v0.9.0 — Universal Agentic Engineering Engine"
```

> **Importante:** Nunca usar etiquetas ligeras (`lightweight tags`). Las etiquetas anotadas garantizan la trazabilidad del autor, la fecha y el mensaje criptográfico inmutable del release. No mover ni sobrescribir jamás una etiqueta ya publicada.

### 5. Envío remoto, Pull Request e integración

Enviar la rama de release junto con su etiqueta al repositorio remoto en GitHub:

```bash
git push -u origin release/v0.9.0 --tags
```

1. Abrir un **Pull Request** desde `release/v0.9.0` hacia `main`.
2. Verificar que los flujos de integración continua en GitHub Actions (`ci.yml` y `validate.yml`) concluyan exitosamente en todas las matrices de sistemas operativos (Ubuntu, Windows) y runtimes soportados (Node.js 22.19.0+, 24, 26).
3. Tras la aprobación final, integrar el Pull Request en `main` (merge commit o squash según convención del repositorio).

### 6. Release automatizado en GitHub Actions

El flujo automatizado `.github/workflows/release.yml` se dispara automáticamente ante la recepción del tag `v*` (ejemplo `v0.9.0`):

1. **Validación:** Invoca `validate.yml` para re-ejecutar la matriz de pruebas completas multiplataforma.
2. **Empaquetado (`npm run release:pack`):** Construye el tarball oficial reproducible (`omni-spec-0.9.0.tgz`) y calcula su firma criptográfica `omni-spec-0.9.0.tgz.sha256` en el directorio `artifacts/release/`.
3. **Publicación del GitHub Release:** Utiliza la acción `softprops/action-gh-release` para publicar la Release oficial en GitHub, adjuntando el archivo tarball y su suma SHA-256, empleando el contenido de `docs/releases/0.9.0.md` como cuerpo oficial de la nota de lanzamiento. Versiones con sufijos preliminares (ej. `-preview.N`, `-rc.N`) se marcan automáticamente como prereleases.

### 7. Publicación en el registro público de npm

La publicación en npm se realiza mediante el flujo automatizado `.github/workflows/publish-npm.yml`:

- **Activación:** Se dispara manualmente mediante `workflow_dispatch` desde la interfaz de GitHub Actions indicando la etiqueta existente (ej. `v0.9.0`).
- **npm Trusted Publisher (OIDC):** El workflow opera mediante autenticación federada OIDC (`id-token: write`), prescindiendo totalmente de contraseñas o tokens npm persistentes en secretos del repositorio.
- **Verificación de Integridad:** Descarga el tarball exacto generado por la GitHub Release, valida que su hash SHA-256 coincida byte a byte (`node scripts/release-assets.mjs verify`), y publica el paquete bajo el canal correspondiente (`latest` para versiones estables como 0.9.0, `preview` para preliminares).

#### Procedimiento de contingencia / Publicación manual de emergencia

En caso de que la federación OIDC o GitHub Actions no estuviesen disponibles temporalmente, el mantenedor oficial puede publicar el tarball verificado de forma manual:

1. Iniciar sesión en npm en una terminal local segura:
   ```bash
   npm login --auth-type=web --registry=https://registry.npmjs.org/
   npm whoami --registry=https://registry.npmjs.org/
   ```
2. Generar y verificar la suma SHA-256 del paquete:
   ```bash
   # En Windows PowerShell:
   Get-FileHash ./artifacts/release/omni-spec-0.9.0.tgz -Algorithm SHA256
   ```
3. Publicar el archivo empaquetado exacto:
   ```bash
   npm publish ./artifacts/release/omni-spec-0.9.0.tgz --access public --tag latest --registry=https://registry.npmjs.org/
   ```

> **Advertencia:** npm no permite reutilizar ni reemplazar ninguna combinación de nombre y versión previamente publicada. Nunca alteres un tarball después de ser publicado.

---

## Documentación y Referencias Relacionadas

- [Guía de Instalación para usuarios finales](INSTALLATION.md)
- [Guía de Contribución](../CONTRIBUTING.md)
- [Notas de Versión OmniSpec 0.9.0](releases/0.9.0.md)
- [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/)
- [Especificación SemVer 2.0.0](https://semver.org/spec/v2.0.0.html)
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/)
