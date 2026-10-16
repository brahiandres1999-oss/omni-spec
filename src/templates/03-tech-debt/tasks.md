# [DEBT-TASKS-XXX] Checklist de Modernización y Refactorización

| Campo | Valor |
| :--- | :--- |
| **Referencia al Diagnóstico** | `[DEBT-XXX]` |
| **Referencia al Plan** | `[DEBT-PLAN-XXX]` |
| **Fecha de Inicio** | AAAA-MM-DD |
| **Estado Global** | `PENDING` \| `IN_PROGRESS` \| `VERIFIED` |

---

## Convención de Trabajo
* Cada paso debe ejecutarse de forma aislada, verificando que los Quality Gates permanezcan en verde tras cada cambio.

---

## Fase 1: Blindaje de Contratos & Pruebas Previas
- [ ] **1.1 Validación de Suite Existente:** Asegurar que todas las pruebas pasen al 100% antes de tocar código:
  ```bash
  [COMANDOS_TEST_SUITES_DEL_PROYECTO]
  ```
- [ ] **1.2 Tests de Fijación (Characterization Tests):** Si el componente a refactorizar carece de pruebas, escribirlas antes para capturar el comportamiento actual exacto.

---

## Fase 2: Implementación de la Nueva Estructura
- [ ] **2.1 Creación del Nuevo Módulo / Servicio:** Implementar la alternativa limpia sin eliminar aún el código viejo.
- [ ] **2.2 Pruebas Unitarias del Nuevo Módulo:** Verificar que el nuevo componente funcione de forma aislada.

---

## Fase 3: Migración Incremental de Consumidores
- [ ] **3.1 Migración Consumidor 1:** Redirigir llamadas hacia el nuevo módulo.
- [ ] **3.2 Migración Consumidor 2:** Redirigir llamadas hacia el nuevo módulo.
- [ ] **3.3 Verificación de Gates tras cada migración:**
  ```bash
  npm --prefix frontend run lint
  npm --prefix frontend test
  ```

---

## Fase 4: Limpieza de Código Muerto & Dependencias
- [ ] **4.1 Eliminación de Rutas/Métodos Obsoletos:** Retirar el código anterior que ya no tiene consumidores.
- [ ] **4.2 Retiro de Dependencias npm (si aplica):** Desinstalar paquetes deprecados o sin uso (`npm uninstall`).
- [ ] **4.3 Verificación de Imports Huérfanos:** Comprobar que no queden referencias rotas.

---

## Fase 5: Verificación Final Anti-Regresión
- [ ] **5.1 Ejecución Completa de Gates:**
  ```bash
  [COMANDOS_QUALITY_GATES_DEL_PROYECTO]
  ```
- [ ] **5.2 Auditoría de Impacto en Rendimiento / Artefactos:** Confirmar que no hubo regresión en métricas clave o tamaño de artefactos de producción.
