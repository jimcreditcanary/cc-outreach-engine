-- ─── Credit Canary Outreach Engine — initial schema ────────────────
--
-- Two halves (build prompt §4):
--   1. The imported spine — organisations / contacts / deals — upserted
--      from Pipedrive CSV/xlsx exports. These mirror the CRM and are the
--      authoritative record of who-is-who.
--   2. Engine-owned tables — events / content_assets / sends /
--      suppressions — written by the machine as it runs.
--
-- Modelled cleanly because Supabase is the foundation of a future
-- "company brain": prefer explicit columns + enums over loose jsonb so
-- schema drift fails loudly and the timeline (events) stays queryable.

-- ── Enums ───────────────────────────────────────────────────────────

create type sector as enum (
  'bank', 'broker', 'building_society', 'credit_union',
  'direct_lender', 'marketplace', 'sme_lender', 'utility'
);

create type email_status as enum ('unverified', 'valid', 'bounced');

create type deal_status as enum ('open', 'won', 'lost');

-- Append-only event timeline. 'open' is deliberately absent: opens are
-- never an engine signal (§6 — Apple/Gmail prefetch makes them noise).
create type event_type as enum (
  'press', 'linkedin_note', 'content_sent', 'email_sent',
  'click', 'reply', 'bounce', 'complaint', 'snooze', 'promote'
);

create type content_type as enum (
  'case_study', 'article', 'module', 'data_product'
);

-- A send moves queued → approved → sent (or failed/suppressed). The
-- approval queue (build decision §14) holds drafts at 'queued' until Jim
-- approves; warmed segments can be auto-approved later.
create type send_status as enum (
  'queued', 'approved', 'sent', 'failed', 'suppressed'
);

create type suppression_reason as enum (
  'unsubscribe', 'hard_bounce', 'complaint', 'manual'
);

-- ── organisations ───────────────────────────────────────────────────

create table public.organisations (
  id              uuid primary key default gen_random_uuid(),
  -- Upsert key from Pipedrive. Nullable: some exports omit the numeric
  -- id, in which case the importer falls back to a natural key (name).
  pipedrive_org_id  bigint unique,
  name            text not null,
  sector          sector,
  location        text,
  website         text,
  top_line_notes  text,
  -- Derived + cached on import (§5), never hand-tagged. NULL until first
  -- tier derivation runs.
  tier            smallint check (tier in (1, 2, 3)),
  -- Partners are excluded from outreach entirely (§12).
  is_partner      boolean not null default false,
  last_signal_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index organisations_name_key
  on public.organisations (lower(name))
  where pipedrive_org_id is null;

create index organisations_tier_idx on public.organisations (tier);
create index organisations_sector_idx on public.organisations (sector);

-- ── contacts ────────────────────────────────────────────────────────

create table public.contacts (
  id                  uuid primary key default gen_random_uuid(),
  pipedrive_person_id bigint unique,
  organisation_id     uuid references public.organisations(id) on delete set null,
  full_name           text,
  email               text,
  email_status        email_status not null default 'unverified',
  job_title           text,
  linkedin_url        text,
  linkedin_connected  boolean not null default false,
  -- The named stakeholder on the org's hottest deal gets the bespoke
  -- variant; secondary contacts get a lighter touch (§6 cap 4).
  is_deal_stakeholder boolean not null default false,
  last_touched_at     timestamptz,
  -- Honoured by the cadence engine; resurfaces after this date (§6).
  snooze_until        timestamptz,
  total_touches       integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index contacts_organisation_idx on public.contacts (organisation_id);
create index contacts_email_idx on public.contacts (lower(email));
create index contacts_snooze_idx on public.contacts (snooze_until);

-- ── deals ───────────────────────────────────────────────────────────

create table public.deals (
  id                 uuid primary key default gen_random_uuid(),
  pipedrive_deal_id  bigint unique,
  organisation_id    uuid references public.organisations(id) on delete cascade,
  primary_contact_id uuid references public.contacts(id) on delete set null,
  title              text,
  status             deal_status not null default 'open',
  stage              text,
  -- The tier driver (§5): a deal with a proposal is T1 (open) or T2
  -- (closed/stale); without one the org is T3 nurture.
  proposal_exists    boolean not null default false,
  proposal_text      text,
  value              numeric,
  lost_reason        text,

  -- MEDDICC layer (§5 / §8). Each component: text + a 'filled' flag the
  -- Anthropic seeding pass sets so the engine can find the single
  -- biggest gap and surface one next-best-action.
  meddicc_metrics              text,
  meddicc_metrics_filled       boolean not null default false,
  meddicc_economic_buyer       text,
  meddicc_economic_buyer_filled boolean not null default false,
  meddicc_decision_criteria    text,
  meddicc_decision_criteria_filled boolean not null default false,
  meddicc_decision_process     text,
  meddicc_decision_process_filled boolean not null default false,
  meddicc_identified_pain      text,
  meddicc_identified_pain_filled boolean not null default false,
  meddicc_champion             text,
  meddicc_champion_filled      boolean not null default false,
  meddicc_competition          text,
  meddicc_competition_filled   boolean not null default false,

  next_best_action   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index deals_organisation_idx on public.deals (organisation_id);
create index deals_status_idx on public.deals (status);

-- ── events — the brain's timeline (append-only) ─────────────────────

create table public.events (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid references public.contacts(id) on delete cascade,
  organisation_id uuid references public.organisations(id) on delete cascade,
  type            event_type not null,
  payload         jsonb not null default '{}'::jsonb,
  source          text,
  ts              timestamptz not null default now()
);

create index events_contact_idx on public.events (contact_id, ts desc);
create index events_org_idx on public.events (organisation_id, ts desc);
create index events_type_idx on public.events (type, ts desc);

-- ── content_assets — crawled from creditcanary.co.uk ────────────────

create table public.content_assets (
  id            uuid primary key default gen_random_uuid(),
  url           text not null unique,
  title         text,
  type          content_type,
  -- Targeting-map facets used to match an asset to a contact's lane (§6).
  tags_sector   text[] not null default '{}',
  tags_problem  text[] not null default '{}',
  tags_module   text[] not null default '{}',
  published_at  timestamptz,
  crawled_at    timestamptz not null default now()
);

-- ── sends — one row per touch ───────────────────────────────────────

create table public.sends (
  id                  uuid primary key default gen_random_uuid(),
  contact_id          uuid not null references public.contacts(id) on delete cascade,
  angle               text,
  asset_id            uuid references public.content_assets(id) on delete set null,
  subject             text,
  body_html           text,
  body_text           text,
  postmark_message_id text,
  status              send_status not null default 'queued',
  opened              boolean not null default false,
  clicked             boolean not null default false,
  replied             boolean not null default false,
  ts                  timestamptz not null default now()
);

create index sends_contact_idx on public.sends (contact_id, ts desc);
create index sends_status_idx on public.sends (status);
create unique index sends_postmark_message_id_key
  on public.sends (postmark_message_id)
  where postmark_message_id is not null;

-- ── suppressions — hard do-not-contact (§12) ────────────────────────

create table public.suppressions (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  reason      suppression_reason not null,
  contact_id  uuid references public.contacts(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);

create unique index suppressions_email_key on public.suppressions (lower(email));

-- ── updated_at touch trigger ────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organisations_touch before update on public.organisations
  for each row execute function public.touch_updated_at();
create trigger contacts_touch before update on public.contacts
  for each row execute function public.touch_updated_at();
create trigger deals_touch before update on public.deals
  for each row execute function public.touch_updated_at();
