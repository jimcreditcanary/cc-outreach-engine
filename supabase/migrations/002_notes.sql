-- ─── notes — CRM free-text context ──────────────────────────────────
--
-- Pipedrive notes attached to orgs / contacts / deals. This is reference
-- context (a corpus read per entity), not an engine signal — so it's its
-- own table rather than an event type. Feeds:
--   • T2 re-engagement ("what's changed since we last spoke", §6)
--   • MEDDICC seeding from free text (§5/§8)
--   • personalisation hooks (§7)
--
-- A note may link to any combination of org / contact / deal (Pipedrive
-- allows all three); all FKs are nullable. `content` is the only
-- required field.

create table public.notes (
  id                uuid primary key default gen_random_uuid(),
  pipedrive_note_id bigint unique,
  organisation_id   uuid references public.organisations(id) on delete cascade,
  contact_id        uuid references public.contacts(id) on delete set null,
  deal_id           uuid references public.deals(id) on delete set null,
  content           text not null,
  author            text,
  noted_at          timestamptz,
  created_at        timestamptz not null default now()
);

create index notes_organisation_idx on public.notes (organisation_id, noted_at desc);
create index notes_contact_idx on public.notes (contact_id, noted_at desc);
create index notes_deal_idx on public.notes (deal_id, noted_at desc);
