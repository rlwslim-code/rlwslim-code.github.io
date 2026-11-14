# GRIM hybrid delivery — main source integration, safe staging build

Based on uploaded `GRIM_STORE_RETAIL_V5_1.zip` (user specified main). This is the ENTIRE website tree with incremental source additions, not a reconstruction. No changes pushed or deployed.

Included: server-side rule selection with unmeasured-product fallback; admin-authenticated rate listing/creation endpoints; prepared customer estimate route, brand email/SMS templates; standalone migration; test cases. Existing courier, wallet, payment and checkout behavior remain unchanged.

## SAFETY / NOT YET FINISHED
- **Rate entries default DISABLED**.
- Customer route requires `config.hybridDeliveryEnabled` and `config.hybridSupabase`, neither is set by existing runtime. It cannot activate inadvertently. These are deliberately not wired until order reservation, server authorization, quote signing and payment binding are implemented.
- No order-quote storage, confirmation links, email/SMS send, customer order tracking, frontend/admin visual screens or automatic payments yet.
- Migration has not been run; do not deploy the new rate endpoints until schema installed and checked.
- Before rollout, must reconcile against production checkout/order schema, implement manual quote workflow and secure payment links, check shipping-to-payment amount reconciliation, inspect frontend, build opt-in notifications, run end-to-end tests. Do not flip live flags.
- Pricing in kobo (100 kobo = ₦1). No sample rates installed, no guessed delivery costs.
- Emails HTML colored; SMS plain text because carrier SMS does not support color.

Tests: `npm test` from a Node.js environment with dependencies installed. `node --test tests/checkout2/hybrid-delivery.test.cjs` checks new pure functions.
