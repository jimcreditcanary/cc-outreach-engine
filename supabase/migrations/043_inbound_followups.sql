-- Inbound follow-up queue. Lead capture (download/enquiry/abandonment) enqueues
-- a lightweight 'pending' row so the API stays fast; a job then researches +
-- drafts a personalised, event-aware follow-up into hs_sends for review. Keyed
-- by the HubSpot contact id (hybrid).

create table if not exists public.inbound_followups (
  id            uuid primary key default gen_random_uuid(),
  hs_contact_id text not null,
  kind          text not null,            -- download | enquiry | abandonment | booking
  asset         text,                     -- what they engaged with (whitepaper, page…)
  page          text,                     -- the URL, if known
  status        text not null default 'pending',  -- pending | drafted | skipped
  owner_id      uuid,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);
create index if not exists inbound_followups_status_idx  on public.inbound_followups (status, created_at);
create index if not exists inbound_followups_contact_idx on public.inbound_followups (hs_contact_id);
