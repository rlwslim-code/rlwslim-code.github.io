-- NEW isolated checkout tables. Does not alter existing orders or wallets.
create table if not exists public.grim2_checkouts (
 reference text primary key, customer_id text not null, email text not null,
 quote jsonb not null, shipping jsonb not null default '{}'::jsonb,
 status text not null default 'pending' check(status in ('pending','paid','initialize_failed','reconciliation_required')),
 provider_id text unique, created_at timestamptz not null default now(), paid_at timestamptz
);
create table if not exists public.grim2_orders (
 reference text primary key references public.grim2_checkouts(reference),
 customer_id text not null, email text not null, items_json jsonb not null,
 total_kobo bigint not null, shipping jsonb not null,
 provider_id text not null unique, created_at timestamptz not null default now()
);
alter table public.grim2_checkouts enable row level security;
alter table public.grim2_orders enable row level security;
revoke all on public.grim2_checkouts, public.grim2_orders from anon, authenticated;
create or replace function public.grim2_create_checkout(p_reference text,p_customer_id text,p_email text,p_quote jsonb,p_shipping jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if p_reference !~ '^GRIM2-[0-9a-f-]{36}$' or coalesce((p_quote->>'totalKobo')::bigint,0)<1 then raise exception 'Invalid checkout'; end if;
 insert into public.grim2_checkouts(reference,customer_id,email,quote,shipping) values(p_reference,p_customer_id,p_email,p_quote,p_shipping);
 return true;
end;$$;
create or replace function public.grim2_get_checkout(p_reference text)
returns public.grim2_checkouts language sql security definer set search_path=public as $$
 select * from public.grim2_checkouts where reference=p_reference;
$$;
create or replace function public.grim2_flag_checkout(p_reference text,p_status text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if p_status not in ('initialize_failed','reconciliation_required') then raise exception 'Invalid state'; end if;
 update public.grim2_checkouts set status=p_status where reference=p_reference and status<>'paid';
 return found;
end;$$;
create or replace function public.grim2_complete_checkout(p_reference text,p_provider_id text)
returns boolean language plpgsql security definer set search_path=public as $$
declare r public.grim2_checkouts%rowtype;
begin
 select * into r from public.grim2_checkouts where reference=p_reference for update;
 if not found then raise exception 'Unknown checkout'; end if;
 if r.status='paid' then return true; end if;
 insert into public.grim2_orders(reference,customer_id,email,items_json,total_kobo,shipping,provider_id)
 values(r.reference,r.customer_id,r.email,r.quote->'items',(r.quote->>'totalKobo')::bigint,r.shipping,p_provider_id);
 update public.grim2_checkouts set status='paid',provider_id=p_provider_id,paid_at=now() where reference=p_reference;
 return true;
end;$$;
revoke all on function public.grim2_create_checkout(text,text,text,jsonb,jsonb), public.grim2_get_checkout(text), public.grim2_flag_checkout(text,text), public.grim2_complete_checkout(text,text) from public,anon,authenticated;
grant execute on function public.grim2_create_checkout(text,text,text,jsonb,jsonb), public.grim2_get_checkout(text), public.grim2_flag_checkout(text,text), public.grim2_complete_checkout(text,text) to service_role;
