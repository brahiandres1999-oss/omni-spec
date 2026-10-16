# [PLAN-XXX] Plan Técnico de Arquitectura

| Campo | Valor |
| :--- | :--- |
| **Referencia al Spec** | `[SPEC-XXX]` |
| **Fecha de Diseño** | AAAA-MM-DD |
| **Arquitecto Líder** | Software Engineer / System Architect |
| **Estado** | `DRAFT` \| `REVIEWED` \| `READY_FOR_EXECUTION` |

---

## 1. Contratos de Interfaz (API / Protocolo) & Datos

### 1.1 Estándar de Respuestas
Estructura uniforme de respuestas para la aplicación:

```json
// Éxito:
{
  "success": true,
  "data": { ... }
}

// Error:
{
  "success": false,
  "error": {
    "code": "ERROR_CODE_IN_UPPERCASE",
    "message": "Mensaje legible explicando la causa del error.",
    "details": null
  }
}
```

### 1.2 Matriz Formal de Contratos de Datos (Data Contract)
| Campo | Tipo de Dato | Nulable | Formato / Validación / Regex | Descripción |
| :--- | :---: | :---: | :--- | :--- |
| `id` | `String` | No | UUIDv4 / CUID | Identificador canónico generado en servidor. |
| `created_at` | `DateTime` | No | ISO-8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`) | Fecha y hora en meridiano UTC. |
| `status` | `Enum` | No | `['PENDING', 'ACTIVE', 'ARCHIVED']` | Estado de la entidad. |
| `idempotency_key`| `String` | Sí | UUIDv4 (Header HTTP) | Clave para evitar duplicados en operaciones concurrentes. |

### 1.3 Catálogo de Endpoints / Operaciones

#### `[HTTP_METHOD] /api/v1/[resource]`
* **Descripción:** Propósito técnico de la operación.
* **Autenticación / Permisos:** Requerida (`Bearer Token` / Session / API Key).
* **Roles Autorizados:** `[RoleA, RoleB]`.
* **Middlewares / Interceptors:** Autenticación, RBAC, Validación de Esquema, Control de Idempotencia.
* **Respuestas HTTP:**
  * `200 OK` / `201 Created`: Datos de la entidad empaquetados en `{ success: true, data }`.
  * `400 Bad Request`: Error de validación con código de campo.
  * `401 Unauthorized` / `403 Forbidden`: Sin sesión válida o sin privilegios.
  * `404 Not Found`: Recurso inexistente.
  * `409 Conflict`: Conflicto de estado o idempotencia duplicada.

### 1.4 Trazabilidad & Eventos de Auditoría
| Acción Operativa | Código de Evento | Nivel de Severidad | Actor | Datos Registrados (Sanitizados) |
| :--- | :---: | :---: | :---: | :--- |
| Creación de entidad | `RESOURCE_CREATED` | `INFO` | `user.id` | `{ resource_id, timestamp }` |
| Intento no autorizado | `UNAUTHORIZED_ACCESS` | `WARNING` | `user.id / anon` | `{ path, role }` |

### 1.5 Sanitización de Logs
> [!CAUTION]
> Prohibido imprimir en logs del servidor (stdout, archivos de texto, APM) contraseñas, secretos, tokens de autenticación o datos personales sensibles (PII).

---

## 2. Esquema de Base de Datos & Persistencia

### 2.1 Sentencias de Migración Hacia Adelante (Up-Migration)
```sql
-- DDL reversible para el motor correspondiente (PostgreSQL, MySQL, SQLite, etc.)
BEGIN;

CREATE TABLE IF NOT EXISTS resource_name (
    id VARCHAR(64) PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(32) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_resource_created ON resource_name (created_at DESC);

COMMIT;
```

### 2.2 Estrategia de Reversión (Down-Migration / Rollback)
```sql
BEGIN;

DROP TABLE IF EXISTS resource_name CASCADE;

COMMIT;
```

### 2.3 Concurrencia, Transacciones e Idempotencia
* **Transacciones Atómicas:** Toda operación multi-tabla debe envolverse en transacción con rollback ante excepciones.
* **Prevención de Clics Dobles:** Utilizar restricciones de unicidad compuestas o validación de clave de idempotencia en caché/BD.
* **Aislamiento:** Emplear bloqueos optimistas (número de versión) o bloqueos de fila para evitar *race conditions*.

---

## 3. Estrategia de Consumo en Cliente & Estado

* **Cliente HTTP Delgado:** Servicios desacoplados que delegan al cliente base configurado con interceptores de autenticación y reintento.
* **Consistencia de Fuente de Verdad:** Prohibido mantener doble persistencia o estados locales simulados desincronizados del servidor.
* **Manejo Reactivo de Estados:**
  * [ ] Carga (Loading / Skeleton).
  * [ ] Vacío (Empty state).
  * [ ] Error con reintento (Error boundary).
  * [ ] Restringido (Forbidden / Locked state).

---

## 4. Matriz de Riesgos Técnicos & Mitigación

| Riesgo Técnico | Impacto | Estrategia de Mitigación |
| :--- | :---: | :--- |
| Fallo de migración en producción | Alto | Script de rollback (`down.sql`) probado en CI/CD. |
| Fuga de datos / Vulnerabilidad IDOR | Crítico | Pruebas de contrato automatizadas que intentan acceder a recursos de otros inquilinos. |
| Degradación de rendimiento en consultas | Medio | Índices creados en columnas de filtro y ordenamiento. |
