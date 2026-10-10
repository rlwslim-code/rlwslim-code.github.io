-- GRIM CHECKOUT 2.0 LIVE MIGRATION — REVIEW BEFORE APPLYING TO PRODUCTION.
-- Non-destructive: creates checkout tables/functions + unique order reference index.
-- DOES NOT credit/debit a wallet or copy test balances during migration.
-- Requires verified orders, customers, wallet_accounts and grim_wallet_debit schemas.
-- Take a DB backup and inspect the existing wallet RPC before running.
begin;
-- FAIL-CLOSED prerequisites. Do not run unless production schema is backed up.
DO $$ begin
 if pg_catalog.to_regclass('public.orders') is null or
    pg_catalog.to_regclass('public.customers') is null or
    pg_catalog.to_regclass('public.wallet_accounts') is null then
   raise exception 'Missing live GRIM tables. STOP; do not deploy.';
 end if;
 if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n
   on n.oid=p.pronamespace where n.nspname='public' and p.proname='grim_wallet_debit')
 then raise exception 'Original wallet debit function missing; STOP.';end if;
 if exists(select 1 from public.orders where payment_reference is not null
   group by payment_reference having count(*) > 1) then
   raise exception 'Duplicate existing order payment references. STOP and reconcile first.';
 end if;
end $$;
-- The existing admin order table is preserved. Ensures no duplicate charge
-- reference can generate two separate fulfillment orders.
create unique index if not exists grim2_orders_payment_ref_unique
  on public.orders(payment_reference) where payment_reference is not null;

create table if not exists public.grim2_attempts (
 reference text primary key, customer_id text not null, email text not null,
 checkout_key text not null, method text not null check(method in ('card','wallet')),
 quote jsonb not null, shipping jsonb not null, billing jsonb not null, contact jsonb not null,
 status text not null default 'created' check(status in ('created','initializing','pending','initialization_unknown','reconciliation_required','paid','cancelled')),
 authorization_url text, provider_id text unique, order_id text,
 created_at timestamptz not null default now(), paid_at timestamptz,
 unique(customer_id,checkout_key)
);
create table if not exists public.grim2_receipts (
 reference text primary key references public.grim2_attempts(reference), customer_id text not null,
 email text not null, quote jsonb not null, shipping jsonb not null, billing jsonb not null,
 contact jsonb not null, method text not null, provider_id text unique,
 total_kobo bigint not null check(total_kobo>0), created_at timestamptz not null default now()
);
create table if not exists public.grim2_billing_addresses (
 customer_id text not null, address jsonb not null, created_at timestamptz not null default now(),
 primary key(customer_id,address)
);
create or replace function public.grim2_health() returns boolean language sql security definer set search_path='' as $$ select true; $$;
create or replace function public.grim2_health_live()
returns boolean language sql security definer set search_path='' as $$
 select pg_catalog.to_regclass('public.orders') is not null
    and pg_catalog.to_regclass('public.grim2_attempts') is not null
    and pg_catalog.to_regclass('public.grim2_receipts') is not null
    and pg_catalog.to_regprocedure('public.grim2_finish_card_live(text,text)') is not null
    and pg_catalog.to_regprocedure('public.grim2_finish_wallet_live(text)') is not null;
$$;
create or replace function public.grim2_read(p_reference text) returns jsonb language sql security definer set search_path='' as $$ select to_jsonb(r) from public.grim2_attempts r where reference=p_reference; $$;
create or replace function public.grim2_by_key(p_customer text,p_key text) returns jsonb language sql security definer set search_path='' as $$ select to_jsonb(r) from public.grim2_attempts r where customer_id=p_customer and checkout_key=p_key; $$;
create or replace function public.grim2_pending(p_customer text) returns jsonb language sql security definer set search_path='' as $$ select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]'::jsonb) from public.grim2_attempts r where customer_id=p_customer and status not in ('paid','cancelled'); $$;
create or replace function public.grim2_start(p_reference text,p_customer text,p_email text,p_key text,p_method text,p_quote jsonb,p_shipping jsonb,p_billing jsonb,p_contact jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.grim2_attempts%rowtype;
begin
 -- Serialize different keys for the same customer, as well as concurrent retries.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('grim2:'||p_customer,0));
 select * into r from public.grim2_attempts where customer_id=p_customer and checkout_key=p_key;
 if found then return to_jsonb(r); end if;
 -- Return the outstanding attempt instead of permitting a second payment.
 select * into r from public.grim2_attempts where customer_id=p_customer and status not in ('paid','cancelled') order by created_at limit 1;
 if found then return to_jsonb(r); end if;
 if p_reference !~ '^GRIM2-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 or p_key !~ '^[A-Za-z0-9_-]{16,80}$' or length(p_customer)=0 or length(p_email)=0
 or p_quote->>'currency'<>'NGN' or coalesce((p_quote->>'totalKobo')::bigint,0)<1
 then raise exception 'Invalid checkout'; end if;
 insert into public.grim2_attempts(reference,customer_id,email,checkout_key,method,quote,shipping,billing,contact)
 values(p_reference,p_customer,lower(p_email),p_key,p_method,p_quote,p_shipping,p_billing,p_contact) returning * into r;
 return to_jsonb(r);
end; $$;
create or replace function public.grim2_claim(p_reference text) returns boolean language plpgsql security definer set search_path='' as $$
begin update public.grim2_attempts set status='initializing' where reference=p_reference and method='card' and status='created';return found;end; $$;
create or replace function public.grim2_initialized(p_reference text,p_url text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_url !~ '^https://checkout\.paystack\.com/' then raise exception 'Invalid payment URL'; end if;
 update public.grim2_attempts set status='pending',authorization_url=p_url where reference=p_reference and status='initializing';return found;
end; $$;
create or replace function public.grim2_flag(p_reference text,p_status text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('initialization_unknown','reconciliation_required') then raise exception 'Invalid state'; end if;
 update public.grim2_attempts set status=p_status where reference=p_reference and status<>'paid';return found;
end; $$;
-- Map authoritative fields to existing order column types; retain defaults on every omitted column.
-- Additional mandatory columns cause an exception and rollback rather than invented data.
create or replace function public.grim2_insert_order(p_reference text,p_paid boolean)
returns text language plpgsql security definer set search_path='' as $$
declare r public.grim2_attempts%rowtype; payload jsonb; cols text; v_id text;
begin
 select * into r from public.grim2_attempts where reference=p_reference for update;
 if not found then raise exception 'Unknown checkout'; end if;
 payload:=jsonb_build_object(
  'name',trim(coalesce(r.contact->>'firstName','')||' '||coalesce(r.contact->>'lastName','')),
  'email',r.email,'phone',r.contact->>'phone',
  'address',concat_ws(', ',r.shipping->>'address',nullif(r.shipping->>'apartment',''),r.shipping->>'city',r.shipping->>'state',r.shipping->>'postal',r.shipping->>'country'),
  'items_json',(select jsonb_agg(jsonb_build_object('id',e->>'productId','name',e->>'name','color',e->>'color','size',e->>'size','price',(e->>'unitKobo')::bigint/100.0,'qty',(e->>'quantity')::int))::text from jsonb_array_elements(r.quote->'items') e),
  'total',(r.quote->>'totalKobo')::bigint/100.0,'status',case when p_paid then 'new' else 'payment_pending' end,
  'payment_status',case when p_paid then 'paid' else 'pending' end,'payment_reference',r.reference,
  'customer_id',r.customer_id,'currency','NGN','total_minor',(r.quote->>'totalKobo')::bigint,
  'shipping_address',r.shipping,'billing_address',r.billing,
  'checkout2_metadata',jsonb_build_object('reference',r.reference,'quote',r.quote,'method',r.method)
 );
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='items_json' and data_type in ('json','jsonb')) then
  payload:=jsonb_set(payload,'{items_json}',(payload->>'items_json')::jsonb);
 end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='orders'
   and is_nullable='NO' and column_default is null and is_identity='NO' and is_generated='NEVER'
   and not payload ? column_name) then raise exception 'Unsupported required order column; review production schema'; end if;
 select string_agg(format('%I',column_name),',' order by ordinal_position) into cols
 from information_schema.columns where table_schema='public' and table_name='orders' and payload ? column_name and is_generated='NEVER' and is_identity='NO';
 execute format('insert into public.orders (%s) select %s from jsonb_populate_record(null::public.orders,$1) returning id::text',cols,cols) into v_id using payload;
 return v_id;
end; $$;
-- Production write path: one database transaction creates a normal GRIM order,
-- a Checkout 2.0 receipt, and a paid attempt. Does not copy Preview orders.
create or replace function public.grim2_finish_card_live(p_reference text,p_provider text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.grim2_attempts%rowtype;
        v_order_id public.orders.id%type;
        v_address text;
        v_name text;
begin
 select * into r from public.grim2_attempts where reference=p_reference for update;
 if not found or r.method<>'card' then raise exception 'Unknown card checkout'; end if;
 if r.status='paid' then
   if r.provider_id IS DISTINCT FROM p_provider or r.order_id is null or
     not exists (select 1 from public.grim2_receipts where reference=p_reference)
   then raise exception 'Paid record requires manual reconciliation'; end if;
   return to_jsonb(r);
 end if;
 if coalesce(length(p_provider),0)=0 or (r.quote->>'totalKobo')::bigint < 1
 then raise exception 'Missing verified provider ID or amount'; end if;
 v_name:=trim(coalesce(r.contact->>'firstName','')||' '||coalesce(r.contact->>'lastName',''));
 v_address:=concat_ws(', ',r.shipping->>'address',nullif(r.shipping->>'apartment',''),
     r.shipping->>'city',r.shipping->>'state',r.shipping->>'postal',r.shipping->>'country');
 v_order_id:=public.grim2_insert_order(r.reference,true);
 insert into public.grim2_receipts(reference,customer_id,email,quote,shipping,billing,contact,
      method,provider_id,total_kobo)
 values(r.reference,r.customer_id,r.email,r.quote,r.shipping,r.billing,r.contact,
      'card',p_provider,(r.quote->>'totalKobo')::bigint);
 update public.grim2_attempts set status='paid',provider_id=p_provider,
      order_id=v_order_id::text,paid_at=pg_catalog.now()
 where reference=p_reference returning * into r;
 return to_jsonb(r);
end; $$;

-- Production wallet: NO new wallet balances. Debit only the already existing
-- wallet_accounts using the existing audited grim_wallet_debit RPC, *inside*
-- this same PostgreSQL transaction as order/receipt creation.
create or replace function public.grim2_finish_wallet_live(p_reference text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.grim2_attempts%rowtype;
        v_order_id public.orders.id%type;
        v_customer_id public.customers.id%type;
        v_tx_id uuid;
        v_tx public.wallet_transactions%rowtype;
        v_amount bigint;
        v_address text;
        v_name text;
begin
 select * into r from public.grim2_attempts where reference=p_reference for update;
 if not found or r.method<>'wallet' or r.status='cancelled' then raise exception 'Unknown wallet checkout'; end if;
 if r.status='paid' then
   if r.order_id is null or not exists(select 1 from public.grim2_receipts where reference=p_reference)
   then raise exception 'Paid wallet record requires manual reconciliation'; end if;
   return to_jsonb(r);
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('grim2-wallet-customer:'||r.customer_id,0));
 v_customer_id:=r.customer_id;
 v_amount:=(r.quote->>'totalKobo')::bigint;
 if r.quote ? 'shippingExpiresAt' and (r.quote->>'shippingExpiresAt')::bigint <= extract(epoch from now())*1000 then raise exception 'Shipping quote expired'; end if;
 if v_amount<1 then raise exception 'Invalid wallet amount'; end if;
 v_name:=trim(coalesce(r.contact->>'firstName','')||' '||coalesce(r.contact->>'lastName',''));
 v_address:=concat_ws(', ',r.shipping->>'address',nullif(r.shipping->>'apartment',''),
     r.shipping->>'city',r.shipping->>'state',r.shipping->>'postal',r.shipping->>'country');
 v_order_id:=public.grim2_insert_order(r.reference,false);
 -- PL/pgSQL functions run in the same transaction; any exception rolls back
 -- this order AND the wallet debit AND the receipt.
 v_tx_id := public.grim_wallet_debit(
    p_customer_id=>v_customer_id,
    p_currency=>'NGN',
    p_amount_minor=>v_amount,
    p_order_id=>v_order_id::text,
    p_description=>'GRIM Checkout 2.0 order #'||v_order_id::text,
    p_idempotency_key=>'grim2-wallet:'||r.reference
 );
 select * into v_tx from public.wallet_transactions where id=v_tx_id;
 if not found or v_tx.customer_id::text IS DISTINCT FROM r.customer_id
    or v_tx.currency IS DISTINCT FROM 'NGN' or v_tx.amount_minor IS DISTINCT FROM v_amount
    or v_tx.order_id::text IS DISTINCT FROM v_order_id::text
    or v_tx.idempotency_key IS DISTINCT FROM 'grim2-wallet:'||r.reference
    or v_tx.transaction_type IS DISTINCT FROM 'debit' or v_tx.status IS DISTINCT FROM 'completed'
    or v_tx.balance_before_minor - v_tx.balance_after_minor IS DISTINCT FROM v_amount
 then raise exception 'Wallet transaction linkage mismatch'; end if;
 update public.orders set status='new',payment_status='paid' where id=v_order_id;
 insert into public.grim2_receipts(reference,customer_id,email,quote,shipping,billing,contact,
      method,total_kobo)
 values(r.reference,r.customer_id,r.email,r.quote,r.shipping,r.billing,r.contact,'wallet',v_amount);
 update public.grim2_attempts set status='paid',order_id=v_order_id::text,
      paid_at=pg_catalog.now() where reference=p_reference returning * into r;
 return to_jsonb(r);
end; $$;

create or replace function public.grim2_wallet_live(p_customer text)
returns jsonb language sql security definer set search_path='' as $$
 select coalesce((select pg_catalog.jsonb_build_object('balanceKobo',w.balance_minor,
      'currency',w.currency,'active',w.status='active')
   from public.wallet_accounts w where w.customer_id::text=p_customer and w.currency='NGN'
   limit 1), '{"balanceKobo":0,"currency":"NGN","active":false}'::jsonb);
$$;
create or replace function public.grim2_addresses(p_customer text) returns jsonb language sql security definer set search_path='' as $$ select coalesce(jsonb_agg(address order by created_at desc),'[]'::jsonb) from public.grim2_billing_addresses where customer_id=p_customer; $$;
create or replace function public.grim2_save_address(p_customer text,p_address jsonb) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('grim2-address:'||p_customer,0));
 if (select count(*) from public.grim2_billing_addresses where customer_id=p_customer)>=10 then raise exception 'Address limit reached'; end if;
 insert into public.grim2_billing_addresses(customer_id,address) values(p_customer,p_address) on conflict do nothing;return true;
end; $$;
-- RLS and service-role-only execution apply to every newly created table/function.
do $$ declare r record; begin
 for r in select tablename from pg_tables where schemaname='public' and tablename in ('grim2_attempts','grim2_receipts','grim2_billing_addresses') loop
  execute format('alter table public.%I enable row level security',r.tablename);
  execute format('revoke all on table public.%I from public,anon,authenticated',r.tablename);
  execute format('grant all on table public.%I to service_role',r.tablename);
 end loop;
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('grim2_insert_order','grim2_health','grim2_health_live','grim2_read','grim2_by_key','grim2_pending','grim2_start','grim2_claim','grim2_initialized','grim2_flag','grim2_finish_card_live','grim2_finish_wallet_live','grim2_wallet_live','grim2_addresses','grim2_save_address') loop
  execute format('revoke all on function %s from public,anon,authenticated',r.signature);
  execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end; $$;
commit;
