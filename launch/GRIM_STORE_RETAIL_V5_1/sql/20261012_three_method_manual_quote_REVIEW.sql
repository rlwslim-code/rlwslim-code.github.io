-- REVIEW BEFORE INSTALLING. Creates a NEW quotation starter RPC; does NOT edit
-- existing customers/orders/attempts, charge a card, or debit any wallet.
-- Tested only with isolated JS mocks here: test with isolated PostgreSQL first.
BEGIN;

CREATE OR REPLACE FUNCTION public.grim2_start_manual_quote_v2(
    p_quote_id uuid,
    p_customer text,
    p_email text,
    p_reference text,
    p_method text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
    q public.grim2_hybrid_quote_requests%ROWTYPE;
    r public.grim2_attempts%ROWTYPE;
    v_key text;
    v_quote jsonb;
    v_subtotal bigint;
    v_fee bigint;
    v_total bigint;
    v_method text;
    v_channel text;
BEGIN
    IF NULLIF(BTRIM(p_customer),'') IS NULL
       OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       OR p_reference !~ '^GRIM2-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR p_method IS NULL OR p_method NOT IN ('card','bank_transfer','wallet')
    THEN
        RAISE EXCEPTION 'Invalid customer or payment method/reference';
    END IF;

    -- Prevent two different quotations creating competing attempts for one customer.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('grim2:' || p_customer,0)
    );

    SELECT * INTO q FROM public.grim2_hybrid_quote_requests
    WHERE id=p_quote_id FOR UPDATE;
    IF NOT FOUND OR q.customer_id IS DISTINCT FROM p_customer THEN
        RAISE EXCEPTION 'Quotation not found';
    END IF;

    -- If a payment was previously started, it must be recovered as-is.
    -- NEVER create a fresh attempt just to change method.
    IF q.checkout_reference IS NOT NULL THEN
        SELECT * INTO r FROM public.grim2_attempts
        WHERE reference=q.checkout_reference FOR UPDATE;
        IF NOT FOUND
           OR r.customer_id IS DISTINCT FROM p_customer
           OR r.quote->>'manualQuoteId' IS DISTINCT FROM p_quote_id::text
           OR r.method NOT IN ('card','wallet')
        THEN
            RAISE EXCEPTION 'Existing quotation payment needs reconciliation';
        END IF;
        RETURN to_jsonb(r);
    END IF;

    IF q.status <> 'QUOTE_READY' OR q.expires_at IS NULL OR q.expires_at <= NOW() THEN
        RAISE EXCEPTION 'Quotation not ready or expired';
    END IF;
    IF q.snapshot IS NULL
       OR (q.snapshot->>'currency') IS DISTINCT FROM 'NGN'
       OR pg_catalog.COALESCE(pg_catalog.jsonb_typeof(q.snapshot->'items'),'') <> 'array'
       OR CASE WHEN pg_catalog.jsonb_typeof(q.snapshot->'items') = 'array'
          THEN pg_catalog.jsonb_array_length(q.snapshot->'items') < 1
          ELSE TRUE END
       OR (q.snapshot->'destination'->>'country') IS DISTINCT FROM 'NG'
    THEN
        RAISE EXCEPTION 'Invalid quotation details';
    END IF;

    v_subtotal:=q.subtotal_kobo;
    v_fee:=q.fee_kobo;
    v_total:=q.total_kobo;
    IF v_subtotal IS NULL OR v_subtotal < 1
       OR v_fee IS NULL OR v_fee < 0
       OR v_total IS NULL OR v_total <> v_subtotal+v_fee
       OR v_total < 100
       OR (q.snapshot->>'subtotalKobo')::bigint IS DISTINCT FROM v_subtotal
    THEN
        RAISE EXCEPTION 'Quotation amount mismatch';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.grim2_attempts
      WHERE customer_id=p_customer AND status NOT IN ('paid','cancelled')
    ) THEN
        RAISE EXCEPTION 'Existing payment pending. Recover before retrying.';
    END IF;

    -- The existing grim2_attempts table only permits methods card/wallet;
    -- bank_transfer is a Paystack channel stored with the immutable quote.
    v_method:= CASE WHEN p_method='wallet' THEN 'wallet' ELSE 'card' END;
    v_channel:= CASE WHEN p_method='bank_transfer' THEN 'bank_transfer' ELSE 'card' END;
    v_key:='GRIMQUOTE_' || REPLACE(p_quote_id::text,'-','');
    v_quote:=pg_catalog.jsonb_build_object(
        'currency','NGN',
        'items',q.snapshot->'items',
        'subtotalKobo',v_subtotal,
        'shippingKobo',v_fee,
        'totalKobo',v_total,
        'manualQuoteId',p_quote_id::text,
        'deliveryMethod','manual_quoted',
        'shippingExpiresAt',(EXTRACT(EPOCH FROM q.expires_at)*1000)::bigint,
        'paystackChannel',CASE WHEN v_method='card' THEN v_channel ELSE NULL END
    );

    INSERT INTO public.grim2_attempts(
        reference,customer_id,email,checkout_key,method,quote,shipping,billing,contact
    ) VALUES (
        p_reference,p_customer,LOWER(p_email),v_key,v_method,v_quote,
        q.snapshot->'destination',q.snapshot->'destination',q.snapshot->'recipient'
    ) RETURNING * INTO r;

    UPDATE public.grim2_hybrid_quote_requests
       SET checkout_reference=r.reference,payment_started_at=NOW()
     WHERE id=p_quote_id AND checkout_reference IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Quotation already claimed'; END IF;

    RETURN to_jsonb(r);
END;
$function$;

-- Do not grant this elevated-privilege RPC to end users.
REVOKE ALL ON FUNCTION public.grim2_start_manual_quote_v2(uuid,text,text,text,text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grim2_start_manual_quote_v2(uuid,text,text,text,text)
    TO service_role;

COMMIT;
