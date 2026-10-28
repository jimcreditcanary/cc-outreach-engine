-- Daily HubSpot → Supabase mirror (disaster-recovery snapshot). If the HubSpot
-- connection breaks, these tables hold the last good copy of the CRM. Each object
-- is keyed by its HubSpot id, with a few extracted columns for quick queries, the
-- full fetched property bag as JSONB, its associations, and when it was mirrored.
-- Upsert-only: records deleted in HubSpot linger here (safe for a backup).

create table if not exists public.hs_mirror_companies (
  id           text primary key,
  name         text,
  domain       text,
  properties   jsonb not null,
  associations jsonb,
  mirrored_at  timestamptz not null default now()
);

create table if not exists public.hs_mirror_contacts (
  id           text primary key,
  email        text,
  full_name    text,
  company_id   text,
  properties   jsonb not null,
  associations jsonb,
  mirrored_at  timestamptz not null default now()
);
create index if not exists hs_mirror_contacts_email_idx on public.hs_mirror_contacts (lower(email));
create index if not exists hs_mirror_contacts_company_idx on public.hs_mirror_contacts (company_id);

create table if not exists public.hs_mirror_deals (
  id           text primary key,
  dealname     text,
  amount       numeric,
  dealstage    text,
  properties   jsonb not null,
  associations jsonb,
  mirrored_at  timestamptz not null default now()
);

-- One row per object per run, for observability / alerting on a broken sync.
create table if not exists public.hs_mirror_runs (
  id          bigint generated always as identity primary key,
  object_type text not null,
  fetched     int,
  upserted    int,
  ok          boolean not null,
  error       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists hs_mirror_runs_started_idx on public.hs_mirror_runs (started_at desc);
