-- Add a mobile/phone number to contacts (Pipedrive carried phones in raw;
-- this promotes it to a first-class, editable field for the CRM).
alter table public.contacts add column if not exists mobile text;
