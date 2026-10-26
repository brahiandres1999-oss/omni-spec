# Diseño y comprobación de interfaces con OmniSpec

Este recurso acompaña omni-plan, omni-implement y omni-converge. No requiere instalar otra skill. Es un procedimiento contextual; los criterios del proyecto determinan la composición y las comprobaciones aplicables.

## Antes de dibujar

Identifica la persona, su tarea principal, frecuencia, información necesaria, dispositivo y consecuencias de error. Una página de presentación suele necesitar una secuencia narrativa; una herramienta de trabajo necesita orientación, estado y acciones repetidas; un flujo móvil requiere prioridades y recuperación en poco espacio. Reutiliza identidad/tokens/componentes aprobados de proyectos existentes. Inspecciona pantallas y datos reales permitidos antes de preguntar por lo que ya muestran.

Si falta dirección, busca pocas referencias pertinentes: una interfaz comparable y un sistema oficial de componentes suelen bastar para iniciar. Registra URL, fecha, problema que resuelve y lección aplicable. Separa referencias de composición, comportamiento y accesibilidad. No copies marca, textos, métricas ni imágenes sin permiso. Sin acceso a referencias, explicita esa limitación y aclara o utiliza una delegación de dirección provisional.

## Contrato de diseño proporcional

Registra tarea, contenido/muestra permitida, jerarquía de información, densidad y comportamiento. Explica por qué sirven al usuario. Evita rellenar con componentes repetidos sin función. No existe una obligación universal de tarjetas, gradientes, animaciones, fuentes externas, skeletons o tamaños fijos. Usa controles nativos accesibles cuando resuelvan la tarea.

En una interfaz sustancial e incierta, implementa primero una pantalla o recorrido representativo con contenido largo y un estado exigente. Enséñalo para resolver preferencias materiales pendientes; conserva decisiones previas o delegación, sin pedir aprobación repetida. Un ajuste pequeño puede seguir directamente a implementación y comprobación.

## Contrato de dirección de arte (antes de programar)

Registra estas decisiones en el plan antes de escribir la interfaz. Los ejemplos usan términos web; en otras plataformas aplica sus equivalentes nativos (estados de interacción, curvas de animación, ajustes de accesibilidad del sistema).

1. **Arquetipo estético.** Nómbralo y justifícalo con la tarea y las referencias: precisión técnica, editorial limpio, panel de alta densidad, producto de consumo cálido, utilitario nativo de la plataforma u otro definido en una frase. Indica uno o dos rasgos distintivos y qué vas a evitar.
2. **Tokens.** Reutiliza primero los existentes; cada token nuevo necesita un motivo. Regístralos como variables CSS, en el formato de tokens del proyecto o en formato DTCG.
   - Tipografía: escala modular con razón entre 1,2 y 1,333; una o dos familias; al menos dos pesos con contraste real; interlineado por rol.
   - Espaciado: base de 4 px y múltiplos de 8 para el ritmo del layout.
   - Superficies: como mucho tres radios; bordes de 1 px con alfa controlado; dos o tres niveles de elevación con sombras de ambiente y clave.
   - Color: rampa neutra, un acento intencional y colores semánticos con pares de contraste medidos (ver «Evidencia de aceptación v2»).
   - Movimiento: de 120 a 240 ms, una curva `cubic-bezier` declarada y respeto de `prefers-reduced-motion`.
3. **Matriz de estados por superficie.** Loading (carga real), Empty (sin datos), Error (fallo y recuperación), Partial/Overflow (datos incompletos o contenido largo) e Ideal (contenido típico completo), más foco y deshabilitado. Describe cada uno o márcalo N/A con motivo.
4. **Pulido.** `:hover`, `:active` y `:focus-visible` diferenciados; alineación óptica entre icono y texto; densidad coherente; ninguna decoración que no comunique.

Son decisiones y rangos que se registran, no una receta obligatoria. Conserva la identidad y los tokens aprobados; si un rango no sirve a la tarea, sustitúyelo y explica por qué.

## De la pantalla al recorrido

Completa la acción real y sus datos: por ejemplo seleccionar → validar → revisar → confirmar → retomar tras recargar. Define qué significa persistir, qué es un dato de muestra, qué depende del backend y qué está fuera del alcance. Un aviso visual no sustituye una mutación que el criterio exige. No inventes estado de servicio, testimonios ni indicadores de actividad.

Ejercita en el recorrido la matriz de estados de cada superficie y los estados propios del recorrido: validación, recuperación tras error, confirmación y permisos. Justifica N/A en lugar de añadir latencia o arquitectura para cumplir una lista. Comprueba el estado final integrado después de corregir.

## Evidencia de aceptación v2

Clasifica cada criterio en el contrato: `AC-01 [visual]`, `[interaction]`, `[accessibility]` o `[functional]`. Mantén el mismo kind en acceptance.json. Para UI, leer código no basta: utiliza un check del catálogo de kind ui que ejercite el criterio o una observación manual real. Un build genérico no satisface esos criterios.

Una observación registra actor/observador, fecha real, superficie, entorno, pasos, esperado, resultado observado y artefacto local dentro de la spec. Para visual añade el viewport medido. Si observa el agente, registra antes las capacidades de esa sesión mediante session-record. Si observa el agente un criterio visual, guarda una imagen de la superficie como artefacto en cada viewport que nombra el criterio (si no nombra ninguno, registra el usado), junto con los pasos y resultados; una nota de texto del agente no sustituye la imagen, y una imagen sola no acredita el recorrido. Los campos son evidencia declarada con trazabilidad, no un certificado de verdad.

En el navegador comprueba anchos relevantes, contenido largo, scrollWidth/clientWidth cuando corresponda, Tab/Shift+Tab, activación con teclado y foco tras error/diálogo. Revisa zoom/reflow y movimiento reducido cuando aplique. Mide cada par de contraste real con una herramienta que nombras y registra los dos colores, la razón obtenida y el umbral aplicado; afirmar un nivel WCAG sin esa medición no es evidencia. En UI nativa usa las herramientas de plataforma adecuadas. Sin herramienta disponible conserva el criterio pendiente/blocked y un procedimiento manual; no cierres como aprobado desde CSS o JSX.

## Referencias primarias para consultar según alcance

- GOV.UK Design Principles: https://www.gov.uk/guidance/government-design-principles — necesidades, contexto, iteración y coherencia.
- GOV.UK Design System: https://design-system.service.gov.uk/ — patrones y componentes de interacción; no impone su identidad a otros productos.
- WAI Easy Checks: https://www.w3.org/WAI/test-evaluate/easy-checks/ — revisión inicial delimitada, no auditoría completa.
- WCAG Understanding Reflow: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html — comprobar pérdida de información y scroll según tipo de contenido.
- HTML Standard: https://html.spec.whatwg.org/ — semántica y comportamiento nativo.
- Design Tokens Format Module 2025.10 (DTCG): https://www.designtokens.org/ — formato de intercambio de tokens; estable desde el 2025-10-28, no es un estándar W3C.

Consulta sus versiones vigentes cuando tomes la decisión. Ninguna referencia convierte un prompt o una captura en garantía de buena UX.
