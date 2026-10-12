-- READ ONLY. Run against LIVE GRIM Supabase *before* approving migration.
-- No row-level customer details or secrets are returned.
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('orders','customers','products','wallet_accounts','wallet_transactions','grim2_attempts','grim2_receipts','grim2_billing_addresses')

ORDER BY table_name, ordinal_position;

SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS function_args,
       pg_get_function_result(p.oid) AS returns_type
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('grim_wallet_debit','grim_wallet_credit')
ORDER BY function_name;

SELECT count(*) AS duplicated_payment_references
FROM (
  SELECT payment_reference
  FROM public.orders
  WHERE payment_reference IS NOT NULL
  GROUP BY payment_reference
  HAVING count(*)>1
) duplicates;

-- Exact wallet implementations, ACLs and security configuration; no customer rows.
SELECT p.proname, pg_get_functiondef(p.oid) AS implementation, p.prosecdef, p.proacl, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('grim_wallet_debit','grim_wallet_credit');
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('orders','customers','products','wallet_accounts','wallet_transactions');
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename IN ('orders','customers','products','wallet_accounts','wallet_transactions');
SELECT conrelid::regclass AS relation,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
WHERE conrelid IN ('public.orders'::regclass,'public.customers'::regclass,'public.wallet_accounts'::regclass,'public.wallet_transactions'::regclass);
SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'
AND tablename IN ('orders','wallet_accounts','wallet_transactions');
SELECT tgrelid::regclass AS relation,tgname,pg_get_triggerdef(oid) AS definition FROM pg_trigger
WHERE NOT tgisinternal AND tgrelid IN ('public.orders'::regclass,'public.customers'::regclass,'public.wallet_accounts'::regclass,'public.wallet_transactions'::regclass);
