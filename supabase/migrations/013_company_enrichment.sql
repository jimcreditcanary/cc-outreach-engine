-- Per-company enrichment: a short AI-written summary of what they actually do
-- (scraped from their own website) + their last few RSS / blog posts. Both
-- surfaced on the company page and threaded into the draft generator so
-- outreach references real recent activity, not stale assumptions.
alter table public.organisations add column if not exists company_summary text;
alter table public.organisations add column if not exists recent_posts    jsonb not null default '[]'::jsonb;
alter table public.organisations add column if not exists enriched_at     timestamptz;
