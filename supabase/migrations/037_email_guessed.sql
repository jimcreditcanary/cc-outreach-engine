-- Marker for emails inferred from a company's address convention (the
-- scripts/guess-emails.ts pass) rather than known/verified. Lets the UI flag
-- them and keeps them OUT of automated outreach until a human verifies — a
-- guessed address that bounces hurts sender reputation.

alter table public.contacts
  add column if not exists email_guessed boolean not null default false;

-- Partial index: we only ever query for the guessed ones.
create index if not exists contacts_email_guessed_idx
  on public.contacts (email_guessed) where email_guessed;
