# Fase 2 — Plan de Tests (TDD)

**Alcance:** Omni-Guardian · Ceremonia adaptativa y auditor tipado · Circuit Breaker · Atestación HMAC · Auth Broker DPAPI
**Referencias:** `OMNI-NEXTGEN-BLUEPRINT.md` §2, §4.4, §4.6, §4.8, §5 (Fase 2) · `OMNI-AGENTIC-SECURITY-AUDIT.md` §2.3, §3.3, §5, §6, §7
**Runner:** `node --test --test-concurrency=1` (cero dependencias). Rama: `feat/nextgen-phase1-memory-core` → nueva rama `feat/nextgen-phase2-guardian-governance`.
**Regla de oro:** cada test de esta lista se escribe y se ve fallar (rojo) antes de escribir el código que lo pone en verde. La suite existente debe seguir en verde en cada commit.

---

## 0. Trazabilidad de amenazas y controles

La auditoría no numera amenazas `T-0x` ni controles `C-0x`. Este plan fija esa numeración a partir de la matriz STRIDE (§3.3) y las barreras (§5–§7), para que cada test cite lo que cubre.

| ID | Amenaza (auditoría) | Control(es) |
| :-- | :-- | :-- |
| **T-01** Spoofing | Skill suplanta a una oficial (AST02) | *Fuera de Fase 2* (skill-sanitizer, §4 auditoría) |
| **T-02** Tampering | Alteración de `acceptance.json` / contexto por el agente | C-04, C-05, C-07 |
| **T-03** Repudiation | Evidencia falsificada (`verification.json`, logs) | C-05, C-06 |
| **T-04** Info Disclosure | Exfiltración de secretos (`.env`, tokens) | C-08, C-03 |
| **T-05** DoS / Denial of Wallet | Bucle infinito de reintentos, drenaje de tokens | C-04 |
| **T-06** Elevation of Privilege | Shell escape, binarios de sistema en Windows | C-01, C-02 |

| ID | Control | Módulo |
| :-- | :-- | :-- |
| **C-01** | Whitelist/blacklist de binarios + resolución de shims sin `cmd.exe` | `guardian.mjs` |
| **C-02** | Prohibición de operadores shell + jail de `cwd` (incl. junctions NTFS) | `guardian.mjs` |
| **C-03** | Pre-commit: conflictos Git + reglas anti-slop sobre el contenido *staged* | `guardian.mjs` |
| **C-04** | Circuit Breaker FSM persistente (turnos, reintentos, presupuesto, tasa) | `circuit-breaker.mjs` |
| **C-05** | Atestación HMAC-SHA256 de ejecución en SO | `verification.mjs` |
| **C-06** | Guarda anti-aserciones vacías (*hollow tests*) | `verification.mjs` |
| **C-07** | Compuertas humanas 1 y 2 ligadas a huella (`--full`) + validación tipada | `auditor.mjs` |
| **C-08** | Almacén DPAPI con entropía + mutex interproceso de refresco | `auth.mjs` |

---

## 1. Hallazgos del código actual que condicionan el diseño

Leí el código antes de escribir el plan. Estos puntos cambian lo que hay que probar:

1. **`verification.mjs:134` ejecuta checks con `spawn(command, { shell: true })`.** Hoy la inyección vía `checks.json` es posible. Para pasar a `shell: false` hay un problema concreto: en Windows `npm`, `npx`, `vitest`, `tsc` y `biome` son shims `.cmd`, y desde CVE-2024-27980 Node lanza `EINVAL` al hacer spawn de `.cmd`/`.bat` sin shell. **Decisión de diseño:** el guardian resuelve cada binario permitido a `process.execPath` + script JS (por ejemplo `npm` → `node <npm-cli.js>`, y `vitest` → el `bin` de su `package.json`). Así nunca se usa `cmd.exe`. Los tests G-RES lo cubren.
2. **Los tests existentes usan comandos con operadores dentro de comillas:** `node -e "setTimeout(()=>process.exit(0),5000)"` (`checks.test.mjs:126`) contiene `>`. Una prohibición literal de caracteres rompe la suite. **Propuesta:** prohibición *consciente de comillas*: cualquier operador fuera de comillas se rechaza. Dentro de comillas el carácter es dato inerte, porque con `shell: false` no hay intérprete que lo expanda. La alternativa estricta exige reescribir esos fixtures.
3. **La ceremonia `light/standard/full` ya existe** (`fit.mjs` `ROUTES`, flags en `cli.mjs:282`). La Fase 2 no la reinventa. Añade las **compuertas 1 y 2** en `--full` y mueve la validación a datos tipados.
4. **El auditor depende de regex sobre Markdown:** checkboxes `- [ ]` (`auditor.mjs:23`), cabeceras con "verif" (`:72`, `:100`) y la sección 0 (`:252`). Los tests AU-TYPED migran checkboxes y trazabilidad de verificación a JSON. La sección 0 queda como legado (fuera de alcance).
5. **No existe parser JS en Node sin dependencias.** El "AST guard" y las reglas anti-slop se implementan sobre un **lexer de tokens** (aísla strings, comentarios, regex y template literals) en `src/js-lexer.mjs`. La Fase 3 lo extenderá a Pushdown DFA. Tiene su propio bloque de tests (LX).
6. **`src/` ya contiene 7 `catch {}` vacíos** (`generator.mjs` ×5, `plugin-manager.mjs` ×2). El guardian solo inspecciona archivos *staged*, así que no bloquea nada hoy. Pero el test de *dogfooding* (G-SLOP-12) obliga a sanearlos en esta fase.
7. **Git nunca ejecuta `pre-commit.cmd` ni `.ps1`.** Git for Windows ejecuta `.git/hooks/pre-commit` con su `sh` incluido. **Diseño:** `pre-commit` (sh) es el hook real en todas las plataformas. `.cmd` y `.ps1` son shims para invocación manual y para herramientas de Windows (Omni Studio). Los tests de integración hacen un `git commit` real.
8. **Un breaker solo en RAM se evade reiniciando el proceso.** El estado del breaker se persiste en `memory.db` (Fase 1) con una tabla nueva `circuit_breakers`.

---

## 2. Inventario de archivos

| Archivo nuevo/modificado | Tipo | Tests |
| :-- | :-- | --: |
| `test/js-lexer.test.mjs` | nuevo | 10 |
| `test/guardian.test.mjs` | nuevo | 52 |
| `test/circuit-breaker.test.mjs` | nuevo | 30 |
| `test/attestation.test.mjs` | nuevo | 20 |
| `test/hollow-assertion.test.mjs` | nuevo | 14 |
| `test/auditor-ceremony.test.mjs` | nuevo | 22 |
| `test/auth.test.mjs` | nuevo | 30 |
| `test/checks.test.mjs`, `test/verification-evidence.test.mjs` | ampliados | 6 |
| **Total Fase 2** | | **≈184** |

Los tests marcados con **[win32]** usan `{ skip: process.platform !== 'win32' }`, y los **[posix]** el inverso. Los marcados **[git]** crean un repo temporal con `git init` en `mkdtemp`.

---

## 3. `src/js-lexer.mjs` — lexer compartido (LX)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| LX-01 | Comentarios `//` y `/* */` | Tokens `comment`, no código |
| LX-02 | Strings `'…'`, `"…"` con escapes `\'` | Un solo token `string` |
| LX-03 | Template literal con `${expr}` anidado y backticks internos | Interpolación tokenizada como código; resto como `template` |
| LX-04 | Regex literal vs división (`a / b / c` vs `x = /a\/b/g`) | Clasificación correcta en ambos casos |
| LX-05 | Código dentro de string (`"catch {}"`) | No produce tokens de código |
| LX-06 | CRLF y LF | Mismas posiciones de línea lógica |
| LX-07 | BOM inicial | Ignorado |
| LX-08 | String sin cerrar / comentario sin cerrar | Error `LEX_UNTERMINATED` con línea |
| LX-09 | Llaves balanceadas: devuelve el rango de cada bloque `{…}` | Rangos correctos con anidamiento |
| LX-10 | Rendimiento: archivo de 5.000 líneas | < 50 ms |

---

## 4. `src/guardian.mjs` — Omni-Guardian (`test/guardian.test.mjs`)

### 4.1 Confinamiento de comandos — C-01, C-02 · T-06

**Whitelist / blacklist (G-BIN)**

| ID | Entrada | Esperado |
| :-- | :-- | :-- |
| G-BIN-01 | `node x.js`, `npm test`, `git status`, `tsc --noEmit`, `biome ci .`, `vitest run` | Permitido; `{ binary, args, cwd }` |
| G-BIN-02 | `NODE`, `Node.EXE`, `npm.cmd` | Normalizado y permitido |
| G-BIN-03 | `cmd`, `cmd.exe`, `powershell`, `pwsh.exe`, `certutil`, `bitsadmin`, `reg`, `rundll32`, `mshta`, `wscript`, `cscript`, `regsvr32` (tabla) | `GUARDIAN_FORBIDDEN_BINARY` |
| G-BIN-04 | `curl`, `python`, `ruby` (no listados; los shells `bash`/`sh`/`zsh`/`wsl` son prohibidos) | `GUARDIAN_UNAUTHORIZED_BINARY` (código distinto de BIN-03) |
| G-BIN-05 | Ruta calificada: `C:\evil\node.exe`, `../node`, `/tmp/npm` | Rechazado. La regla canónica de la auditoría (tomar el *basename*) dejaría pasar `C:\evil\node.exe`. |
| G-BIN-06 | `node_modules/.bin/vitest` (relativo al repo) | Permitido solo si el destino permitido está dentro del repo |
| G-BIN-07 | `npx some-unknown-pkg` | Rechazado: `npx` solo con un segundo token de la whitelist |
| G-BIN-08 | `git -c core.pager=evil log`, `git -c alias.x=!sh x`, `--upload-pack=` | `GUARDIAN_HAZARDOUS_ARGUMENT` |
| G-BIN-09 | Whitelist extendida en `manifest.json` (`guardian.allowedBinaries`) | Respeta la extensión. Nunca puede re-permitir un binario de BIN-03 |

**Operadores shell (G-OP)**

| ID | Entrada | Esperado |
| :-- | :-- | :-- |
| G-OP-01 | `npm test & del x`, `a && b`, `a \| b`, `a \|\| b`, `a ; b` (tabla) | `GUARDIAN_SHELL_OPERATOR` |
| G-OP-02 | `` node `whoami` ``, `node $(id)`, `node ${X}` | `GUARDIAN_SHELL_OPERATOR` |
| G-OP-03 | `node a > out`, `node a >> out`, `node a < in`, `2>&1` | `GUARDIAN_SHELL_OPERATOR` |
| G-OP-04 | Saltos de línea `\n`, `\r`, `\u2028` | Rechazado |
| G-OP-05 | Caracteres de control, zero-width (`\u200B`), BiDi (`\u202E`) | `GUARDIAN_INVISIBLE_CHAR` |
| G-OP-06 | `node -e "setTimeout(()=>process.exit(0),5000)"` (fixture existente) | **Permitido** (operador dentro de comillas; ver §1.2) |
| G-OP-07 | Comillas desbalanceadas `node -e "x` | `GUARDIAN_PARSE_ERROR` |
| G-OP-08 | Tokenización: `node -e "require('./v.cjs')"` → `['node','-e',"require('./v.cjs')"]` | Exacto |
| G-OP-09 | Comando vacío o solo espacios | `GUARDIAN_EMPTY_COMMAND` |

**Jail de `cwd` (G-CWD)**

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| G-CWD-01 | `cwd: '.'`, `cwd: 'packages/a'` | Permitido, ruta real |
| G-CWD-02 | `cwd: '..'`, `cwd: 'a/../../x'`, ruta absoluta externa | `GUARDIAN_UNSAFE_CWD` |
| G-CWD-03 | Symlink dentro del repo apuntando fuera **[posix]** | `GUARDIAN_UNSAFE_CWD` |
| G-CWD-04 | Junction NTFS (`symlinkSync(t, p, 'junction')`) apuntando fuera **[win32]** | `GUARDIAN_UNSAFE_CWD` |
| G-CWD-05 | Repo cuya ruta contiene espacios (`Analisis propio OMNI`) | Permitido |

**Resolución de ejecución sin shell (G-RES)** — §1.1

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| G-RES-01 | `npm test` **[win32]** | Plan de spawn = `process.execPath` + `npm-cli.js`; `shell: false`; nunca `cmd.exe` |
| G-RES-02 | `vitest`/`tsc`/`biome` desde `node_modules` (fixture con `package.json` `bin`) | Resuelto a `node <bin.js>` |
| G-RES-03 | Binario permitido no instalado | Error `environment` (no `check-failed`) |
| G-RES-04 | Spy de `spawn`: ninguna llamada del motor usa `shell: true` | Verificado sobre `verification.mjs` |

### 4.2 Pre-commit — C-03 · T-02, T-04

**Inspección de staged (G-STG)** **[git]**

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| G-STG-01 | Lista = `git diff --cached --name-only -z --diff-filter=ACMR` | Solo añadidos/modificados/renombrados; borrados excluidos |
| G-STG-02 | Nombres con espacios, unicode y saltos de línea | Parseados por `-z` correctamente |
| G-STG-03 | Contenido leído del **índice** (`git show :path`), no del working tree | Índice con marcador y working tree limpio → bloquea |
| G-STG-04 | Caso inverso: working tree con marcador, índice limpio | Permite |
| G-STG-05 | Archivo binario (contiene NUL) | Omitido de reglas de texto |
| G-STG-06 | Sin archivos staged | Sale con 0 sin trabajo |

**Marcadores de conflicto (G-CONF)**

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| G-CONF-01 | `<<<<<<< HEAD` al inicio de línea | `GUARDIAN_CONFLICT_MARKER` con `archivo:línea` |
| G-CONF-02 | `>>>>>>> branch` | Bloquea |
| G-CONF-03 | `\|\|\|\|\|\|\| base` (estilo diff3) | Bloquea |
| G-CONF-04 | `=======` junto a `<<<<<<<` o `>>>>>>>` en el mismo archivo | Bloquea |
| G-CONF-05 | `=======` aislado en Markdown (subrayado setext de H1) | **No** bloquea (falso positivo evitado) |
| G-CONF-06 | Marcador indentado o dentro de un string (`'<<<<<<< '`) | No bloquea (solo a columna 0) |
| G-CONF-07 | `specs/decisions/*.json` con marcador | Bloquea (protege memoria Fase 1) |

**Anti-slop (G-SLOP)** — sobre el lexer (LX)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| G-SLOP-01 | `catch {}`, `catch (e) {}`, `catch (e) { /* nada */ }` | `SLOP_EMPTY_CATCH` |
| G-SLOP-02 | `catch { return null; }`, `return undefined`, `return` | `SLOP_SWALLOWED_ERROR` |
| G-SLOP-03 | `catch (e) { throw new X(..., { cause: e }) }`, `log(e)`, rama con manejo | Permitido |
| G-SLOP-04 | `catch` vacío dentro de string o comentario | Permitido |
| G-SLOP-05 | `.ts`/`.tsx`: `: any`, `as any`, `<any>`, `any[]`, `Array<any>` | `SLOP_BLIND_TYPE` |
| G-SLOP-06 | `as unknown as T` | `SLOP_BLIND_CAST` |
| G-SLOP-07 | La palabra `any` en `.mjs`/`.js` o dentro de strings/comentarios | Permitido |
| G-SLOP-08 | Sentencias tras `return`/`throw`/`break`/`continue` en el mismo bloque | `SLOP_DEAD_CODE` |
| G-SLOP-09 | `if (false)`, `if (0)`, `while (false)` | `SLOP_DEAD_CODE` |
| G-SLOP-10 | Supresión explícita `// guardian-allow SLOP_EMPTY_CATCH: <motivo>` | Permitido solo con motivo no vacío |
| G-SLOP-11 | Solo se reportan violaciones en **líneas añadidas** del diff staged | Código legado no tocado no bloquea |
| G-SLOP-12 | *Dogfooding*: `src/**/*.mjs` del propio repo | Cero violaciones (obliga a sanear §1.6) |

### 4.3 Instalación de hooks y shims (G-HOOK)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| G-HOOK-01 | `installHooks()` usa `git rev-parse --git-path hooks` (respeta `core.hooksPath` y worktrees) **[git]** | Hook en la ruta correcta |
| G-HOOK-02 | Genera `pre-commit` (sh, LF, `#!/bin/sh`), `pre-commit.cmd` (CRLF) y `pre-commit.ps1` | Contenido exacto (snapshot) |
| G-HOOK-03 | Ruta de Node y del repo con espacios | Correctamente entrecomilladas en los tres shims |
| G-HOOK-04 | Bit ejecutable en `pre-commit` **[posix]** | `mode & 0o111` |
| G-HOOK-05 | Hook previo ajeno existente | No lo sobrescribe: lo encadena (`pre-commit.local`) o aborta sin `--force` |
| G-HOOK-06 | Reinstalación idempotente | Mismo contenido, sin duplicar el encadenado |
| G-HOOK-07 | `uninstallHooks()` | Restaura el hook previo; elimina solo lo propio |
| G-HOOK-08 | `git commit` real con marcador de conflicto staged **[git]** | Exit ≠ 0, commit no creado, mensaje con `archivo:línea` |
| G-HOOK-09 | `git commit` real limpio **[git]** | Commit creado |
| G-HOOK-10 | `pre-commit.cmd` invocado directamente **[win32]** | Mismo veredicto que el hook sh |
| G-HOOK-11 | Rendimiento: 200 archivos staged × 300 líneas | < 1,5 s |

---

## 5. `src/circuit-breaker.mjs` — FSM (`test/circuit-breaker.test.mjs`) — C-04 · T-05

Reloj (`now`) y aleatoriedad (`random`) inyectables. Ningún test usa `setTimeout` real.

**Semántica de reintentos fijada aquí.** La auditoría tiene una inconsistencia: el diagrama (§5.1) pasa a `HALF_OPEN` al agotar los reintentos, mientras que el código canónico (§5.3) entra en `HALF_OPEN` desde el primer fallo y nunca llega a `DEAD_LETTER`. Propuesta coherente con "máx. 2 reintentos":

- fallo 1 → `CLOSED` (reintento 1);
- fallo 2 → `HALF_OPEN` (el reintento 2 es la sonda única);
- fallo 3 → `OPEN`.

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| CB-01 | Construcción por defecto | `CLOSED`; límites 3 / 2 / 80.000 / 25.000 por 60 s / 60.000 ms |
| CB-02 | Config inválida (0, negativo, `NaN`, no entero) | `TypeError` |
| CB-03 | Turnos 1–3 | Permitidos |
| CB-04 | Turno 4 | `OPEN`, `CircuitBreakerOpenError` con `reason: 'MAX_TURNS_EXCEEDED'` y snapshot de contadores |
| CB-05 | Tokens acumulados = 80.000 | Permitido (límite inclusivo) |
| CB-06 | Tokens acumulados = 80.001 | `TOKEN_BUDGET_EXCEEDED` |
| CB-07 | `recordTokenUsage(-5)`, `NaN`, `1.5`, `Infinity` | `TypeError` (anti-gaming: no se puede "devolver" presupuesto) |
| CB-08 | 25.001 tokens en 59.999 ms | `RATE_LIMIT_EXCEEDED` |
| CB-09 | 20.000 en t=0 y 20.000 en t=60.001 | Sin disparo (la ventana se desliza) |
| CB-10 | Ambos límites superados en la misma llamada | Razón determinista: `TOKEN_BUDGET_EXCEEDED` |
| CB-11 | Fallo de compuerta 1 | `CLOSED`, `canRetry: true` |
| CB-12 | Fallo de compuerta 2 | `HALF_OPEN` |
| CB-13 | Éxito en `HALF_OPEN` | `CLOSED`, reintentos de esa compuerta a 0. **Turnos y tokens NO se reinician** (desviación deliberada del "restablecer presupuesto" del diagrama: reiniciarlo reabre el drenaje) |
| CB-14 | Fallo 3 (sonda) | `OPEN`, `VERIFICATION_RETRIES_EXHAUSTED` |
| CB-15 | Reintentos por compuerta: A falla ×2 y B falla ×1 | Contadores independientes |
| CB-16 | Toda operación en `OPEN` (`incrementTurn`, `recordTokenUsage`, `recordGateFailure`, `recordGateSuccess`) | Lanza (el código canónico olvida `recordGateFailure`) |
| CB-17 | `resetByHuman({ actor, reason })` desde `OPEN` | `CLOSED`, contadores a 0, evento auditado |
| CB-18 | `resetByHuman` sin `actor` o `reason` | `TypeError` |
| CB-19 | `resetByHuman` desde `CLOSED` o `HALF_OPEN` | `ILLEGAL_TRANSITION` |
| CB-20 | `abort(reason)` desde `OPEN` | `DEAD_LETTER` |
| CB-21 | `abort` desde `CLOSED`/`HALF_OPEN` | `DEAD_LETTER` |
| CB-22 | `DEAD_LETTER` es terminal: cualquier evento, incluido `resetByHuman` | Lanza |
| CB-23 | Matriz exhaustiva 4 estados × 7 eventos | Cada celda = transición o `ILLEGAL_TRANSITION` según la tabla |
| CB-24 | `toJSON()` / `fromJSON()` | Ida y vuelta exacta, incluida la ventana de tokens |
| CB-25 | `fromJSON` con estado manipulado (`state:'CLOSED'` + `consumedTokens: 90000`) | Rechazado: el invariante se revalida al cargar |
| CB-26 | Persistencia en `memory.db` (tabla `circuit_breakers` por `taskId`) | Estado `OPEN` sobrevive a cerrar y reabrir la DB |
| CB-27 | Dos procesos sobre la misma tarea (`spawn` de 2 workers) | Contadores sin pérdida (transacción `BEGIN IMMEDIATE`) |
| CB-28 | `backoffMs(attempt)` con `random` fijo | `min(8000, 500·2^n) + jitter` y jitter ∈ [0, 250) |
| CB-29 | `hardTimeoutMs` se aplica solo a ejecuciones del pipeline autónomo | `verify` manual conserva el timeout actual de `checks.json` (compatibilidad) |
| CB-30 | Mensaje de error | Incluye estado, razón y la acción humana requerida, sin datos sensibles |

---

## 6. `src/verification.mjs` — atestación HMAC (`test/attestation.test.mjs`) — C-05 · T-02, T-03

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| AT-01 | Llave de sesión: 32 bytes de `randomBytes`, distinta en dos procesos | Verificado con 2 `spawn` |
| AT-02 | Firma determinista para mismo payload y llave | Igual |
| AT-03 | Cada campo firmado altera la firma (tabla: `version`, `specId`, `fingerprint`, `checkId`, `command`, `cwd`, `outputLogHash`, `exitCode`, `processId`, `startedAt`) | Firma distinta por campo. Se añaden `command`, `cwd` y `version`, que el canónico omite |
| AT-04 | Inyección de delimitador: `checkId='a\|b', fp='c'` vs `checkId='a', fp='b\|c'` | Firmas distintas (codificación con longitud prefijada, no `join('\|')`) |
| AT-05 | Comparación con `timingSafeEqual` | Firma con longitud o hex inválido → `false`, sin excepción |
| AT-06 | `verification.json` v4 incluye `attestationSignature` por resultado | Esquema validado |
| AT-07 | Agente escribe `verification.json` con `passed:true`, hashes correctos y firma aleatoria | `completeSpec` rechaza: `ATTESTATION_INVALID` |
| AT-08 | Registro válido de la spec A copiado a la spec B | Rechazado (`specId` ligado) |
| AT-09 | Firma válida pero `exitCode` editado de 1 a 0 | Rechazado |
| AT-10 | Log editado tras verificar (barrera 1 existente) | Rechazado (regresión) |
| AT-11 | Log prefabricado en la ruta antes de verificar | `writeFile` con `wx` falla → `environment` (regresión) |
| AT-12 | La llave nunca aparece en `verification.json`, logs, `process.env` del hijo ni mensajes de error | Check que imprime `process.env` → el log no contiene la llave hex |
| AT-13 | Registro v3 (anterior) | "Run verify again" (comportamiento existente) |
| AT-14 | Llave de otra sesión | Comportamiento según la decisión de §9.1 |
| AT-15 | `checks.json` con `npm test && npm run lint` | `validateChecks` rechaza con `GUARDIAN_SHELL_OPERATOR` y sugiere dividir en dos checks |
| AT-16 | Check bloqueado por el guardian en tiempo de ejecución | `errorType: 'policy'`; nunca se hace spawn |
| AT-17 | Binario inexistente (antes exit 9009/127 vía shell) | `errorType: 'environment'` |
| AT-18 | Ejecución real end-to-end de verify → complete en repo temporal | Pasa con atestación |
| AT-19 | `pid` firmado = `child.pid` real | Coincide |
| AT-20 | Suite existente (`checks.test.mjs`, `verification-evidence.test.mjs`, `delivery-flow.test.mjs`) | Verde sin cambios de fixtures (depende de §1.2) |

### 6.1 Guarda anti-hollow (`test/hollow-assertion.test.mjs`) — C-06 · T-03

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| HA-01 | Solo `expect(true).toBe(true)` | `HOLLOW_TEST_DETECTED` |
| HA-02 | `assert.ok(true)`, `assert(true)`, `assert.equal(1,1)`, `assert.strictEqual('a','a')` | Tautología detectada |
| HA-03 | `expect(x).toBe(x)` / `assert.equal(x, x)` con la misma expresión en ambos lados | Tautología |
| HA-04 | Archivo de test sin ninguna aserción | `HOLLOW_TEST_DETECTED` |
| HA-05 | `assert.equal(sum(2,2), 4)`, `expect(fn()).toBe(3)` | Válido |
| HA-06 | Reconoce `assert.deepStrictEqual`, `throws`, `rejects`, `match`, `t.assert.*` y `expect(...).toEqual/toThrow` | Contadas como aserciones |
| HA-07 | Aserción tautológica dentro de comentario o string | Ignorada |
| HA-08 | String `"assert.equal("` como única "aserción" | Hollow (no cuenta) |
| HA-09 | Test sin import relativo a código del proyecto | `CONTRACT_FRAUD_DETECTED` |
| HA-10 | Test que importa el módulo bajo prueba | Válido |
| HA-11 | Archivo mixto: una real + una tautológica | Reporta la tautológica (`file:line`); el criterio falla |
| HA-12 | Se aplica solo a archivos de test cambiados en el snapshot de la spec | Tests legados no tocados no bloquean |
| HA-13 | *Dogfooding*: `test/**/*.test.mjs` del repo | Cero hallazgos |
| HA-14 | Integración: `verifySpec` con un test hollow en el diff | Verificación falla con código y ruta |

> **Fuera de alcance:** las pruebas de mutación (barrera 4) no están en los objetivos de Fase 2.

---

## 7. `src/auditor.mjs` — ceremonia y validación tipada (`test/auditor-ceremony.test.mjs`) — C-07 · T-02

**Validación tipada (AU-TYPED).** Validadores escritos a mano con errores `{ path, code, message }`, sin regex sobre Markdown.

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| AU-01 | `tasks.json` (`id`, `title`, `status ∈ pending/in_progress/done`) como fuente canónica | El auditor lee JSON; ignora `tasks.md` |
| AU-02 | Variaciones de estilo en `tasks.md` (`* [x]`, `- [X]`, numeradas, en español) con `tasks.json` presente | Resultado idéntico |
| AU-03 | `tasks.json` con `id` duplicado, `status` fuera del enum o campo faltante | Error con `path` JSON exacto (`$.tasks[2].status`) |
| AU-04 | `tasks.md` es una proyección: `renderTasks(tasks.json)` es determinista y la ida y vuelta es estable | Igualdad byte a byte |
| AU-05 | Spec legada sin `tasks.json` | Ruta de compatibilidad actual (los tests existentes del auditor siguen verdes) |
| AU-06 | Trazabilidad automática: criterio con `checks: ['unit']` en `acceptance.json` | Trazado sin depender del texto de cabecera "verif" |
| AU-07 | Cabecera "## Comprobación" (sin "verif") con binding de datos | Pasa (hoy falla por la regex) |
| AU-08 | Criterio `automated` sin binding a check | Error tipado `ACCEPTANCE_UNBOUND` |
| AU-09 | Paridad de esquemas: el validador acepta y rechaza lo mismo que `schema/*.schema.json` sobre un corpus de fixtures | Tabla verde |
| AU-10 | BOM, CRLF y JSON con comentarios | BOM/CRLF aceptados; comentarios → `JSON_PARSE_ERROR` con línea |

**Niveles de ceremonia (AU-LVL)**

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| AU-11 | `create --light` | Solo artefacto primario + `acceptance.json`; cero plantillas vacías |
| AU-12 | Auditoría `light` sin `plan.md`/`tasks.json` | Sin errores por artefactos ausentes |
| AU-13 | `standard` sin plan | Error; sin tareas → OK |
| AU-14 | `full` sin `tasks.json` | Error |
| AU-15 | Cambio de nivel `light → full` con `fit` | Exige los artefactos nuevos; no borra nada |

**Compuertas humanas en `--full` (AU-GATE)**

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| AU-16 | Pasar a implementación sin la compuerta 1 aprobada | `GATE_1_REQUIRED` |
| AU-17 | `approve --gate 1 --actor <n>` guarda la aprobación ligada a la huella de plan + acceptance (+ blast radius si existe) | Registro con huella |
| AU-18 | Editar `plan.md` tras aprobar la compuerta 1 | Compuerta invalidada (`GATE_1_STALE`) |
| AU-19 | `complete` sin la compuerta 2 | `GATE_2_REQUIRED` |
| AU-20 | La compuerta 2 se liga a la huella de verificación atestada (AT) + diff | Cambiar código tras aprobar → `GATE_2_STALE` |
| AU-21 | `light`/`standard` | No exigen compuertas (compatibilidad) |
| AU-22 | Registro de aprobación editado a mano (huella falsa) | Rechazado |

---

## 8. `src/auth.mjs` — Auth Broker (`test/auth.test.mjs`) — C-08 · T-04

**Diseño sin dependencias:** DPAPI se invoca con un helper de `powershell.exe` de script fijo que usa `[System.Security.Cryptography.ProtectedData]` y `Add-Type -AssemblyName System.Security`. Es una invocación interna del motor, no un comando del agente, así que no pasa por el guardian. Los datos entran por **stdin**, nunca por argv. El mutex se mantiene con un proceso helper vivo que lo adquiere, imprime `ACQUIRED` y lo libera al cerrarse su stdin. Todo backend es inyectable: la lógica del broker se prueba con fakes y las integraciones reales llevan **[win32]**.

**Almacén DPAPI (AUTH-DP)**

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| AUTH-01 | Ida y vuelta protect/unprotect de 16 KB **[win32]** | Igual. Supera el límite de 2.560 B de WinCred (criterio EARS) |
| AUTH-02 | Ruta = `%LOCALAPPDATA%\OmniSpec\auth.dat`; directorio creado si falta **[win32]** | Exacto |
| AUTH-03 | Descifrar con otra entropía **[win32]** | Falla. Prueba el aislamiento por `pOptionalEntropy` |
| AUTH-04 | El secreto no aparece en argv del helper (spy de `spawn`) ni en logs | Verificado |
| AUTH-05 | `auth.dat` en disco no contiene el secreto en claro (UTF-8 ni UTF-16) **[win32]** | Verificado |
| AUTH-06 | Escritura atómica (tmp + `rename`); un crash simulado a mitad deja el archivo anterior intacto | Verificado |
| AUTH-07 | Fake backend lanza HRESULT `0x8009000B` (`NTE_BAD_KEY_STATE`) | Purga `auth.dat`; devuelve `{ status: 'relogin-required' }` y no colapsa |
| AUTH-08 | Otros errores DPAPI (`0x8009000D`, archivo corrupto) | Error tipado distinto; **no** purga |
| AUTH-09 | Plataforma no Windows | Backend POSIX: archivo `0600` en `$XDG_STATE_HOME/omnispec`. Documentado como no cifrado a nivel de kernel **[posix]** |
| AUTH-10 | Esquema del almacén versionado; versión desconocida | Error tipado, sin purga |

**Mutex y broker de refresco (AUTH-MX)**

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| AUTH-11 | Adquirir y liberar `Global\OmniSpec_Auth_Mutex` **[win32]** | OK |
| AUTH-12 | Segundo proceso espera mientras el primero lo retiene **[win32]** | Orden serializado, verificado con timestamps |
| AUTH-13 | Proceso dueño muere (kill) **[win32]** | El siguiente adquiere (`WAIT_ABANDONED` tratado como adquirido + revalidación del token) |
| AUTH-14 | Timeout de adquisición | `AUTH_LOCK_TIMEOUT`, sin refresco |
| AUTH-15 | `Global\` denegado por política | Fallback a `Local\` con aviso (no colapsa) |
| AUTH-16 | Fallback POSIX: lockfile con la semántica de `docs/locking.md` **[posix]** | Serialización equivalente |
| AUTH-17 | 10 llamadas concurrentes a `getToken()` con token por vencer (fake OAuth con RTR estricto) | **Exactamente 1** refresco; las 10 reciben el token nuevo; cero revocaciones |
| AUTH-18 | Doble-check tras adquirir el mutex: otro proceso ya refrescó | No refresca de nuevo |
| AUTH-19 | Refresco proactivo a `exp − 300 s` (reloj inyectado) | A `exp−301` no refresca; a `exp−300` sí |
| AUTH-20 | Fake servidor responde `invalid_grant` (cadena revocada) | Purga y `relogin-required` |
| AUTH-21 | Criterio EARS end-to-end: 2 procesos reales + fake OAuth RTR + DPAPI real **[win32]** | 1 refresco, 0 revocaciones |

**Delegated CLI Passthrough (AUTH-CLI)** — binarios falsos en un `PATH` temporal (en Windows, `.exe` vía `node` + script para evitar `.cmd`)

| ID | Caso | Esperado |
| :-- | :-- | :-- |
| AUTH-22 | Detecta `claude`, `gh`, `gcloud` presentes/ausentes | `{ provider, available, version }` |
| AUTH-23 | `gh auth status` exit 0 / 1 | `authenticated: true/false` |
| AUTH-24 | `gcloud auth print-access-token` | Token devuelto en memoria; nunca persistido en `auth.dat` |
| AUTH-25 | Invocación con `shell: false` y argv fijo; el input del usuario nunca se concatena | Spy de `spawn` |
| AUTH-26 | CLI cuelga | Timeout + kill del árbol; `AUTH_PROVIDER_TIMEOUT` |
| AUTH-27 | El stderr del proveedor con tokens no se propaga a mensajes de error | Redacción verificada |
| AUTH-28 | Cascada: passthrough > BYOK DPAPI > Ollama local | Orden según disponibilidad simulada |
| AUTH-29 | `omni-spec login --provider gh` (CLI) | Salida estable y código 0/≠0 |
| AUTH-30 | `omni-spec auth status --json` | Nunca imprime secretos |

> **Fuera de alcance de esta fase** (listados en la Fase 2 del blueprint, pero no en los objetivos pedidos): OAuth 2.0 PKCE y Device Flow (Copilot, GCP), `--use-system-ca`, sanitizador de skills y mutation testing. Los propondré como Fase 2b si se quieren.

---

## 9. Decisiones tomadas

1. **Llave HMAC (opción A, aprobada):** 256 bits aleatorios en `%LOCALAPPDATA%\OmniSpec\keys\attestation.key`, cifrados con DPAPI y entropía propia (`0600` en `$XDG_STATE_HOME/omnispec/keys/` fuera de Windows). Es una llave por usuario y máquina, compartida por `verify` y `complete`. Por eso AT-01 comprueba que dos procesos leen **la misma** llave, en lugar de llaves distintas, y AT-14 prueba la rotación. `OMNISPEC_HOME` redirige el directorio; la suite lo fija con `test-support/isolated-home.mjs`. **Límite:** un agente con ejecución de código como el mismo usuario puede llamar a DPAPI. El HMAC impide falsificar evidencia escribiendo archivos, no la ejecución arbitraria de JS.
2. **Operadores consciente de comillas (aprobada).**
3. **Breaking changes documentados en `CHANGELOG.md`:** `checks.json` y gates con `&&`, `|`, `;`, `>`… dejan de ejecutarse. Los binarios fuera de la whitelist necesitan `guardian.allowedBinaries`. En Windows, un `.cmd` que no sea de Node (p. ej. `mvn.cmd`) da `GUARDIAN_SHELL_REQUIRED`. Los registros de verificación v3 exigen un `verify` nuevo.
4. **Compuertas 1 y 2 como política (`governance.humanGates: "full"`), desactivada por defecto.** Activarla para todo spec `full` rompería las decenas de tests y proyectos existentes que verifican y completan specs `full` sin aprobación. Queda pendiente decidir si `init` la activa en proyectos nuevos.
5. **`tasks.json` opcional:** es canónico cuando existe. `omni-spec tasks migrate <id>` convierte `tasks.md`. AU-14 acepta `tasks.json` o el `tasks.md` heredado.
6. **Trazabilidad tipada aditiva:** el campo `tests` de un criterio sustituye la búsqueda del encabezado "Verification". Sin `tests` se mantiene la regla anterior (Spec 031), porque `test-adequacy.test.mjs` la fija.
7. **Shells prohibidos:** `bash`, `sh`, `zsh` y `wsl` están en la lista negra (G-BIN-04 usa `ruby`).

## 9.1 Estado de implementación

| Archivo | Tests | Estado |
| :-- | --: | :-- |
| `test/js-lexer.test.mjs` | 10 | verde |
| `test/guardian.test.mjs` | 63 | verde (2 omitidos por plataforma) |
| `test/circuit-breaker.test.mjs` | 30 | verde |
| `test/attestation.test.mjs` | 22 | verde |
| `test/hollow-assertion.test.mjs` | 14 | verde |
| `test/auditor-ceremony.test.mjs` | 24 | verde |
| `test/auth.test.mjs` | 30 | verde (1 omitido por plataforma) |
| **Total nuevos** | **193** | |

Test existente modificado: `checks.test.mjs`. "an unavailable command shell is an environment failure" pasa a "checks run without a command shell, so a broken ComSpec cannot affect them", porque el contrato anterior dependía de `cmd.exe`.

---

## 10. Orden de implementación (rojo → verde)

1. `js-lexer` (LX) — base de G-SLOP y HA.
2. `guardian` comandos (G-BIN, G-OP, G-CWD, G-RES) → integración en `checks.mjs`/`verification.mjs` (AT-15…17, AT-20).
3. `guardian` pre-commit (G-STG, G-CONF, G-SLOP) + saneamiento de los 7 `catch {}` → hooks (G-HOOK).
4. `circuit-breaker` (CB-01…25) → persistencia en `memory.db` (CB-26…27).
5. Atestación v4 (AT) + hollow guard (HA).
6. Auditor tipado y compuertas (AU).
7. `auth.mjs` (AUTH), con backends fake primero e integraciones **[win32]** al final.

En cada paso: `npm test` completo + `npm run lint` en verde antes del commit.
