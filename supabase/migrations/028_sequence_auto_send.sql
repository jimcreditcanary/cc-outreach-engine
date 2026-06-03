-- Migration 028: per-sequence "review before send" toggle.
--
-- Default true (auto-send) keeps the existing automated behaviour.
-- Flip false on a sequence to have its AI-generated emails land in
-- /queue as 'queued' so the operator can edit + approve each one
-- before it ships. Useful for high-stakes campaigns or brand-new
-- voice templates you want to eyeball first.

alter table public.sequences
  add column if not exists auto_send boolean not null default true;
