-- 030_user_profile.sql
--
-- Per-operator display profile — first/last name + job title. Stored on
-- the existing user_settings row (one per auth user, cascade-delete) so
-- it lives outside the Supabase-managed auth.users table.
--
-- Used to render "Jim Fell" instead of "jim@creditcanary.co.uk" in every
-- owner picker / owner filter / reassign-ownership dropdown / event
-- attending-operators list / users admin page.
--
-- Backfill leaves the columns NULL — the auth helper falls back to the
-- email (or id) when a name isn't set yet.

alter table public.user_settings
  add column if not exists first_name text,
  add column if not exists last_name  text,
  add column if not exists job_title  text;
