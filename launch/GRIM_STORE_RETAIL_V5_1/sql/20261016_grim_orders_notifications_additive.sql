-- GRIM additive order lifecycle and transactional email outbox.
-- Does NOT replace checkout functions, alter wallet balances, or send emails.
BEGIN;
CREATE TABLE IF NOT EXISTS public.grim_order_status_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  old_status text,
  new_status text NOT NULL,
  payment_status text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL DEFAULT 'system',
  reason text,
  CONSTRAINT grim_order_status_actor_check CHECK (actor_type IN ('system','admin','customer'))
);
CREATE INDEX IF NOT EXISTS grim_order_status_events_order_idx
  ON public.grim_order_status_events(order_id,occurred_at DESC);
CREATE TABLE IF NOT EXISTS public.grim_transactional_email_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_key text NOT NULL UNIQUE,
  order_id bigint NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  recipient_email text NOT NULL,
  template_key text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','sending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grim_email_outbox_pending_idx
  ON public.grim_transactional_email_outbox(state,queued_at);
-- Backend-only tables. Service-role access required; never expose to anon/authenticated roles.
ALTER TABLE public.grim_order_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grim_transactional_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.grim_order_status_events FROM anon, authenticated;
REVOKE ALL ON public.grim_transactional_email_outbox FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.grim_order_status_events_id_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.grim_transactional_email_outbox_id_seq FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.grim_capture_order_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_email text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    INSERT INTO public.grim_order_status_events(order_id,old_status,new_status,payment_status)
    VALUES(NEW.id,CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status END,
           COALESCE(NEW.status,'unknown'),NEW.payment_status);
  END IF;
  -- Queue once when a recorded order becomes paid; never queue on payment initiation.
  IF lower(COALESCE(NEW.payment_status,'')) = 'paid'
     AND (TG_OP='INSERT' OR lower(COALESCE(OLD.payment_status,'')) <> 'paid') THEN
    v_email := lower(btrim(COALESCE(NEW.email,'')));
    IF v_email <> '' AND position('@' in v_email)>1 THEN
      INSERT INTO public.grim_transactional_email_outbox(event_key,order_id,recipient_email,template_key)
      VALUES('paid:' || NEW.id::text,NEW.id,v_email,'order_confirmed')
      ON CONFLICT(event_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS grim_capture_order_lifecycle_trg ON public.orders;
CREATE TRIGGER grim_capture_order_lifecycle_trg
AFTER INSERT OR UPDATE OF status,payment_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.grim_capture_order_lifecycle();
COMMIT;
