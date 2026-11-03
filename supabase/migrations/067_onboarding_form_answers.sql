-- Step 6 questionnaire foundation (P0). A flexible per-field answer store for
-- the long-tail customer questionnaire — one row per field gives free per-field
-- attribution ("updated by {email} ({role})"), autosave / Save-and-Continue,
-- and a "don't know / ask later" flag. Plus per-page progress for the multi-page
-- form. Typed/sensitive data (bank accounts, UBO KYC, uploads) stays in its own
-- tables. RLS deny-all; all access via serviceClient().

create table if not exists public.onboarding_form_answers (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references public.onboarding_cases(id) on delete cascade,
  field_key        text not null,
  value            text,
  is_unknown       boolean not null default false,
  updated_by_email text,
  updated_by_role  text,
  updated_at       timestamptz not null default now(),
  unique (case_id, field_key)
);
create index if not exists onboarding_form_answers_case_idx on public.onboarding_form_answers (case_id);
alter table public.onboarding_form_answers enable row level security;

create table if not exists public.onboarding_form_progress (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.onboarding_cases(id) on delete cascade,
  page         text not null,
  completed    boolean not null default false,
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  unique (case_id, page)
);
create index if not exists onboarding_form_progress_case_idx on public.onboarding_form_progress (case_id);
alter table public.onboarding_form_progress enable row level security;

notify pgrst, 'reload schema';
