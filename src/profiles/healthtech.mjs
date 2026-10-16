export const healthtechProfile = {
  id: 'healthtech',
  name: 'Healthtech, Clinical & Medical Data',
  description: 'HIPAA, GDPR Health Data, Protected Health Information (PHI) encryption, and strict consent management.',
  constitutionInvariants: `### 2.1 Protected Health Information (PHI) & HIPAA
* **Zero Plaintext PHI:** Medical records, diagnoses, clinical notes, and patient identifiers must be encrypted in transit (TLS 1.3) and at rest (AES-256-GCM).
* **Strict Consent Verification:** Access to patient health information requires explicit, active consent verification before query execution.
* **Access Logging:** Every read and write access to clinical data must record the clinician/actor ID, purpose of access, and UTC timestamp.
* **De-identification & Anonymization:** Data exported for research or analytics must satisfy Safe Harbor or Expert Determination de-identification methods.

### 2.2 Clinical Safety & High Availability
* **Fail-Safe Operation:** Critical medical alerts must have backup notification channels (SMS/Webhook) in case of WebSocket disconnection.`,
  specSecurityQuestions: `| Health Data & Privacy Control | Required? | Technical Enforcement |
| :--- | :---: | :--- |
| **Does it touch Protected Health Information (PHI)?** | \`YES / NO\` | If YES: AES-256 encryption, access logged in HIPAA audit trail. |
| **Does it require active patient consent?** | \`YES / NO\` | If YES: Verify active consent record before servicing query. |
| **Does it expose aggregated research data?** | \`YES / NO\` | If YES: Apply k-anonymity (k >= 5) and remove 18 HIPAA identifiers. |`
};
