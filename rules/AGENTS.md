<!-- OMNI-SPEC-START -->
## OmniSpec 0.6.0 Constitution & Engineering Standards

Use the project's OmniSpec workflows for requested engineering work. Start with `/omni-init` to understand this repository or `/omni-discuss` for exploration. Read `CONSTITUTION.md` and `specs/project-context.md`. Deliver first-pass precision: zero code slop (no trivial comments, no premature layers, fail-fast), zero spec fluff, and high-craft UI (anti-cliché, 4 mandatory states). Run the local CLI with `node specs/.omni/runtime/bin/omni-spec.mjs`. Inspect status before resuming work. Documentary audit is not code verification.

### 1. Governance & Code Surgery
1. **Pre-Execution Diagnostic:** Before making any non-trivial change, present a structured assessment: *Problem, Proposed Solution, and Consequences/Risks*.
2. **Strict Non-Destructive Policy:** Destructive changes, large refactors, or database modifications require explicit approval.
3. **Evidence and uncertainty:** Distinguish verified facts, hypotheses and unresolved decisions. Inspect repository evidence first; ask the user about material ambiguity.
4. **Minimal Touch Surgery:** Modify exclusively the files necessary to achieve the verified objective. Do not touch adjacent working code or reformat unrelated modules.
5. **Demonstrable Quality Gates:** Automated gates must pass for automated verification; when none apply, document explicitly labeled manual evidence.

### 2. Backend Pragmatic Craft & Zero Code Slop
- **Strict YAGNI & Direct Implementation:** Never add speculative abstraction layers, premature interfaces, DTOs, factories, or wrapper classes when a direct, idiomatic function or standard module satisfies the acceptance criteria.
- **Zero Comment Slop:** Strictly forbid obvious, narrative, or parrot comments that paraphrase code syntax. Self-documenting code with clean naming is mandatory.
- **Fail-Fast & Transparent Failures:** Strictly forbid defensive `try/catch` wrappers that swallow exceptions, return dummy nulls, or silently mask errors without a documented business requirement.
- **Zero Spec & Plan Slop:** Specifications and plans must maintain high technical density: tabular evidence, explicit non-goals, and atomic, falsable criteria (`AC-01`).

### 3. UI Ergonomics & Frontend Craft (Anti-Slop & ProMax Standards)
- **Zero Visual Slop:** Strictly avoid generic AI clichés: default purple-to-blue gradients, centered pill badges with ungrounded outer glow, and repetitive nested bordered cards with diffuse drop shadows ("card-itis").
- **Intentional Typography & Whitespace:** Establish a clear typographic scale and deliberate whitespace hierarchy rather than partitioning every element with artificial boxes and borders.
- **Interactive Polish & Micro-Interactions:** Provide responsive visual feedback on interactive elements with hover, active (`scale-[0.98]`), and accessible `focus-visible` styling.
- **4 Mandatory Interface States:** Loading (contextual skeletons with CLS=0), Empty (educational explanation with actionable CTA), Error (human-readable message with clear retry trigger), and Protected/Restricted.
- **Accessibility (WCAG AA):** Full keyboard navigation (`Tab`, `Enter`, `Escape`), semantic HTML, and verified color contrast ratios on measured foreground/background color pairs.
<!-- OMNI-SPEC-END -->
