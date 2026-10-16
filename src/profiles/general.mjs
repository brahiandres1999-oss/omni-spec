export const generalProfile = {
  id: 'general',
  name: 'General SaaS / Cloud Application',
  description: 'Clean Architecture, multi-tenant isolation, RBAC, and standard security practices.',
  constitutionInvariants: `### 2.1 Security & Multi-Tenancy
* **Tenant Isolation:** Every query must enforce tenant/account boundary verification to eliminate IDOR vulnerabilities.
* **RBAC Enforcement:** Role-based permissions must be evaluated on the server side; hiding buttons in UI is insufficient authorization.
* **Log Sanitization:** Sensitive data (passwords, tokens, PII) must never appear in application logs or metrics.

### 2.2 Persistence & Database Integrity
* **Atomic Transactions:** Multi-table mutations must use database transactions with explicit rollback on error.
* **Reversible Migrations:** Every database schema change must include a tested down-migration (\`down.sql\`).
* **Concurrency:** Use unique constraints and optimistic concurrency controls to avoid race conditions.`,
  specSecurityQuestions: `| Security & Compliance Control | Required? | Technical Enforcement |
| :--- | :---: | :--- |
| **Does it touch sensitive personal data (PII)?** | \`YES / NO\` | If YES: Enforce encryption in transit (TLS) and rest (AES-256). |
| **Does it expose cross-tenant data?** | \`NO\` | Strictly forbidden. All queries must filter by authenticated tenant ID. |
| **Does it require audit logging?** | \`YES / NO\` | If YES: Log action, actor ID, UTC timestamp, and resource ID. |`
};
