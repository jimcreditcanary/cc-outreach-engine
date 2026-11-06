-- Fix L1: make renewal_decision_date a GENERATED column.
--
-- Migration 063 had already added billing_accounts.renewal_decision_date as a
-- plain nullable date, so 074's `add column if not exists … generated` was a
-- no-op and the column stayed un-computed (always null). That silently made the
-- daily notice nudge fall back to the legacy (contract_end_date − notice_days)
-- path instead of being keyed to the computed date. Postgres can't convert a
-- plain column to GENERATED in place, so drop + re-add. The column is only ever
-- read (never written), so no data is lost. Idempotent-ish: safe to re-run.

-- Drop the plain column (this also drops 074's index that referenced it).
alter table public.billing_accounts drop column if exists renewal_decision_date;

-- Re-add it as generated (term end − notice), matching term_end_date.
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
