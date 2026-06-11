-- Google Calendar sync via the per-user "secret address in iCal format".
-- Same shape as the Granola integration: the operator pastes a private
-- credential (here a capability URL) into the app, a cron pulls on a
-- schedule, and rows land in `meetings` with owner_id stamped.
--
--   user_settings.google_ics_url — the secret basic.ics URL. Treated like
--     an API token: server-side only, never rendered back to the browser.
--   meetings.google_event_uid    — per-occurrence dedup key. ICS UIDs are
--     NOT mailbox-unique (unlike ms_event_id): two operators invited to
--     the same Google event share a UID. So uniqueness is per owner, and
--     recurring occurrences get "<uid>:<startISO>" suffixed keys.
--
-- The unique index is non-partial on purpose: Postgres treats NULLs as
-- distinct, so the existing Outlook rows (google_event_uid null) never
-- collide, and PostgREST upsert onConflict can infer the index.

alter table public.user_settings
  add column if not exists google_ics_url text;

alter table public.meetings
  add column if not exists google_event_uid text;

create unique index if not exists meetings_google_uid_owner_uidx
  on public.meetings (owner_id, google_event_uid);
