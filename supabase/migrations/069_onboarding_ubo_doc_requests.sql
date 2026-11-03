-- Step 7: UBO document-upload requests. When a beneficial owner's ID&V or
-- PEP/sanctions check fails, ops shares a per-UBO link; the UBO uploads a
-- passport photo + a proof of address (<3 months). No email to the customer —
-- the unguessable token is the credential and the link is shared manually.
-- RLS deny-all; all access via serviceClient().

create table if not exists public.onboarding_ubo_doc_requests (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.onboarding_cases(id) on delete cascade,
  ubo_kyc_id  uuid,
  ubo_name    text,
  token       text not null unique,
  reason      text,
  created_at  timestamptz not null default now(),
  unique (case_id, ubo_name)
);
create index if not exists onboarding_ubo_doc_requests_case_idx on public.onboarding_ubo_doc_requests (case_id);
alter table public.onboarding_ubo_doc_requests enable row level security;

-- Tie an uploaded document to a specific UBO (by name).
alter table public.onboarding_uploads add column if not exists ubo_ref text;

notify pgrst, 'reload schema';
