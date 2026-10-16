# [BUG-XXX] Reporte de Incidente / Error

| Campo | Valor |
| :--- | :--- |
| **ID del Bug** | `BUG-XXX` |
| **Fecha de Reporte** | AAAA-MM-DD |
| **Severidad** | `P1 (Crítico/Caída de Servicio)` \| `P2 (Alto/Operación Bloqueada)` \| `P3 (Medio/Fallo Funcional)` \| `P4 (Bajo/Cosmético)` |
| **Estado** | `REPORTED` \| `TRIAGED` \| `ANALYZING_RCA` \| `FIX_VERIFIED` \| `CLOSED` |
| **Actor / Rol Afectado** | `[ ] Usuario Final` \| `[ ] Operador Interno` \| `[ ] Administrador` \| `[ ] Sistema / API Externa` |
| **Entorno Detectado** | `Local / Test` \| `Staging` \| `Producción` |
| **Componente Afectado** | `path/to/module-or-service` |

---

## 1. Resumen del Fallo
> Descripción concisa de 2 o 3 líneas sobre qué está fallando, para qué tipo de usuario y cuál es la consecuencia inmediata en el sistema.

---

## 2. Comportamiento Observado vs. Esperado

### 2.1 Comportamiento Observado (Lo que ocurre)
* *ej. Al enviar el formulario de checkout, la interfaz arroja un error 500 y no confirma el pedido.*

### 2.2 Comportamiento Esperado (Lo que debería ocurrir)
* *ej. El pedido debe persistir atómicamente, procesar el pago y devolver confirmación en < 500ms.*

---

## 3. Pasos Deterministas de Reproducción
> [!IMPORTANT]
> Los pasos deben ser 100% reproducibles y no basarse en intuiciones.
1. Iniciar sesión con el usuario de prueba con rol `[Rol]`.
2. Navegar a la ruta `/[ruta]`.
3. Ingresar los siguientes valores en el formulario: `[Valores]`.
4. Hacer clic en `[Botón]`.
5. Observar el error en la interfaz o en la respuesta de red.

---

## 4. Trazas, Logs Sanitizados & Payloads
```text
// Pegar aquí la traza de error (Stack trace) o respuesta HTTP fallida.
// RECORDATORIO: Sanitizar tokens JWT, contraseñas, secretos o datos personales antes de pegar.
```

---

## 5. Impacto en el Negocio & Seguridad
* **¿Bloquea la operación crítica del negocio?** `SÍ / NO` (Detalle).
* **¿Existe riesgo de fuga de datos sensibles o violación regulatoria?** `SÍ / NO` (Si es SÍ, elevar inmediatamente a P1).
* **¿Existe pérdida o corrupción de datos en la base de datos?** `SÍ / NO`.
