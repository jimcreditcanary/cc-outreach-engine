-- Phase 3c — AI assessment of the merchant's privacy policy against the TU /
-- GDPR due-diligence requirements. One assessment per case (re-runnable;
-- replaces). The policy URL comes from the merchant form's compliance section.
-- RLS enabled, deny-all (service-role bypasses).

create table if not exists public.onboarding_privacy_assessment (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null unique references public.onboarding_cases (id) on delete cascade,
  url         text,
  result      jsonb,            -- structured assessment (coverage, gaps, overall)
  assessed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger onboarding_privacy_assessment_touch before update on public.onboarding_privacy_assessment
  for each row execute function public.touch_updated_at();

alter table public.onboarding_privacy_assessment enable row level security;
