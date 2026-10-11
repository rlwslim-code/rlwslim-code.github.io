# GRIM Hybrid Delivery Batch 3 — Manual Quote Requests (inactive by default)

Adds server-side quote-request storage using **existing product catalog prices**, immutable cart/address/recipient snapshot, 7-day quote request expiration, admin-only fee finalization, and a customer-scoped read endpoint. A conditional update prevents double finalization. There is **no payment link**, no wallet charge, no Paystack call, no SMS/email transmission and no change to the existing checkout UI. This is a staged integration, not production-ready.

Routes (behind existing authenticated middleware):
- POST `/api/checkout2/shipping/hybrid/request` customer creates an unpaid request
- GET `/api/checkout2/shipping/hybrid/requests` customer sees their own requests
- GET `/api/admin/checkout2/shipping/hybrid/requests` admin reviews requests
- POST `/api/admin/checkout2/shipping/hybrid/requests/:id/quote` admin finalizes fee in `feeKobo`

To test later in an isolated environment: back up DB; apply `migrations/20261011_hybrid_quote_requests.sql` in test Supabase; configure `GRIM_HYBRID_QUOTE_REQUESTS_ENABLED=true` **only in Preview** after review. Validate authenticated roles, CSRF origin, expiration, simultaneous updates, cleanup and database/RLS. In production leave feature flag unset or false. Follow-on batch must build secure payment-request creation, Paystack verification/idempotency, customer approval, emails/SMS via configured provider, and admin/customer UI before any launch. IMPORTANT: existing `/api/checkout2` routes are disabled if Checkout2 engine isn't configured.

GRIM visual identity: retain existing locked logos and seven brand colors. Existing branded email/SMS templates remain unchanged.
