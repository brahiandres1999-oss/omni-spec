export const fintechProfile = {
  id: 'fintech',
  name: 'Fintech, Banking & Payments',
  description: 'PCI-DSS, double-entry ledger invariance, strict financial idempotency, and audit trails.',
  constitutionInvariants: `### 2.1 Financial Invariants & PCI-DSS
* **Idempotency Keys:** Every mutation involving balances, payments, or ledger movements must require a client-generated \`Idempotency-Key\` header.
* **Double-Entry Ledger:** Money can never be created or destroyed. Debits must equal credits in all balance mutations.
* **Zero Raw Card Data:** Raw PAN / CVV data must never touch application databases or logs (PCI-DSS Level 1 compliance).
* **Audit Trail Immutability:** Financial events must be written to append-only tables; updates and deletes to audit logs are strictly forbidden.

### 2.2 Concurrency & Race Conditions
* **Row-Level Locking:** Balance updates must utilize pessimistic locks (\`SELECT ... FOR UPDATE\`) or serializable isolation to prevent double-spending.
* **Reversible Migrations:** DDL changes must be tested against rollback scripts (\`down.sql\`) without data loss.`,
  specSecurityQuestions: `| Financial & Security Control | Required? | Technical Enforcement |
| :--- | :---: | :--- |
| **Does it touch balances, money, or ledger?** | \`YES / NO\` | If YES: Double-entry ledger transaction with \`Idempotency-Key\`. |
| **Does it handle cardholder data?** | \`NO\` | Strictly forbidden. Delegate to certified payment gateway tokenization. |
| **Does it emit immutable audit logs?** | \`YES\` | Append-only event in \`financial_audit_logs\` with actor and hash integrity. |`
};
