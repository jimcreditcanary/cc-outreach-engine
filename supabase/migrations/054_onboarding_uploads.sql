-- Phase 3c — merchant document uploads (information-security docs etc.) with AI
-- extraction. Files live in the PRIVATE Supabase Storage bucket
-- 'onboarding-uploads' (no public policies → reachable only via the service
-- role on the server). This table records metadata + the AI extraction.
-- RLS enabled, deny-all (service-role bypasses).

insert into storage.buckets (id, name, public)
values ('onboarding-uploads', 'onboarding-uploads', false)
on conflict (id) do nothing;

create table if not exists public.onboarding_uploads (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.onboarding_cases (id) on delete cascade,
  kind         text not null default 'infosec',   -- infosec | other
  filename     text,
  storage_path text not null,
  content_type text,
  size_bytes   bigint,
  extracted    jsonb,                              -- AI-extracted summary / facts
  extracted_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists onboarding_uploads_case_idx on public.onboarding_uploads (case_id);

create trigger onboarding_uploads_touch before update on public.onboarding_uploads
  for each row execute function public.touch_updated_at();

alter table public.onboarding_uploads enable row level security;
