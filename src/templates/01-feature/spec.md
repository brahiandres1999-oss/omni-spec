# [SPEC-XXX] Short Title

Date: YYYY-MM-DD

## 0. Clarification and Assumptions
[TODO] Record confirmed decisions, evidence and material questions. Do not invent answers.

## 1. Need and scope
[TODO] Who needs what outcome and why? Define the smallest useful change.

## 2. Acceptance Criteria and Non-Goals
[TODO] State Acceptance Criteria using formal EARS syntax (Easy Approach to Requirements Syntax) with stable IDs and kinds (functional, visual, interaction, accessibility).
- Ubiquitous: `<system> SHALL <action>` (e.g. `AC-01 [functional]: The system SHALL validate input tokens on load`)
- Event-driven: `WHEN <trigger>, <system> SHALL <action>` (e.g. `AC-02 [functional]: WHEN an invalid token is provided, the CLI SHALL exit with status 1`)
- State-driven: `WHILE <state>, <system> SHALL <action>` (e.g. `AC-03 [interaction]: WHILE data is loading, the UI SHALL display contextual skeleton placeholders`)
- Unwanted condition: `IF <error/condition>, THEN <system> SHALL <action>` (e.g. `AC-04 [functional]: IF the network connection drops, THEN the client SHALL display a retry mechanism`)
State Non-Goals explicitly to prevent scope creep.

## 3. Domain applicability
Review relevant controls only; justify N/A. Domain profiles are not compliance certification.

| Security Control | Applies? | Evidence / decision |
| --- | --- | --- |
| **Does it access or process sensitive data?** | [TODO] | If yes: specify protection in transit/at rest and least-privilege access. |

## 4. Experience and limits
[TODO] With a user interface, review Loading, Empty, Error, Partial/Overflow and Ideal for each affected surface (guide design) and record the states that apply, with N/A and a reason for the rest. Without a user interface: N/A with reason.

## 5. Traceability
[TODO] Link acceptance criteria to plan sections, task IDs and intended verification. Refine this mapping during planning.
