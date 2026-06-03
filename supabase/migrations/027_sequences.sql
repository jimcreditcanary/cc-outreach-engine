-- Migration 027: Sequences — automated multi-step outreach cadences.
--
-- A sequence runs every contact added to it through a fixed 13-day cadence
-- (defined in src/lib/sequences/steps.ts) that mixes email, LinkedIn and
-- call steps. Email steps auto-generate AI drafts into the existing /queue
-- approval flow. Non-email steps surface as actions for the operator to
-- mark done.
--
-- Tables:
--   sequences           — one per campaign. name + status + owner.
--   sequence_contacts   — per-contact state inside a sequence. Tracks
--                          current_step, started_at, last advance, and the
--                          per-contact outcome (active/replied/done).
--   sequence_actions    — the to-do items the operator sees. One row per
--                          (contact, step). Email steps are auto-marked
--                          done when their generated send goes out.
--
-- All three carry owner_id so the existing per-user filter pattern works
-- on /sequences out of the box.

create table if not exists public.sequences (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  status      text not null default 'live',  -- 'live' | 'paused' | 'complete'
  owner_id    uuid references auth.users(id) on delete set null,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists sequences_owner_idx on public.sequences (owner_id);
create index if not exists sequences_status_idx on public.sequences (status);

create table if not exists public.sequence_contacts (
  sequence_id   uuid not null references public.sequences(id) on delete cascade,
  contact_id    uuid not null references public.contacts(id)  on delete cascade,
  current_step  int  not null default 0,         -- 0-indexed into SEQUENCE_STEPS
  started_at    timestamptz not null default now(),
  last_advanced_at timestamptz,
  status        text not null default 'active',  -- 'active' | 'replied' | 'completed' | 'opted_out' | 'bounced'
  added_by      uuid references auth.users(id) on delete set null,
  primary key (sequence_id, contact_id)
);
create index if not exists sequence_contacts_status_idx on public.sequence_contacts (status);
create index if not exists sequence_contacts_contact_idx on public.sequence_contacts (contact_id);

create table if not exists public.sequence_actions (
  id            uuid primary key default gen_random_uuid(),
  sequence_id   uuid not null references public.sequences(id) on delete cascade,
  contact_id    uuid not null references public.contacts(id)  on delete cascade,
  step_index    int  not null,
  kind          text not null,                   -- matches SEQUENCE_STEPS[i].kind
  due_at        timestamptz not null default now(),
  status        text not null default 'pending', -- 'pending' | 'done' | 'skipped'
  send_id       uuid references public.sends(id) on delete set null, -- email steps only
  completed_at  timestamptz,
  completed_by  uuid references auth.users(id) on delete set null,
  owner_id      uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (sequence_id, contact_id, step_index)
);
create index if not exists sequence_actions_pending_idx on public.sequence_actions (owner_id, due_at)
  where status = 'pending';
create index if not exists sequence_actions_send_idx on public.sequence_actions (send_id)
  where send_id is not null;

-- For the reply hook: link a send back to its sequence_contact via a column
-- on sends so the Postmark webhook can find it. Nullable + indexed.
alter table public.sends add column if not exists sequence_id uuid references public.sequences(id) on delete set null;
create index if not exists sends_sequence_idx on public.sends (sequence_id) where sequence_id is not null;
