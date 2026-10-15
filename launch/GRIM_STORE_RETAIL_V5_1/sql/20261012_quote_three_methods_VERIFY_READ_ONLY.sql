-- GRIM Checkout 2.0 approved quotation payment verification.
-- READ ONLY. Run only after reviewing and installing the separate migration.
SELECT
  p.proname,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') AS anon_can_execute,
  pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') AS user_can_execute,
  pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') AS server_can_execute
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='grim2_start_manual_quote_v2';

-- Substitute the approved quote ID; this example is the previously shared
-- controlled test quotation. It may already have a CARD payment attempt.
SELECT
  q.id, q.status AS quotation_status, q.expires_at,
  q.checkout_reference,
  a.status AS payment_status, a.method AS database_method,
  a.quote->>'paystackChannel' AS paystack_channel,
  a.quote->>'shippingExpiresAt' AS expiry_timestamp_ms,
  a.order_id,
  o.payment_status AS order_payment_status,
  r.reference IS NOT NULL AS receipt_exists,
  r.method AS receipt_method,
  (a.quote->>'totalKobo')::numeric/100 AS amount_ngn
FROM public.grim2_hybrid_quote_requests q
LEFT JOIN public.grim2_attempts a ON a.reference=q.checkout_reference
LEFT JOIN public.orders o ON o.payment_reference=a.reference
LEFT JOIN public.grim2_receipts r ON r.reference=a.reference
WHERE q.id='d591c149-8257-438f-9e40-c23658e0fa0c'::uuid;

-- Read-only duplicate checks; all should return zero rows.
SELECT payment_reference,COUNT(*) FROM public.orders
WHERE payment_reference IS NOT NULL GROUP BY payment_reference HAVING COUNT(*)>1;
SELECT idempotency_key,COUNT(*) FROM public.wallet_transactions
WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING COUNT(*)>1;
