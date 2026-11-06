# Omni Studio: Design System & Visual Architecture

> **Estándar de Interfaz**: Consola de ingeniería de alta densidad informativa, inspirada en la arquitectura ergonómica de Antigravity (Obsidian / Deep Charcoal), ventana nativa fluida en Windows 11 (Mica / Window Chrome integrado), componentes personalizados shadcn/ui y calibración física Better UI.
> **Principio de Identidad**: Adoptamos la elegancia ergonómica de Antigravity pero con una identidad visual propia concebida para OmniSpec (Consola de Control SDD, métricas de Blast Radius, Gobernanza en Ámbar y terminal ConPTY acoplada).

---

## 1. Deconstrucción Visual: El ADN "Antigravity-Inspired"

A partir del análisis de la interfaz de última generación de Antigravity, Omni Studio adopta sus patrones más pulidos:

| Patrón Visual | Implementación en Omni Studio |
| :--- | :--- |
| **Paleta "Obsidian & Charcoal"** | Fondo cálido neutro muy oscuro (`#131314` a `#18181b`), erradicando los fondos azulados fríos genéricos y el negro puro `#000000`. |
| **Arquitectura de 3 Columnas Elásticas** | 1. **Rail Lateral Izquierdo:** Navegación, proyectos y especificaciones activas.<br>2. **Escenario Central:** Kanban dinámico, Grafo Cartográfico y Visor de Diffs.<br>3. **Inspector Lateral Derecho (Collapsible):** Telemetría FinOps, subagentes, tareas activas y terminal ConPTY. |
| **Dock Flotante Inferior ("Cockpit Pill")** | Barra de comandos flotante desacoplada con esquinas redondeadas (`rounded-2xl`), microborde de 1px (`#282a2c`) y selector de modos integrado (`/omni-specify`, `/omni-audit`, `/omni-converge`). |
| **Titlebar Integrado Seamless** | La barra de título se funde con el cromo nativo de Windows 11 (`titleBarStyle: 'overlay'`), alojando navegación breadcrumb y controles DWM sin saltos visuales. |
| **Micro-Bordes y Jerarquía Óptica** | Separadores ultra-sutiles de 1px (`#262626`), cero sombras pesadas ("card-itis"), densidad de datos con fuentes monospace en etiquetas de metadatos. |

---

## 2. Nuestra Identidad Única: La Firma OmniSpec

Para diferenciarnos y proyectar la personalidad de OmniSpec, definimos la arquitectura del espacio de trabajo:

```
+---------------------------------------------------------------------------------------------------------+
| [Logo Omni]  Omni Studio  |  branch: feat/nextgen-phase4-omni-studio  |  [Ctrl+K]        |  -  □  ✕ (Win) |
+---------------------------------------------------------------------------------------------------------+
|  [RAIL IZQUIERDO]   |                     [ESCENARIO CENTRAL]                     | [INSPECTOR DERECHO] |
|                     |                                                             |                     |
|  + Nueva Spec       |  [Tabs: Kanban | Cartografía | Diffs | FinOps | Skills]     |  ● Subagentes (3)   |
|                     |  ---------------------------------------------------------  |  ● Tareas (4/7)     |
|  PROYECTOS          |                                                             |  ● Memory WAL: 0 B  |
|  📁 omni-spec       |  [VISTA SELECCIONADA A 60 FPS]                              |  ● ConPTY Terminal  |
|    └─ 001-memory    |  - Kanban adaptativo de ceremonia                           |  -----------------  |
|    └─ 002-guardian  |  - WebGL Blast Radius Heatmap                               |  FINOPS METER       |
|    └─ 003-carto     |  - Visor Side-by-Side con Cherry-picking                    |  ⚡ 142 t/s         |
|  📁 omnipage        |                                                             |  💰 $0.12 / 80k     |
|                     |                                                             |  Circuit: CLOSED 🟢 |
|  ⚙ Ajustes          |                                                             |                     |
+---------------------+-------------------------------------------------------------+---------------------+
|                     |  [ ⬡ /omni-specify  |  Escribe una instrucción...  |  ⚡ Turbo | 🟢 ]                   |
+---------------------+-----------------------------------------------------------------------------------+
```

### 2.1 Paleta de Color (Obsidian Titanium Theme)
* **Base / Canvas:** `#121213` (Gris basal cálido, compatible con Mica translúcido de Windows 11).
* **Superficies / Paneles:** `#18181a` (Rail lateral e Inspector derecho).
* **Contenedores Flotantes (Cards & Dock):** `#1e1e21` con borde `#2a2a2e`.
* **Bordes y Divisores:** `#262628` (1px sólido).
* **Acentos Propios:**
  * ⚡ **Electric Cyan (`#06b6d4` / `#22d3ee`):** Acento primario, selección de nodos, foco de terminal y tabs activos.
  * 🛡️ **Amber de Gobernanza (`#f59e0b`):** Exclusivo para las compuertas humanas (Gate 1 y Gate 2) y advertencias de Blast Radius.
  * 🟢 **Emerald Attestation (`#10b981`):** Verificación HMAC v4 válida, tests verdes.
  * 🔴 **Crimson Shield (`#f43f5e`):** Circuit Breaker abierto o fallo de contrato.

---

## 3. Calibración Física de Interfaz (Better UI Standards)

Adoptado formalmente desde las directrices de Better UI:

1. **Microinteracción de Pulsación:**
   * Todos los botones, tabs y cards interactivas implementan:
     `enabled:active:scale-[0.96] transition-[scale,background-color,border-color] duration-150 ease-out`
   * Se prohíbe terminantemente `transition-all`.
2. **Aislamiento Táctil y Puntero:**
   * Variante `hover:` compilada con `future: { hoverOnlyWhenSupported: true }`.
   * Supresión del tap highlight gris mediante `-webkit-tap-highlight-color: transparent`.
3. **Accesibilidad Vestibular (`motion-safe`):**
   * Toda animación o apertura de drawer está condicionada con `motion-safe:`.
   * En `prefers-reduced-motion: reduce`, las transiciones se limitan a opacidad instantánea.
4. **Iconos Lucide Normalizados:**
   * Trazo unificado en toda la app a `strokeWidth={1.75}` con tamaño 16px/18px y padding asimétrico (`ps-2.5 pe-3.5`).
5. **Scroll Containment:**
   * Contención estricta (`overscroll-contain`) en el visor de diffs, terminal ConPTY y árbol de archivos.

---

## 4. Componentes shadcn/ui Personalizados (`apps/studio/src/components/ui/`)

* `cockpit-input`: El dock flotante inferior con selector integrado de comandos `/omni-*` y modelo.
* `inspector-drawer`: Panel lateral derecho elástico y colapsable con pestañas (`Terminal`, `Overview`, `FinOps`, `Files`).
* `kanban-board`: Columnas limpias de alta densidad para specs `--light`, `--standard` y `--full`.
* `diff-viewer`: Visor de diffs con `@git-diff-view/react` estilizado en modo Obsidian y botones de inyección de comentarios en línea.
* `command-palette`: Buscador global modal (`Ctrl+K`) con estética Raycast/Antigravity.
* `status-pill`: Badges compactos monospaced para estados del Circuit Breaker, memoria y Git Tree OID.

---

## 5. Los 4 Estados Obligatorios en Toda Vista

1. **Loading:** Skeletons oscuros contextuales con dimensiones idénticas al contenido (CLS = 0).
2. **Empty:** Ilustración sutil en línea monocromática con acción clara (CTA button calibrado a `active:scale-[0.96]`).
3. **Error:** Explicación técnica clara con botón de reintento atómico (`Retry`).
4. **Protected:** Bloqueo de seguridad explícito cuando Gate 1 o Gate 2 requieren firma criptográfica antes de proceder.
