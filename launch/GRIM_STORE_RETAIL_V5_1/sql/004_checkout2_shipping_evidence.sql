-- Run after 002 on ISOLATED Preview or 003 on approved production. No existing wallet data is changed.
begin;
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
commit;
