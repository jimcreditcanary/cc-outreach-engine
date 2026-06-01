-- Migration 022: which operators are attending a given conference.
--
-- When the team is on the ground at a conference, attendee uploads get
-- divided up round-robin BY COMPANY between the attending operators —
-- so every contact lands with a real human responsible for follow-up,
-- and no two operators end up chasing the same account.
--
-- Modelled as a join table (rather than a uuid[] column) so future
-- per-operator metadata (lead-count, sub-track, etc.) has somewhere to
-- live without another migration.

create table if not exists public.conference_operators (
  conference_id uuid not null references public.conferences(id) on delete cascade,
  user_id       uuid not null references auth.users(id)         on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (conference_id, user_id)
);
create index if not exists conference_operators_user_idx on public.conference_operators (user_id);
