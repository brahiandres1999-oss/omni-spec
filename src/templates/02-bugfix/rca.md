# [RCA-XXX] Análisis de Causa Raíz (5 Whys Standard)

| Campo | Valor |
| :--- | :--- |
| **Referencia al Bug** | `[BUG-XXX]` |
| **Fecha de Análisis** | AAAA-MM-DD |
| **Analista Líder** | Subagente / Ingeniero |
| **Tipo de Falla** | `Lógica de Negocio` \| `Concurrencia / Race Condition` \| `Fuga de Memoria` \| `Contrato Desincronizado` \| `Fallo de Permisos` |

---

## 1. Declaración Precisa del Problema
> *Formulación exacta del síntoma sin juicios de valor (ej. "El endpoint POST /api/v1/supervisor/actions/followup arroja 500 TypeError: Cannot read properties of undefined (reading 'rows') al recibir un arreglo vacío").*

---

## 2. La Cadena de los 5 Porqués (The 5 Whys)
> Profundiza más allá del síntoma superficial ("error de código" o "fallo humano") hasta encontrar la deficiencia sistémica o de diseño:

| Nivel | Pregunta | Respuesta / Hallazgo Técnico | Evidencia / Archivo / Línea |
| :---: | :--- | :--- | :--- |
| **Por qué 1** | ¿Por qué ocurrió el fallo directo? | *Porque el pool de PostgreSQL devolvió un resultado no controlado.* | `file:///backend/src/...#L45` |
| **Por qué 2** | ¿Por qué devolvió ese resultado? | *Porque la consulta SQL asumió que siempre existía al menos un registro en la cohorte.* | `file:///backend/src/...#L78` |
| **Por qué 3** | ¿Por qué se asumió esa precondición? | *Porque la validación de entrada en el middleware no comprobó la longitud mínima del arreglo.* | `file:///backend/src/...#L12` |
| **Por qué 4** | ¿Por qué faltaba esa validación? | *Porque el contrato de la API no especificó el campo como obligatorio con minItems: 1.* | `specs/.../plan.md` |
| **Por qué 5** | **¿Causa Raíz Sistémica?** | *Porque el generador de esquemas no tenía una regla obligatoria de validación para colecciones.* | **[Causa Raíz Identificada]** |

---

## 3. Factores Contribuyentes
*Factores colaterales que amplificaron el problema o demoraron su detección:*
* **Vacío de Pruebas:** No existía una prueba unitaria para el caso límite de entrada vacía (`[]`).
* **Monitoreo:** El log del error fue capturado por un bloque `catch` genérico sin trazabilidad estructurada.
* **Manejo de Estado en Frontend:** El cliente no manejó el estado de error y mantuvo el botón deshabilitado indefinidamente.

---

## 4. Análisis de Radio de Impacto (Blast Radius)
> [!WARNING]
> ¿Qué otros módulos, tablas o pantallas dependen de este mismo componente o función?
* **Módulos Afectados:**
  1. `features/supervisor/...`
  2. `features/sst/...`
* **¿Existe riesgo de efectos secundarios colaterales al aplicar el fix?** `SÍ / NO` (Detallar cómo se aislará el cambio).
