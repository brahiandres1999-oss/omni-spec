export const generalProfile = {
  id: 'general',
  name: 'General software project',
  description:
    'Evidence-based scope, access boundaries, data protection, state consistency and recovery where applicable.',
  constitutionInvariants:
    '### 2.1 Applicable security, data & state boundaries\n* Review what data, state and capabilities this project actually exposes. If authentication or authorization applies, enforce it at the trusted boundary and test unauthorized access.\n* If the project is multi-tenant, document and test tenant isolation; do not introduce tenancy into a single-user tool.\n* If the change mutates financial balances, inventory or non-idempotent external state, define and test retry safety (idempotency) and atomic consistency.\n* Avoid exposing secrets, tokens or sensitive personal data (PII) in logs, client payloads and error responses.\n### 2.2 Changes, contracts and recovery\n* If persistence exists, preserve its documented integrity constraints and concurrency behavior.\n* For migrations, choose and test a recovery strategy appropriate to the data and deployment; a down.sql file is not universally appropriate.\n* If no database, UI or remote service exists, record N/A rather than creating one to satisfy a template.',
  specSecurityQuestions:
    '| Security, Data & State Control | Required? | Technical Enforcement |\n| :--- | :---: | :--- |\n| **Does it touch sensitive personal data (PII) or secrets?** | [TODO] | Identify actual data and applicable protection/redaction requirements, or justify N/A. |\n| **Does it expose cross-tenant or unauthorized data?** | [TODO] | If auth or tenancy exists, document and test access boundaries; otherwise N/A. |\n| **Does it mutate critical state, balances, or external contracts?** | [TODO] | Define idempotency, concurrency/retry safety and audit logging where applicable, or justify N/A. |',
};
