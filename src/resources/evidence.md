# Registros de evidencia de OmniSpec

Este recurso acompaña a omni-init, omni-specify y omni-converge. Muestra la forma exacta de cada archivo que el CLI valida. Los valores son ilustrativos: registra lo que realmente observaste, nunca copies un ejemplo como resultado.

## Dónde guardar los archivos de entrada

`session-record`, `decision-record`, `checks` y `contract-record` leen JSON con `--from`. Usa `specs/.omni/inputs/<nombre>.json`, un archivo temporal fuera del proyecto o `--from -` para leer de la entrada estándar. No lo dejes en la raíz del proyecto: un archivo nuevo ahí forma parte del código verificado.

## Clasificación del cambio: `specs/<slug>/fit.json`

```json
{
  "schemaVersion": 2,
  "reasoning": "done",
  "files": 2,
  "modules": 1,
  "crossesContract": false,
  "ambiguity": "none",
  "existingTests": true,
  "risk": "low",
  "uncertainty": "clear",
  "reversibility": "easy"
}
```

Valores admitidos: `reasoning` done|partial|skipped; `ambiguity` none|material|blocked; `risk` low|high|critical; `uncertainty` clear|material|blocked; `reversibility` easy|difficult. La ruta se lee con `fit <id>`, nunca se escribe a mano.

## Checks aprobados: `checks --from <archivo>`

```json
{
  "schemaVersion": 1,
  "checks": [
    { "id": "api-test", "command": "mvn -q test", "cwd": "backend", "timeoutMs": 600000 },
    { "id": "web-unit", "command": "npm test", "cwd": "frontend" },
    { "id": "web-e2e", "command": "npx playwright test", "cwd": "frontend", "kind": "ui", "timeoutMs": 900000 }
  ]
}
```

`cwd` es relativo al proyecto. `kind: "ui"` marca un check que ejercita la interfaz renderizada. Las salidas generadas que estén en `.gitignore`, en `.omnispecignore` o en la lista por defecto (por ejemplo `test-results/`, `playwright-report/`, `.gradle/`, `build/`, `target/`, `coverage/`) no forman parte de la huella. Si `verify` informa archivos cambiados durante los checks, exclúyelos en `.omnispecignore` con sintaxis de `.gitignore`.

## Criterios: `specs/<slug>/acceptance.json`

En el artefacto principal cada criterio lleva ID y tipo: `AC-01 [functional]: ...`, `AC-02 [visual]: ...`.

```json
{
  "schemaVersion": 2,
  "criteria": [
    {
      "id": "AC-01",
      "kind": "functional",
      "status": "passed",
      "method": "automated",
      "checkIds": ["api-test"],
      "evidence": "AppointmentServiceTest.rejectsOverlap: dos citas solapadas devuelven 409; limitado a la base H2 de prueba."
    },
    {
      "id": "AC-02",
      "kind": "visual",
      "status": "passed",
      "method": "manual",
      "evidence": "Agenda a 375 px sin desplazamiento horizontal con el nombre de paciente más largo de la muestra.",
      "observations": [
        {
          "actor": "agent",
          "observer": "agente del piloto",
          "sessionId": "<id devuelto por session-record>",
          "surface": "/agenda",
          "environment": "Chromium 130, servidor local de desarrollo, datos de muestra",
          "steps": ["Abrir /agenda", "Fijar viewport 375x812", "Medir document.documentElement.scrollWidth"],
          "expected": "scrollWidth <= 375",
          "actual": "scrollWidth = 360",
          "result": "passed",
          "observedAt": "2026-10-22T15:04:05.000Z",
          "viewport": { "width": 375, "height": 812 },
          "artifact": "evidence/agenda-375.png"
        }
      ]
    }
  ]
}
```

- `status`: passed solo cuando la evidencia lo sostiene; si no, pending, failed o blocked.
- `method`: automated (requiere `checkIds`), manual, inspection o decision.
- Criterios visual, interaction y accessibility: un check `kind: "ui"` o observaciones reales. Leer CSS/JSX no basta.
- `artifact`: archivo local dentro de la carpeta de la spec.
- Observaciones de un agente: necesitan una sesión registrada con `render` disponible antes de observar. Usa su `sessionId` o una hora posterior a ese registro. Las sesiones anteriores se conservan, así que una evidencia válida no caduca por registrar una sesión nueva.

## Sesión: `session-record --from <archivo>`

```json
{
  "host": "Claude Code 2.x",
  "capabilities": {
    "questions": { "status": "available", "source": "herramienta nativa de preguntas expuesta" },
    "web": { "status": "available", "source": "búsqueda web realizada en esta sesión" },
    "terminal": { "status": "available", "source": "comando ejecutado" },
    "render": { "status": "available", "source": "navegador abrió http://localhost:5173" },
    "delegation": { "status": "unknown", "source": "no inspeccionado" }
  }
}
```

Registra la sesión al empezar a trabajar, antes de observar la interfaz.

## Decisión: `decision-record --from <archivo>`

```json
{
  "id": "stack-frontend",
  "topic": "technology",
  "status": "approved",
  "value": "React + Vite + TypeScript (versiones estables consultadas)",
  "basis": "El usuario aprobó la recomendación tras comparar las opciones el 2026-10-22.",
  "required": true,
  "sources": [
    {
      "url": "https://react.dev/versions",
      "consultedAt": "2026-10-22T14:00:00.000Z",
      "appliesTo": "versión estable de React",
      "authority": "official"
    }
  ],
  "expectedRevision": 0
}
```

`status`: pending, provisional, approved, delegated o not-applicable. Para cambiar una decisión existente usa su `expectedRevision` actual. Una decisión obligatoria pendiente bloquea `verify` en su alcance (`appliesTo` con IDs de spec, o todo el proyecto si se omite).

## Orden de cierre

1. Implementa y completa `verification.md` con criterio → evidencia → resultado y límites.
2. Si `status` informa contexto `STALE` (cambió un manifiesto, CI, instrucciones o un archivo citado), reconcilia `project-context.md` y ejecuta `context-record`. Los cambios de código fuente no dejan el contexto obsoleto.
3. `verify <id>`: ejecuta los checks y liga la evidencia a la huella actual.
4. `complete <id>`: cierra solo si nada cambió desde la verificación.
