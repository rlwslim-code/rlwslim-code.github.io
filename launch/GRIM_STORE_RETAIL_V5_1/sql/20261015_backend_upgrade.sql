-- GRIM backend consolidated upgrade. One transaction; no charges or balance changes.
BEGIN;
-- Source: sql/003_checkout2_live_REVIEW.sql
-- GRIM CHECKOUT 2.0 LIVE MIGRATION — REVIEW BEFORE APPLYING TO PRODUCTION.
-- Non-destructive: creates checkout tables/functions + unique order reference index.
-- DOES NOT credit/debit a wallet or copy test balances during migration.
-- Requires verified orders, customers, wallet_accounts and grim_wallet_debit schemas.
-- Take a DB backup and inspect the existing wallet RPC before running.

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
  'subtotal_kobo',(r.quote->>'subtotalKobo')::bigint,'fee_kobo',(r.quote->>'shippingKobo')::bigint,
  'total_kobo',(r.quote->>'totalKobo')::bigint,
  'snapshot',jsonb_build_object('quote',r.quote,'shipping',r.shipping,'billing',r.billing,'contact',r.contact,'method',r.method),
  'expires_at',coalesce(to_timestamp((r.quote->>'shippingExpiresAt')::numeric/1000),now()+interval '1 day'),
  'paid_at',case when p_paid then now() else null end,
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

-- Source: sql/004_checkout2_shipping_evidence.sql
-- Run after 002 on ISOLATED Preview or 003 on approved production. No existing wallet data is changed.

alter table public.grim2_attempts drop constraint if exists grim2_attempts_status_check;
alter table public.grim2_attempts add constraint grim2_attempts_status_check check(status in ('created','initializing','pending','initialization_unknown','reconciliation_required','paid','cancelled'));
alter table public.grim2_attempts add column if not exists payment_evidence jsonb;
alter table public.grim2_receipts add column if not exists payment_evidence jsonb;
create table if not exists public.grim2_product_shipping (
 product_id text primary key, weight_kg numeric not null check(weight_kg>0),
 dimensions jsonb not null check(jsonb_typeof(dimensions)='object'), updated_at timestamptz not null default now()
);
create table if not exists public.grim2_package_shipping (
 cart_key text primary key, dimensions jsonb not null check(jsonb_typeof(dimensions)='object'),
 updated_at timestamptz not null default now()
);
create or replace function public.grim2_apply_evidence(p_reference text,p_provider text,p_evidence jsonb,p_mode text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.grim2_attempts%rowtype; charged bigint; base bigint; requested bigint; fee bigint;
begin
 select * into r from public.grim2_attempts where reference=p_reference for update;
 charged:=(p_evidence->>'chargedAmountKobo')::bigint; base:=(r.quote->>'totalKobo')::bigint;
 requested:=(p_evidence->>'requestedAmountKobo')::bigint; fee:=(p_evidence->>'providerFeesKobo')::bigint;
 if not found or r.method<>'card' or p_evidence->>'domain' IS DISTINCT FROM p_mode
 or p_evidence->>'status' IS DISTINCT FROM 'success' or p_evidence->>'reference' IS DISTINCT FROM p_reference
 or p_evidence->>'currency' IS DISTINCT FROM 'NGN' or coalesce(charged,0)<base
 or p_provider !~ '^[0-9]+$' or (requested is not null and requested<>base)
 or (charged<>base and (requested is null or requested<>base or fee is null or fee<=0 or charged<>base+fee))
 or (p_evidence->>'processingFeeKobo')::bigint IS DISTINCT FROM charged-base
 then raise exception 'Invalid verified payment evidence'; end if;
 if r.status='paid' and (r.provider_id IS DISTINCT FROM p_provider or
    (r.payment_evidence is not null and r.payment_evidence IS DISTINCT FROM p_evidence))
 then raise exception 'Paid evidence conflict'; end if;
 update public.grim2_attempts set payment_evidence=p_evidence where reference=p_reference;
 return true;
end; $$;
create or replace function public.grim2_finish_card_verified(p_reference text,p_provider text,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 perform public.grim2_apply_evidence(p_reference,p_provider,p_evidence,'test');
 r:=public.grim2_finish_card(p_reference,p_provider);
 update public.grim2_receipts set payment_evidence=p_evidence where reference=p_reference;
 return (select to_jsonb(a) from public.grim2_attempts a where reference=p_reference);
end; $$;
create or replace function public.grim2_finish_card_live_verified(p_reference text,p_provider text,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 perform public.grim2_apply_evidence(p_reference,p_provider,p_evidence,'live');
 r:=public.grim2_finish_card_live(p_reference,p_provider);
 update public.grim2_receipts set payment_evidence=p_evidence where reference=p_reference;
 return (select to_jsonb(a) from public.grim2_attempts a where reference=p_reference);
end; $$;
create or replace function public.grim2_health() returns boolean language sql security definer set search_path='' as $$
 select pg_catalog.to_regprocedure('public.grim2_finish_card_verified(text,text,jsonb)') is not null and pg_catalog.to_regclass('public.grim2_product_shipping') is not null; $$;
create or replace function public.grim2_health_live() returns boolean language sql security definer set search_path='' as $$
 select pg_catalog.to_regprocedure('public.grim2_finish_card_live_verified(text,text,jsonb)') is not null and pg_catalog.to_regprocedure('public.grim2_finish_wallet_live(text)') is not null and pg_catalog.to_regclass('public.grim2_product_shipping') is not null; $$;
create or replace function public.grim2_cancel_wallet(p_reference text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.grim2_attempts%rowtype;
begin
 select * into r from public.grim2_attempts where reference=p_reference for update;
 if not found or r.method<>'wallet' then raise exception 'Unknown wallet checkout'; end if;
 if r.status='paid' then return to_jsonb(r); end if;
 if exists(select 1 from public.grim2_receipts where reference=p_reference) then raise exception 'Wallet receipt requires reconciliation'; end if;
 update public.grim2_attempts set status='cancelled' where reference=p_reference returning * into r;
 return to_jsonb(r);
end; $$;
-- Reject duplicate save attempts only after checking whether the address already exists.
create or replace function public.grim2_save_address(p_customer text,p_address jsonb) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('grim2-address:'||p_customer,0));
 if exists(select 1 from public.grim2_billing_addresses where customer_id=p_customer and address=p_address) then return true; end if;
 if (select count(*) from public.grim2_billing_addresses where customer_id=p_customer)>=10 then raise exception 'Address limit reached'; end if;
 insert into public.grim2_billing_addresses(customer_id,address) values(p_customer,p_address);return true;
end; $$;
do $$ declare r record; begin
 for r in select tablename from pg_tables where schemaname='public' and tablename in ('grim2_product_shipping','grim2_package_shipping') loop
  execute format('alter table public.%I enable row level security',r.tablename);
  execute format('revoke all on table public.%I from public,anon,authenticated',r.tablename);
  execute format('grant all on table public.%I to service_role',r.tablename);
 end loop;
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('grim2_health','grim2_health_live','grim2_cancel_wallet','grim2_apply_evidence','grim2_finish_card_verified','grim2_finish_card_live_verified','grim2_save_address') loop
  execute format('revoke all on function %s from public,anon,authenticated',r.signature);
  execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end; $$;

-- Source: migrations/20261011_hybrid_delivery_rates.sql
-- Run only after review and backup. No existing tables modified.
create table if not exists public.grim2_hybrid_rates (
 id uuid primary key default gen_random_uuid(),
 country text not null check(country ~ '^[A-Z]{2}$'),
 state text not null default '', city text not null default '',
 fee_kobo bigint not null check(fee_kobo between 0 and 1000000000),
 max_weight_grams integer not null check(max_weight_grams between 1 and 1000000),
 enabled boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.grim2_hybrid_rates enable row level security;
-- No anonymous or authenticated user policies. Server service role only.

-- Source: migrations/20261011_hybrid_quote_requests.sql
-- REVIEW AND BACK UP FIRST. Separate opt-in manual quote records; no writes to existing orders/wallets.
create table if not exists public.grim2_hybrid_quote_requests (
 id uuid primary key,
 customer_id text not null,
 status text not null default 'AWAITING_QUOTE' check(status in ('AWAITING_QUOTE','QUOTE_READY','CANCELLED')),
 snapshot jsonb not null,
 subtotal_kobo bigint not null check(subtotal_kobo>0),
 fee_kobo bigint check(fee_kobo between 0 and 1000000000),
 total_kobo bigint check(total_kobo>0),
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 quoted_at timestamptz,
 constraint quote_amounts_consistent check ((status='AWAITING_QUOTE' and fee_kobo is null and total_kobo is null) or (status='QUOTE_READY' and fee_kobo is not null and total_kobo=subtotal_kobo+fee_kobo) or status='CANCELLED')
);
create index if not exists grim2_hybrid_quote_customer_idx on public.grim2_hybrid_quote_requests(customer_id,created_at desc);
alter table public.grim2_hybrid_quote_requests enable row level security;
-- No client policies; service role only. Maintain strict API-side customer filtering.

-- Source: sql/20261011_manual_quote_live_payment_REVIEW.sql
-- GRIM quotation Paystack integration. REVIEW AND BACK UP LIVE DB BEFORE APPLYING.
-- No wallet actions, no automatic customer charges. Separate production flag is OFF by default.
-- Prerequisites: previous GRIM Checkout 2.0 LIVE migrations and quote table exist.

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

-- Source: sql/20261012_three_method_manual_quote_REVIEW.sql
-- REVIEW BEFORE INSTALLING. Creates a NEW quotation starter RPC; does NOT edit
-- existing customers/orders/attempts, charge a card, or debit any wallet.
-- Tested only with isolated JS mocks here: test with isolated PostgreSQL first.

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

    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id::text=p_customer AND lower(email)=lower(p_email)) THEN
      RAISE EXCEPTION 'Customer identity mismatch';
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
       OR COALESCE(pg_catalog.jsonb_typeof(q.snapshot->'items'),'') <> 'array'
       OR (CASE WHEN pg_catalog.jsonb_typeof(q.snapshot->'items') = 'array'
          THEN pg_catalog.jsonb_array_length(q.snapshot->'items') < 1
          ELSE TRUE END)
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


-- Route new card quotations through the same validated atomic starter as wallet/transfer.
CREATE OR REPLACE FUNCTION public.grim2_start_manual_quote(p_quote_id uuid,p_customer text,p_email text,p_reference text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.grim2_start_manual_quote_v2(p_quote_id,p_customer,p_email,p_reference,'card');
$$;
REVOKE ALL ON FUNCTION public.grim2_start_manual_quote(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.grim2_start_manual_quote(uuid,text,text,text) TO service_role;
REVOKE ALL ON TABLE public.grim2_hybrid_rates,public.grim2_hybrid_quote_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.grim2_hybrid_rates,public.grim2_hybrid_quote_requests TO service_role;

COMMIT;
