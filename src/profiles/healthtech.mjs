export const healthtechProfile = {
  id: 'healthtech',
  name: 'Healthtech, Clinical & Medical Data',
  description: 'Review health-data scope, access, confidentiality, integrity and availability.',
  constitutionInvariants:
    '### 2.1 Health-data applicability\n* Establish jurisdiction, data categories, organizational roles and whether HIPAA or other requirements apply. Use current official guidance; do not infer applicability from the project label.\n* Document necessary administrative, physical and technical safeguards with responsible reviewers. This template does not certify them.\n* Choose encryption, authorization, access logging and retention based on applicable requirements and a documented risk assessment; do not invent a universal cipher or consent rule.\n* For research exports, establish an appropriate de-identification process. A fixed cohort size alone is not a claim of anonymity or compliance.\n### 2.2 Safety and availability\n* Identify whether failures can affect clinical safety; define and test appropriate recovery and escalation behavior with domain stakeholders.',
  specSecurityQuestions:
    '| Health Data & Privacy Control | Required? | Technical Enforcement |\n| :--- | :---: | :--- |\n| **Does it touch Protected Health Information (PHI)?** | [TODO] | Establish actual scope and applicable safeguards with sources. |\n| **What authorization or consent basis applies?** | [TODO] | Record confirmed requirements, exceptions and verification. |\n| **Does it expose research or aggregate data?** | [TODO] | Review disclosure risk and required de-identification; do not assume k=5 is sufficient. |',
};
