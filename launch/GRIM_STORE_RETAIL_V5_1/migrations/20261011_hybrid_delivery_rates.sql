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
