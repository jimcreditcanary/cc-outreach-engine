-- Map each veepveep operator to their HubSpot owner id, so deal-nurture,
-- follow-up tasks and (later) deal scoping act on *their* deals rather than a
-- single default owner. Set per user in Settings; falls back to
-- HUBSPOT_LEAD_OWNER_ID when unset.

alter table public.user_settings add column if not exists hubspot_owner_id text;
