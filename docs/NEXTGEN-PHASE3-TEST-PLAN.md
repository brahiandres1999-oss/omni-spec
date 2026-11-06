# Fase 3 — Plan de Tests (TDD)

**Alcance:** Pushdown DFA Lexer · Resolutor de rutas y monorepos · Grafo de módulos en SQLite con CTE anti-ciclos · Desenrollado de barrel files · Evaluador de Blast Radius · CLI `cartography` / `blast-radius` · MCP `omni_check_blast_radius`
**Referencias:** `OMNI-NEXTGEN-BLUEPRINT.md` §4.1, §4.2, §4.3, §5 (Fase 3), §6 · `BROWNFIELD-CARTOGRAPHY-STRESS-TEST.md` (completo)
**Runner:** `node --test --test-concurrency=1` (cero dependencias). Rama: `feat/nextgen-phase2-guardian-governance` → `feat/nextgen-phase3-cartography-blast-radius`.
**Regla de oro:** cada test se escribe y se ve fallar (rojo) antes de escribir el código que lo pone en verde. La suite existente se mantiene en verde en cada commit.

---

## 0. Criterio de aceptación (EARS) y trazabilidad

> **AC-F3:** Cuando se analice un monorepo preexistente de 500.000 LOC y 4.000 archivos, la cartografía completará el mapa de dependencias en menos de 200 ms con menos de 60 MB de RAM. Identificará el impacto por símbolo sin falsos positivos de barrel files ni bucles infinitos por ciclos.

| Riesgo (blueprint §6) | Bloque de tests |
| :-- | :-- |
| Falsas dependencias en cadenas y plantillas | LX-MASK, LX-TPL, LX-RE |
| Desconexión del grafo en monorepos (`workspace:*`) | RS-WS |
| Bucles infinitos en SQLite por ciclos | GR-CTE |
| Falsos positivos de barrel files | GR-BRL, BR-SYM |
| Distorsión por tamaño del repo | BR-PHI, BR-FX |
| Límite de RAM (descarte de `worker_threads`) | GR-PERF |

---

## 1. Hallazgos del código y los documentos que condicionan el diseño

Leí los dos documentos vinculantes y el código actual antes de escribir el plan. Estos puntos cambian lo que hay que probar:

1. **El sanitizador de referencia (§3.1 del stress test) no enmascara el contenido de las cadenas.** Copia `source.slice(lastCopy, i + 1)`, así que el texto de los strings llega intacto a la regex. Eso contradice el blueprint §4.3. Además no tiene pila de plantillas, no reconoce regex literales y construye la salida carácter a carácter con `+=`. **Diseño:** el masker sustituye por espacios el contenido de comentarios, strings, texto de plantilla y regex. Conserva delimitadores, saltos de línea y longitud exacta. Como los offsets se preservan, el especificador de un import se lee del **código original** en el mismo rango que ocupa la cadena enmascarada. La regex nunca ve texto de datos y el especificador sigue siendo exacto.
2. **La guarda de ciclos con `LIKE` tiene un fallo de corrección.** En `br.visited_path NOT LIKE '%,' || md.source_module || ',%'`, los caracteres `_` y `%` del nombre del módulo actúan como comodines. Con `src/a_b.py` ya visitado, `src/axb.py` se considera visitado y **desaparece del blast radius** (falso negativo). `_` es habitual en Python, Go y Rust. **Propuesta:** la misma guarda con `instr(br.visited_path, ',' || md.source_module || ',') = 0`. Es semánticamente idéntica, sin comodines. Ver D-1.
3. **`UNION ALL` con camino visitado enumera caminos simples, no nodos.** En grafos densos el número de filas crece de forma exponencial con la profundidad: 6 capas completas de 20 nodos dan 20⁶ = 64 M filas. La guarda evita ciclos infinitos, pero no la explosión combinatoria. Ver D-1.
4. **El parser JSONC de referencia rompe los `paths` típicos.** La regex `\/\*[\s\S]*?\*\/` interpreta como comentario de bloque el `/*` de `"@/*": ["./src/*"]`. **Diseño:** el JSONC se limpia con el mismo DFA del lexer, que sabe que eso está dentro de una cadena.
5. **El resolutor de referencia se aparta de la semántica de TypeScript:**
   - Fusiona los `paths` del padre y del hijo. En TypeScript, `paths` del hijo **reemplaza** al del padre.
   - Resuelve los `imports` de `package.json` contra el `baseUrl` del tsconfig. Deben resolverse contra el directorio del `package.json`.
   - No mapea `import './a.js'` → `a.ts`. Es la convención estándar de TS ESM y el caso más común en código moderno.
   - Usa un único tsconfig raíz. En un monorepo, cada importador debe usar su tsconfig más cercano.
6. **El esquema actual de `memory.db` (v2) no tiene `module_dependencies`.** `modules_graph` tampoco tiene columnas para la caché incremental (`content_hash`, `mtime_ms`, `size_bytes`, `language`, `node_type`, `has_opaque_deps`). Hace falta una migración **v2 → v3** dentro de `BEGIN IMMEDIATE`. Hoy `openMemory` rechaza cualquier versión distinta de 2 (`memory.mjs:211`).
7. **`Memory.blastRadius()` (`memory.mjs:529`) es un stub de Fase 1.** Lee `dependencies_json` y lanza `Cartography index is empty`. Dos tests de `mcp-server.test.mjs` (líneas 205 y 213) fijan ese comportamiento. **Se reescriben** (MCP-03, MCP-04) y se documenta el cambio.
8. **`specs/contracts.json` no vincula contratos a archivos.** `scope` es prosa (`'Signed-in account owner sees…'`). Para calcular `ContractLevel(F)` hace falta una regla de mapeo. Ver D-2.
9. **`TestCoverage(F)` no tiene fuente definida.** El stress test dice que reduce el riesgo "hasta en un 50 %", pero con δ = 0.40 la reducción máxima es del **40 %**. Sigo el blueprint (δ = 0.40). La fuente de cobertura está en D-3.
10. **Las cifras de rendimiento `[EXECUTED / OBSERVED]` no se pueden verificar desde aquí:** 3,07 M LOC/s, 49 ms y 58 MB. El I/O de 4.000 archivos en NTFS con Defender activo suele costar más de 49 ms por sí solo. Ver D-5: la suite fija suelos conservadores y un benchmark aparte mide los objetivos EARS reales.
11. **Ya existe `src/js-lexer.mjs` (Fase 2).** Produce un objeto por token, lo que es correcto para el guardian pero demasiado lento para 3 M LOC/s. **Diseño:** `src/cartography/lexer.mjs` es un masker nuevo que trabaja sobre códigos de carácter. Un test diferencial (LX-DIFF) comprueba que ambos clasifican igual strings, plantillas y regex sobre `src/` del propio repo.
12. **Trampas léxicas reales de código brownfield** que el documento no cubre:
    - Apóstrofos en texto JSX (`<p>Don't</p>`), que abren un string falso.
    - Lifetimes de Rust (`'a`), que no son literales de carácter (`'a'`).
    - Raw strings de Rust (`r#"…"#`) y comentarios de bloque anidados.
    - Text blocks de Java (`"""`).
    - Docstrings y f-strings de Python.

    Cada una tiene su test.
13. **Invariante de la fórmula:** α + β + γ = 1.00 y cada término está en [0, 1], así que el máximo es exactamente 100 y el `min(100, …)` solo protege contra errores de redondeo. BR-FX-09 lo comprueba.

---

## 2. Inventario de archivos

| Archivo nuevo/modificado | Tipo | Tests |
| :-- | :-- | --: |
| `test/cartography-lexer.test.mjs` | nuevo | 57 |
| `test/cartography-resolver.test.mjs` | nuevo | 46 |
| `test/cartography-graph.test.mjs` | nuevo | 50 |
| `test/cartography-blast-radius.test.mjs` | nuevo | 42 |
| `test/cartography-cli.test.mjs` | nuevo | 12 |
| `test/mcp-server.test.mjs` | 3 nuevos + 2 reescritos | 5 |
| `test/memory.test.mjs` | 1 ajustado (`user_version`) | — |
| `scripts/bench-cartography.mjs` | nuevo (fuera de la suite) | — |
| **Total Fase 3** | | **≈212** |

Etiquetas:
- **[perf]**: suelo conservador en la suite. El objetivo EARS se mide con `npm run bench:cartography`.
- **[child]**: se ejecuta en un proceso hijo para medir RSS sin el ruido del runner.
- **[fs]**: crea un repositorio de prueba en `mkdtemp`.
- **[win32]** / **[posix]**: `skip` según plataforma.

Los fixtures de repositorio viven en `test-support/cartography-fixtures.mjs`, como builders en código (sin árboles binarios en Git).

---

## 3. `src/cartography/lexer.mjs` — Pushdown DFA (`test/cartography-lexer.test.mjs`)

**API propuesta:**
- `maskSource(source, language)` → `string` de igual longitud.
- `scanModule(source, { language })` → `{ language, imports[], exports[], reexports[], hasOpaqueDependencies, opaqueSites[] }`.
- `detectLanguage(path)`.

Cada import es `{ specifier, kind: 'static'|'dynamic'|'require'|'side-effect', edgeType: 'value'|'type_only', symbols: string[] | ['*'], line }`.

### 3.1 Whitespace masking (LX-MASK)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| LX-MASK-01 | `maskSource` sobre un archivo mixto | `masked.length === source.length`; los `\n` y `\r` quedan en los mismos offsets |
| LX-MASK-02 | `// import x from 'evil'` y `/* import 'evil' */` multilínea | Sin imports; las líneas siguientes conservan su número |
| LX-MASK-03 | `const s = "import x from 'evil'"` | Sin imports. Contenido enmascarado y comillas preservadas |
| LX-MASK-04 | Escapes: `'it\'s'`, `"a\"b"`, `"\\"` seguido de `import './real'` | El string se cierra donde debe; `./real` detectado |
| LX-MASK-05 | String con continuación de línea `\` + LF/CRLF | Una sola cadena; la línea siguiente sigue siendo dato |
| LX-MASK-06 | El especificador se lee del original: `import a from './ruta con espacios.js'` | `specifier` exacto, sin espacios añadidos |
| LX-MASK-07 | BOM inicial y shebang `#!/usr/bin/env node` | Ignorados; los offsets se mantienen |
| LX-MASK-08 | CRLF frente a LF en el mismo archivo | Mismos números de línea para cada import |
| LX-MASK-09 | String sin cerrar antes de fin de línea (JS inválido) | **Recuperación:** se cierra en el `\n`, sin excepción. El import de la línea siguiente se detecta |
| LX-MASK-10 | Comentario de bloque sin cerrar al final del archivo | Enmascarado hasta EOF, sin excepción. `opaqueSites` no se contamina |

### 3.2 Pila de plantillas y balanceo de llaves (LX-TPL)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| LX-TPL-01 | `` `import x from 'evil'` `` | Sin imports |
| LX-TPL-02 | `` `${ "foo`bar" }` `` seguido de `import './after'` | El backtick dentro del string interpolado no cierra la plantilla. `./after` detectado |
| LX-TPL-03 | Anidamiento triple `` `a${ `b${ `c${x}` }` }` `` | `templateDepth` vuelve a 0; el código posterior se analiza |
| LX-TPL-04 | Objeto literal dentro de la interpolación `` `${ {a:{b:1}}.a }` `` | Las llaves de código no cierran la interpolación antes de tiempo |
| LX-TPL-05 | `` `${ '}' }` `` y `` `${ /}/.test(x) }` `` | El `}` dentro de string o regex no cuenta para el balanceo |
| LX-TPL-06 | Comentario dentro de la interpolación `` `${ /* } */ x }` `` | Ignorado para el balanceo |
| LX-TPL-07 | Texto de plantilla enmascarado y código interpolado conservado | `` `x${import('./lazy.js')}y` `` → `./lazy.js` dinámico detectado |
| LX-TPL-08 | 1.000 niveles de anidamiento | Sin desbordamiento de pila (pila explícita, sin recursión) |

### 3.3 Heurística de `/` (LX-RE)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| LX-RE-01 | `a / b / c`, `x = (y) / 2`, `arr[i] / n`, `n++ / 2` | División; nada enmascarado |
| LX-RE-02 | `x = /import 'evil'/g`, `f(/a/)`, `[/a/, /b/]`, `!/a/.test(s)` | Regex; contenido enmascarado y sin imports |
| LX-RE-03 | Tras palabras clave: `return /a/`, `throw /a/`, `case /a/:`, `typeof /a/`, `yield /a/`, `await /a/` | Regex |
| LX-RE-04 | Clase con barra: `/[/]import/` y escape `/a\/b/` | La regex no se cierra en la `/` de la clase ni en la escapada |
| LX-RE-05 | Propiedad con nombre de palabra clave: `obj.return / 2` | División (el token previo es una propiedad, no una palabra clave) |
| LX-RE-06 | **Límite aceptado:** `if (x) /re/.test(s)` | Se trata como división. Mismo criterio que `js-lexer`. Test fijado como comportamiento documentado; no rompe la extracción de imports |

### 3.4 Extracción TypeScript / JavaScript (LX-JS)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| LX-JS-01 | `import a from 'x'`, `import { b, c as d } from 'x'`, `import * as ns from 'x'`, `import a, { b } from 'x'` | `kind: static`; símbolos `['default']`, `['b','c']`, `['*']`, `['default','b']` |
| LX-JS-02 | `import './polyfill'` | `kind: side-effect`; símbolos `['*']` (conservador) |
| LX-JS-03 | `import type { U } from './t'`, `export type { U } from './t'` | `edgeType: type_only` |
| LX-JS-04 | Mixto: `import { type U, makeU } from './t'` | `edgeType: value`; `typeOnlySymbols: ['U']` |
| LX-JS-05 | Import multilínea con comentarios y coma final | Un import; símbolos correctos |
| LX-JS-06 | `import('./a')`, `` import(`./b`) `` sin interpolación | `kind: dynamic`, especificador resuelto |
| LX-JS-07 | `import(variable)`, `` import(`./x/${d}`) ``, `require(expr)` | `hasOpaqueDependencies: true`; `opaqueSites` con línea |
| LX-JS-08 | `require('./c')`, `const { x } = require('./c')` | `kind: require`, `edgeType: value` |
| LX-JS-09 | `import fs = require('node:fs')` (TS) | `kind: require` |
| LX-JS-10 | Falsos amigos: `myimport('./x')`, `obj.import('./x')`, `obj.require('./x')`, `import.meta.url` | Ningún import |
| LX-JS-11 | Exportaciones: `export const/let/var/function/function*/async function/class/interface/type/enum`, `export default`, `export { a, b as c }` | `exports` con nombre y `kind`; `export { b as c }` exporta `c` |
| LX-JS-12 | Re-exportaciones: `export { x } from`, `export { x as y } from`, `export * from`, `export * as ns from`, `export { default } from`, `export { default as Foo } from` | `reexports` con pares `{ imported, exported }` o `'*'` |
| LX-JS-13 | JSX con apóstrofo `<p>Don't import 'evil'</p>` en `.tsx` | Sin excepción. El import real posterior se detecta (recuperación de LX-MASK-09) |
| LX-JS-14 | Genéricos y comparaciones: `a < b > c`, `<T,>(x: T) => x` | Sin efectos en la extracción |

### 3.5 Políglota (LX-PY, LX-GO, LX-RS, LX-JV)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| LX-PY-01 | `import os`, `import a.b as c`, `import a, b` | Tres especificadores en el orden del código |
| LX-PY-02 | `from x.y import z`, `from . import a`, `from ..pkg.mod import b as c` | Relativos con nivel (`.` = 1, `..` = 2) y símbolos |
| LX-PY-03 | `from x import (a,\n b,\n c)` en paréntesis multilínea | Símbolos `a, b, c` |
| LX-PY-04 | Comentarios `#` y docstrings `"""…import evil…"""` / `'''…'''` | Sin imports falsos |
| LX-PY-05 | f-string `f"{import_name}"` y prefijos `rb''`, `Rb""` | Enmascarados; sin imports |
| LX-GO-01 | `import "fmt"` y bloque `import (\n "a/b"\n x "c/d"\n _ "e"\n . "f"\n)` | Especificadores con alias (`x`, `_`, `.`) |
| LX-GO-02 | Raw strings `` `import "evil"` `` y comentarios `//`, `/* */` | Sin imports falsos |
| LX-RS-01 | `use crate::models::User;`, `use super::utils;`, `use self::a::{b, c::d};`, `pub use crate::x as y;` | Rutas y símbolos |
| LX-RS-02 | `mod foo;`, `pub mod bar;`, y `mod inline { … }` (no genera arista) | Solo las declaraciones con `;` generan dependencia |
| LX-RS-03 | Lifetimes `fn f<'a>(x: &'a str)` frente a char `'a'` y `'\''` | El lifetime no abre un literal; nada se desincroniza |
| LX-RS-04 | Raw strings `r"…"`, `r#"…"#` con `"` interno, y comentario de bloque anidado `/* /* */ use evil; */` | Sin imports falsos |
| LX-JV-01 | `package com.corp.app;`, `import com.corp.model.User;`, `import com.corp.util.*;`, `import static com.corp.X.y;` | Paquete y tres imports (wildcard y static marcados) |
| LX-JV-02 | Text block `"""\nimport evil.X;\n"""` | Sin imports falsos |

### 3.6 Robustez, coherencia y rendimiento (LX-DIFF, LX-PERF)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| LX-DIFF-01 | Diferencial con `js-lexer`: sobre cada `src/**/*.mjs` del repo, los rangos enmascarados coinciden con los tokens `string`, `template`, `regex` y `comment` de `lex()` | Sin discrepancias |
| LX-DIFF-02 | *Dogfooding*: `scanModule(src/cli.mjs)` | Incluye `./mcp-server.mjs` y `./memory.mjs`, entre otros |
| LX-ROB-01 | Fuzz determinista (semilla fija, 2.000 entradas aleatorias de caracteres ASCII y Unicode) | Nunca lanza; `masked.length === source.length` siempre |
| LX-ROB-02 | Línea minificada de 2 MB | Tiempo lineal (< 3× el de 1 MB) |
| LX-PERF-01 **[perf]** | 100.000 LOC de TS sintético (mezcla de imports, strings, plantillas y regex), mediana de 5 ejecuciones tras calentamiento | ≥ 1,0 M LOC/s en la suite. El benchmark exige ≥ 3,0 M LOC/s |
| LX-PERF-02 **[perf]** | Crecimiento del heap durante LX-PERF-01 | < 16 MB |

---

## 4. `src/cartography/resolver.mjs` — rutas y monorepos (`test/cartography-resolver.test.mjs`)

**API propuesta:** `createResolver(root, { fs })` → `{ resolve(specifier, importerPath, language) }`. Devuelve `{ kind: 'internal', path }`, `{ kind: 'external', name }` o `{ kind: 'unresolved', specifier }`. Las rutas son siempre POSIX relativas a la raíz.

### 4.1 Rutas relativas y sondeo (RS-REL)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| RS-REL-01 | `./a` con `a.ts`, `a.tsx`, `a.d.ts`, `a.js`, `a.jsx`, `a.mjs`, `a.cjs` | Orden de sondeo determinista: `.ts` gana sobre `.js` |
| RS-REL-02 | `./dir` con `dir/index.ts` | `dir/index.ts` |
| RS-REL-03 | **Convención TS ESM:** `./a.js` → `a.ts`; `./a.mjs` → `a.mts`; `./a.cjs` → `a.cts`; `./a.jsx` → `a.tsx` | Resuelve al fuente TS cuando no existe el `.js` |
| RS-REL-04 | `./a.js` existe como `.js` real | Gana el archivo exacto |
| RS-REL-05 | `../../fuera-del-repo` | `unresolved`; nunca sale de la raíz |
| RS-REL-06 | Rutas devueltas en POSIX relativo también en Windows (`src/a.ts`, no `src\a.ts`) | Exacto |
| RS-REL-07 **[win32]** | `./Button` cuando el archivo en disco es `button.tsx` | Ruta con el casing **real**, más un aviso `case-mismatch` (fallaría en Linux CI) |
| RS-REL-08 | Builtins y paquetes: `node:fs`, `fs`, `react`, `@scope/pkg/sub` | `external` con nombre de paquete; sin sondeo de disco |

### 4.2 tsconfig / jsconfig (RS-TS)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| RS-TS-01 | *Longest prefix*: `@/*`, `@/features/*` y `@/features/billing/*` declarados en orden inverso | `@/features/billing/tax` usa la regla 3 |
| RS-TS-02 | Patrón exacto (sin `*`) frente a comodín | El exacto gana |
| RS-TS-03 | Varios destinos `["./src/*", "./generated/*"]` | Primer destino existente |
| RS-TS-04 | Patrón con sufijo `"*.css": ["./styles/*.css"]` | Prefijo y sufijo respetados |
| RS-TS-05 | `paths` sin `baseUrl` (TS ≥ 4.1) | Relativos al tsconfig que declara `paths` |
| RS-TS-06 | Fallback de `baseUrl` para imports no relativos (`components/Button`) | Resuelve si existe; si no, `external` |
| RS-TS-07 | `extends` relativo en cadena de 3 niveles | `baseUrl` heredado y relativo al config que lo declara |
| RS-TS-08 | **El hijo reemplaza `paths`:** el padre define `@a/*` y el hijo `@b/*` | Solo `@b/*` activo |
| RS-TS-09 | `extends` como array (TS 5.0): el último gana | Exacto |
| RS-TS-10 | `extends` de paquete (`@tsconfig/node20/tsconfig.json`) en `node_modules` | Leído si existe; ausente → se ignora con aviso, sin excepción |
| RS-TS-11 | Ciclo en `extends` (A → B → A) | Corta con aviso `TSCONFIG_EXTENDS_CYCLE`, sin bucle infinito |
| RS-TS-12 | Plantilla `${configDir}` (TS 5.5) en `paths` y `baseUrl` | Sustituida por el directorio del config hijo |
| RS-TS-13 | JSONC: comentarios `//` y `/* */`, comas finales y `"@/*"` / `"https://x"` dentro de strings | Parseo correcto (hallazgo §1.4) |
| RS-TS-14 | `jsconfig.json` cuando no hay `tsconfig.json` | Usado |
| RS-TS-15 | **tsconfig más cercano:** `apps/web/tsconfig.json` y `packages/ui/tsconfig.json` con `@/*` distintos | Cada importador usa el config de su paquete |
| RS-TS-16 | tsconfig malformado | Aviso tipado `TSCONFIG_INVALID`, resolución relativa intacta |

### 4.3 `package.json#imports` (RS-PKG)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| RS-PKG-01 | `"#db": "./src/db/index.js"` (destino exacto) | Relativo al **directorio del package.json** |
| RS-PKG-02 | Comodín `"#utils/*": "./src/utils/*.js"` | Sustitución correcta + convención `.js` → `.ts` |
| RS-PKG-03 | Condiciones `{ "types": …, "import": …, "require": …, "default": … }` | Orden de condiciones fijado (D-8) |
| RS-PKG-04 | `#x` declarado en un `package.json` anidado | Usa el `package.json` más cercano al importador |
| RS-PKG-05 | `#no-declarado` | `unresolved` (no `external`) |

### 4.4 Monorepos (RS-WS)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| RS-WS-01 | `pnpm-workspace.yaml` con `packages: ['apps/*', "packages/**", '!**/test/**']` y comentarios | Paquetes descubiertos; exclusión aplicada |
| RS-WS-02 | `package.json` `"workspaces": ["packages/*"]` (npm) y `{ "packages": […] }` (yarn) | Ambos formatos |
| RS-WS-03 | `import { x } from '@myorg/shared'` con `"@myorg/shared": "workspace:*"` y **sin `node_modules`** | `internal` → `packages/shared/src/index.ts` (vía `exports`) |
| RS-WS-04 | Subpath `@myorg/shared/utils` con `exports: { "./utils": … }` y comodín `"./*"` | Resuelto |
| RS-WS-05 | `exports` apunta a `dist/` sin compilar | Fallback a fuente equivalente `src/` con marca `unbuilt` (D-8) |
| RS-WS-06 | Paquete sin `exports`: `main` / `module` / `types`, o `index.*` | Resuelto en ese orden |
| RS-WS-07 | Paquete que no está en workspaces, aunque exista en `node_modules` | `external`; nunca se indexa `node_modules` |
| RS-WS-08 | Nombre de workspace duplicado en dos carpetas | Aviso `WORKSPACE_DUPLICATE_NAME`; gana el primero en orden lexicográfico (determinista) |
| RS-WS-09 | Descubrimiento sin `npm install` ni symlinks (fixture sin `node_modules`) | Grafo inter-paquete conectado |

### 4.5 Resolutores políglotas (RS-PY, RS-GO, RS-RS, RS-JV)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| RS-PY-01 | `from ..pkg.mod import x` desde `app/sub/a.py` | `app/pkg/mod.py` o `app/pkg/mod/__init__.py` |
| RS-PY-02 | Absoluto `import app.core` con raíz de paquete por `pyproject.toml` o `__init__.py` | Interno; `import requests` → `external` |
| RS-GO-01 | `go.mod` `module github.com/acme/svc`; `import "github.com/acme/svc/pkg/auth"` | Arista al **directorio** `pkg/auth` (paquete Go = directorio) |
| RS-GO-02 | `fmt`, `net/http`, `github.com/other/lib` | `external` |
| RS-RS-01 | `mod foo;` desde `src/lib.rs` | `src/foo.rs` o `src/foo/mod.rs` |
| RS-RS-02 | `use crate::models::User` | `src/models.rs` o `src/models/mod.rs`; `use serde::…` → `external` |
| RS-JV-01 | `import com.corp.model.User` | `src/main/java/com/corp/model/User.java` (o `src/test/java`) |
| RS-JV-02 | `import com.corp.util.*` | Arista a cada `.java` del directorio del paquete |

---

## 5. `src/cartography/graph.mjs` — indexación y consultas (`test/cartography-graph.test.mjs`)

### 5.1 Esquema y migración v2 → v3 (GR-SCH) — también en `test/memory.test.mjs`

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| GR-SCH-01 | Base nueva | `user_version = 3`. Existen `module_dependencies` (`source_module`, `target_module`, `edge_type`, `target_kind`, `symbols_json`; PK `(source_module, target_module, edge_type)`) y sus índices `idx_deps_target` e `idx_deps_source` |
| GR-SCH-02 | `modules_graph` tiene las columnas nuevas: `language`, `node_type`, `content_hash`, `mtime_ms`, `size_bytes`, `has_opaque_deps` | Exacto |
| GR-SCH-03 | Base v2 con decisiones y observaciones existentes | Migra a v3 dentro de `BEGIN IMMEDIATE`; los datos previos quedan intactos |
| GR-SCH-04 | Dos procesos abren la misma base v2 a la vez | Una sola migración. El segundo ve v3 tras el re-chequeo dentro de la transacción |
| GR-SCH-05 | `user_version = 4` | Error `Unsupported memory schema version` (sin downgrade) |
| GR-SCH-06 | `DELETE` de un módulo | Sus aristas salientes desaparecen por `ON DELETE CASCADE` |

`memory.test.mjs:152` (`user_version === 2`) pasa a comparar contra `MEMORY_SCHEMA_VERSION`.

### 5.2 Indexación en streaming (GR-IDX) **[fs]**

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| GR-IDX-01 | Fixture TS de 6 archivos | Nodos, aristas y `edge_type` exactos (snapshot JSON ordenado) |
| GR-IDX-02 | Imports externos y no resueltos | Aristas con `target_kind` `external` y `unresolved`; no crean nodos |
| GR-IDX-03 | Respeta `.gitignore` y `DEFAULT_IGNORE_PATTERNS` (`node_modules`, `dist`, `.git`, `specs/.omni`) | Ninguno indexado |
| GR-IDX-04 | Symlink o junction que forma un bucle de directorios | No se sigue; sin bucle infinito |
| GR-IDX-05 | Archivo > 1 MB o binario (contiene NUL) | Omitido con motivo (`too-large`, `binary`) en el informe |
| GR-IDX-06 | Lotes: 1.000 archivos con `batchSize` 250 | Exactamente 4 transacciones `BEGIN IMMEDIATE` (spy sobre `memory.write`); ninguna `BEGIN` diferida |
| GR-IDX-07 | Fallo a mitad de un lote (archivo ilegible inyectado) | El lote hace rollback; el informe nombra el archivo; los lotes previos persisten |
| GR-IDX-08 | Rutas almacenadas en POSIX relativo en Windows | Exacto |
| GR-IDX-09 | Clasificación topológica (§5.1 del stress test): core (`d_in ≥ 20`, `d_out ≤ 3`), domain, leaf | `node_type` correcto en los umbrales exactos (19/20, 1/2) |
| GR-IDX-10 | Repo políglota (TS + Python + Go) | `language` por archivo y aristas de cada lenguaje |
| GR-IDX-11 | Lector concurrente durante la indexación (WAL) | El lector nunca recibe `SQLITE_BUSY` y ve un estado consistente por lote |

### 5.3 Caché incremental (GR-INC) **[fs]**

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| GR-INC-01 | Segunda pasada sin cambios | Cero lecturas de contenido (spy de `readFileSync`), solo `stat` |
| GR-INC-02 | `mtime` cambia y el contenido es idéntico | Se calcula el hash, no se re-parsea |
| GR-INC-03 | Contenido cambiado | Solo ese archivo se re-parsea; sus aristas se reemplazan en una transacción |
| GR-INC-04 | Archivo borrado | Nodo eliminado; aristas salientes en cascada; aristas entrantes pasan a `unresolved` |
| GR-INC-05 | Archivo nuevo que satisface un import antes `unresolved` | La arista pasa a `internal` |
| GR-INC-06 | Cambio en `tsconfig.json` o en `pnpm-workspace.yaml` | Invalida la resolución completa (re-resolución sin re-lectura de fuentes) |

### 5.4 CTE recursiva anti-ciclos (GR-CTE)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| GR-CTE-01 | Cadena `D → C → B → A`, consulta sobre `A` | `B:1, C:2, D:3` ordenados por distancia |
| GR-CTE-02 | `maxDepth` = 2 | `D` excluido |
| GR-CTE-03 | Ciclo `A ↔ B` | Termina; `B:1`; `A` no aparece como su propio consumidor |
| GR-CTE-04 | Autoimport `A → A` y triángulo `A → B → C → A` | Termina; distancias mínimas correctas |
| GR-CTE-05 | **Comodines de LIKE:** `src/a_b.py` visitado y `src/axb.py` también consumidor | `src/axb.py` **sí** aparece (hallazgo §1.2) |
| GR-CTE-06 | Rutas con `%`, `,` y espacios | Guarda correcta |
| GR-CTE-07 | Propagación del tipo de arista: `F ←type− A ←value− B` | `B` llega con clase `type_only` (la arista más débil del camino) |
| GR-CTE-08 | Dos caminos hacia `B` (uno `value`, otro `type_only`) | `B` cuenta como `value` con `MIN(depth)` |
| GR-CTE-09 **[perf]** | Grafo denso de 6 capas × 20 nodos completas, `maxDepth` = 6 | Termina en < 1 s con resultado completo, o con `truncated: true` según D-1 |
| GR-CTE-10 | 10.000 nodos, cadena de profundidad 10 | < 50 ms en la suite (EARS del stress test: < 1,2 ms en memoria, medido en el benchmark) |
| GR-CTE-11 | Orden estable ante empates (`distance`, después `path`) | Determinista entre ejecuciones |

### 5.5 Desenrollado de barrel files (GR-BRL)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| GR-BRL-01 | `index.ts`: `export { slugify } from './slug'; export { calculateTax } from './tax'` | Filas en `barrel_symbol_routes` hacia `slug.ts` y `tax.ts` |
| GR-BRL-02 | Alias `export { a as b } from './x'` | La ruta de `b` apunta a `x.ts` con símbolo de origen `a` |
| GR-BRL-03 | `export * from './x'` | Una ruta por cada export de `x.ts` (expansión con los exports indexados) |
| GR-BRL-04 | `export * as ns from './x'` | Ruta única `ns` → `x.ts` (namespace) |
| GR-BRL-05 | Barrels encadenados `index → sub/index → leaf` | Ruta final al módulo hoja (origen **real**) |
| GR-BRL-06 | Barrels cíclicos con `export *` mutuo | Termina; sin filas duplicadas |
| GR-BRL-07 | Un export local con el mismo nombre que un `export *` | El local gana (semántica ESM) |
| GR-BRL-08 | Dos `export *` que exportan el mismo nombre | Símbolo ambiguo: ruta conservadora a ambos orígenes, marcada `ambiguous` |
| GR-BRL-09 | `import { x } from './a'; export { x }` (import + export) | Ruta `x` → `a.ts`, `is_reexport = 1` |
| GR-BRL-10 | `export { default } from './Btn'` y `export { default as Btn } from './Btn'` | Rutas `default` y `Btn` |
| GR-BRL-11 | Cambio de un barrel en la caché incremental | Sus rutas se recalculan; las de otros barrels no se tocan |

### 5.6 Rendimiento y memoria (GR-PERF) **[perf] [child] [fs]**

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| GR-PERF-01 | Generador determinista: 4.000 archivos, 500.000 LOC, aliases y 3 paquetes de workspace | Indexación en frío sin errores; nodos = 4.000 |
| GR-PERF-02 | Tiempo de indexación en frío (proceso hijo) | Suelo en la suite < 5 s. El benchmark mide el objetivo EARS de **< 200 ms** |
| GR-PERF-03 | RSS máximo del hijo (`process.resourceUsage().maxRSS`) | En la suite: crecimiento sobre la línea base del hijo < 40 MB. En el benchmark: RSS absoluto **< 60 MB** |
| GR-PERF-04 | Segunda pasada incremental sin cambios | < 25 % del tiempo en frío |
| GR-PERF-05 | Sin `worker_threads` en el pipeline (spy de `Worker`) | Cero instancias (blueprint §4.3.5) |

---

## 6. `src/cartography/blast-radius.mjs` — evaluador (`test/cartography-blast-radius.test.mjs`)

**Diseño:** el núcleo matemático es una función pura, `scoreRisk({ impactedConsumers, edgeClass, centrality, testCoverage, contractLevel, rootAnchor })`. El adaptador `evaluateBlastRadius(graph, files, opts)` calcula esas entradas desde SQLite. Pesos congelados en `RISK_WEIGHTS = Object.freeze({ alpha: 0.5, beta: 0.2, gamma: 0.3, delta: 0.4, kSat: 30, omegaTypeOnly: 0.1, omegaValue: 1.0 })`. Las puntuaciones se redondean a 2 decimales **solo** en la salida.

### 6.1 Saturación Φ(K) (BR-PHI)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| BR-PHI-01 | Φ(0) | 0 |
| BR-PHI-02 | Φ(1), Φ(5), Φ(10) | 0,201849…, 0,521772…, 0,698283… (tolerancia 1e-6) |
| BR-PHI-03 | Φ(30) y Φ(1000) | 1 (saturado) |
| BR-PHI-04 | Monótona no decreciente en K ∈ [0, 100] | Verificado |
| BR-PHI-05 | K negativo, `NaN` o no entero | `TypeError` |

### 6.2 Fórmula S_risk (BR-FX)

Valores de referencia: K = 10, Centrality = 0,25.

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| BR-FX-01 | `value`, cobertura 0, contrato 0 | 100·(0,5·0,698283 + 0,2·0,25) = **39,91** |
| BR-FX-02 | Igual con cobertura 1 | 39,91 × 0,6 = **23,95** |
| BR-FX-03 | Igual con cobertura 1 y contrato activo (1,0) | 23,95 + 30 = **53,95** |
| BR-FX-04 | **Aislamiento del contrato:** K = 0, centralidad 0, cobertura 1, contrato 1 | **30** (no 18: el contrato no se amortigua) |
| BR-FX-05 | `type_only` (ω = 0,1), cobertura 0, contrato 0 | 100·(0,5·0,698283·0,1 + 0,05) = **8,49** |
| BR-FX-06 | Contrato propuesto (0,5) frente a ninguno o retirado (0) | +15 frente a +0 |
| BR-FX-07 | Máximo: K ≥ 30, centralidad 1, cobertura 0, contrato 1 | **100** |
| BR-FX-08 | Mínimo: todo 0 | **0** |
| BR-FX-09 | Invariante: α + β + γ = 1 y S ∈ [0, 100] sobre 10.000 entradas aleatorias con semilla | Nunca fuera de rango |
| BR-FX-10 | `RISK_WEIGHTS` congelado | Mutar lanza en modo estricto |
| BR-FX-11 | Entradas fuera de [0, 1] (centralidad 1,2; cobertura −0,1) | `RangeError` (sin recorte silencioso) |

### 6.3 Niveles de gobernanza (BR-LVL) — §5.3 del stress test

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| BR-LVL-01 | 24,99 / 25 / 69,99 / 70 | `low` / `medium` / `medium` / `high` |
| BR-LVL-02 | `high` | `gate: 'CONTRACT_BREACH_BLOCKER'`; `medium` → `confirm`; `low` → `proceed` |
| BR-LVL-03 | El umbral se aplica sobre la puntuación **sin redondear** (69,996 no sube a 70) | `medium` |

### 6.4 Entradas derivadas del grafo (BR-SYM, BR-CEN, BR-COV, BR-CON)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| BR-SYM-01 | `utils.ts` exporta `slugify`, `formatDate` y `calculateTax`; Δ = `{slugify}` | Solo cuentan los consumidores de `slugify` |
| BR-SYM-02 | Consumidor vía barrel `import { formatDate } from './utils/index'` con Δ = `{calculateTax}` | **No** impactado (criterio EARS: sin falsos positivos de barrel) |
| BR-SYM-03 | `import * as u`, `import './utils'` (side-effect) o `require('./utils')` | Cuenta para cualquier Δ (conservador) |
| BR-SYM-04 | Δ omitido | Δ = todos los exports de F (conservador) |
| BR-SYM-05 | Saltos transitivos ≥ 2 | Nivel de archivo (el flujo de símbolos intermedio no es observable léxicamente). Documentado |
| BR-SYM-06 | ω: todos los caminos impactados `type_only` → 0,1; alguno `value` → 1,0 | Exacto |
| BR-CEN-01 | Centralidad = d_in(runtime) / (N − 1) sobre aristas `value` | Valores exactos en un fixture de 5 nodos; N ≤ 1 → 0 |
| BR-COV-01 | Fuente de cobertura según D-3 | Niveles 1,0 / 0,5 / 0 en tres fixtures |
| BR-COV-02 | Detección de módulos de test: `*.test.*`, `*.spec.*`, `__tests__/`, `test/`, `test_*.py`, `*_test.go`, `src/test/java/` | Clasificados como test |
| BR-CON-01 | Mapeo de contrato según D-2: contrato `active` cuya `evidence` cita F o su directorio | 1,0; `proposed` → 0,5; `retired` o ninguno → 0 |
| BR-CON-02 | `contracts.json` ausente o inválido | ContractLevel 0 con aviso `CONTRACTS_UNREADABLE` (no colapsa) |

### 6.5 Anclas raíz y puentes sintéticos (BR-ANC, BR-BRG)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| BR-ANC-01 | `package.json`, `tsconfig.json`, `jsconfig.json`, `pnpm-workspace.yaml`, `.env.example`, `go.mod`, `Cargo.toml`, `pyproject.toml` en la raíz | `ROOT_ANCHOR`, S = 100, nivel `high` |
| BR-ANC-02 | `packages/ui/package.json` (no raíz) | Ancla del **paquete**: S = 100 solo si el paquete tiene consumidores de workspace; si no, se evalúa normalmente |
| BR-ANC-03 | `tsconfig.base.json` referenciado por `extends` desde la raíz | `ROOT_ANCHOR` (forma parte de la cadena raíz) |
| BR-BRG-01 | `prisma/schema.prisma` | Arista sintética hacia los importadores de `@prisma/client` |
| BR-BRG-02 | `migrations/*.sql` / `db/migrations/*.sql` | Arista sintética hacia el mismo destino del ORM detectado (Prisma o Drizzle), o `unbridged` si no hay ORM |
| BR-BRG-03 | Puentes declarados en `manifest.json` `cartography.bridges: [{ asset, consumers }]` | Respetados |
| BR-BRG-04 | Las aristas sintéticas se distinguen en la salida (`edge_type: 'synthetic'`) y cuentan como `value` | Exacto |

### 6.6 Informe y casos límite (BR-RPT)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| BR-RPT-01 | Archivo no indexado (nuevo) | `indexed: false`, S = 0, nivel `low`, aviso `NOT_INDEXED` |
| BR-RPT-02 | Archivo con `has_opaque_deps` en sí o en un consumidor | Aviso `UNCERTAIN_DEPENDENCY_RISK` (§2.3 del stress test); la puntuación no cambia |
| BR-RPT-03 | Varios archivos | Informe por archivo + `overall` = máximo + unión de consumidores sin duplicados |
| BR-RPT-04 | Forma del informe estable (`schemaVersion: 1`, campos ordenados) | Snapshot JSON |
| BR-RPT-05 | Mismo grafo y mismas entradas | Salida byte a byte idéntica (determinismo) |

---

## 7. CLI y MCP (`test/cartography-cli.test.mjs`, `test/mcp-server.test.mjs`)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| CLI-01 | `omni-spec cartography` en un repo fixture | Resumen: archivos, aristas, lenguajes, núcleos `core`, ciclos detectados y duración. Código 0 |
| CLI-02 | `omni-spec cartography --json` | JSON estable (snapshot de forma, sin tiempos variables fuera de `timings`) |
| CLI-03 | `omni-spec cartography` fuera de un proyecto OmniSpec | Código ≠ 0 con mensaje claro |
| CLI-04 | `omni-spec blast-radius src/utils.ts src/a.ts` | Tabla por archivo con nivel y consumidores; reindexación incremental previa automática (D-6) |
| CLI-05 | `--json`, `--depth 5` y `src/utils.ts#slugify,formatDate` (Δ explícito, D-4) | Respetados |
| CLI-06 | Rutas con `\` de Windows, absolutas dentro de la raíz o con `./` | Normalizadas a POSIX relativo |
| CLI-07 | Ruta fuera de la raíz (`../../etc/passwd`, `C:\Windows\x`) | Código ≠ 0 `PATH_OUTSIDE_ROOT`; nada se lee |
| CLI-08 | Código de salida: 0 por defecto; `--fail-on high` con resultado `high` → 2 (D-7) | Exacto |
| CLI-09 | `blast-radius` sin archivos | Uso + código ≠ 0 |
| CLI-10 | `--help` lista `cartography` y `blast-radius` | Presentes |
| CLI-11 | `--depth` fuera de [1, 10] | Error de validación |
| CLI-12 | `cartography` dos veces seguidas | La segunda informa `incremental: true` y 0 archivos re-parseados |
| MCP-01 | `omni_check_blast_radius` devuelve el informe del motor real (mismo JSON que `blast-radius --json`) | Igualdad estructural |
| MCP-02 | Acepta la notación `file#sym` en `files` | Δ aplicado |
| MCP-03 | **Reescrito** (antes "reports an uninitialized cartography explicitly"): índice vacío | Indexa de forma incremental y responde (D-6), sin `isError` |
| MCP-04 | **Reescrito** (antes "returns direct dependents from modules_graph"): fixture con imports reales | Consumidores, nivel y puntuación del motor real |
| MCP-05 | Ruta fuera de la raíz | `isError: true` con `PATH_OUTSIDE_ROOT` |

---

## 8. Decisiones que necesito aprobar antes de empezar en rojo

1. **D-1 — Guarda de ciclos de la CTE.**
   - Se mantiene el acumulador `visited_path` exigido, pero la comprobación usa `instr()` en lugar de `LIKE` (hallazgo §1.2). La semántica es idéntica, sin comodines.
   - Contra la explosión en grafos densos (§1.3) caben dos opciones:
     - **(a) Recomendada:** presupuesto de filas (`LIMIT` en la CTE, por defecto 200.000) con `truncated: true` en el informe, y `maxDepth` por defecto 3 (máximo 10).
     - **(b)** `UNION` sobre `(nodo, profundidad, clase)`. Polinómica y siempre completa, pero sustituye la guarda de camino.
2. **D-2 — `ContractLevel(F)`.** Un contrato cubre F si alguna referencia de su `evidence` es una ruta del repo igual a F o un directorio que lo contiene. `active` = 1,0, `proposed` = 0,5, `retired` o sin contrato = 0. No cambia el esquema de `contracts.json`.
3. **D-3 — `TestCoverage(F)`.**
   - **1,0:** F tiene al menos un módulo de test que lo importa directamente **y** la última verificación atestada (HMAC, Fase 2) de la spec activa pasó.
   - **0,5:** tiene importadores de test sin evidencia atestada.
   - **0:** no tiene importadores de test.
   - Se descarta la cifra del 50 % del stress test: con δ = 0,40 la reducción máxima es del 40 %.
4. **D-4 — Entrada Δ.** Notación `ruta#sym1,sym2` en CLI y MCP. Sin `#`, Δ = todos los exports (conservador). Derivar Δ del `git diff` queda fuera de esta fase.
5. **D-5 — Rendimiento.** La suite fija suelos conservadores para no generar tests intermitentes en Windows con Defender: ≥ 1 M LOC/s, < 5 s y +40 MB. `npm run bench:cartography` mide y exige los objetivos EARS: 3 M LOC/s, < 200 ms y < 60 MB. Informaré las cifras reales medidas, sean cuales sean.
6. **D-6 — Índice siempre fresco.** `blast-radius` y la herramienta MCP ejecutan una pasada incremental antes de calcular (coste ≈ un `stat` por archivo). Desaparece el error `Cartography index is empty`.
7. **D-7 — Código de salida.** `blast-radius` sale con 0 por defecto. `--fail-on low|medium|high` sale con 2 cuando se alcanza el umbral, para hooks y CI.
8. **D-8 — `exports` y condiciones.**
   - Orden de condiciones: `source`, `types`, `import`, `module`, `require`, `node`, `default`.
   - Si el destino está en un `dist/` sin compilar, se prueba el equivalente en `src/` (mismo nombre, extensión TS) y la arista se marca `unbuilt`.

**Fuera de alcance de esta fase:**
- Extracción de tokens DI (`@Inject`, `Depends`).
- Detección de contratos OpenAPI entre frontend y backend.
- Escritura de `blast-radius.json` para la Compuerta 1 (`gates.mjs` ya lo acepta como entrada).
- Δ automático desde `git diff`.

Los propondré como Fase 3b si se quieren.

---

## 9. Orden de implementación (rojo → verde)

**Línea base (2026-11-05, rama recién creada):** 678 tests: 666 pasan, 3 omitidos y **9 fallan**. Los 9 están en `plugin-manager` y `plugin-coexistence` y tienen una causa ajena al código: el CLI `agy` de Antigravity se auto-actualizó hoy a la 1.5.1 y `agy plugin validate --strict` ahora emite un *warning* cuando `plugin.json` no declara `"version"`.

0. `fix(plugin)`: declarar `version` en `plugin.json` (sincronizada con `package.json`) para recuperar el verde antes del primer test rojo de la fase.
1. Lexer: masker JS con pila de plantillas y heurística `/` (LX-MASK, LX-TPL, LX-RE) → extracción JS (LX-JS) → políglota → LX-DIFF, LX-ROB y LX-PERF.
2. Resolutor: relativos y sondeo → tsconfig y JSONC → `package.json#imports` → workspaces → políglotas.
3. Migración de esquema v3 (GR-SCH) → indexación (GR-IDX) → caché incremental (GR-INC).
4. CTE anti-ciclos (GR-CTE) → barrels (GR-BRL) → GR-PERF y benchmark.
5. Evaluador puro (BR-PHI, BR-FX, BR-LVL) → adaptador sobre el grafo (BR-SYM … BR-RPT).
6. CLI (`cartography`, `blast-radius`) → MCP (reescritura de los 2 tests) → `CHANGELOG.md`.

En cada paso: `npm test` completo + `npm run lint` en verde antes del commit (Conventional Commits en inglés con viñetas).
