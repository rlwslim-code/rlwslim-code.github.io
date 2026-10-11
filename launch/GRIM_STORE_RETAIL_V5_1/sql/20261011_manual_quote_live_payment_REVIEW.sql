-- GRIM quotation Paystack integration. REVIEW AND BACK UP LIVE DB BEFORE APPLYING.
-- No wallet actions, no automatic customer charges. Separate production flag is OFF by default.
-- Prerequisites: previous GRIM Checkout 2.0 LIVE migrations and quote table exist.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.grim2_attempts') IS NULL OR to_regclass('public.grim2_hybrid_quote_requests') IS NULL
    OR to_regprocedure('public.grim2_finish_card_live_verified(text,text,jsonb)') IS NULL
 THEN RAISE EXCEPTION 'Missing checkout schema or verified payment RPC. STOP.'; END IF;
END $$;
ALTER TABLE public.grim2_hybrid_quote_requests ADD COLUMN IF NOT EXISTS checkout_reference text;
ALTER TABLE public.grim2_hybrid_quote_requests ADD COLUMN IF NOT EXISTS payment_started_at timestamptz;
ALTER TABLE public.grim2_hybrid_quote_requests ADD COLUMN IF NOT EXISTS paid_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS grim2_hybrid_quote_checkout_reference_unique
 ON public.grim2_hybrid_quote_requests(checkout_reference) WHERE checkout_reference IS NOT NULL;

-- Atomic quote-to-checkout claim. All amounts and customer data come from stored quote.
-- This function is only callable via the server service role, NEVER from the browser.
CREATE OR REPLACE FUNCTION public.grim2_start_manual_quote(
 p_quote_id uuid,p_customer text,p_email text,p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.grim2_hybrid_quote_requests%rowtype;
        r public.grim2_attempts%rowtype;
        v_key text;
        v_quote jsonb;
        v_subtotal bigint;
        v_fee bigint;
        v_total bigint;
BEGIN
 IF nullif(p_customer,'') IS NULL OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 OR p_reference !~ '^GRIM2-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN RAISE EXCEPTION 'Invalid payment customer or reference'; END IF;
 -- Same customer lock used by ordinary Checkout 2.0 attempts.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('grim2:'||p_customer,0));
 SELECT * INTO q FROM public.grim2_hybrid_quote_requests WHERE id=p_quote_id FOR UPDATE;
 IF NOT FOUND OR q.customer_id IS DISTINCT FROM p_customer THEN RAISE EXCEPTION 'Quote not found'; END IF;
 IF q.checkout_reference IS NOT NULL THEN
   SELECT * INTO r FROM public.grim2_attempts WHERE reference=q.checkout_reference;
   IF NOT FOUND OR r.customer_id IS DISTINCT FROM p_customer OR r.method <> 'card'
     THEN RAISE EXCEPTION 'Linked payment requires merchant review'; END IF;
   RETURN to_jsonb(r);
 END IF;
 IF q.status <> 'QUOTE_READY' OR q.expires_at <= pg_catalog.now() THEN
   RAISE EXCEPTION 'Quotation not ready or expired'; END IF;
 IF q.snapshot->>'currency' <> 'NGN' OR q.snapshot->'items' IS NULL OR
    jsonb_typeof(q.snapshot->'items') <> 'array' OR jsonb_array_length(q.snapshot->'items') < 1 OR
    q.snapshot->'destination'->>'country' <> 'NG'
 THEN RAISE EXCEPTION 'Quotation snapshot invalid'; END IF;
 v_subtotal:=q.subtotal_kobo;v_fee:=q.fee_kobo;v_total:=q.total_kobo;
 IF v_subtotal IS NULL OR v_subtotal < 1 OR v_fee IS NULL OR v_fee < 0 OR
    v_total IS NULL OR v_total <> v_subtotal+v_fee OR v_total < 100
    OR (q.snapshot->>'subtotalKobo')::bigint <> v_subtotal
 THEN RAISE EXCEPTION 'Quotation amount mismatch'; END IF;
 -- No second pending card request while another payment for this customer is outstanding.
 IF EXISTS(SELECT 1 FROM public.grim2_attempts WHERE customer_id=p_customer
           AND status NOT IN ('paid','cancelled'))
 THEN RAISE EXCEPTION 'Existing checkout pending. Recover it before creating another.'; END IF;
 v_key:='GRIMQUOTE_'||replace(p_quote_id::text,'-','');
 v_quote:=jsonb_build_object('currency','NGN','items',q.snapshot->'items',
            'subtotalKobo',v_subtotal,'shippingKobo',v_fee,'totalKobo',v_total,
            'manualQuoteId',p_quote_id::text,'deliveryMethod','manual_quoted');
 INSERT INTO public.grim2_attempts(reference,customer_id,email,checkout_key,method,quote,shipping,billing,contact)
 VALUES(p_reference,p_customer,lower(p_email),v_key,'card',v_quote,
        q.snapshot->'destination',q.snapshot->'destination',q.snapshot->'recipient')
 RETURNING * INTO r;
 UPDATE public.grim2_hybrid_quote_requests SET checkout_reference=r.reference,
    payment_started_at=pg_catalog.now() WHERE id=p_quote_id AND checkout_reference IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Quotation was claimed concurrently'; END IF;
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.grim2_start_manual_quote(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.grim2_start_manual_quote(uuid,text,text,text) TO service_role;
COMMIT;
