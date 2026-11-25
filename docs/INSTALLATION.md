# Instalación y actualización de OmniSpec

La versión oficial recomendada es **OmniSpec `0.10.0` (Oficial Estable)**, disponible en el canal `latest` de npm y en GitHub Releases con **Zero Runtime Dependencies**. Consulta las [notas de la versión 0.10.0](releases/0.10.0.md).

## Requisitos previos

- **Node.js `>=22.19.0`** (requerido para el motor nativo `node:sqlite` con soporte `DatabaseSync` y búsqueda de texto completo FTS5 sin compilaciones nativas de terceros) y `npm`, o bien gestores modernos compatibles como **Bun** (`bunx`), **pnpm** (`pnpm dlx`) o **Yarn** (`yarn dlx`).
- Una carpeta de proyecto (nueva o existente).

## Empezar con un comando

En la carpeta del proyecto, ejecuta cualquiera de los siguientes gestores:

```sh
npx --yes omni-spec@latest init
# o la versión explícita:
npx --yes omni-spec@0.10.0 init

# Alternativas soportadas de primera clase:
bunx omni-spec@latest init
pnpm dlx omni-spec@latest init
yarn dlx omni-spec init
```

- `npx --yes` solo autoriza a npm a descargar el paquete si aún no está en caché.
- El asistente interactivo de OmniSpec se abre igualmente para elegir idioma, herramienta de IA y carpeta destino.
- Al terminar, muestra los 3 pasos siguientes con el comando exacto para tu herramienta (`/omni-init`, `$omni-init` en Codex o lectura de `specs/commands/omni-init.md`).
- Para automatización o CI sin preguntas interactivas:

```sh
npx --yes omni-spec@latest init --yes --agent antigravity --lang es
```

## Opciones de instalación

| Modo | Cuándo usarlo | Comando |
| --- | --- | --- |
| **Por proyecto (sin instalar globalmente)** | Probar o inicializar un repositorio puntual con `npx` / `bunx` | `npx --yes omni-spec@latest init` |
| **CLI global** | Usar `omni-spec` en cualquier carpeta sin prefijo `npx` | `npm install -g omni-spec@latest` |
| **Plugin global de Antigravity (Huella Cero)** | Compartir las 9 skills y el runtime de OmniSpec en todos tus workspaces de Antigravity sin copiar `specs/.omni/runtime/` ni `specs/_templates/` al proyecto (~180 KB instalados) | `npx --yes omni-spec@latest plugin install` |

Para verificar una instalación global:

```sh
omni-spec --version
```

Debe mostrar `omni-spec v0.10.0`.

## Qué hace `init` en tu proyecto

1. **Inspección de solo lectura:** detecta lenguajes, gestores de paquetes (`npm`, `pnpm`, `yarn`, `bun.lockb`, `bun.lock`, `uv.lock`, `poetry.lock`, `Cargo.lock`, `go.mod`, `pom.xml`, `gradle`) y frameworks sin ejecutar scripts del proyecto ni modificar tu código fuente.
2. **Estructura base (`specs/`):** crea `CONSTITUTION.md`, `specs/manifest.json` y `specs/project-context.md`.
   - En **modo proyecto / multi-agente**, copia las plantillas en `specs/_templates/` y el runtime local en `specs/.omni/runtime/`.
   - En **modo Plugin de Antigravity (`--agent plugin`)**, opera con **huella cero (Zero-Footprint)**: no copia `specs/.omni/runtime/` ni `specs/_templates/` al repositorio; todo se resuelve desde el plugin global.
3. **Memoria unificada externa (`memory.db`):** el estado de sesión, las decisiones arquitectónicas, la memoria heurística FTS5 y el grafo de cartografía se almacenan fuera del repositorio Git en `%LOCALAPPDATA%\OmniSpec\workspaces\<id>\memory.db` (Windows) o `~/.local/share/OmniSpec/workspaces/<id>/memory.db` (Linux/macOS), evitando ensuciar tus commits con archivos de estado efímeros.
4. **Integración con el agente elegido:** instala las skills o adaptadores en la ruta oficial de la herramienta seleccionada (`.agents/skills/`, `.claude/skills/` + sincronización de `CLAUDE.md`, `.cursor/skills/`, `.gemini/`, `.kilo/`, `.opencode/` o `AGENTS.md`).
5. **Reconciliación en el chat (`/omni-init`):** al ejecutar `/omni-init` en tu agente, este lee el proyecto, indexa la cartografía si es un proyecto existente (`omni-spec cartography`), registra decisiones pendientes y guarda la línea base con `context-record`.

## Actualizar un proyecto existente

Antes de aplicar cambios sobre un proyecto que ya tiene OmniSpec instalado, previsualiza el impacto:

```sh
npx --yes omni-spec@latest update --dry-run
```

Para actualizar conservando tus especificaciones, constitución, contexto y decisiones:

```sh
npx --yes omni-spec@latest update
```

Si modificaste manualmente archivos administrados por OmniSpec y deseas respaldarlos y actualizarlos a la versión actual:

```sh
npx --yes omni-spec@latest update --accept-updates
```

Si usas el plugin global de Antigravity, actualízalo también y verifica que su versión coincida con la del proyecto:

```sh
npx --yes omni-spec@latest plugin update
npx --yes omni-spec@latest doctor
```

> **Nota sobre migración desde `0.8.x` o `0.9.0`:** Al ejecutar comandos en `0.10.0`, OmniSpec migra automáticamente cualquier `specs/project-state.json` heredado hacia la base de datos externa `memory.db` y actualiza el esquema del grafo a v3 de forma transparente. Además, los registros de verificación (`verification.json`) firmados con v4 HMAC-SHA256 siguen vigentes y se complementan con el subsistema nativo **Omni-Design** (`omni-spec design contrast|tokens|scaffold|check|grill|lens`).

### Migrar un proyecto existente al modo Plugin de Huella Cero (`clean`)

Si inicializaste un proyecto anteriormente con archivos locales y ahora utilizas el plugin global de Antigravity, puedes limpiar el runtime y adaptadores redundantes del repositorio sin perder especificaciones ni configuración:

```sh
omni-spec clean --dry-run
omni-spec clean --accept-updates
```

## Comandos principales de consulta, arquitectura, diseño y seguridad

Una vez inicializado el proyecto, dispones de las siguientes utilidades clave:

```sh
# Ver estado del proyecto, memoria activa y bloqueos
omni-spec status

# Indexar el grafo de módulos políglota (TS/JS, Python, Go, Rust, Java)
omni-spec cartography

# Analizar el radio de impacto antes de modificar un archivo o símbolo
omni-spec blast-radius src/core.ts#runTask

# Ejecutar el motor determinista Omni-Design (contraste OKLCH/WCAG 2.2, tokens DTCG, UI-Slop Guard y lentes)
omni-spec design contrast "#0F172A" "#F8FAFC" --role normal-text
omni-spec design scaffold --archetype precision-dark --output tokens.json
omni-spec design tokens tokens.json
omni-spec design check
omni-spec guide design --lens grill

# Instalar el hook pre-commit de Omni-Guardian (ejecución segura y anti-slop)
omni-spec guardian install

# Registrar o buscar observaciones persistentes en la memoria FTS5
omni-spec memory add --category gotcha --scope auth --summary "Token refresh requires OS mutex"
omni-spec memory search "mutex"
```

## Instalación desde un paquete `.tgz` descargado

Si descargaste el activo `omni-spec-0.10.0.tgz` desde GitHub Releases para entornos sin conexión o auditoría interna:

```sh
npx --yes --package ./omni-spec-0.10.0.tgz omni-spec init
```
