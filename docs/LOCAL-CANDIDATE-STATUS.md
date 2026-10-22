# Candidato local 0.7.0-rc.1 — 2026-10-22

El alcance de implementación identificado para preparar el piloto está integrado. El siguiente paso de aceptación es desarrollar un proyecto independiente con el usuario, preferiblemente IPS desde cero. Este estado no autoriza publicar, hacer push, cambiar una instalación global ni declarar una release pública estable. IPS y Pulso360 aportaron observaciones; el motor no contiene reglas de esos dominios.

## Correcciones incorporadas

| Bloque | Resultado verificable |
| --- | --- |
| R01 — afirmaciones y fuentes | Se distinguen declaraciones, observaciones, ejecución y límites; las heurísticas no se presentan como conclusiones científicas universales. |
| R02 — rutas | Feature/debt y bugfix v2 respetan light/standard/full. Standard bugfix requiere causa y diseño; full añade tareas. La promoción conserva artefactos. |
| R03–R04 — cierre y aceptación | Evidencia recursiva, aceptación v2 por tipo y catálogo de checks con ID/cwd. Un build genérico o inspección de código no satisface por sí solo un criterio visual. |
| R05 — continuidad operativa | status devuelve bloqueos, pendientes por criterio y próxima acción. READY_TO_COMPLETE y complete comparten inspector. RFC y entregas parciales conservan sus diferencias. |
| R06–R08 — UI | Capacidades observadas por sesión, guía de diseño incluida, referencias/dirección/prototipo proporcionales y evidencia UI con pasos, fecha, esperado/real, artefacto y viewport visual. Sin render se conserva el bloqueo dependiente. |
| R09 — contexto | Huella de fuentes/contexto, detección de obsolescencia y baseline anterior conservado. Registrar una nueva huella exige reconciliación semántica; no corrige requisitos copiando defectos. |
| R10 — contratos | Contratos por capacidad, revisiones/deltas y estado efectivo conservado frente a propuestas posteriores. Activación/retirada exige spec completada y evidencia. |
| R11 — rigor | Fit v2 agrega riesgo, incertidumbre y reversibilidad; conserva compatibilidad v1. Un cambio crítico pequeño escala. |
| R12 — evaluación | Regresiones negativas, recorridos de paquete y producto sintético renderizado con corrección y reobservación. La comparación de eficacia entre modelos y el piloto independiente no se han convertido en resultados inexistentes. |
| R13 — distribución | Nueve skills derivadas de workflows comunes; preservación de decisiones/contexto/contratos al actualizar. Los formatos de adaptadores tienen tests; el descubrimiento real depende del host del piloto. |
| R14 — runner | Timeout/limpieza acotados, cwd validado, clasificación de errores, cola con aviso y log limitado con hash. Comprobado en Windows y Ubuntu mediante WSL. |

## Validación local

- Node 22.23.4: Windows, 228 pruebas aprobadas, ninguna omitida; Ubuntu mediante WSL, 227 aprobadas y una omitida porque comprueba ComSpec de Windows.
- Node 22.19.0, mínimo declarado: 228 pruebas aprobadas en Windows, sin omisiones.
- Paquete instalado: instalación offline, npm-exec, prefijo global temporal aislado, runtime local, arquetipos, onboarding, actualización, checks por módulo, rechazo de contexto obsoleto, contrato efectivo y rechazo de evidencia visual basada solo en código.
- Lint, generación de nueve skills, comprobación de release y whitespace: aprobados. La comprobación de release no publica.
- Cobertura del runtime (src/bin): 95,43 % de líneas y 87,12 % de ramas. El gate existente incluye además tests/tooling y obtuvo 97,05 % de líneas, superior a su mínimo de 85 %; son alcances distintos.
- Producto sintético ATRIL: ocho criterios UI observados, un check automático de sintaxis, verificación, cierre y contrato activo. Reconciliación posterior y actualización a rc.1 conservan evidencia/decisiones y permiten volver a verificar nueve criterios. El estado queda sin trabajo activo; la spec completada permanece en historial.

Los logs, fallos intermedios, fuentes oficiales, capturas y trazas están en .research/evidence-2026-10-22/, fuera del paquete y de Git. El informe final identifica cada corrida; no suma corridas repetidas como si fueran casos independientes.

## Lo que se valida en el piloto

1. Descubrimiento de las skills de este candidato en el host elegido y uso de preguntas nativas, o chat/consola cuando no existan.
2. Reconocimiento de una carpeta nueva o proyecto existente; decisiones entendibles, stack investigado/aprobado, preparación local y convenciones documentales/Git.
3. Resultado de dominio y UI conforme a lo solicitado, con evidencia ejecutada, revisión del usuario y corrección de defectos observados.

No queda una corrección conocida del motor aplazada deliberadamente para ese piloto. La prueba real puede descubrir defectos nuevos: se conservan como evidencia, se corrigen y se repiten las comprobaciones afectadas antes de considerar publicación. Las evaluaciones masivas entre modelos y versiones de hosts siguen siendo trabajo de investigación; no se exige al usuario realizarlas para ejecutar su piloto ni se anuncia superioridad universal.

El diseño original del producto sintético utilizó una skill externa en una evaluación separada. La revisión integrada posterior usó la guía incluida en OmniSpec. Es evidencia de integración y validación del resultado; no demuestra que OmniSpec causó por sí solo el diseño original ni sustituye crear un producto nuevo con el candidato.

Para ejecutar el piloto con el paquete exacto y evitar una versión antigua de npm/plugin, seguir [PILOT](PILOT.md). Para los formatos operativos, ver [DELIVERY](DELIVERY.md).
