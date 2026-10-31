-- Billing agent — Phase 3 (APIs): usage records.
-- Idempotent; ends with the PostgREST schema-cache reload. RLS deny-all.
--
-- One row per reported usage event, tied to the billing item its usage key
-- authorises. idempotency_key is globally unique so retries/batches don't
-- double-count; a repeat with a DIFFERENT payload is a 409 at the API edge.

create table if not exists public.billing_usage_records (
  id                  uuid primary key default gen_random_uuid(),
  billing_item_id     uuid not null references public.billing_items (id) on delete cascade,
  period_month        date not null,            -- always the 1st of the month
  quantity            numeric not null default 0,
  value               numeric,                  -- txn value, for % metrics
  principal           numeric,                  -- loan principal, for pct_of_principal
  application_outcome text,                      -- monevo per-application outcome
  source              text not null default 'api',   -- api | manual
  idempotency_key     text not null unique,
  raw                 jsonb,
  created_at          timestamptz not null default now()
);
create index if not exists billing_usage_item_period_idx on public.billing_usage_records (billing_item_id, period_month);
alter table public.billing_usage_records enable row level security;

notify pgrst, 'reload schema';
