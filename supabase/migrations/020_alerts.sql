-- Migration 020: contact-level alerts.
--
-- An "alert" is something noteworthy about a specific company / contact —
-- a press mention, a new blog post, a hiring spree, a regulatory filing —
-- something Jim wants to know about so he can reach out. Distinct from
-- sector-level press signals (which power outreach generation): alerts
-- are ALWAYS tied to a specific org you already have on file.
--
-- Sources today: press feed matches on org name, enrichment runs that
-- surface fresh posts. Later: hiring signal, funding rounds, etc.
--
-- dismissed_at = the operator marked it as actioned/irrelevant.
-- kind        = "press" | "post" | "hiring" | … (free-text, filterable)

create table if not exists public.alerts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id) on delete cascade,
  contact_id      uuid references public.contacts(id)      on delete set null,
  owner_id        uuid references auth.users(id)           on delete set null,
  kind            text not null,
  title           text not null,
  link            text,
  summary         text,
  source          text,
  ts              timestamptz not null default now(),
  dismissed_at    timestamptz,
  dedup_key       text unique               -- ensures we never log the same alert twice
);
create index if not exists alerts_org_idx        on public.alerts (organisation_id);
create index if not exists alerts_owner_idx      on public.alerts (owner_id);
create index if not exists alerts_active_ts_idx  on public.alerts (ts desc) where dismissed_at is null;

-- Alerts inherit ownership from the linked organisation at write time, so
-- the per-user filter on /alerts uses the same plumbing as everything else.
