# Diseño y comprobación de interfaces con OmniSpec

Este recurso acompaña omni-plan, omni-implement y omni-converge. No requiere instalar otra skill. Es un procedimiento contextual; los criterios del proyecto determinan la composición y las comprobaciones aplicables.

## Antes de dibujar

Identifica la persona, su tarea principal, frecuencia, información necesaria, dispositivo y consecuencias de error. Una página de presentación suele necesitar una secuencia narrativa; una herramienta de trabajo necesita orientación, estado y acciones repetidas; un flujo móvil requiere prioridades y recuperación en poco espacio. Reutiliza identidad/tokens/componentes aprobados de proyectos existentes. Inspecciona pantallas y datos reales permitidos antes de preguntar por lo que ya muestran.

Si falta dirección, busca pocas referencias pertinentes: una interfaz comparable y un sistema oficial de componentes suelen bastar para iniciar. Registra URL, fecha, problema que resuelve y lección aplicable. Separa referencias de composición, comportamiento y accesibilidad. No copies marca, textos, métricas ni imágenes sin permiso. Sin acceso a referencias, explicita esa limitación y aclara o utiliza una delegación de dirección provisional.

## Contrato de diseño proporcional

Registra tarea, contenido/muestra permitida, jerarquía de información, densidad, tipografía, espaciado, colores y comportamiento. Explica por qué sirven al usuario. Escoge uno o dos rasgos de identidad coherentes y evita rellenar con componentes repetidos sin función. No existe una obligación universal de tarjetas, gradientes, animaciones, fuentes externas, skeletons o tamaños fijos. Usa controles nativos accesibles cuando resuelvan la tarea.

En una interfaz sustancial e incierta, implementa primero una pantalla o recorrido representativo con contenido largo y un estado exigente. Enséñalo para resolver preferencias materiales pendientes; conserva decisiones previas o delegación, sin pedir aprobación repetida. Un ajuste pequeño puede seguir directamente a implementación y comprobación.

## De la pantalla al recorrido

Completa la acción real y sus datos: por ejemplo seleccionar → validar → revisar → confirmar → retomar tras recargar. Define qué significa persistir, qué es un dato de muestra, qué depende del backend y qué está fuera del alcance. Un aviso visual no sustituye una mutación que el criterio exige. No inventes estado de servicio, testimonios ni indicadores de actividad.

Ejercita estados aplicables: normal, foco, vacío, carga real, validación, error y recuperación, confirmación y permisos. Justifica N/A en lugar de añadir latencia o arquitectura para cumplir una lista. Comprueba el estado final integrado después de corregir.

## Evidencia de aceptación v2

Clasifica cada criterio en el contrato: `AC-01 [visual]`, `[interaction]`, `[accessibility]` o `[functional]`. Mantén el mismo kind en acceptance.json. Para UI, leer código no basta: utiliza un check del catálogo de kind ui que ejercite el criterio o una observación manual real. Un build genérico no satisface esos criterios.

Una observación registra actor/observador, fecha real, superficie, entorno, pasos, esperado, resultado observado y artefacto local dentro de la spec. Para visual añade viewport medido. Si observa el agente, registra antes las capacidades de esa sesión mediante session-record. Una captura aislada no acredita el recorrido; guarda también los pasos y resultados. Los campos son evidencia declarada con trazabilidad, no un certificado de verdad.

En el navegador comprueba anchos relevantes, contenido largo, scrollWidth/clientWidth cuando corresponda, Tab/Shift+Tab, activación con teclado y foco tras error/diálogo. Revisa zoom/reflow, contraste de pares reales y movimiento reducido cuando aplique. En UI nativa usa las herramientas de plataforma adecuadas. Sin herramienta disponible conserva el criterio pendiente/blocked y un procedimiento manual; no cierres como aprobado desde CSS o JSX.

## Referencias primarias para consultar según alcance

- GOV.UK Design Principles: https://www.gov.uk/guidance/government-design-principles — necesidades, contexto, iteración y coherencia.
- GOV.UK Design System: https://design-system.service.gov.uk/ — patrones y componentes de interacción; no impone su identidad a otros productos.
- WAI Easy Checks: https://www.w3.org/WAI/test-evaluate/easy-checks/ — revisión inicial delimitada, no auditoría completa.
- WCAG Understanding Reflow: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html — comprobar pérdida de información y scroll según tipo de contenido.
- HTML Standard: https://html.spec.whatwg.org/ — semántica y comportamiento nativo.

Consulta sus versiones vigentes cuando tomes la decisión. Ninguna referencia convierte un prompt o una captura en garantía de buena UX.
