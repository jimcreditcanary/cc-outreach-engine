-- Migration 021: conferences (the "Events" tab in the UI).
--
--   conferences            — Money 2020, FCA Innovate, etc. Owned by an operator.
--   conference_attendances — many-to-many link to contacts, with a per-row
--                            "matched_via" so we know whether the row was
--                            an existing contact, freshly created, or a
--                            placeholder needing identification.
--   contacts.needs_research — set true on placeholder rows from CSV upload
--                             where we only had job-title + company. The
--                             /linkedin "Needs research" surface already
--                             keys off rows with no email/linkedin_url, so
--                             this flag just makes that intent explicit.

create table if not exists public.conferences (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  location    text,
  start_date  date,
  end_date    date,
  notes       text,
  owner_id    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists conferences_owner_idx on public.conferences (owner_id);
create index if not exists conferences_start_idx on public.conferences (start_date desc);

create table if not exists public.conference_attendances (
  conference_id uuid not null references public.conferences(id) on delete cascade,
  contact_id    uuid not null references public.contacts(id)    on delete cascade,
  matched_via   text not null default 'manual',  -- 'email' | 'name_company' | 'created' | 'needs_research' | 'manual'
  notes         text,
  created_at    timestamptz not null default now(),
  primary key (conference_id, contact_id)
);
create index if not exists conference_attendances_contact_idx on public.conference_attendances (contact_id);

alter table public.contacts add column if not exists needs_research boolean not null default false;
create index if not exists contacts_needs_research_idx on public.contacts (needs_research) where needs_research = true;
