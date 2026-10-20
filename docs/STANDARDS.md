# Fuentes y decisiones de interoperabilidad

Consulta: 2026-10-18. Las siguientes fuentes son documentación oficial o especificaciones primarias. No son una certificación de OmniSpec ni garantizan el comportamiento de un modelo.

| Fuente | Decisión aplicada | Comprobación local |
| --- | --- | --- |
| [Agent Skills specification](https://agentskills.io/specification) | Skills con nombre y descripción, carpeta coincidente y cuerpo Markdown. Se omite `allowed-tools` porque es opcional/experimental y los nombres no son portables. | Nombres, contenido y ubicaciones en pruebas de adaptadores. |
| [Antigravity skills](https://www.antigravity.google/docs/skills?tab=ide) | `.agents/skills/<nombre>/SKILL.md`; invocación por nombre en el host. | Nueve archivos instalados; chat real pendiente. |
| [Antigravity migration](https://www.antigravity.google/docs/migration/workflows-to-skills/) | Se utiliza el formato de skills en lugar de añadir workflows heredados. | No se generan carpetas de workflows antiguas. |
| [Cursor commands](https://docs.cursor.com/en/agent/chat/commands) | Comandos Markdown bajo `.cursor/commands`; una regla persistente no sustituye al comando. | Onboarding y demás comandos presentes. |
| [Claude Code skills](https://code.claude.com/docs/en/skills) | `.claude/skills` para el nuevo adaptador; sin duplicar nuevos archivos en commands. | Skill con metadata y protocolo común. |
| [VS Code prompt files](https://code.visualstudio.com/docs/agent-customization/prompt-files) | `.github/prompts/*.prompt.md`; soporte declarado para Copilot en VS Code. | Archivos y frontmatter; otros hosts no certificados. |
| [Kilo workflows](https://kilo.ai/docs/customize/workflows) | `.kilo/commands/*.md`; adaptación separada de OpenCode. | Archivos y argumentos. |
| [OpenCode commands](https://opencode.ai/docs/commands/) | `.opencode/commands/*.md` y `$ARGUMENTS`. | Archivos y protocolo común. |
| [Gemini CLI custom commands](https://geminicli.com/docs/cli/custom-commands/) | TOML en `.gemini/commands` con description, prompt y `{{args}}`. | Formato generado e interpolación declarada. |
| [OpenAI: skills in repositories](https://developers.openai.com/blog/skills-agents-sdk) y [build skills](https://learn.chatgpt.com/docs/build-skills) | Skills de proyecto en `.agents/skills`, con invocación propia del host. No anunciar `/` universal donde corresponde un selector o `$`. | Generación del adaptador; sesión real pendiente. |
| [GitHub Spec Kit: SDD](https://github.github.com/spec-kit/reference/agentic-sdd.html) y [existing projects](https://github.github.io/spec-kit/guides/existing-projects.html) | Separar necesidad, aclaración, plan, tareas y revisión; adoptar reglas realistas del repositorio. | Protocolos por arquetipo y recorridos de paquete nuevo/existente. |
| [NIST SSDF 1.1](https://csrc.nist.gov/pubs/sp/800/218/final) | Usado como referencia de prácticas de desarrollo seguro y verificación integrables en el ciclo de vida; no como supuesta certificación SDD. | Evidencia explícita, resultados de pruebas y límites documentados. |
| [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) | 0.5.1 por precisión de primer pase (anti-slop backend y frontend) sobre la base 0.5.0; versión única obtenida de package.json. | Versión única obtenida de package.json. |

## Qué significa SDD en esta implementación

La intención se registra antes de implementar; el diseño y las tareas responden a ella; los cambios se contrastan con criterios; las decisiones sobreviven a otra sesión. Las propuestas pueden terminar en rechazo o aplazamiento, y una consulta de ayuda no necesita implementación.

El motor controla generación, estado, integridad y ejecución explícita de verificaciones. La revisión semántica requiere al agente y, cuando faltan decisiones, al usuario. Ninguna fuente consultada convierte una búsqueda de tokens o un prompt en una demostración de corrección universal.

## Política para nuevos agentes

Los perfiles también se convirtieron en revisiones de aplicabilidad. Las referencias de [HIPAA Security Rule](https://www.hhs.gov/hipaa/for-professionals/security/index.html) y [PCI DSS](https://www.pcisecuritystandards.org/standards/pci-dss/) respaldan consultar el alcance y las obligaciones correspondientes; no justifican afirmar que una plantilla, un cifrado fijo o un umbral de agregación certifica cumplimiento. No se impone una base de datos, tenancy o arquitectura financiera a todos los proyectos.

Para declarar un adaptador: consultar la documentación oficial de su versión, implementar la ubicación/formato de invocación, comprobar generación y preservación de archivos, y completar un recorrido en su chat. Si el host no tiene comandos custom, usar `generic` y anunciar la limitación. No confundir formato compatible con integración probada en producción.
