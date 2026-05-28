-- CRM activity logging: every create/update/delete/merge across contacts,
-- companies and deals appends an event so the timeline tells the full story.
-- Adds a generic 'crm_change' event type and a deal_id link (events already
-- carry contact_id + organisation_id).
alter type event_type add value if not exists 'crm_change';

alter table public.events add column if not exists deal_id uuid references public.deals(id) on delete cascade;
create index if not exists events_deal_idx on public.events (deal_id);
