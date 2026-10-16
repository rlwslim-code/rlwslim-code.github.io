-- STAGE 6: status emails; install AFTER Stage 1 and Stage 5 review.
-- Queues once per order + transition event. Does not send messages or modify payment functions.
BEGIN;
CREATE OR REPLACE FUNCTION public.grim_queue_status_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_template text;
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 v_template := CASE lower(coalesce(NEW.status,''))
 WHEN 'processing' THEN 'order_processing'
 WHEN 'shipped' THEN 'order_shipped'
 WHEN 'in_transit' THEN 'order_shipped'
 WHEN 'out_for_delivery' THEN 'out_for_delivery'
 WHEN 'delivered' THEN 'order_delivered'
 WHEN 'cancelled' THEN 'order_cancelled'
 ELSE NULL END;
 IF v_template IS NOT NULL AND nullif(btrim(coalesce(NEW.email,'')),'') IS NOT NULL THEN
   INSERT INTO public.grim_transactional_email_outbox(event_key,order_id,recipient_email,template_key)
   VALUES('status:'||NEW.id::text||':'||lower(NEW.status)||':'||txid_current()::text,NEW.id,lower(btrim(NEW.email)),v_template)
   ON CONFLICT(event_key) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS grim_queue_status_email_trg ON public.orders;
CREATE TRIGGER grim_queue_status_email_trg AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.grim_queue_status_email();
COMMIT;
