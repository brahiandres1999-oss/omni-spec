# [RFC-XXX] Propuesta Técnica / Registro de Decisión Arquitectónica (MADR)

| Campo | Valor |
| :--- | :--- |
| **ID del RFC** | `RFC-XXX` |
| **Fecha de Propuesta** | AAAA-MM-DD |
| **Estado** | `PROPOSED` \| `UNDER_REVIEW` \| `ACCEPTED` \| `REJECTED` \| `SUPERSEDED` |
| **Autor(es)** | Nombre / Rol |
| **Decisores / Consultados** | Ingenieros Líderes / Arquitectos |

---

## 1. Contexto & Declaración del Problema
> Describe en 2 o 3 párrafos la situación arquitectónica o la nueva idea a evaluar. ¿Por qué se plantea esta decisión ahora? ¿Qué limitación técnica o necesidad de negocio la motiva?

---

## 2. Fuerzas Impulsoras de la Decisión (Decision Drivers)
*Factores técnicos, regulatorios o de negocio que guían la elección:*
* **Driver 1:** (ej. Escalabilidad: soporte para alto volumen de operaciones concurrentes).
* **Driver 2:** (ej. Seguridad y Privacidad: cumplimiento de normativas de datos y cifrado en tránsito).
* **Driver 3:** (ej. Experiencia de Desarrollo / DX: evitar dependencias pesadas o complejas de compilar).
* **Driver 4:** (ej. Mantenibilidad: diseño limpio y testeable con bajo costo de soporte a largo plazo).

---

## 3. Opciones Consideradas

### Opción A: [Nombre de la Opción A, ej. Implementar WebSockets con Socket.io]
* **Descripción:** Breve resumen técnico de cómo funcionaría.
* **Pros:**
  * ✅ *Ventaja 1 (ej. Comunicación bidireccional en tiempo real con baja latencia).*
  * ✅ *Ventaja 2 (ej. Reconexión automática nativa).*
* **Contras & Trade-offs:**
  * ❌ *Desventaja 1 (ej. Requiere mantener conexiones persistentes y mayor consumo de memoria en servidor).*
  * ❌ *Desventaja 2 (ej. Dificultad para balancear carga entre múltiples instancias).*

### Opción B: [Nombre de la Opción B, ej. Server-Sent Events (SSE)]
* **Descripción:** Breve resumen técnico.
* **Pros:**
  * ✅ *Ventaja 1 (ej. Protocolo HTTP estándar, unidireccional y ligero).*
* **Contras & Trade-offs:**
  * ❌ *Desventaja 1 (ej. No permite envío bidireccional desde el cliente por el mismo canal).*

### Opción C: [Nombre de la Opción C, ej. Short Polling cada 5 segundos]
* **Descripción:** Breve resumen técnico.
* **Pros:**
  * ✅ *Ventaja 1 (ej. Muy simple de implementar).*
* **Contras & Trade-offs:**
  * ❌ *Desventaja 1 (ej. Alto desperdicio de peticiones HTTP en turnos sin actividad).*

---

## 4. Decisión Final & Justificación

**Opción Seleccionada:** `[Opción Elegida]`

### Justificación Técnica:
> Explica por qué la opción elegida es la superior considerando los Decision Drivers.

### Consecuencias & Concesiones (Trade-offs Aceptados):
* **Consecuencias Positivas:**
  * *Mejora en [Métrica / Calidad].*
* **Consecuencias Negativas Aceptadas:**
  * *Mayor complejidad en [Componente], mitigada mediante [Estrategia].*

---

## 5. Plan de Validación / Prueba de Concepto (PoC)
* **¿Se requiere un spike o prototipo previo?** `SÍ / NO`.
* **Criterio de Éxito del PoC:** (ej. Demostrar latencia menor a 100ms con 50 clientes conectados localmente).
