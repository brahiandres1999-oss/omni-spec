export const bpoProfile = {
  id: 'bpo',
  name: 'BPO, Contact Centers & Occupational Health (SST)',
  description: 'k-anonymity (k >= 5) for supervisory analytics, private operator journal isolation, and workplace wellbeing.',
  constitutionInvariants: `### 2.1 Occupational Wellbeing & Privacy (Ley 1581 / Res. 2646 & 2764)
* **Operator Journal Isolation:** Private notes, emotional reflections, and personal journals are strictly confidential under Ley 1581 de 2012 (accessible exclusively by the author).
* **k-Anonymity (k >= 5):** Aggregated metrics, trend reports, and team views for Supervisors or SST require cohorts of at least 5 distinct individuals (\`COUNT(DISTINCT user_id) >= 5\`).
* **Server-Side Suppression:** If a cohort is smaller than 5 participants, the backend must suppress the nominal payload and return a protected status (\`"protected": true\`).
* **Non-Punitive Wellbeing:** Wellbeing, stress indicators, and check-ins must never be used for disciplinary action, surveillance, or ranking agents by emotional state.

### 2.2 Persistence & Clean Architecture
* **Zero Dual Persistence:** Modules backed by PostgreSQL must not maintain parallel mutations in client-side mock storage.`,
  specSecurityQuestions: `| BPO & Occupational Health Control | Required? | Technical Enforcement |
| :--- | :---: | :--- |
| **Does it access operator private journals?** | \`YES / NO\` | If YES: Restricted strictly to author ID. Reject supervisor/admin. |
| **Does it show aggregated team metrics?** | \`YES / NO\` | If YES: Enforce \`HAVING COUNT(DISTINCT user_id) >= 5\` in SQL. |
| **Does it generate stress or mood rankings?** | \`NO\` | Strictly forbidden. Ranking workers by mental state is prohibited. |`
};
