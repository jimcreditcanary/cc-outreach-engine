-- Phase 4 — UBO identity verification (ID&V) + PEP / sanctions screening via
-- Call Validate (TransUnion). Full DOB is added to the merchant-completed KYC
-- (ID&V needs it); results land in onboarding_ubo_checks (re-run replaces).
--
-- RLS enabled, deny-all (service-role bypasses). Holds verification outcomes +
-- PEP/sanctions match detail — sensitive.

alter table public.onboarding_ubo_kyc add column if not exists date_of_birth date;

create table if not exists public.onboarding_ubo_checks (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references public.onboarding_cases (id) on delete cascade,
  ubo_kyc_id       uuid references public.onboarding_ubo_kyc (id) on delete cascade,
  ubo_name         text,
  -- ID&V
  idv_band         text,                 -- pass | refer | fail (provider band)
  idv_score        integer,
  idv_verified     boolean not null default false,
  idv_detail       jsonb,
  -- PEP / sanctions screening
  pep_match        boolean not null default false,
  sanctions_match  boolean not null default false,
  screening_detail jsonb,
  checked_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists onboarding_ubo_checks_case_idx on public.onboarding_ubo_checks (case_id);

alter table public.onboarding_ubo_checks enable row level security;
