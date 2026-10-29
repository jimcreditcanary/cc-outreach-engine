-- Phase 2 — Companies House deep-enrichment snapshot, per onboarding case:
--   • company snapshot (profile + accounts/CS/charges/insolvency flags)
--   • officers (current + resigned ≤12 months — §4 addendum rule)
--   • PSC / UBO chain (direct PSCs + bounded recursion through corporate PSCs)
--
-- Re-enriching a case REPLACES its rows (delete-by-case, re-insert), so the
-- snapshot is a point-in-time pull stamped with enriched_at.
--
-- RLS ENABLED, deny-all (service-role bypasses) — these hold officer/PSC DOBs
-- and residential-ish addresses. Same posture as 048.

-- ─── company snapshot (one per case) ──────────────────────────────────────────
create table if not exists public.onboarding_company_snapshot (
  id                              uuid primary key default gen_random_uuid(),
  case_id                         uuid not null unique references public.onboarding_cases (id) on delete cascade,
  company_number                  text not null,
  company_name                    text,
  company_status                  text,
  company_type                    text,
  incorporation_date              date,
  sic_codes                       text[] not null default '{}',
  registered_office               jsonb,
  previous_names                  jsonb,
  accounts_next_due               date,
  accounts_last_made_up           date,
  accounts_overdue                boolean not null default false,
  confirmation_statement_next_due date,
  confirmation_statement_overdue  boolean not null default false,
  has_charges                     boolean not null default false,
  has_insolvency_history          boolean not null default false,
  -- true if any current/recent officer appears on the disqualified register
  -- (name-match, flagged for human verification — never an automatic decision).
  disqualified_officer_found      boolean not null default false,
  raw                             jsonb,
  enriched_at                     timestamptz,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

create trigger onboarding_company_snapshot_touch before update on public.onboarding_company_snapshot
  for each row execute function public.touch_updated_at();

alter table public.onboarding_company_snapshot enable row level security;

-- ─── officers / directors ─────────────────────────────────────────────────────
-- Current officers + those resigned within the last 12 months (§4 addendum).
create table if not exists public.onboarding_officers (
  id                   uuid primary key default gen_random_uuid(),
  case_id              uuid not null references public.onboarding_cases (id) on delete cascade,
  ch_appointment_id    text,              -- links.self, natural key for dedupe
  name                 text not null,
  officer_role         text,
  appointed_on         date,
  resigned_on          date,              -- null = current officer
  nationality          text,
  occupation           text,
  country_of_residence text,
  dob_month            integer,           -- CH exposes month + year only
  dob_year             integer,
  address              jsonb,
  is_disqualified      boolean not null default false,
  disqualification     jsonb,
  raw                  jsonb,
  created_at           timestamptz not null default now(),
  unique (case_id, ch_appointment_id)
);
create index if not exists onboarding_officers_case_idx on public.onboarding_officers (case_id);

alter table public.onboarding_officers enable row level security;

-- ─── PSC / UBO chain ──────────────────────────────────────────────────────────
-- Direct PSCs of the company, plus bounded recursion through corporate PSCs
-- (parent_id links a node to the corporate PSC it was found under; depth 0 =
-- direct on the onboarding company).
create table if not exists public.onboarding_ubos (
  id                   uuid primary key default gen_random_uuid(),
  case_id              uuid not null references public.onboarding_cases (id) on delete cascade,
  parent_id            uuid references public.onboarding_ubos (id) on delete cascade,
  depth                integer not null default 0,
  via_company_number   text,              -- the corporate PSC recursed through
  kind                 text,              -- individual-…/corporate-entity-…/legal-person-…/a PSC statement
  is_corporate         boolean not null default false,
  name                 text,
  natures_of_control   text[] not null default '{}',
  notified_on          date,
  ceased_on            date,
  nationality          text,
  country_of_residence text,
  dob_month            integer,
  dob_year             integer,
  address              jsonb,
  identification       jsonb,             -- corporate PSC: registration number / place registered
  raw                  jsonb,
  created_at           timestamptz not null default now()
);
create index if not exists onboarding_ubos_case_idx on public.onboarding_ubos (case_id);
create index if not exists onboarding_ubos_parent_idx on public.onboarding_ubos (parent_id);

alter table public.onboarding_ubos enable row level security;
