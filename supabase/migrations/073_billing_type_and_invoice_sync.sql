-- Phase 3 billing: per-account invoice mode (X1) + persisted Xero status (X3).
--
-- X1 — billing_type: 'auto' raises the Xero invoice as AUTHORISED and emails it;
-- 'draft' raises it as DRAFT for manual review. The global XERO_AUTO_APPROVE_FROM
-- cutover still gates whether an 'auto' account actually authorises (safety), so
-- nothing auto-sends before go-live even when set to 'auto'.
alter table public.billing_accounts
  add column if not exists billing_type text not null default 'auto';  -- auto | draft

-- X3 — persist the Xero amount-due and the last sync time so the billing list and
-- the 15th chase read current figures without re-querying Xero each time.
alter table public.billing_invoices
  add column if not exists amount_due_pence integer,
  add column if not exists status_synced_at timestamptz;
