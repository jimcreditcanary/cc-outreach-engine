-- Phase 2b — parsed iXBRL accounts (latest filed) per case: the headline
-- figures extracted from the company's filed accounts via the Companies House
-- Document API. Re-parsing replaces. RLS enabled, deny-all (service-role bypasses).

create table if not exists public.onboarding_accounts (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null unique references public.onboarding_cases (id) on delete cascade,
  period_end  date,
  turnover    numeric,
  profit_loss numeric,
  net_assets  numeric,
  cash        numeric,
  employees   integer,
  facts       jsonb,          -- all extracted iXBRL facts (name/value/period)
  parsed_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger onboarding_accounts_touch before update on public.onboarding_accounts
  for each row execute function public.touch_updated_at();

alter table public.onboarding_accounts enable row level security;
