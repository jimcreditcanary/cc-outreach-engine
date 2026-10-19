-- GA4 high-intent dedup: one row per contact recording the last time we raised a
-- high-intent task from their site visits, so the ingestion doesn't re-task the
-- same person every run.

create table if not exists public.intent_signals (
  hs_contact_id text primary key,
  pageviews     int,
  window_days   int,
  tasked_at     timestamptz,
  updated_at    timestamptz not null default now()
);
