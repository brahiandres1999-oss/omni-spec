# [DEBT-XXX] Diagnóstico e Inventario de Deuda Técnica

| Campo | Valor |
| :--- | :--- |
| **ID de Deuda** | `DEBT-XXX` |
| **Fecha de Auditoría** | AAAA-MM-DD |
| **Categoría** | `Doble Persistencia (Mock vs BD)` \| `Dependencias Obsoletas/Vulnerables` \| `Acoplamiento Arquitectónico` \| `CSS/Estilos Huérfanos` \| `Código Muerto / Cruft` |
| **Estado** | `IDENTIFIED` \| `TRIAGED` \| `PLAN_APPROVED` \| `IN_REFACTOR` \| `RESOLVED` |
| **Módulos Afectados** | `frontend/src/styles/...` \| `frontend/src/features/...` \| `backend/...` |

---

## 1. Declaración del Problema & Síntomas
> Describe con precisión la deuda técnica detectada. ¿Cómo se originó? (ej. prototipado rápido, refactorización incompleta, acumulación histórica de CSS, paquetes desactualizados en npm).
* **Síntomas Actuales:** (ej. lentitud en build de Vite, colisiones de estilos por cascada, componentes de 500 líneas con demasiadas responsabilidades, riesgo de seguridad reportado por `npm audit`).

---

## 2. Matriz de Evaluación de Impacto (Puntuación 1 a 5)

| Dimensión | Puntuación (1-5) | Justificación Técnica |
| :--- | :---: | :--- |
| **Velocidad del Desarrollador / Agente** | `[1-5]` | *¿Cuánto ralentiza la creación de nuevas features?* |
| **Mantenibilidad & Carga Cognitiva** | `[1-5]` | *¿Qué tan difícil es entender el código sin romperlo?* |
| **Riesgo de Confiabilidad / Regresión** | `[1-5]` | *¿Es propenso a generar bugs silenciosos en producción?* |
| **Seguridad, Privacidad & Cumplimiento**| `[1-5]` | *¿Viola normas de k-anonimato, Ley 1581 o introduce CVEs?* |

---

## 3. Inventario Exhaustivo de Archivos & Consumidores
> [!IMPORTANT]
> Antes de planificar la refactorización, lista todos los archivos que producen o consumen esta deuda:

### 3.1 Archivos Fuente de la Deuda
* `file:///ruta/al/archivo_a_sanear.jsx` (Líneas X-Y)

### 3.2 Consumidores Dependientes (Blast Radius)
* `file:///ruta/al/consumidor_1.jsx` (Llama al método obsoleto)
* `file:///ruta/al/consumidor_2.jsx`

---

## 4. Diagnóstico de Herramientas Automatizadas
```bash
# Salida de comandos de análisis (ej. npm audit, depcheck, eslint o analizador de bundle)
```
