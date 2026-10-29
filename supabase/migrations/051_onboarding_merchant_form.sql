-- Phase 3a — the merchant-completed onboarding form. One submission per case
-- (section data as jsonb) plus the per-UBO KYC the merchant fills in. Driven by
-- the public token form at /m/<merchant_form_token>.
--
-- RLS ENABLED, deny-all (service-role bypasses). Holds residential addresses +
-- PEP self-declarations — PII. The public form writes via serviceClient on the
-- server, keyed by the unguessable merchant_form_token.
--
-- Bank/settlement details, DD sub-form, CoP (P3b) and infosec uploads /
-- privacy-policy assessment (P3c) land in later migrations.

create table if not exists public.onboarding_merchant_form (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null unique references public.onboarding_cases (id) on delete cascade,
  -- trading name(s), trading address, principal office, phone, email, website
  business      jsonb not null default '{}',
  -- ico_number, fca_frn, dpo, privacy_policy_url, trade_body
  compliance    jsonb not null default '{}',
  -- name, title, email
  signatory     jsonb not null default '{}',
  status        text not null default 'draft',   -- draft | submitted
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger onboarding_merchant_form_touch before update on public.onboarding_merchant_form
  for each row execute function public.touch_updated_at();

alter table public.onboarding_merchant_form enable row level security;

-- Per-UBO KYC the merchant completes (one row per beneficial owner). ubo_id is
-- a soft link — re-enriching replaces onboarding_ubos rows, so we also snapshot
-- the name. ID documents + ID&V/PEP checks are later phases (uploads = P3c,
-- Call Validate ID&V + PEP = P4); this captures the self-declared fields.
create table if not exists public.onboarding_ubo_kyc (
  id                      uuid primary key default gen_random_uuid(),
  case_id                 uuid not null references public.onboarding_cases (id) on delete cascade,
  ubo_id                  uuid references public.onboarding_ubos (id) on delete set null,
  ubo_name                text,
  exact_ownership_percent text,
  residential_address     jsonb,
  is_pep                  boolean not null default false,
  pep_detail              text,
  consent_given           boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (case_id, ubo_id)
);
create index if not exists onboarding_ubo_kyc_case_idx on public.onboarding_ubo_kyc (case_id);

create trigger onboarding_ubo_kyc_touch before update on public.onboarding_ubo_kyc
  for each row execute function public.touch_updated_at();

alter table public.onboarding_ubo_kyc enable row level security;
