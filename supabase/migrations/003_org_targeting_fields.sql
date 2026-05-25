-- ─── organisation targeting fields ──────────────────────────────────
--
-- The real CRM segments organisations on richer dimensions than the
-- sector enum alone. These are the inputs the targeting engine (§6) and
-- the daily prioritisation lean on, so capture them rather than discard:
--
--   icp                   — Ideal Customer Profile flag (Yes/No). The
--                           single strongest prioritisation signal.
--   customer_category     — Retail / SME (top-level segment).
--   customer_sub_category — Loans / Mortgages / Credit Cards / BNPL /
--                           DCA / Broker / P2P ... (product lane).
--   industry              — raw lender-type text (Banks, Building
--                           Society, Credit Union, Auto Finance, ...);
--                           `sector` is the cleaned enum derived from it.
--   partner_category      — set when the org is a partner; drives
--                           is_partner (§12 — excluded from outreach).

alter table public.organisations
  add column icp                   boolean,
  add column customer_category     text,
  add column customer_sub_category text,
  add column industry              text,
  add column partner_category      text;

create index organisations_icp_idx on public.organisations (icp);
