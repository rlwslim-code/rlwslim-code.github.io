# GRIM Checkout 2.0 — Preview implementation

Source: `rlwslim-code/rlwslim-code.github.io`, branch `grim-payment-repair-test`, baseline `17a7e5e714dbab9e543153827909da7029f22e76`.

This continues the recovered Independent Integration Build, Connected Preview, and UI Review packages. The current server was patched in place; the older integration/server.js was not substituted for it.

## Implemented

- Responsive replacement checkout at `/checkout2.html`. The existing cart passes product IDs, quantities and sizes; the server reads prices from the authoritative test Supabase catalog.
- Existing authenticated customer sessions, including return to payment recovery after password sign-in and the existing two-factor flow.
- Paystack hosted card entry with a dedicated `sk_test_` secret. Only the `card` channel is initialized. Secrets, raw card numbers, CVV and authorization tokens are never sent to the browser or stored by this checkout.
- Server verification checks test domain, reference, email, NGN currency, exact integer kobo amount and provider transaction ID before an order is recorded. Signed webhooks use the original request bytes and repeat server verification.
- Durable pending attempts and checkout keys. SQL claims prevent repeat initialization; row locks and unique transaction IDs prevent duplicate orders. An outstanding attempt is returned even if a different key is submitted.
- The reviewed total must match the fresh server quote before a payment is initialized or a wallet is debited. Price changes return a reviewable updated quote. Recovery keys survive browser restarts.
- Atomic test-wallet debit, receipt and ledger recording, including rollback for insufficient funds and idempotent retries.
- Saved billing addresses scoped to the authenticated customer. Existing saved preferences are read from the isolated test account without overwriting them. Address saving is opt-in.
- Recovery after interrupted redirects, browser refreshes, lost local references and temporary order-recording failures. A paid attempt can be recovered without another provider call.
- Preview rejects the legacy payment/funding routes, uses dedicated test database variables, and refuses to use inherited production Supabase credentials.
- Vercel function entry, static output configuration and a deployment helper whose target is fixed to Preview.

## Preservation and isolation

No production branch, production deployment, external customer record or wallet balance was changed. Only the working checkout branch was edited locally. Existing logo assets, customer-service code, product editing, site controls, login implementations and existing payment modules remain intact. The storefront pages receive one Preview-aware checkout bridge.

Apply only `sql/002_checkout2_preview.sql` to an isolated Supabase project. It creates `grim2_attempts`, `grim2_receipts`, `grim2_wallet_accounts`, `grim2_wallet_ledger` and `grim2_billing_addresses`; it does not alter or migrate existing customer/order/wallet tables. `001_checkout2.sql` is retained from the earlier package for provenance, not required for this build.

The Preview intentionally uses **test wallet balances and isolated order receipts**. It does not spend existing production balances or place test orders into production fulfilment. Existing admin order lists do not display `grim2_receipts`; checking this Preview's receipts currently uses the isolated database. Production wallet migration and order/admin reconciliation are separate work requiring approval before a production rollout.

## Tests

Use Node 22, matching the repository engine:

```sh
npm ci
npm run check
npm test
npm run test:browser
```

The suite covers security/configuration, server-side totals, database migrations and privileges, retry handling, wallet rollback, payment recovery, ownership and origin restrictions, signed webhooks, and full existing-server smoke tests. The SQL migration executes against in-memory PostgreSQL through PGlite. This is real SQL execution but not a multi-connection Supabase load test. Paystack and sign-in responses are simulated in integration/browser tests; these tests do not establish an actual provider payment or external Supabase write.

The browser suite uses bundled Chromium to avoid a browser download requirement. It checks a 390px mobile viewport and a desktop viewport, saved addresses, wallet completion, card recovery, post-sign-in callback recovery, and safe text rendering.

Latest local verification: **71 automated tests passed, 0 failures, 0 skipped; 12 browser checks passed, 0 page errors.** All application JavaScript passed syntax checks, and `git diff --check` passed. These results are from the test fixtures, not the actual Paystack/Supabase services.

## Preview deployment

1. Supply authenticated repository write access and Vercel project access. Keep this branch separate from `main` and the production branch.
2. Link this directory to the intended Vercel project. Use `launch/GRIM_STORE_RETAIL_V5_1/` as the deployment source. Do not change shared production project/root settings to make Preview work.
3. Configure `.env.preview.example` variables for Preview only, preferably scoped to `grim-payment-repair-test`. Use a separate Supabase test project containing the GRIM base schema and test-only customers/products. Apply `002_checkout2_preview.sql` there. Test balances can be seeded directly into `grim2_wallet_accounts` by the test-project administrator.
4. Configure the Paystack **test** webhook to the deployment URL's `/api/checkout2/webhook` endpoint. Authenticated Preview protection must allow that webhook via the provider's supported protection exception. Do not disable production deployment protection.
5. Run `npm run deploy:preview`. The helper checks the branch, project link and tests, then runs a fixed Preview-target deployment. Never run `--prod` or promote the Preview.
6. On the deployed Preview, validate one actual Paystack test-card checkout, webhook, recovery and test-wallet purchase. Confirm the expected isolated receipts and ledger entries. No live payment is authorized.

## Remaining blockers

- No authenticated GitHub write credential is available in the current workspace. Public clone/read access worked; a dry-run push returned `could not read Username`.
- The Vercel dashboard currently opens at sign-in. No authenticated CLI deployment credential or linked Vercel project is available.
- Dedicated Paystack test credentials, isolated Supabase credentials/base schema/test fixtures, and test webhook configuration are not available. The migration has not been applied to any external database.
- Vercel build/routing and real Paystack test payments/webhooks remain unverified until Preview deployment access/configuration is available.
- Uncertain initialization and unresolved provider attempts remain deliberately locked to their reference. They require recovery or operator reconciliation; there is no automatic unsafe reset that could permit a second payment.
- This test build does not charge previously saved production cards. Card entry uses Paystack's hosted test checkout; existing saved-card data is preserved.

Official references used during implementation: [Paystack verification](https://paystack.com/docs/payments/verify-payments/), [Paystack webhooks](https://paystack.com/docs/payments/webhooks/), [Supabase database functions](https://supabase.com/docs/guides/database/functions), [Vercel Express](https://vercel.com/docs/frameworks/backend/express), [PGlite](https://pglite.dev/docs/).
