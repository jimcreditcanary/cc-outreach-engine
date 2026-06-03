-- Migration 029: per-sequence theme + optional conference link.
--
-- theme        — free-text context the AI injects into every drafted email
--                in this sequence. e.g. "Money 2020 Vegas attendees —
--                lead with the cost-of-living theme + cite our case study."
-- conference_id — optional FK to conferences. When set, the sequence's
--                contacts are visually tied to the event so the operator
--                can see "Sequence for Money 2020" at a glance.

alter table public.sequences
  add column if not exists theme text,
  add column if not exists conference_id uuid references public.conferences(id) on delete set null;

create index if not exists sequences_conference_idx
  on public.sequences (conference_id) where conference_id is not null;
