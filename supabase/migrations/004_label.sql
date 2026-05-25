-- ─── CRM label (Lead / Prospect) ────────────────────────────────────
--
-- Jim's hand-curated qualification label from Pipedrive. "Prospect" is
-- the warmer, actively-qualified set; "Lead" the wider pool. Drives
-- prioritisation in the daily surface (§10) — Prospects surface first.
-- Stored as free text (labels evolve) on both orgs and contacts.

alter table public.organisations add column label text;
alter table public.contacts      add column label text;

create index organisations_label_idx on public.organisations (label);
create index contacts_label_idx      on public.contacts (label);
