-- Migration 023: explicit "not on LinkedIn" flag for contacts.
--
-- The /linkedin "Needs research" surface currently shows every contact
-- without a linkedin_url. For some contacts there's nothing to research —
-- they're just not on LinkedIn. Mark them and they fall out of the queue
-- forever (until un-flagged on the contact detail page).
--
-- Kept separate from linkedin_connected (which means "we've sent a
-- connection request") so the state is honest: "no LI presence" is not
-- the same as "we connected".

alter table public.contacts add column if not exists not_on_linkedin boolean not null default false;
create index if not exists contacts_not_on_linkedin_idx on public.contacts (not_on_linkedin) where not_on_linkedin = true;
