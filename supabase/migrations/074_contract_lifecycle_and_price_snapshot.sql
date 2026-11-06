-- Phase 4 — contract lifecycle (L1) + line-level price snapshot (L2/L3).
--
-- Jim applies migrations. The code degrades gracefully until this is applied:
--   • account reads fall back to the pre-074 column set;
--   • the invoice run reads the LIVE catalogue when an item has no snapshot;
--   • the notice nudge falls back to (contract_end_date − notice_period_days)
--     when renewal_decision_date is null.
-- Idempotent (add-column-if-not-exists, create-index-if-not-exists); re-running
-- also refreshes the PostgREST schema cache.

-- ── L1: contract-lifecycle fields on billing_accounts ────────────────────────
-- Notice moves from DAYS (notice_period_days, kept for back-compat) to MONTHS.
alter table public.billing_accounts
  add column if not exists term_months   integer,
  add column if not exists auto_renew     boolean not null default true,
  add column if not exists break_months   integer,
  add column if not exists notice_months  integer;

-- Natural end of the committed term, and the date by which notice must be given
-- to avoid auto-renewal (= term end − notice). GENERATED + STORED so they stay
-- correct even when the base dates are edited directly in SQL, and so the daily
-- notice nudge can filter on renewal_decision_date. Null until a term is set.
alter table public.billing_accounts
  add column if not exists term_end_date date
    generated always as (
      case when term_months is null then null
           else (contract_start_date + make_interval(months => term_months))::date end
    ) stored;
alter table public.billing_accounts
  add column if not exists renewal_decision_date date
    generated always as (
      case when term_months is null then null
           else (contract_start_date + make_interval(months => term_months)
                 - make_interval(months => coalesce(notice_months, 0)))::date end
    ) stored;

create index if not exists billing_accounts_renewal_idx
  on public.billing_accounts (renewal_decision_date)
  where renewal_decision_date is not null;

-- status gains 'draft' and 'ended' — enforced in the app via ACCOUNT_STATUSES;
-- the column is free text so no constraint change is required.

-- ── L2/L3: line-level price snapshot on billing_items ────────────────────────
-- At activation each item's RESOLVED pricing (metric, VAT, bands, merged config,
-- band mode, product group, catalogue version) is frozen into priced_snapshot;
-- the invoice run reads that instead of the live catalogue, so an in-place band
-- edit never reprices a live contract. A super-admin "re-sync from catalogue"
-- refreshes it and bumps pricing_snapshot_version (supersede). Invoices already
-- raised are unaffected — they were computed from the snapshot then in force.
alter table public.billing_items
  add column if not exists priced_snapshot          jsonb,
  add column if not exists priced_at                timestamptz,
  add column if not exists pricing_snapshot_version integer not null default 0;
