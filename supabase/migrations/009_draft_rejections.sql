-- Capture WHY a draft was rejected, with a snapshot of the draft. This is the
-- training signal for the style-learning loop (rejections + the reasons feed
-- the next voice-spec refresh). The send row itself is deleted on reject so
-- the queue stays clean.
create table if not exists public.draft_rejections (
  id         uuid primary key default gen_random_uuid(),
  send_id    uuid,
  contact_id uuid references public.contacts(id) on delete set null,
  subject    text,
  body_text  text,
  angle      text,
  reason     text not null,
  note       text,
  ts         timestamptz not null default now()
);
