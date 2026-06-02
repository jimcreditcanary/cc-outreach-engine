-- Migration 024: separate "connection request sent" from "already connected".
--
-- Previously linkedin_connected meant both "request sent" and "we have a
-- 1st-degree connection" — operators couldn't distinguish the two, and
-- 1st-degree contacts fell out of /linkedin forever instead of resurfacing
-- for re-engagement (drop-a-new-hook).
--
-- Split:
--   linkedin_request_sent_at  → when we sent the request. Counts toward
--                               the daily 15/day connection-request cap.
--   linkedin_connected        → kept; now means "we are 1st-degree". Used
--                               to surface for periodic re-hooking.

alter table public.contacts
  add column if not exists linkedin_request_sent_at timestamptz;

create index if not exists contacts_linkedin_request_sent_idx
  on public.contacts (linkedin_request_sent_at desc nulls last)
  where linkedin_request_sent_at is not null;
