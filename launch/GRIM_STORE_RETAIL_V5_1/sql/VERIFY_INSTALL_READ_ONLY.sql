-- READ-ONLY POST-MIGRATION CHECK. Do not run this until all 3 reviewed migrations succeeded.
select to_regclass('public.grim2_attempts') as attempts,
       to_regclass('public.grim2_receipts') as receipts,
       to_regprocedure('public.grim2_start_manual_quote(uuid,text,text,text)') as quote_claim,
       to_regprocedure('public.grim2_finish_card_live_verified(text,text,jsonb)') as verified_payment;
select indexname,indexdef from pg_indexes
where schemaname='public' and tablename in ('orders','grim2_hybrid_quote_requests','grim2_attempts')
order by tablename,indexname;
select relname,relrowsecurity from pg_class where oid in (
 'public.grim2_attempts'::regclass,
 'public.grim2_receipts'::regclass,
 'public.grim2_billing_addresses'::regclass
);
