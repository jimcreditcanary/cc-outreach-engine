-- Outreach workflow dispositions: when an operator discards a drafted email in
-- the Workflow, they record WHY and WHAT happens to the contact — disqualify
-- (hard, never contact), remove from the workflow (stop auto-drafting, still a
-- lead), or snooze until a date X months out (re-enters outreach after). Keyed
-- by HubSpot contact id (the workflow is HubSpot-backed). Append-only audit;
-- the draft workflow reads the latest active disposition per contact to decide
-- who to skip. Local-only; disqualify additionally writes a suppressions row so
-- every send path honours it. RLS deny-all; all access via serviceClient().

create table if not exists public.outreach_dispositions (
  id            uuid primary key default gen_random_uuid(),
  hs_contact_id text not null,
  email         text,
  disposition   text not null check (disposition in ('disqualified', 'removed', 'snoozed')),
  reason        text,
  snooze_until  timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists outreach_dispositions_contact_idx on public.outreach_dispositions (hs_contact_id);
create index if not exists outreach_dispositions_snooze_idx on public.outreach_dispositions (snooze_until) where snooze_until is not null;
alter table public.outreach_dispositions enable row level security;

notify pgrst, 'reload schema';
