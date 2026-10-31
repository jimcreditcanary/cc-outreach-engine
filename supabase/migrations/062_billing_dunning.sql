-- Billing agent — Phase 5: dunning log.
-- Idempotent; ends with the PostgREST schema-cache reload. RLS deny-all.
--
-- One row per (invoice, reporting date). The 15th-of-month dunning cron upserts
-- a row for each overdue invoice; the deal owner then records on /billing/
-- outstanding whether they've chased the customer.

create table if not exists public.billing_dunning_log (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references public.billing_invoices (id) on delete cascade,
  account_id         uuid references public.billing_accounts (id) on delete cascade,
  deal_owner_user_id uuid,
  reported_on        date not null default current_date,
  contacted_customer boolean,
  contacted_at       timestamptz,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists billing_dunning_invoice_date_uidx on public.billing_dunning_log (invoice_id, reported_on);
create index if not exists billing_dunning_account_idx on public.billing_dunning_log (account_id);
create trigger billing_dunning_touch before update on public.billing_dunning_log
  for each row execute function public.touch_updated_at();
alter table public.billing_dunning_log enable row level security;

notify pgrst, 'reload schema';
