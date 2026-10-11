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
