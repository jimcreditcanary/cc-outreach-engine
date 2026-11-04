-- Phase 2 enrichment depth (B4–B6). Additive columns only — the app writes them
-- best-effort and reads them tolerantly, so it runs unchanged until this is applied.
--   • B4 incorporation certificate: the CH filing-history transaction id for the
--     incorporation filing, used to build a public "view document" link.
--   • B6 insolvency filings: the structured insolvency cases (type / dates /
--     practitioners) behind the existing has_insolvency_history flag.
--   • B5 two-year financials: current assets / liabilities / net current assets
--     for the latest + prior reported period (jsonb array, newest first).

alter table public.onboarding_company_snapshot
  add column if not exists incorporation_transaction_id text,
  add column if not exists insolvency_cases            jsonb;

alter table public.onboarding_accounts
  add column if not exists periods jsonb;  -- [{ period_end, current_assets, current_liabilities, net_current_assets }], newest first

notify pgrst, 'reload schema';
