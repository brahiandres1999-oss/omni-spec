# Evaluación de comportamiento local

Las pruebas del motor no demuestran que un agente haga preguntas pertinentes, respete decisiones o compruebe una interfaz. Este protocolo prepara escenarios sintéticos separados de las aplicaciones del usuario.

## Preparación

Ejecutar `node scripts/prepare-behavior-eval.mjs`. Se crea una carpeta nueva bajo `.research/behavior-evals`, con tres proyectos, prompts y rúbricas externas al proyecto evaluado. No se ejecuta ningún modelo ni se publica contenido. Se conserva la huella de cada workflow y un baseline de archivos previo a cada corrida.

| Caso | Qué se observa |
| --- | --- |
| novice-offline | Preguntas comprensibles sobre intención, versiones pendientes sin fuentes actuales y preservación del trabajo local. |
| existing-conflicts | Conservación de declaraciones contradictorias, ausencia de ejecución de scripts en init y separación entre política declarada e implementación. |
| visual-build-only | Detección estática de defectos sembrados, respeto a identidad existente y negativa a certificar UI sin inspección renderizada. |

Los tres casos delimitan explícitamente la ausencia de web y herramientas visuales. No evalúan búsqueda actual de versiones, preguntas nativas, creación de una buena interfaz ni ejecución de un recorrido renderizado. Esas capacidades requieren escenarios adicionales con herramientas efectivamente disponibles.

## Ejecución y revisión

Puede usarse el host disponible, conservando prompt, restricciones y archivos. Para Codex, el [modo no interactivo oficial](https://learn.chatgpt.com/docs/non-interactive-mode) permite una ejecución efímera con eventos JSON y respuesta final guardada. El agente evaluado debe conservar sandbox `workspace-write`; no usar opciones que eliminen sus restricciones. Elegir y registrar un presupuesto antes de ampliar la campaña; la preparación no autoriza automáticamente consumo de modelos.

Registrar versión del host, modelo y configuración cuando estén disponibles, fuentes/herramientas permitidas, fechas, eventos, salida final, uso reportado y errores. Si el host no expone el modelo exacto, declarar esa limitación; no inventarlo. El código cero del proceso significa que terminó, no que aprobó la rúbrica.

Comparar baseline y resultado, inspeccionar las acciones ejecutadas y revisar afirmaciones contra los archivos y salidas citados. Mantener la rúbrica fuera del proyecto leído por el agente. Registrar cada criterio como observado, fallido, no observado o bloqueado, junto con evidencia. Una búsqueda de palabras no es evaluación semántica. Un archivo sentinel ausente complementa, pero no sustituye, revisar la traza.

Preservar también corridas interrumpidas o fallidas. Las recomendaciones posteriores deben probarse en una carpeta nueva; no sobrescribir la evidencia anterior ni atribuirle una versión de instrucciones que aún no existía.

## Límites de las primeras corridas

Una corrida por escenario, en un solo host y sin brazo de control, es un diagnóstico. No demuestra superioridad sobre otro producto ni estabilidad universal. El roadmap conserva la comparación entre agente base, versión anterior y candidato, así como evaluación funcional, visual y de continuidad. IPS seguirá siendo el piloto posterior que ejecutará el usuario, sin convertirse en la plantilla del producto.
