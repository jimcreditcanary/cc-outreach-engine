-- Migration 025: LinkedIn re-engage cooldown.
--
-- Once an operator has touched a contact on /linkedin (request sent,
-- marked-as-already-connected, or re-engage hook), don't surface them
-- again for at least 30 days. Without this the queue keeps re-suggesting
-- people you spoke to yesterday.
--
-- Tracked on a dedicated column rather than re-using contacts.last_touched_at
-- (which is used by the email cadence logic) — keeps the two channels
-- independently pace-able.

alter table public.contacts
  add column if not exists linkedin_last_touched_at timestamptz;

create index if not exists contacts_linkedin_last_touched_idx
  on public.contacts (linkedin_last_touched_at desc nulls first);

-- Backfill from existing linkedin_note events so already-touched contacts
-- inherit the cooldown immediately instead of all re-appearing on next load.
update public.contacts c
   set linkedin_last_touched_at = e.last_ts
  from (
    select contact_id, max(ts) as last_ts
      from public.events
     where type = 'linkedin_note'
       and contact_id is not null
     group by contact_id
  ) e
 where e.contact_id = c.id
   and c.linkedin_last_touched_at is null;
