# GRIM integrated checkout release candidate

Status: implementation integrated and locally tested; EXTERNAL VALIDATION BLOCKED. This is not approved for production launch.

Source baseline: `grim-payment-repair-test`, commit `a15bb157f40a4b15951ae98953ad773474c8eb73`. All V2, V3, V4, V5 and attached V6 packages were retrieved and inspected. V6 has the union of the earlier source paths; its later shipping changes were consolidated over the actual branch. The branch's fee verification fix is preserved and tightened. Full storefront source and assets are included, rather than disconnected patches.

## Included behavior

- Checkout 2.0 server startup, existing storefront checkout entry, existing authenticated customers mapped to authoritative customer rows, billing and profile address loading.
- Server-priced cart, authenticated Nigerian delivery address, validated Oye-Ekiti sender, Shipbubble pickup courier quotations and customer-facing rate-card prices. No booking or shipment-wallet spending endpoint is implemented.
- Signed quotes bind customer, full normalized delivery address including apartment/postal data, customer contact, priced items, sender/category and physical measurements. Ten-minute expiry; fresh rates are requested before payment. Changed rates, couriers, cart, measurements, recipient or token fail closed.
- Live card support is separately gated from isolated Preview test payments. Server verification matches domain, status, reference, currency and customer email. Fee pass-through requires the exact original requested amount and exact verified fee difference. An exact charged amount with a conflicting requested amount is rejected too.
- Order total and card processing fees remain separate. Verified charge information is stored with the attempt and receipt. Wallet spending includes delivery and adds no card fee.
- Existing production `grim_wallet_debit` is called within the same database transaction as ordinary order and receipt recording. Its returned ledger row must match customer, currency, amount, order, debit type, completed status, before/after balance delta and the dedicated `grim2-wallet:<reference>` key. Duplicate paid requests return the existing receipt. Any recording or linkage failure rolls the entire transaction back.
- Order insertion maps server-owned fields to the existing order column types and defaults, including customer/currency/minor-total fields when present. Unrecognized mandatory columns fail closed. Existing orders/admin table remains the fulfillment source.
- Recovery keeps uncertain card references; callbacks never establish payment alone. Signed webhooks trigger independent provider verification. Previously paid callbacks do not remove a newly filled cart again.
- Unpaid wallet attempts can be closed atomically and requoted. A cancelled key cannot debit. Changed wallet bag/address/contact details require closing the old attempt.
- Admin shipping measurements and per-reference courier/receipt lookup at `/grim-admin/shipping.html`; links added to both admin surfaces. Product measurements and exact multi-item parcel profiles are separate additive shipping configuration tables, not replacement product or wallet databases.
- Legacy wallet funding's arbitrary overpayment tolerance is replaced with the strict verification helper. The account dashboard now reads the existing production wallet ledger and balance columns instead of obsolete legacy columns.

## Remaining launch gates

1. Authenticated GitHub write access and the intended Vercel project/Preview environment are unavailable here. Public clone works; a write dry run fails authentication. The Preview deployment helper stops because `.vercel/project.json` is absent. No Preview link exists. Connect those services without pasting secrets into chat.
2. Authenticated Supabase schema access is unavailable. Production column types, constraints, triggers, policies and the actual wallet-function source/ACL/search-path behavior are not verified. The SQL files are reviewable proposals, NOT migrations that were applied to production. Local production-shaped fixtures do not establish the live schema or real wallet-function behavior.
3. Measure packed products and supported final parcels. Configure the validated Oye-Ekiti sender address code and actual provider category ID. The existing Shipbubble key is Production-only; configure an explicitly scoped quotation key in Preview. No measurements, address codes, category IDs or provider results have been fabricated.

## Evidence and limitations

Run `npm ci` with Node 22, then `npm run test:release`. Test logs and screenshots are in the outer archive's evidence directory. Unit/API/database tests use PGlite and synthetic provider responses. Browser tests exercise the actual storefront and Checkout 2.0 source through local HTTP with fixture services. Production-shaped wallet tests use an explicitly identified model of the described RPC, not the unavailable production implementation. PGlite uses a serialized local connection; parallel application requests test idempotency but do not prove multi-session production locking. Actual provider sandbox transactions, deployed Vercel sessions, real courier availability and live admin order visibility remain unverified. No customer data was read, no real payments/funding/debits were initiated, and no shipment was booked.

Read-only live HTTP checks: the storefront returned 200 and redirects to `www.grimwear.store`; `/api/checkout2/config` returned 404. This does not identify the current Vercel project or authenticate database access.

## Preview deployment procedure

- Link only `launch/GRIM_STORE_RETAIL_V5_1/` to the existing intended Vercel project. Preserve its project settings/root directory and existing hosting behavior. Do not make a new production site or promote a deployment.
- Configure `.env.preview.example` variable names exclusively for the branch Preview. Use Paystack `sk_test_...`, an isolated Supabase test project and separate session/signing secrets. Do not copy real customer data, balances or orders. Existing `SUPABASE_URL` must differ from the isolated URL. The server deliberately refuses inherited production database credentials on Preview.
- Apply `sql/002_checkout2_preview.sql` then `sql/004_checkout2_shipping_evidence.sql` ONLY to the isolated test project. Seed only synthetic test customers/products and wallet balances there. Production-shaped RPC tests should additionally run against an isolated database matching the inspected live schema/RPC, not production accounts.
- Enter genuine measured packaging data using the admin screen, validate the sender code through Shipbubble and verify category/account access. Quotations alone cannot purchase shipping.
- Run `npm run test:release`. Run `npm run deploy:preview`, which fixes the target to Preview and requires the dedicated development branch and linked project.
- On that actual URL, test new and restored account sessions, saved billing, current courier prices and unavailable routes; Paystack test success/failure/fee pass-through; wallet balance/insufficiency; repeated and concurrent submissions; expiry and changed carts; webhook delivery; payment recorded after an injected database failure; customer receipt and existing admin fulfillment visibility. Record real provider references and reconcile isolated test records.

## Production preparation and final approval

- Obtain a schema-only snapshot, constraints/indexes/triggers/RLS/ACLs and exact wallet function definitions through read-only administrative access using `sql/000_live_schema_preflight_READ_ONLY.sql`. Review original debit/credit idempotency behavior, account locking, transaction direction/amount conventions, uniqueness and function search paths. Confirm no public/anonymous/authenticated permission permits arbitrary service debits or credits. Repair any discovered live weakness only in the isolated clone first; any production alteration belongs to the final approved change set.
- Match `sql/003_checkout2_live_REVIEW.sql` and `004_checkout2_shipping_evidence.sql` to that actual snapshot. Do not apply Preview migration 002 to production. 003 creates no test wallets and calls the original debit function. Order-column compatibility is guarded; check historical payment-reference uniqueness once immediately before creating the unique index. Check unique-index creation lock time against table size. Review existing RLS/triggers without disabling them.
- Confirm backup/PITR, record current production deployment ID and environment scope, compare customer/product/order/wallet counts and financial aggregate checksums before/after additive migrations, and keep the original SESSION_SECRET stable. Apply no production change before approval.
- Verify all active shippable products and enabled bag combinations have genuine measured weights and final parcel dimensions. International delivery remains disabled; Nigerian states and FCT are accepted, while actual quotations determine courier coverage. There are no fabricated rates or free-shipping fallback.
- Preserve existing secrets. Add missing variable names from `.env.production.example` through Vercel's secret settings. Do not expose values in source, logs, browser code or chat. Keep all production switches false until the approved activation. Stop if public origin, schema, RPC, shipping or credentials differ from the reviewed configuration.
- Present the verified Preview, exact migration/environment change set, evidence and remaining risks for ONE final launch approval. Only after approval, apply the reviewed additive migrations 003 then 004, deploy the reviewed commit, and enable the production checkout/database/wallet and ACCEPT_NEW_ORDERS flags as appropriate. Existing card transactions continue to use verification/recovery; new legacy order/payment initialization and wallet checkout are blocked once the Checkout 2.0 flag is on.

## Rollback

- If the new checkout must stop accepting orders, set `GRIM_CHECKOUT2_ACCEPT_NEW_ORDERS=false` while retaining its verification/reconciliation endpoints and stored references. Do not simply turn off the entire new router during in-flight payments: existing Checkout 2.0 references still require recovery and webhook processing. Operationally place ordering in maintenance and keep the reviewed release running for reconciliation.
- Before restoring the prior deployment/launch flag, reconcile every outstanding GRIM2 reference, retain the new recovery endpoint or provide a reviewed reconciliation worker, and confirm the legacy fulfillment paths are safe. The prior deployment alone does not understand these new references.
- Revert source/config to the recorded prior deployment only after the above checks. Retain all additive attempts, receipts, measured shipping rows, paid orders, wallet transactions and unique indexes. Never drop payment evidence, reset balances, refund automatically, copy test data, or restore a whole-database snapshot over new legitimate orders.
- Any refund, wallet adjustment or shipment action requires its own explicit authorization and ledger reconciliation.

## Post-launch smoke checks

Verify canonical storefront/product images/search/bag, mobile and desktop checkout, fresh and restored customer/admin sessions, profile/billing data, genuine courier prices, receipt fee separation, exactly one ordinary fulfillment order per verified reference, original wallet balances and debit linkage, and provider webhook deliveries. A real live payment is a separate explicit approval; do not silently run one as a smoke test. Monitor redacted error categories, pending reconciliation age and provider/DB availability without logging secrets, card authorizations, full addresses or whole request bodies. Freeze website feature development after verified release; do not start GRIM Mobile until then.

## Provider references used

- https://paystack.com/docs/api/transaction/
- https://docs.shipbubble.com/api-reference/addresses/validate-address-global
- https://docs.shipbubble.com/api-reference/addresses/get-single-address-details
- https://docs.shipbubble.com/api-reference/rates/request-shipping-rates

Shipbubble documentation was available through indexed official content; direct documentation HTTP access returned 403 here. Provider request/response tests are contract fixtures, not observed account-level API results.
