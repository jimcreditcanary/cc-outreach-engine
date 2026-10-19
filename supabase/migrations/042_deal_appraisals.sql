-- MEDDICC appraisals for the weekly deal-nurture workflow. Keyed by the HubSpot
-- deal id (deals live in HubSpot; this is the hybrid operational store). Each
-- run appraises a deal and records the inputs + the recommended next action;
-- the nurture email that follows is queued into hs_sends like any other draft.

create table if not exists public.deal_appraisals (
  id               uuid primary key default gen_random_uuid(),
  hs_deal_id       text not null,
  owner_id         uuid,                 -- operator (auth.users) for scoping
  meddicc          jsonb,                -- { metrics, economic_buyer, decision_criteria, decision_process, identified_pain, champion, competition }
  summary          text,
  biggest_gap      text,
  next_best_action text,
  created_at       timestamptz not null default now()
);
create index if not exists deal_appraisals_deal_idx    on public.deal_appraisals (hs_deal_id);
create index if not exists deal_appraisals_created_idx on public.deal_appraisals (created_at desc);
