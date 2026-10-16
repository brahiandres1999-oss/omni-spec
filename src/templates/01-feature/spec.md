# [SPEC-XXX] Título de la Especificación

| Campo | Valor |
| :--- | :--- |
| **ID del Spec** | `SPEC-XXX` |
| **Fecha de Creación** | AAAA-MM-DD |
| **Estado** | `DRAFT` \| `CLARIFYING` \| `IN_AUDIT` \| `APPROVED` \| `IMPLEMENTED` |
| **Autor(es)** | Nombre / Rol |
| **Roles / Actores Destinatarios** | `[ ] Rol Primario` \| `[ ] Rol Secundario` \| `[ ] Administrador` \| `[ ] Sistema / Job` |
| **Agentes / Responsables** | Backend Engineer, Frontend Engineer, Security Reviewer |

---

## 0. Fase de Clarificación & Supuestos (Anti-Alucinación)

> [!IMPORTANT]
> **Regla de Oro:** Si existen dudas de negocio, reglas no escritas o ambigüedades en el modelo, el agente/desarrollador **NO debe asumir**. Debe preguntar al usuario y documentar aquí las respuestas antes de pasar a la especificación funcional.

### 0.1 Registro de Preguntas y Decisiones Acordadas
| # | Pregunta Formulada / Ambigüedad Detectada | Decisión Acordada con el Usuario | Impacto en el Alcance |
| :-: | :--- | :--- | :--- |
| 1 | *ej. ¿Esta operación es sincrónica o asíncrona?* | *ej. Asíncrona: responde 202 Accepted y procesa en background.* | *Requiere cola o worker.* |
| 2 | *ej. ¿Qué ocurre si el usuario cancela la operación?* | *ej. Se revierte la transacción y se notifica el estado.* | *Requiere compensación/rollback.* |

### 0.2 Supuestos Técnicos y de Negocio (Assumptions)
*Listado de premisas que se asumen como verdaderas. Si alguno de estos supuestos falla durante la implementación, el spec debe pausarse para revisión:*
1. **Supuesto 1:** (ej. El servicio de autenticación ya provee el ID de usuario autenticado en el contexto).
2. **Supuesto 2:** (ej. La base de datos soporta transacciones ACID y aislamiento Serializable o Read Committed).

---

## 1. Contexto de Negocio, Problema & Delimitación de Alcance

### 1.1 El Problema Real
> Describe la necesidad de negocio o del usuario sin ambigüedades. ¿Qué dolor o limitación experimenta el usuario actualmente?

### 1.2 Objetivo de la Solución (In-Scope)
> ¿Qué resuelve exactamente esta funcionalidad? ¿Cuál es el resultado esperado y verificable?

### 1.3 Límites Explícitos y Fuera de Alcance (Non-Goals)
> [!WARNING]
> Para evitar "scope creep" y código innecesario, se prohíbe explícitamente implementar lo siguiente en esta iteración:
* **NO-GO 1:** (ej. No se implementará soporte multi-moneda; solo moneda local).
* **NO-GO 2:** (ej. No se rediseñará el layout global; solo el componente afectado).
* **NO-GO 3:** (ej. No se modificarán esquemas de bases de datos ajenos a esta entidad).

---

## 2. Casos de Uso & Criterios de Aceptación (Gherkin + Edge Cases)

### Escenario 1: [Flujo Principal / Happy Path]
* **Dado** que un usuario con rol `[Rol Autorizado]` ha iniciado sesión válidamente,
* **Cuando** realiza la acción `[Acción específica en la UI o API]`,
* **Entonces** el sistema debe responder `[Resultado esperado]`,
* **Y** persistir los cambios atómicamente en la base de datos.

### Escenario 2: [Restricción de Acceso / RBAC / Autorización]
* **Dado** que un usuario no autenticado o con rol `[Rol No Autorizado]` intenta invocar esta funcionalidad,
* **Cuando** envía la solicitud,
* **Entonces** el sistema debe responder con código HTTP `401 Unauthorized` o `403 Forbidden`,
* **Y** no revelar metadatos internos del sistema ni información confidencial.

### Escenario 3: [Casos Límite / Datos Vacíos o Umbrales]
* **Dado** que no existen registros o no se cumplen las condiciones mínimas del negocio,
* **Cuando** el usuario consulta o ejecuta la acción,
* **Entonces** el sistema debe responder con un estado comprensible y controlado,
* **Y** nunca fallar con errores no capturados ni mostrar datos corruptos o ficticios.

### Escenario 4: [Resiliencia de Red & Prevención de Doble Envío (Idempotencia)]
* **Dado** que el usuario hace clic repetido o sufre una desconexión intermitente,
* **Cuando** la solicitud se transmite dos veces con la misma clave de idempotencia,
* **Entonces** el sistema debe procesar una sola transacción,
* **Y** devolver el mismo resultado sin duplicar registros ni efectos secundarios.

---

## 3. Matriz de Cumplimiento, Privacidad & Seguridad

| Control de Seguridad / Dominio | Respuesta | Justificación Técnica & Cumplimiento |
| :--- | :---: | :--- |
| **¿Accede o procesa datos sensibles / PII?** | `SÍ / NO` | Si es SÍ: Especificar cifrado en reposo/tránsito y permisos mínimos. |
| **¿Involucra transacciones financieras o cobros?** | `SÍ / NO` | Si es SÍ: Exigir idempotencia estricta y doble factor de confirmación. |
| **¿Requiere auditoría de trazabilidad?** | `SÍ / NO` | Si es SÍ: Registrar actor, fecha/hora UTC, acción e IP en el log de auditoría. |
| **¿Expone datos agregados o estadísticas?** | `SÍ / NO` | Si es SÍ: Definir umbrales mínimos de agregación para evitar reidentificación. |

---

## 4. Experiencia de Usuario & Filosofía Visual

### 4.1 Principios de Interfaz
* **Los 4 Estados de Interfaz Obligatorios:**
  1. *Carga (Indicador visual o skeleton con timeout).*
  2. *Vacío (Explicación clara del estado sin elementos decorativos superfluos).*
  3. *Error (Mensaje comprensible con opción de reintentar).*
  4. *Restringido / Protegido (Explicación del bloqueo por permisos).*

### 4.2 Tono & Accesibilidad
* Verbos de acción claros y sin ambigüedades.
* Soporte para navegación con teclado (`Tab`, `Enter`, `Escape`) y contraste WCAG AA.

---

## 5. Dictamen de Auditoría Previa
- [ ] Fase de clarificación completada sin supuestos ocultos.
- [ ] Non-Goals definidos explícitamente.
- [ ] Seguridad, privacidad y permisos verificados.

**Veredicto:** `APROBADO` \| `OBSERVACIONES`  
*Observaciones:* [Anotaciones de los revisores]
