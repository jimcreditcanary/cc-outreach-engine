-- Migration 019: round out multi-user.
--
-- 1. notes.owner_id — so deletions cascade-set-null + future filters work.
-- 2. meetings.post_summary — AI-generated post-meeting recap from a pasted
--    transcript / notes; separate from the pre-meeting brief.
-- 3. user_settings — per-operator outbound identity (FROM / Reply-To /
--    Postmark sender-signature id). Drives multi-user sending without
--    touching the env var defaults.

alter table public.notes add column if not exists owner_id uuid references auth.users(id) on delete set null;
create index if not exists notes_owner_idx on public.notes (owner_id);

alter table public.meetings
  add column if not exists post_summary              text,
  add column if not exists post_summary_generated_at timestamptz;

create table if not exists public.user_settings (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  from_email             text,         -- e.g. "Jim Fell <jim@mail.creditcanary.co.uk>"
  reply_to_email         text,         -- e.g. "jimfell@creditcanary.co.uk"
  postmark_signature_id  text,         -- Postmark sender signature id (optional, for future)
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Backfill notes.owner_id from the oldest auth user (today = Jim).
do $$
declare first_user uuid := (select id from auth.users order by created_at asc limit 1);
begin
  if first_user is not null then
    update public.notes set owner_id = first_user where owner_id is null;
  end if;
end $$;
