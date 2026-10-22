# Candidato local 0.7.0-rc.2 — 2026-10-22

rc.2 corrige los defectos encontrados al evaluar rc.1 en escenarios realistas e integra una revisión independiente de los cambios. El siguiente paso de aceptación es el piloto del usuario con un proyecto nuevo ([PILOT](PILOT.md)). Este estado no autoriza publicar, hacer push, cambiar una instalación global ni declarar una release estable.

## Defectos de rc.1 corregidos

| Defecto | Efecto en rc.1 | Corrección en rc.2 |
| --- | --- | --- |
| Huella sin reglas de ignorado | Un check que escribía reportes (Playwright `test-results/`, `.gradle/`, `junit.xml`) hacía fallar siempre `verify` | `.gitignore`, `.git/info/exclude`, `.omnispecignore` y exclusiones por defecto; lista de archivos cambiados y bloqueo `VERIFICATION_SOURCE_CHANGED` |
| Contexto basado en todo el árbol | Cualquier edición de código o del IDE dejaba el contexto `STALE` y bloqueaba `verify` | El baseline cubre solo entradas de contexto, citas y manifiestos; los baselines antiguos se comparan de forma compatible |
| `clean` destructivo | Borraba skills propias en `.agents/skills` y los respaldos | Solo elimina copias administradas sin modificar; conserva el resto; rechaza rutas manipuladas |
| `--from` dentro del proyecto | Los JSON de entrada en la raíz cambiaban la huella | Rutas externas, stdin y `specs/.omni/inputs/` documentado |
| Bloqueo retenido durante los checks | `decision-record`/`session-record` fallaban tras unos 10 s | Bloqueo de verificación separado; `complete` no se cruza con una verificación |
| Evidencia UI ligada a la sesión actual | Una sesión nueva invalidaba observaciones válidas | Historial de sesiones, ventanas por inicio y precisión de segundos |
| Gates implícitos | `init --yes` convertía scripts detectados en gates | Quedan como candidatos `NOT_RUN` |
| Límite de snapshot sin salida | Proyectos con cachés grandes no podían verificar | Las reglas de ignorado reducen el árbol; el error indica cómo excluir |
| OneDrive / antivirus | Renombres con EPERM/EBUSY esporádicos | Reintentos acotados en todas las escrituras atómicas |
| Orden dependiente del locale | Huella potencialmente distinta entre entornos | Orden por unidades de código |
| Wizard con tubería | Abortaba en la segunda pregunta | Lector de líneas con cola |
| Mensajes | `fit` sin ruta ni esquema; fallo por cambio de fuentes mostrado como fallo de check | Ruta exacta, ejemplo `schemaVersion: 2`, causa y remedio |
| Repositorio | Estado local acumulado sin guía; constitución actualizada nunca revisada | Sección administrada en `specs/.gitignore`; referencia de constitución en `update` |
| Test de timeout | Fallaba en contenedores sin recolector de zombis | Comprueba el estado real del proceso |
| Plantillas | Mezcla de español e inglés; tipos de criterio no documentados | Plantilla feature coherente con `AC-01 [kind]`; los encabezados en español siguen siendo válidos |

La revisión independiente encontró además: patrones escapados que excluían código o rompían el snapshot, symlinks de `node_modules`, rutas manipuladas en el registro de `clean`, ventanas de sesión sin fin, conflictos con un `specs/.gitignore` propio, citas a archivos de estado de OmniSpec, reglas de carpetas padre que podían desactivar la atestación, dependencia de mayúsculas por plataforma, CRLF tratado como edición local (también en `clean`), enlaces `CLAUDE.md`/`AGENTS.md` en ambos sentidos y enlaces hacia `specs/` o `.git/`. Todos están corregidos y cubiertos por pruebas. Sigue sin cambios desde rc.1 un límite conocido: `update` se niega a escribir a través de un `AGENTS.md` que sea symlink.

## Validación local de rc.2

Entorno: Linux, Node 22.22.0.

- Suite: 262 pruebas, 261 aprobadas y 1 omitida (específica de Windows).
- Paridad de reglas de ignorado con `git ls-files --exclude-standard`: 93 casos.
- Lint (Biome) aprobado. Cobertura: 96,9 % de líneas y 89,0 % de ramas (mínimo 85 % de líneas).
- `test:package`: 19 escenarios aprobados con el tarball instalado, incluidos salidas generadas excluidas, contexto por manifiestos y guía de evidencia.
- `release:check` aprobado; no publica.
- Recorridos manuales: proyecto con frontend y backend, salidas de tipo Playwright, archivos del IDE, ruta con espacios y "ñ", actualización desde 0.6.1 y desde rc.1, evidencia UI manual y `clean` con skills propias.

rc.1 se había validado en Windows (Node 22.23.4 y 22.19.0) y en Ubuntu mediante WSL. rc.2 no se ha ejecutado todavía en Windows: el piloto y la CI, cuando se autorice, lo confirman.

## Lo que valida el piloto

1. Descubrimiento de las skills de este candidato en el host elegido y uso de preguntas nativas, o chat/consola si no existen.
2. Reconocimiento de una carpeta nueva; decisiones comprensibles, stack investigado y aprobado, preparación local y convenciones de documentación y Git.
3. Resultado de dominio y UI conforme a lo pedido, con evidencia ejecutada, revisión del usuario y corrección de defectos observados.

No queda una corrección conocida del motor aplazada a propósito. Un defecto que aparezca en el piloto se conserva, se corrige y se repiten las comprobaciones afectadas antes de considerar una publicación. La comparación de eficacia frente a otros frameworks de SDD y entre modelos sigue siendo una evaluación pendiente; no se anuncia superioridad sin ella.
