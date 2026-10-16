export const ecommerceProfile = {
  id: 'ecommerce',
  name: 'E-Commerce, Marketplaces & Retail',
  description: 'Inventory reservations, checkout idempotency, catalog caching, and cart consistency.',
  constitutionInvariants: `### 2.1 Inventory Consistency & Checkout Safety
* **Inventory Reservation:** Stock must be reserved atomically within database transactions before initiating third-party payment requests.
* **Checkout Idempotency:** The checkout endpoint must require a unique client order token to prevent duplicate charges upon network timeouts.
* **Cart Isolation:** Guest and authenticated cart merges must preserve line-item integrity without race conditions.

### 2.2 Performance & Caching
* **Catalog Caching:** High-traffic product catalog queries must utilize edge caching with explicit cache-invalidation webhooks upon inventory updates.`,
  specSecurityQuestions: `| E-Commerce Control | Required? | Technical Enforcement |
| :--- | :---: | :--- |
| **Does it mutate product inventory?** | \`YES / NO\` | If YES: Atomic reservation with rollback on payment expiration. |
| **Does it handle customer checkout / billing?** | \`YES / NO\` | If YES: Enforce \`Idempotency-Key\` and server-side price recalculation. |`
};
