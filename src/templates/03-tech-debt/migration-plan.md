# [DEBT-PLAN-XXX] Plan de Refactorización & Desacoplamiento

| Campo | Valor |
| :--- | :--- |
| **Referencia a la Deuda** | `[DEBT-XXX]` |
| **Fecha de Diseño** | AAAA-MM-DD |
| **Arquitecto Líder** | Subagente / Ingeniero |
| **Estrategia** | `Strangler Fig Pattern (Sustitución Gradual)` \| `Corte Limpio de Mock` \| `Consolidación de CSS` \| `Actualización de Dependencia` |

---

## 1. Estrategia de Refactorización

### 1.1 El Enfoque Seguro (Strangler Fig / Sustitución Gradual)
> Explica cómo se sustituirá el código heredado sin detener la operación ni romper contratos existentes:
1. Crear la nueva abstracción o servicio limpio al lado del código anterior.
2. Migrar los componentes consumidores uno por uno.
3. Verificar que las pruebas existentes sigan pasando.
4. Retirar el código muerto y dependencias obsoletas una vez desconectados todos los consumidores.

### 1.2 Límites Explícitos y Fuera de Alcance (Non-Goals)
> [!WARNING]
> Prohibido aprovechar una refactorización de deuda técnica para añadir nuevas funcionalidades o cambiar el comportamiento visual.
* **NO-GO 1:** (ej. No se rediseñará la interfaz ni se cambiarán las rutas existentes).
* **NO-GO 2:** (ej. No se actualizarán paquetes mayores con breaking changes no relacionados).

---

## 2. Invariantes a Preservar
* **Invariante 1:** (ej. Todas las interfaces y contratos públicos existentes deben seguir respondiendo con el mismo esquema).
* **Invariante 2:** (ej. Cero pérdida o duplicidad de datos durante la fase de transición).
* **Invariante 3:** (ej. Preservar todas las pruebas del suite actual en verde sin modificar aserciones).

---

## 3. Plan de Reversión (Rollback en Caso de Regresión)
* ¿Cómo revertir el refactor si se detecta un bug inesperado?
* Rama Git aislada / commits atómicos reversibles (`git revert`).
