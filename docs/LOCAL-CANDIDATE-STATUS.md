# Estado del candidato local — 2026-10-22

Este punto de conservación no es una release estable. No autoriza publicación, instalación en los hosts del usuario ni el reinicio del piloto IPS. El usuario hará ese piloto posteriormente desde cero. IPS y Pulso360 son fuentes de observaciones, no plantillas de arquitectura.

## Implementado y comprobado con alcance acotado

- Auditoría y workflows respetan rutas light/standard/full para feature y debt.
- La huella incluye evidencia anidada de la spec, con límites de tamaño y rechazo de symlinks.
- Criterios automatizados referencian gates configurados; verify registra resultados y complete exige bindings válidos. Los registros antiguos requieren una ejecución nueva. La suficiencia de las assertions y la evidencia manual siguen requiriendo revisión.
- Timeout acotado y diagnóstico explícito cuando no puede confirmarse la limpieza. Terminación efectiva del hijo y rechazo de symlinks comprobados en este Windows con permisos suficientes.
- Protocolos compartidos de preguntas, versiones con fuentes oficiales, documentación por lenguaje, preparación/Git y diseño contextual, distribuidos en constitución, workflows y adaptadores.
- Corrección de detección JavaScript/TypeScript y límites de exploración del onboarding.
- Fixtures de evaluación conductual: tres escenarios con un agente real y una repetición. Observación renderizada independiente de dos defectos sembrados; no equivale a construir una UI satisfactoria.

Últimas evidencias: suite general de 186 aprobadas y una omitida; la prueba omitida y el timeout se comprobaron después con permisos suficientes (dos aprobadas). Tras el ajuste de onboarding, 13 pruebas dirigidas aprobadas. Lint y paquete local aprobados en los incrementos documentados. Son corridas diferentes, no una única certificación total.

## Lo que aún falta, además del piloto IPS

| Bloque del roadmap | Estado real y pendiente |
| --- | --- |
| R04 — aceptación | Vinculación mecánica implementada mediante comandos de gates. No existe todavía todo el catálogo ampliado de checks propuesto, con ejecución configurable por directorio y tipos de evidencia especializados. |
| R05 — estados y próxima acción | Pendiente de implementar un contrato estructurado común para status, bloqueos, próxima acción y entregas parciales. |
| R06–R08 — UI/UX integrada | Hay protocolos y pruebas diagnósticas. Falta completar la integración de capacidades y evidencia visual con el cierre, y ejecutar construcción/corrección de una UI con navegador y recorrido funcional. Un gate genérico no acredita por sí solo un criterio visual. |
| R09 — contexto vigente | Hay instrucciones de reconciliación. Falta completar y comprobar actualización del contexto durante evolución real, cambios de scripts/arquitectura y reanudación. |
| R10 — contratos vigentes por capacidad | Propuesto; no implementado. Es evolución posterior, no requisito para cada tarea pequeña. |
| R11 — fit por riesgo | Se corrigió el uso de rutas y se identificaron umbrales como heurísticas. El algoritmo no se ha rediseñado por riesgo, incertidumbre y reversibilidad; bugfix continúa en full. |
| R12 — evaluación | Diagnósticos iniciales, sin comparación controlada ni evaluación completa de construcción de producto. Falta selección tecnológica con web disponible y preguntas nativas en un host interactivo. |
| R13 — continuidad/hosts | Generación y preservación de adaptadores probadas; falta el recorrido real entre sesiones y hosts y la actualización con decisiones propias preservadas. |
| R14 — runner | Timeout Windows comprobado con límites explícitos. Falta otro sistema operativo y el resto del alcance propuesto: cwd por check, salida completa/truncada y clasificación de errores. |

R01–R03 tienen sus correcciones principales implementadas. Esto no cierra los hitos A, B y C completos. Tampoco implica que todo el backlog de evolución deba completarse antes de cualquier piloto: se debe fijar y verificar el alcance del candidato antes de llamarlo estable. No se ha aprobado una reducción del alcance para declarar estabilidad.

## Orden para retomar

1. Completar estados/bloqueos y el recorrido integrado UI: referencias, dirección, implementación, ejecución y evidencia por resultado.
2. Comprobar selección tecnológica actual y preguntas con herramientas disponibles; verificar contexto actualizado y continuidad en proyecto nuevo y existente.
3. Cerrar la matriz de compatibilidad y la robustez operativa correspondientes al alcance del candidato.
4. Ejecutar el piloto IPS que realizará el usuario. Registrar defectos y corregirlos antes de decidir publicación.

La investigación completa, roadmap y trazas permanecen bajo `.research`, excluidos de Git. Se conserva un archivo local de respaldo separado del commit; no se incorporan cachés de dependencias al historial. No usar una rama o un commit como prueba de estabilidad.
