-- Monthly newsletter — separate from 1:1 outreach.
-- contacts.newsletter_subscribed = opt-in flag (Jim toggles per contact;
--   a recipient who hits /unsubscribe clears this too).
-- newsletters = each issue (draft → sent), bodies stored as text + html,
--   with the recipient count tracked once sent.

alter table public.contacts add column if not exists newsletter_subscribed boolean not null default false;

create table if not exists public.newsletters (
  id          uuid primary key default gen_random_uuid(),
  subject     text not null,
  body_text   text not null default '',
  body_html   text not null default '',
  status      text not null default 'draft',  -- 'draft' | 'sent'
  sent_at     timestamptz,
  sent_count  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
