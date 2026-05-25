-- ─── raw — full-fidelity capture of every imported field ────────────
--
-- The typed columns on each table hold the fields the engine reasons
-- over (tiering, targeting, sending). `raw` keeps the COMPLETE original
-- CRM row (keyed by its source header) so nothing from an import is ever
-- lost — every Pipedrive field is queryable via raw->>'Field Name', and
-- any field can later be promoted to a typed column without re-importing.
--
-- jsonb (not json) so it's indexable and dedupes keys.

alter table public.organisations add column raw jsonb not null default '{}'::jsonb;
alter table public.contacts      add column raw jsonb not null default '{}'::jsonb;
alter table public.deals         add column raw jsonb not null default '{}'::jsonb;
alter table public.notes         add column raw jsonb not null default '{}'::jsonb;
