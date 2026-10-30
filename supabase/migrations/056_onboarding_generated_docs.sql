-- Phase 5 — generated onboarding documents (the branded templates filled with
-- the case + enrichment + merchant-form data). Files are written to the existing
-- private 'onboarding-uploads' Storage bucket under a generated/ prefix; this
-- table records them (one row per generated file; regenerating replaces).
-- RLS enabled, deny-all (service-role bypasses).

create table if not exists public.onboarding_generated_docs (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.onboarding_cases (id) on delete cascade,
  doc_kind     text not null,        -- tu_credit_eua | tu_monevo_eua | tu_due_diligence_xlsx | merchant_onboarding_form | dd_questionnaire
  filename     text not null,
  storage_path text not null,
  content_type text,
  generated_at timestamptz not null default now()
);
create index if not exists onboarding_generated_docs_case_idx on public.onboarding_generated_docs (case_id);

alter table public.onboarding_generated_docs enable row level security;
