-- GRIM Checkout 2.0: wallet and bank-transfer quotation starter, review candidate.
-- DO NOT execute in production without staging tests and review.
-- Bank transfer settlement is NOT enabled by this migration; verified server callback is still required.
BEGIN;

-- Preserve all existing rows; allow a bank transfer method without rewriting historical attempts.
ALTER TABLE public.grim2_attempts DROP CONSTRAINT IF EXISTS grim2_attempts_method_check;
ALTER TABLE public.grim2_attempts ADD CONSTRAINT grim2_attempts_method_check CHECK (method IN ('card','wallet','bank_transfer'));


CREATE OR REPLACE FUNCTION public.grim2_start_manual_quote_v2(
  p_quote_id uuid, p_customer text, p_email text,
  p_reference text, p_method text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  q public.grim2_hybrid_quote_requests%ROWTYPE;
  r public.grim2_attempts%ROWTYPE;
  v_subtotal bigint;
  v_fee bigint;
  v_total bigint;
  v_quote jsonb;
BEGIN
  IF p_method NOT IN ('wallet','bank_transfer') THEN
    RAISE EXCEPTION 'Payment method not enabled in this migration';
  END IF;
  IF NULLIF(btrim(p_customer), '') IS NULL
    OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR p_reference !~ '^GRIM2-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION 'Invalid customer or payment reference';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('grim2:' || p_customer, 0)
  );
  SELECT * INTO q FROM public.grim2_hybrid_quote_requests
   WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND OR q.customer_id IS DISTINCT FROM p_customer THEN
    RAISE EXCEPTION 'Quotation not found';
  END IF;

  IF q.checkout_reference IS NOT NULL THEN
    SELECT * INTO r FROM public.grim2_attempts
      WHERE reference = q.checkout_reference;
    IF NOT FOUND OR r.customer_id IS DISTINCT FROM p_customer
      OR r.method <> p_method
      OR r.quote->>'manualQuoteId' IS DISTINCT FROM p_quote_id::text
    THEN
      RAISE EXCEPTION 'Payment requires reconciliation';
    END IF;
    RETURN to_jsonb(r);
  END IF;

  IF q.status <> 'QUOTE_READY' OR q.expires_at <= now() THEN
    RAISE EXCEPTION 'Quotation not ready or expired';
  END IF;
  IF q.snapshot->>'currency' <> 'NGN'
    OR jsonb_typeof(q.snapshot->'items') <> 'array'
    OR jsonb_array_length(q.snapshot->'items') < 1
    OR q.snapshot->'destination'->>'country' <> 'NG'
  THEN
    RAISE EXCEPTION 'Invalid quotation details';
  END IF;

  v_subtotal := q.subtotal_kobo;
  v_fee := q.fee_kobo;
  v_total := q.total_kobo;
  IF v_subtotal IS NULL OR v_subtotal < 1
    OR v_fee IS NULL OR v_fee < 0
    OR v_total IS NULL OR v_total <> v_subtotal + v_fee
    OR v_total < 100
    OR (q.snapshot->>'subtotalKobo')::bigint IS DISTINCT FROM v_subtotal
  THEN
    RAISE EXCEPTION 'Quotation amount mismatch';
  END IF;

  IF EXISTS (SELECT 1 FROM public.grim2_attempts
    WHERE customer_id = p_customer
      AND status NOT IN ('paid','cancelled')) THEN
    RAISE EXCEPTION 'Existing payment pending. Recover before retrying.';
  END IF;

  v_quote := jsonb_build_object(
    'currency','NGN',
    'items',q.snapshot->'items',
    'subtotalKobo',v_subtotal,
    'shippingKobo',v_fee,
    'totalKobo',v_total,
    'manualQuoteId',p_quote_id::text,
    'deliveryMethod','manual_quoted'
  );

  INSERT INTO public.grim2_attempts
    (reference,customer_id,email,checkout_key,method,
     quote,shipping,billing,contact)
  VALUES
    (p_reference,p_customer,lower(p_email),
     'GRIMQUOTE_' || replace(p_quote_id::text,'-',''),
     p_method,v_quote,q.snapshot->'destination',
     q.snapshot->'destination',q.snapshot->'recipient')
  RETURNING * INTO r;

  UPDATE public.grim2_hybrid_quote_requests
     SET checkout_reference=r.reference, payment_started_at=now()
   WHERE id=p_quote_id AND checkout_reference IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quotation already claimed'; END IF;
  RETURN to_jsonb(r);
END;
$fn$;

REVOKE ALL ON FUNCTION public.grim2_start_manual_quote_v2(uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grim2_start_manual_quote_v2(uuid,text,text,text,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grim2_start_manual_quote_v2(uuid,text,text,text,text) TO service_role;
COMMIT;
