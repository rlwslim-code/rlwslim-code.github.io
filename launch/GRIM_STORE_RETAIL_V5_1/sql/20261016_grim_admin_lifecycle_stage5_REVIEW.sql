-- STAGE 5: run ONLY after Stage 1 schema has been reviewed and installed.
-- Requires trusted backend service-role invocation. Does not alter checkout, wallet, or payment status.
BEGIN;
ALTER TABLE public.grim_order_status_events ADD COLUMN IF NOT EXISTS actor_note text;
CREATE OR REPLACE FUNCTION public.grim_admin_transition_order(p_order_id bigint,p_new_status text,p_reason text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old public.orders%ROWTYPE; v_new text := lower(btrim(coalesce(p_new_status,'')));
BEGIN
  -- Only server service-role; do not grant to authenticated/anon.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'not authorized' USING ERRCODE='42501'; END IF;
  IF v_new NOT IN ('processing','shipped','in_transit','out_for_delivery','delivered','under_review','cancelled') THEN RAISE EXCEPTION 'invalid order status'; END IF;
  IF v_new IN ('cancelled','under_review') AND length(btrim(coalesce(p_reason,''))) < 5 THEN RAISE EXCEPTION 'reason required'; END IF;
  SELECT * INTO v_old FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF lower(coalesce(v_old.status,'')) IN ('cancelled','delivered') AND v_new <> lower(coalesce(v_old.status,'')) THEN RAISE EXCEPTION 'terminal order status'; END IF;
  IF v_new IN ('processing','shipped','in_transit','out_for_delivery','delivered') AND lower(coalesce(v_old.payment_status,'')) <> 'paid' THEN RAISE EXCEPTION 'unpaid order cannot be fulfilled'; END IF;
  IF v_new = lower(coalesce(v_old.status,'')) THEN RETURN jsonb_build_object('id',p_order_id,'status',v_new,'unchanged',true); END IF;
  UPDATE public.orders SET status=v_new,updated_at=now() WHERE id=p_order_id;
  -- Stage 1 trigger records status change; record the admin reason separately, in the same transaction.
  UPDATE public.grim_order_status_events SET actor_type='admin',reason=nullif(left(btrim(p_reason),500),'')
  WHERE id=(SELECT id FROM public.grim_order_status_events WHERE order_id=p_order_id AND new_status=v_new ORDER BY id DESC LIMIT 1);
  RETURN jsonb_build_object('id',p_order_id,'status',v_new,'previous_status',v_old.status,'payment_status',v_old.payment_status);
END $$;
REVOKE ALL ON FUNCTION public.grim_admin_transition_order(bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.grim_admin_transition_order(bigint,text,text) TO service_role;
COMMIT;
