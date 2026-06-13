-- Lead capture from external forms (whitepaper downloads, gated content,
-- "talk to us" on creditcanary.co.uk) via POST /api/leads + the /enquire
-- landing page.
--
-- Two new contact columns:
--   status      — 'new' for a freshly-captured lead so operators see it
--                 instantly on /contacts; NULL for established CRM contacts.
--                 Operators clear it ('engaged') once they've actioned it.
--   lead_source — where the contact ORIGINALLY came from ('whitepaper',
--                 'website', 'linkedin', …). Set once, never overwritten,
--                 so re-downloads don't rewrite provenance.
--
-- A dedicated 'lead' event type keeps inbound activity (downloads, form
-- fills) distinct from CRM edits in the timeline and makes it filterable.
-- The API degrades gracefully if this migration hasn't run yet (falls back
-- to writing without status/lead_source and using the crm_change type), so
-- deploys never block on the migration — but run it to light the feature up.

alter table public.contacts
  add column if not exists status text,
  add column if not exists lead_source text;

create index if not exists contacts_status_idx on public.contacts (status);

alter type event_type add value if not exists 'lead';
