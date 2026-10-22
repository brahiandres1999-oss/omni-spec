export const ecommerceProfile = {
  id: 'ecommerce',
  name: 'E-Commerce, Marketplaces & Retail',
  description: 'Review checkout, retries, pricing and stock consistency where applicable.',
  constitutionInvariants:
    '### 2.1 Commerce behavior\n* If inventory is managed, specify overselling policy, reservation/release behavior and failure recovery suitable for the existing system.\n* If checkout can be retried, define and test duplicate-order/charge prevention using the actual provider contract.\n* Validate pricing and authorization at the trusted boundary when clients can submit orders.\n### 2.2 Performance and compatibility\n* Introduce caching only when justified by requirements or measurements; define staleness tolerance and invalidation if caching is used.\n* Preserve existing guest/account behavior where relevant. Do not add accounts, carts or inventory to unrelated features.',
  specSecurityQuestions:
    '| E-Commerce Control | Required? | Technical Enforcement |\n| :--- | :---: | :--- |\n| **Does it mutate product inventory?** | [TODO] | Define consistency, reservation expiration and recovery, or N/A. |\n| **Does it handle checkout or billing?** | [TODO] | Define trusted pricing and retry/idempotency contracts with verification. |',
};
