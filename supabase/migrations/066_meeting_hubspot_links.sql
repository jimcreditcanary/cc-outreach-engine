-- Meetings can now be linked to live HubSpot company / contact / deal records
-- (the picker on the meeting page searches HubSpot). We store the HubSpot id
-- plus a name snapshot so the list + detail render the label without a runtime
-- HubSpot lookup. The existing Supabase organisation_id / primary_contact_id /
-- deal_id columns are left intact — they still drive the AI briefs and the
-- MEDDICC re-seed (that re-key is a separate, later piece). Idempotent.

alter table public.meetings
  add column if not exists hs_company_id   text,
  add column if not exists hs_company_name text,
  add column if not exists hs_contact_id   text,
  add column if not exists hs_contact_name text,
  add column if not exists hs_deal_id      text,
  add column if not exists hs_deal_name    text;

notify pgrst, 'reload schema';
