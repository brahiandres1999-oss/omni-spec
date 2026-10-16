# [FIX-XXX] Plan de Corrección Quirúrgica & Verificación

| Campo | Valor |
| :--- | :--- |
| **Referencia al Bug** | `[BUG-XXX]` |
| **Referencia al RCA** | `[RCA-XXX]` |
| **Fecha de Ejecución** | AAAA-MM-DD |
| **Ingeniero Ejecutor** | Subagente / Desarrollador |
| **Estado** | `PROPOSED` \| `RED_TEST_CONFIRMED` \| `GREEN_TEST_VERIFIED` \| `MERGED` |

---

## 1. Protocolo "Test-First" (Reproducción Automatizada)

> [!IMPORTANT]
> **Regla Inquebrantable:** Antes de tocar una sola línea del código de producción, se debe escribir una prueba automatizada que reproduzca el fallo exactamente.

### 1.1 Prueba de Regresión Creada
* **Archivo de Prueba:** `backend/test/...` o `frontend/tests/...`
* **Nombre de la Prueba:** `debe manejar adecuadamente el caso límite de entrada vacía sin arrojar 500`
* **Comando para Ejecutar la Prueba Sola:**
  ```bash
  node --test backend/test/nombre_del_test.test.mjs
  ```
* **Resultado Inicial:** `FALLA (ROJO)` con la misma traza reportada en `bug.md`.

---

## 2. Cirugía de Código Mínima (Minimal Touch)

> [!CAUTION]
> Modificar **única y exclusivamente** las líneas necesarias para solucionar la causa raíz. Prohibido hacer refactorizaciones cosméticas o renombrar variables no relacionadas durante un bugfix.

### Archivos Afectados y Cambios Propuestos
* `archivo_a_modificar.jsx`:
  ```diff
  - // Código defectuoso anterior
  + // Código corregido
  ```

---

## 3. Verificación de Pase a Verde (Green Verification)

* **Ejecución del Test Específico:**
  ```bash
  [COMANDO_EJECUTAR_TEST_REPRODUCCION]
  # Resultado esperado: PASA (VERDE)
  ```
* **Ejecución de Suites Completas (Anti-Regresión):**
  ```bash
  [COMANDOS_QUALITY_GATES_DEL_PROYECTO]
  ```

---

## 4. Medidas Preventivas (Action Items)
| ID | Acción Preventiva | Tipo *(Prevenir / Detectar / Mitigar)* | Responsable | Archivo o Tarea |
| :-: | :--- | :---: | :--- | :--- |
| **AI-01** | Agregar validador de esquema estricto en el middleware. | *Prevenir* | `backend-api-architect` | `backend/src/middlewares/...` |
| **AI-02** | Agregar alerta estructurada en Winston para este código de error. | *Detectar* | `backend-api-architect` | `backend/src/utils/logger.jsx` |
