-- Hybrid outreach send log for HubSpot-sourced contacts (P5 mailer).
--
-- HubSpot is the contact system of record; this table is the FAST LOCAL
-- metrics + cadence store, keyed by the HubSpot contact id (text, not a FK —
-- the contact lives in HubSpot, not Supabase). It lets the mailer answer
-- "who've we emailed, when, and did it land" without hammering HubSpot search.
--
-- Suppression is NOT duplicated here — it stays in public.suppressions
-- (email-keyed) and is shared with the existing Supabase mailer, so a bounce
-- or unsubscribe from either path protects both.

create table if not exists public.hs_sends (
  id                  uuid primary key default gen_random_uuid(),
  hs_contact_id       text not null,            -- HubSpot contact id
  email               text not null,
  campaign            text,                     -- campaign / segment label
  subject             text,
  body_html           text,
  body_text           text,
  status              text not null default 'queued',  -- queued|approved|sent|suppressed|failed|skipped
  postmark_message_id text,
  clicked             boolean not null default false,
  replied             boolean not null default false,
  bounced             boolean not null default false,
  owner_id            uuid,                     -- operator (auth.users) for scoping
  error               text,
  ts                  timestamptz not null default now(),
  sent_at             timestamptz
);

create index if not exists hs_sends_contact_idx on public.hs_sends (hs_contact_id);
create index if not exists hs_sends_status_idx  on public.hs_sends (status);
create index if not exists hs_sends_campaign_idx on public.hs_sends (campaign);
create index if not exists hs_sends_sent_idx    on public.hs_sends (sent_at desc) where status = 'sent';
create index if not exists hs_sends_email_idx   on public.hs_sends (lower(email));
create index if not exists hs_sends_pmid_idx    on public.hs_sends (postmark_message_id);
