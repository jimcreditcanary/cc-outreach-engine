-- Per-draft metadata for the outreach workflow: research confidence, the CC
-- page the drafter chose, the contact's name, and the internal angle — so the
-- review UI can show why each draft says what it says. Additive; null for rows
-- created before the workflow (e.g. flat template campaigns).

alter table public.hs_sends add column if not exists meta jsonb;
