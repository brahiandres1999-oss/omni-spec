# Fuentes y decisiones de interoperabilidad

Consulta: 2026-10-22. Las siguientes fuentes son documentación oficial o especificaciones primarias. No son una certificación de OmniSpec ni garantizan el comportamiento de un modelo.

| Fuente | Decisión aplicada | Comprobación local |
| --- | --- | --- |
| [Agent Skills specification](https://agentskills.io/specification) | Skills con nombre y descripción, carpeta coincidente y cuerpo Markdown. Se omite `allowed-tools` porque es opcional/experimental y los nombres no son portables. | Nombres, contenido y ubicaciones en pruebas de adaptadores. |
| [Antigravity skills](https://antigravity.google/docs/skills?tab=ide) | `.agents/skills/<nombre>/SKILL.md`; invocación por nombre en el host. | Nueve archivos instalados; chat real pendiente. |
| [Antigravity plugins](https://antigravity.google/docs/plugins/) | `plugin.json` se limita al esquema publicado (`$schema`, `name`, `description`); los campos no documentados por Google viven en `plugin.extra.json`. | Manifiesto y `rules/constitution.md` con frontmatter verificados en pruebas. |
| [Antigravity rules](https://antigravity.google/docs/rules/) | Todo `.md` de `rules/` exige frontmatter con `trigger:` válido; sin él Antigravity descarta la regla en silencio. | `trigger: always_on` obligatorio en prueba. |
| [Antigravity migration](https://antigravity.google/docs/migration/workflows-to-skills/) | Se utiliza el formato de skills en lugar de añadir workflows heredados. | No se generan carpetas de workflows antiguas. |
| [Cursor skills](https://cursor.com/docs/skills) | `.cursor/skills/<nombre>/SKILL.md`; Cursor también lee `.agents/skills/`, `.claude/skills/` y `.codex/skills/`. | Árbol de skills y regla de proyecto generados. |
| [Claude Code skills](https://code.claude.com/docs/en/skills) | `.claude/skills` para el nuevo adaptador; sin duplicar nuevos archivos en commands. | Skill con metadata y protocolo común. |
| [GitHub Copilot cheat sheet](https://docs.github.com/en/copilot/reference/customization-cheat-sheet) | Copilot lee `.agents/skills/` y `.claude/skills/`; los prompt files solo ejecutan en el harness Local, por lo que dejan de ser la vía principal. | Árbol de skills en el adaptador de Copilot. |
| [Kilo skills](https://kilo.ai/docs/customize/skills) y [workflows](https://kilo.ai/docs/customize/workflows) | `.kilo/skills` más `.kilo/commands` para la invocación de slash documentada. | Archivos y argumentos. |
| [OpenCode skills](https://opencode.ai/docs/skills) | `.opencode/skills`; la invocación de slash se declara con `metadata: {"opencode/slash": "true"}` en lugar de duplicar en commands. | Metadata y protocolo común. |
| [Gemini CLI custom commands](https://geminicli.com/docs/cli/custom-commands/) y skills | TOML en `.gemini/commands` con description, prompt y `{{args}}`, más `.gemini/skills`. | Formato generado e interpolación declarada. |
| [OpenAI: skills in repositories](https://developers.openai.com/blog/skills-agents-sdk) y [build skills](https://learn.chatgpt.com/docs/build-skills) | Skills de proyecto en `.agents/skills`, con invocación propia del host. No anunciar `/` universal donde corresponde un selector o `$`. | Generación del adaptador; sesión real pendiente. |
| [AGENTS.md en Codex](https://learn.chatgpt.com/docs/agent-configuration/agents-md) | `AGENTS.md` es el único archivo que los siete hosts documentan, así que se entrega en todos los adaptadores como sección gestionada. | Bloque presente en cada adaptador; contenido de usuario preservado. |
| [GitHub Spec Kit: SDD](https://github.github.com/spec-kit/reference/agentic-sdd.html) y [existing projects](https://github.github.io/spec-kit/guides/existing-projects.html) | Separar necesidad, aclaración, plan, tareas y revisión; adoptar reglas realistas del repositorio. | Protocolos por arquetipo y recorridos de paquete nuevo/existente. |
| [Uvik SDD Benchmark 2026](https://uvik.net/blog/spec-driven-development-benchmark/) (datos CC BY 4.0) | El overhead de planificación solo se paga desde **3 archivos**; se usa ese umbral para la ruta ligera. La ruta completa se conserva sin `fit.json`. | `src/fit.mjs` y `test/fit.test.mjs` cubren el umbral, la escalada y el valor por defecto. |
| [Spec Fit Test de Uvik](https://uvik.net/blog/spec-driven-development-benchmark/) (CC BY 4.0) | Cuestionario de seis preguntas como base del Spec Fit; se reescribe en forma declarativa y verificable por máquina. | `schema/fit.schema.json` valida cada respuesta y rechaza valores no permitidos. |
| [Garg, *When Spec-Driven Development Pays off*](https://www.infoq.com/articles/when-spec-driven-development-pays-off) (GAISS 2026) | El razonamiento previo, no la especificación, es lo que sube la corrección en cambios pequeños; por eso `reasoning` es una respuesta obligatoria y bloquea la ruta ligera. | Un `reasoning` distinto de `done` escala a ruta completa. |
| [Yang et al. (Orchid), ASE 2026](https://doi.org/10.1145/3832783.3834403) | La ambigüedad se **pregunta**, no se infiere: los modelos no la detectan solos y cuesta corrección. | `ambiguity` es una respuesta obligatoria; `material` o `blocked` escalan a ruta completa. |
| [Konstantinou et al., arXiv:2607.05139](https://arxiv.org/abs/2607.05139) | Un bugfix mantiene siempre la ruta completa: la detección de fallos cae del 25% al 14% si los tests se escriben después del código. | `classifyFit` fija `full` para `bugfix` y `decision` para `rfc`. |
| [NIST SSDF 1.1](https://csrc.nist.gov/pubs/sp/800/218/final) | Usado como referencia de prácticas de desarrollo seguro y verificación integrables en el ciclo de vida; no como supuesta certificación SDD. | Evidencia explícita, resultados de pruebas y límites documentados. |
| [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) | 0.6.0 por soporte nativo de Plugin en Antigravity, subagente omni-auditor y desbloqueo del diagnóstico en bugfix sobre la base 0.5.x; versión única obtenida de package.json. | Versión única obtenida de package.json. |

## Qué significa SDD en esta implementación

La intención se registra antes de implementar; el diseño y las tareas responden a ella; los cambios se contrastan con criterios; las decisiones sobreviven a otra sesión. Las propuestas pueden terminar en rechazo o aplazamiento, y una consulta de ayuda no necesita implementación.

El motor controla generación, estado, integridad y ejecución explícita de verificaciones. La revisión semántica requiere al agente y, cuando faltan decisiones, al usuario. Ninguna fuente consultada convierte una búsqueda de tokens o un prompt en una demostración de corrección universal.

## Política para nuevos agentes

Los perfiles también se convirtieron en revisiones de aplicabilidad. Las referencias de [HIPAA Security Rule](https://www.hhs.gov/hipaa/for-professionals/security/index.html) y [PCI DSS](https://www.pcisecuritystandards.org/standards/pci-dss/) respaldan consultar el alcance y las obligaciones correspondientes; no justifican afirmar que una plantilla, un cifrado fijo o un umbral de agregación certifica cumplimiento. No se impone una base de datos, tenancy o arquitectura financiera a todos los proyectos.

Para declarar un adaptador: consultar la documentación oficial de su versión, implementar la ubicación/formato de invocación, comprobar generación y preservación de archivos, y completar un recorrido en su chat. Si el host no tiene comandos custom, usar `generic` y anunciar la limitación. No confundir formato compatible con integración probada en producción.
