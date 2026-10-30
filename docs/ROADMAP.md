# Hoja de ruta de OmniSpec

Actualizado el 2026-10-30 tras el lanzamiento oficial de **OmniSpec 0.8.1**.

---

## OmniSpec 0.8.1 — Lanzamiento de Parche y TUI Dual-Tone (Completado)

Publicado en el canal npm `latest` y GitHub Releases el 2026-10-30.

- **TUI Visual Modernization & Dual-Tone Wordmark (Spec 024):** Banner FIGlet ASCII limpio (azul corporativo / ámbar) reemplazando la rasterización isométrica ruidosa, reduciendo el consumo vertical de 27 a 6 líneas de alto con umbral responsivo adaptable.

---

## OmniSpec 0.8.0 — Lanzamiento Oficial Estable (Completado)

Publicado en el canal npm `latest` y GitHub Releases el 2026-10-30.

### Núcleo y Arquitectura Consolidada:
- **Pilar 6: MDD (Memory Distillation Driven) & FinOps de Contexto (Spec 023):** Exposición de presupuestos de tokens en CLI (`context-check`), destilación compacta del contexto en 5 épocas evolutivas y reducción de más del 70% del consumo de tokens por turno.
- **Ecosistema de Agentes y Protocolo Multimodal (Spec 022):** 10 adaptadores de host estandarizados (Antigravity, Cursor, Claude Code, Copilot, Codex, Kilo, OpenCode, Gemini, Generic y Plugin). Soporte bidireccional gestionado para `CLAUDE.md` y `AGENTS.md`.
- **Detección de Herramientas Modernas y Runtime Bun (Spec 019):** Reconocimiento de locks binarios (`bun.lockb`) y textuales (`bun.lock`), tooling de Python moderno (`uv.lock`), frameworks Astro, Svelte y Nuxt, y compatibilidad desatendida con `bunx omni-spec`.
- **Gobernanza de Artefactos y Anti-Slop (Specs 016, 017 y 018):** Protocolo Zero-Slop con 5 reglas de artesanía de software, criterios de aceptación EARS y triaje dinámico de especificaciones (`--light`, `--preset`).
- **Antigravity First-Class Plugin:** Empaquetado autónomo de ~540 KB con inyección de constitución (`trigger: always_on`) y subagente auditor (`omni-auditor.md`), validado formalmente con `agy plugin validate --strict`.

---

## Próximas iteraciones planificadas (0.8.1 / 0.9.0)

| Capacidad | Estado | Objetivo |
| :--- | :--- | :--- |
| **Flujo Ceremonial Rojo→Verde en TDD (Opcional)** | Planificado | Registro automatizado de fallo previo a la implementación para equipos que elijan TDD estricto sin penalizar el consumo de tokens en tareas estándar. |
| **Auditoría Automatizada de Accesibilidad y UI en CI** | Planificado | Gate ejecutable para contrastes WCAG 2.1 AA y verificación de los 4 estados de interfaz en pipelines desatendidos. |
| **Puente Web Initializr y Perfiles Headless** | Planificado | Interfaz visual web interactiva para configurar manifiestos de OmniSpec y exportar configuraciones reproducibles. |
| **Multi-Agent Collaboration Mesh** | Investigación | Protocolos de coordinación formal entre subagentes independientes para monorepos de gran escala. |
