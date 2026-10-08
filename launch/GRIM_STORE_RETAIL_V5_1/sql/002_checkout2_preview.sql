-- Apply ONLY to the isolated Preview Supabase project. No existing tables are altered.
begin;
create table if not exists public.grim2_attempts (
 reference text primary key, customer_id text not null, email text not null,
 checkout_key text not null, method text not null check(method in ('card','wallet')),
 quote jsonb not null, shipping jsonb not null, billing jsonb not null, contact jsonb not null,
 status text not null default 'created' check(status in ('created','initializing','pending','initialization_unknown','reconciliation_required','paid')),
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
-- Explicit test-only wallet. No production balance is copied, credited, or debited.
create table if not exists public.grim2_wallet_accounts (
 customer_id text primary key, currency text not null default 'NGN' check(currency='NGN'),
 balance_kobo bigint not null default 0 check(balance_kobo>=0), active boolean not null default true
);
create table if not exists public.grim2_wallet_ledger (
 reference text primary key references public.grim2_receipts(reference),customer_id text not null,
 amount_kobo bigint not null check(amount_kobo>0),before_kobo bigint not null,after_kobo bigint not null check(after_kobo>=0),created_at timestamptz not null default now()
);
create table if not exists public.grim2_billing_addresses (
 customer_id text not null, address jsonb not null, created_at timestamptz not null default now(),
 primary key(customer_id,address)
);
create or replace function public.grim2_health() returns boolean language sql security definer set search_path='' as $$ select true; $$;
create or replace function public.grim2_read(p_reference text) returns jsonb language sql security definer set search_path='' as $$ select to_jsonb(r) from public.grim2_attempts r where reference=p_reference; $$;
create or replace function public.grim2_by_key(p_customer text,p_key text) returns jsonb language sql security definer set search_path='' as $$ select to_jsonb(r) from public.grim2_attempts r where customer_id=p_customer and checkout_key=p_key; $$;
create or replace function public.grim2_pending(p_customer text) returns jsonb language sql security definer set search_path='' as $$ select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]'::jsonb) from public.grim2_attempts r where customer_id=p_customer and status<>'paid'; $$;
create or replace function public.grim2_start(p_reference text,p_customer text,p_email text,p_key text,p_method text,p_quote jsonb,p_shipping jsonb,p_billing jsonb,p_contact jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.grim2_attempts%rowtype;
begin
 -- Serialize different keys for the same customer, as well as concurrent retries.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('grim2:'||p_customer,0));
 select * into r from public.grim2_attempts where customer_id=p_customer and checkout_key=p_key;
 if found then return to_jsonb(r); end if;
 -- Return the outstanding attempt instead of permitting a second payment.
 select * into r from public.grim2_attempts where customer_id=p_customer and status<>'paid' order by created_at limit 1;
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
create or replace function public.grim2_finish_card(p_reference text,p_provider text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.grim2_attempts%rowtype;
begin
 select * into r from public.grim2_attempts where reference=p_reference for update;
 if not found or r.method<>'card' then raise exception 'Unknown card checkout'; end if;
 if r.status='paid' then return to_jsonb(r); end if;
 if length(coalesce(p_provider,''))=0 then raise exception 'Missing verified provider ID'; end if;
 insert into public.grim2_receipts(reference,customer_id,email,quote,shipping,billing,contact,method,provider_id,total_kobo)
 values(r.reference,r.customer_id,r.email,r.quote,r.shipping,r.billing,r.contact,'card',p_provider,(r.quote->>'totalKobo')::bigint);
 update public.grim2_attempts set status='paid',provider_id=p_provider,order_id=reference,paid_at=now() where reference=p_reference returning * into r;
 return to_jsonb(r);
end; $$;
create or replace function public.grim2_finish_wallet(p_reference text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.grim2_attempts%rowtype; w public.grim2_wallet_accounts%rowtype; amount bigint;
begin
 select * into r from public.grim2_attempts where reference=p_reference for update;
 if not found or r.method<>'wallet' then raise exception 'Unknown wallet checkout'; end if;
 if r.status='paid' then return to_jsonb(r); end if;
 select * into w from public.grim2_wallet_accounts where customer_id=r.customer_id for update;
 amount:=(r.quote->>'totalKobo')::bigint;
 if not found or not w.active or w.balance_kobo<amount then raise exception 'Insufficient or inactive test wallet'; end if;
 insert into public.grim2_receipts(reference,customer_id,email,quote,shipping,billing,contact,method,total_kobo)
 values(r.reference,r.customer_id,r.email,r.quote,r.shipping,r.billing,r.contact,'wallet',amount);
 update public.grim2_wallet_accounts set balance_kobo=balance_kobo-amount where customer_id=r.customer_id;
 insert into public.grim2_wallet_ledger(reference,customer_id,amount_kobo,before_kobo,after_kobo) values(r.reference,r.customer_id,amount,w.balance_kobo,w.balance_kobo-amount);
 update public.grim2_attempts set status='paid',order_id=reference,paid_at=now() where reference=p_reference returning * into r;
 return to_jsonb(r);
end; $$;
create or replace function public.grim2_wallet(p_customer text) returns jsonb language sql security definer set search_path='' as $$ select coalesce((select jsonb_build_object('balanceKobo',w.balance_kobo,'currency',w.currency,'active',w.active) from public.grim2_wallet_accounts w where customer_id=p_customer),'{"balanceKobo":0,"currency":"NGN","active":false}'::jsonb); $$;
create or replace function public.grim2_addresses(p_customer text) returns jsonb language sql security definer set search_path='' as $$ select coalesce(jsonb_agg(address order by created_at desc),'[]'::jsonb) from public.grim2_billing_addresses where customer_id=p_customer; $$;
create or replace function public.grim2_save_address(p_customer text,p_address jsonb) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('grim2-address:'||p_customer,0));
 if (select count(*) from public.grim2_billing_addresses where customer_id=p_customer)>=10 then raise exception 'Address limit reached'; end if;
 insert into public.grim2_billing_addresses(customer_id,address) values(p_customer,p_address) on conflict do nothing;return true;
end; $$;
-- RLS and service-role-only execution apply to every newly created table/function.
do $$ declare r record; begin
 for r in select tablename from pg_tables where schemaname='public' and tablename in ('grim2_attempts','grim2_receipts','grim2_wallet_accounts','grim2_wallet_ledger','grim2_billing_addresses') loop
  execute format('alter table public.%I enable row level security',r.tablename);
  execute format('revoke all on table public.%I from public,anon,authenticated',r.tablename);
  execute format('grant all on table public.%I to service_role',r.tablename);
 end loop;
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('grim2_health','grim2_read','grim2_by_key','grim2_pending','grim2_start','grim2_claim','grim2_initialized','grim2_flag','grim2_finish_card','grim2_finish_wallet','grim2_wallet','grim2_addresses','grim2_save_address') loop
  execute format('revoke all on function %s from public,anon,authenticated',r.signature);
  execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end; $$;
commit;
