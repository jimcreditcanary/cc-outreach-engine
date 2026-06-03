-- 031_granola.sql
--
-- Granola integration — pulls transcripts out of api.granola.ai every 15
-- minutes for any operator who's added their API token under /settings,
-- matches them to the meetings table by start_time + attendee email, fills
-- meetings.transcript, generates a post-meeting summary, and ships an
-- auto-generated follow-up email to the primary contact.
--
-- Fields:
--   meetings.granola_note_id          — the Granola side's note id, unique
--                                       so re-syncs don't double-up.
--   meetings.granola_synced_at        — last successful pull of THIS note.
--   meetings.granola_followup_send_id — fk to the sends row that contains
--                                       the auto-sent follow-up email.
--                                       NULL until we've drafted + sent.
--   user_settings.granola_api_token   — per-operator bearer token. Stored
--                                       in clear (env-grade secret); the
--                                       service role only — never to the
--                                       browser.

alter table public.meetings
  add column if not exists granola_note_id          text,
  add column if not exists granola_synced_at        timestamptz,
  add column if not exists granola_followup_send_id uuid references public.sends(id) on delete set null;

create unique index if not exists meetings_granola_note_id_uidx
  on public.meetings (granola_note_id)
  where granola_note_id is not null;

alter table public.user_settings
  add column if not exists granola_api_token text;
