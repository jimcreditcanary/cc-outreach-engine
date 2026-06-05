-- 033_contact_skip.sql
--
-- Soft-skip a contact from outreach surfaces (LinkedIn research/send
-- queue + sequence contact picker) without deleting them. Distinct from
-- `not_on_linkedin` (which only hides them from the LinkedIn queue) and
-- from `snooze_until` (which is a temporal pause that auto-clears).
--
-- The operator picks a reason from a short curated list at the moment
-- they skip — used for personal triage + later reporting on WHY
-- contacts get parked. Unskippable via the same UI.
--
-- skipped_at = null → contact is in active outreach population.
-- skipped_at != null → suppressed from queues until manually unskipped.

alter table public.contacts
  add column if not exists skip_reason text,
  add column if not exists skipped_at  timestamptz;

create index if not exists contacts_skipped_idx
  on public.contacts (skipped_at)
  where skipped_at is not null;
