-- Meetings synced from Outlook (Microsoft Graph) + AI pre-meeting brief.
-- ms_event_id is the dedup key for re-syncs. Attendees stored as jsonb
-- so we don't need a join table for what's mostly read-once data.
-- sales_relevant defaults true; Jim flips false to hide non-sales meetings
-- from the surface (still kept in DB so re-sync doesn't re-import them).
create table if not exists public.meetings (
  id                  uuid primary key default gen_random_uuid(),
  ms_event_id         text unique,
  subject             text,
  start_at            timestamptz not null,
  end_at              timestamptz,
  location            text,
  online_url          text,
  body_preview        text,
  attendees           jsonb not null default '[]'::jsonb,
  organisation_id     uuid references public.organisations(id) on delete set null,
  deal_id             uuid references public.deals(id) on delete set null,
  primary_contact_id  uuid references public.contacts(id) on delete set null,
  sales_relevant      boolean not null default true,
  brief               text,
  brief_generated_at  timestamptz,
  notes               text,
  transcript          text,
  status              text not null default 'upcoming',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists meetings_start_idx on public.meetings (start_at);
create index if not exists meetings_org_idx   on public.meetings (organisation_id);
create index if not exists meetings_deal_idx  on public.meetings (deal_id);

-- Microsoft OAuth tokens. PK is the Supabase auth user id so each operator
-- can connect their own calendar in future; today it's just Jim's row.
create table if not exists public.ms_oauth_tokens (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  access_token   text not null,
  refresh_token  text not null,
  expires_at     timestamptz not null,
  scope          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
