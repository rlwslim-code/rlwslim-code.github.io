-- GRIM Notifications V1. Non-destructive: creates isolated tables and one orders trigger.
-- REVIEW BEFORE RUNNING ON PRODUCTION. Does not alter payments, wallet, shipping or existing orders.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.grim_notify_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  subscription jsonb not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.grim_notify_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null check (event_type in ('order_created', 'payment_received')),
  order_id text not null,
  message text not null,
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  attempts integer not null default 0,
  delivered_at timestamptz,
  last_error text
);

create index if not exists grim_notify_pending_idx
on public.grim_notify_outbox (available_at, created_at)
where delivered_at is null;

alter table public.grim_notify_push_subscriptions enable row level security;
alter table public.grim_notify_outbox enable row level security;
revoke all on table public.grim_notify_push_subscriptions from anon, authenticated;
revoke all on table public.grim_notify_outbox from anon, authenticated;

-- Server-only claim of work: lease prevents parallel webhook invocations duplicating alerts.
create or replace function public.grim_notify_claim_events(batch_size integer default 20)
returns setof public.grim_notify_outbox
language sql
security definer
set search_path = public, pg_temp
as $$
  with picked as (
    select id from public.grim_notify_outbox
    where delivered_at is null
      and attempts < 12
      and available_at <= now()
      and (lease_until is null or lease_until < now())
    order by created_at
    for update skip locked
    limit least(greatest(batch_size, 1), 50)
  )
  update public.grim_notify_outbox o
  set attempts = o.attempts + 1, lease_until = now() + interval '90 seconds'
  from picked
  where o.id = picked.id
  returning o.*;
$$;
revoke all on function public.grim_notify_claim_events(integer) from public, anon, authenticated;
grant execute on function public.grim_notify_claim_events(integer) to service_role;

create or replace function public.grim_notify_record_order_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n jsonb := to_jsonb(new);
  p jsonb;
  id_text text;
  is_paid boolean;
  was_paid boolean := false;
  ref text;
begin
  id_text := coalesce(n->>'id', 'unknown');
  ref := right(id_text, 8);
  is_paid := coalesce(lower(n->>'payment_status'), '') in ('paid', 'success', 'successful')
    or coalesce(lower(n->>'status'), '') in ('paid', 'payment_received')
    or nullif(n->>'paid_at', '') is not null;

  if tg_op = 'UPDATE' then
    p := to_jsonb(old);
    was_paid := coalesce(lower(p->>'payment_status'), '') in ('paid', 'success', 'successful')
      or coalesce(lower(p->>'status'), '') in ('paid', 'payment_received')
      or nullif(p->>'paid_at', '') is not null;
  end if;

  if tg_op = 'INSERT' then
    if is_paid then
      insert into public.grim_notify_outbox (event_key, event_type, order_id, message)
      values (id_text || ':payment_received', 'payment_received', id_text, 'Payment confirmed for order #' || ref)
      on conflict (event_key) do nothing;
    else
      insert into public.grim_notify_outbox (event_key, event_type, order_id, message)
      values (id_text || ':order_created', 'order_created', id_text, 'New order #' || ref || ' — payment not yet confirmed')
      on conflict (event_key) do nothing;
    end if;
  elsif is_paid and not was_paid then
    insert into public.grim_notify_outbox (event_key, event_type, order_id, message)
    values (id_text || ':payment_received', 'payment_received', id_text, 'Payment confirmed for order #' || ref)
    on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

-- Ensure there is only one copy of this trigger on orders.
drop trigger if exists grim_notify_orders_trigger on public.orders;
create trigger grim_notify_orders_trigger
  after insert or update on public.orders
  for each row execute function public.grim_notify_record_order_event();

-- Observe events without exposing customer information:
-- select id, event_type, order_id, created_at, delivered_at, last_error
-- from public.grim_notify_outbox order by created_at desc limit 20;
