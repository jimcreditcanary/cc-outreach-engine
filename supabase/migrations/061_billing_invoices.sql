-- Billing agent — Phase 4: invoice runs, invoices, invoice lines.
-- Idempotent; ends with the PostgREST schema-cache reload. RLS deny-all.
-- Money stored as INTEGER PENCE. The unique (account_id, period_month) on
-- billing_invoices is what makes the monthly run idempotent — re-running a
-- period can never create a second invoice for an account.

create table if not exists public.billing_invoice_runs (
  id           uuid primary key default gen_random_uuid(),
  period_month date not null,
  run_date     date not null default current_date,
  status       text not null default 'running',   -- running | complete | error
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  summary      jsonb,
  errors       jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists billing_invoice_runs_period_idx on public.billing_invoice_runs (period_month, created_at);
alter table public.billing_invoice_runs enable row level security;

create table if not exists public.billing_invoices (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.billing_accounts (id) on delete cascade,
  run_id         uuid references public.billing_invoice_runs (id) on delete set null,
  period_month   date not null,
  xero_invoice_id text,
  xero_status    text,
  subtotal_pence integer not null default 0,
  vat_pence      integer not null default 0,
  total_pence    integer not null default 0,
  due_date       date,
  paid_at        timestamptz,
  prorated       boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists billing_invoices_account_period_uidx on public.billing_invoices (account_id, period_month);
create index if not exists billing_invoices_run_idx on public.billing_invoices (run_id);
create trigger billing_invoices_touch before update on public.billing_invoices
  for each row execute function public.touch_updated_at();
alter table public.billing_invoices enable row level security;

create table if not exists public.billing_invoice_lines (
  id               uuid primary key default gen_random_uuid(),
  invoice_id       uuid not null references public.billing_invoices (id) on delete cascade,
  billing_item_id  uuid references public.billing_items (id) on delete set null,
  description      text not null,
  quantity         numeric not null default 0,
  unit_amount_pence integer not null default 0,
  line_amount_pence integer not null default 0,
  vat_rate         numeric not null default 0,
  vat_pence        integer not null default 0,
  calc             jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists billing_invoice_lines_invoice_idx on public.billing_invoice_lines (invoice_id);
alter table public.billing_invoice_lines enable row level security;

notify pgrst, 'reload schema';
