# [TASKS-XXX] Checklist Atómico de Ejecución

| Campo | Valor |
| :--- | :--- |
| **Referencia al Spec** | `[SPEC-XXX]` |
| **Referencia al Plan** | `[PLAN-XXX]` |
| **Fecha de Inicio** | AAAA-MM-DD |
| **Estado Global** | `PENDING` \| `IN_PROGRESS` \| `VERIFIED` |

---

## Convención de Ejecución
* **Prohibido saltarse fases:** No se avanza a la siguiente fase hasta que todas las casillas de la fase actual estén marcadas y verificadas.
* Ejecutar los comandos de prueba asociados tras cada cambio significativo.

---

## Fase 0: Clarificación & Pre-Requisitos
**Responsable:** Desarrollador / Agente Líder

- [ ] **0.1 Sesión de Clarificación:** Preguntas y dudas resueltas con el usuario y documentadas en `spec.md` (Sección 0.1).
- [ ] **0.2 Validación de Supuestos:** Verificar que los supuestos técnicos (Sección 0.2) se cumplan en el entorno actual.
- [ ] **0.3 Delimitación de Non-Goals:** Confirmar que la lista de elementos fuera de alcance esté acordada para evitar scope creep.

---

## Fase 1: Base de Datos, Dominio & Migración Reversible
**Responsable:** Backend Engineer

- [ ] **1.1 Migración DDL (Up):** Crear script con tablas, llaves foráneas, índices y constraints de unicidad.
- [ ] **1.2 Migración de Reversión (Down):** Crear y probar el script de rollback (`down.sql`) para garantizar que la migración sea reversible.
- [ ] **1.3 Asignación de Permisos Mínimos:** Conceder únicamente privilegios de ejecución necesarios al usuario de la aplicación.
- [ ] **1.4 Repositorio / Capa de Datos:** Implementar consultas transaccionales (`BEGIN/COMMIT`) utilizando el cliente o pool configurado.
- [ ] **Verificación Fase 1:**
  ```bash
  # Ejecutar suite de pruebas de persistencia / migraciones del stack
  [COMANDO_TEST_BASE_DE_DATOS]
  ```

---

## Fase 2: Controladores, Rutas, Idempotencia & Sanitización
**Responsable:** Backend Engineer

- [ ] **2.1 Esquemas de Validación:** Validar tipos, nulabilidad y formatos del payload entrante contra la Matriz de Contratos de Datos.
- [ ] **2.2 Middlewares / Interceptores de Autorización:** Proteger endpoints por rol / permisos y verificar autenticación.
- [ ] **2.3 Control de Idempotencia:** Implementar verificación de `Idempotency-Key` en operaciones de mutación para evitar duplicados.
- [ ] **2.4 Controladores:** Responder exclusivamente bajo el envelope estándar `{ success: true, data }` o `{ success: false, error }`.
- [ ] **2.5 Registro de Auditoría:** Emitir eventos estructurados en el registro de auditoría para acciones sensibles.
- [ ] **2.6 Sanitización de Logs:** Verificar que **nunca se impriman en stdout/stderr secretos, tokens o datos personales sensibles (PII)**.

---

## Fase 3: Pruebas de Contrato Backend & Concurrencia
**Responsable:** QA / Backend Engineer

- [ ] **3.1 Suite de Endpoints:** Cobertura de casos exitosos y fallos controlados (400, 401, 403, 404, 409).
- [ ] **3.2 Comprobación Anti-IDOR:** Validar que un usuario o inquilino no pueda acceder a recursos de otros inquilinos.
- [ ] **3.3 Prueba de Concurrencia:** Simular peticiones simultáneas sobre el mismo registro para verificar ausencia de *race conditions*.
- [ ] **Verificación Fase 3:**
  ```bash
  # Ejecutar pruebas de contrato de la API
  [COMANDO_TEST_BACKEND]
  ```

---

## Fase 4: Integración Frontend / Consumo de API
**Responsable:** Frontend Engineer

- [ ] **4.1 Servicio HTTP Delgado:** Consumir exclusivamente el cliente HTTP centralizado con manejo de autenticación.
- [ ] **4.2 Fuente Única de Verdad:** Eliminar persistencias locales simuladas o estados en caché desincronizados.
- [ ] **4.3 Manejo de Errores & Respuestas:** Capturar excepciones de red y transformarlas en estados reactivos amigables.

---

## Fase 5: UI, Accesibilidad & Estados de Interfaz
**Responsable:** UI/UX Engineer

- [ ] **5.1 Los 4 Estados de Interfaz Implementados:**
  - [ ] Estado de carga (Loading skeleton o spinner discreto con timeout).
  - [ ] Estado vacío explicativo.
  - [ ] Estado de error con acción de reintento.
  - [ ] Estado restringido / protegido (explicación del bloqueo por permisos).
- [ ] **5.2 Accesibilidad & Teclado:** Foco visualmente nítido y navegación completa por teclado (`Tab`, `Enter`, `Escape`).
- [ ] **5.3 Anti-Slop Check:** Sin componentes genéricos innecesarios, microcopy claro y contrastes WCAG AA.

---

## Fase 6: Quality Gates Finales & Entrega
**Responsable:** Lead Engineer / QA

- [ ] **6.1 Pruebas Unitarias y de Integración:**
  ```bash
  [COMANDO_TEST_SUITE]
  ```
- [ ] **6.2 Linter y Formateador de Código:**
  ```bash
  [COMANDO_LINT]
  ```
- [ ] **6.3 Compilación / Build de Producción:**
  ```bash
  [COMANDO_BUILD]
  ```
- [ ] **6.4 Verificación de Reversibilidad:** Probar que el script de rollback se ejecute limpiamente.

---

## Definition of Done (DoD)

La tarea se considera oficialmente finalizada cuando:
1. La fase de clarificación inicial (Fase 0) fue completada y validada.
2. Todos los casos de uso y criterios de aceptación descritos en `spec.md` están cubiertos.
3. Se respetó la arquitectura de `plan.md` sin generar duplicidad de estados.
4. Las migraciones cuentan con script de reversión probado.
5. Todas las casillas de este checklist están marcadas `[x]`.
6. Los Quality Gates automáticos pasan en verde con 0 errores.
7. Se redactó el walkthrough oficial de entrega.
