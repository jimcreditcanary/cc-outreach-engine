# Billing — go-live checklist

Everything below runs on **mocks/placeholders** until these are done, so the
pipeline is safe to exercise beforehand.

## Database (run in the Supabase SQL editor, in order)
- [ ] `058_billing_core.sql` — catalogue, accounts, items, role column
- [ ] `059_billing_setup.sql` — PO number, audit log, key reveals
- [ ] `060_billing_usage.sql` — usage records
- [ ] `061_billing_invoices.sql` — invoice runs, invoices, lines
- [ ] `npm run billing-seed-pricing` (after 058) — seeds PLACEHOLDER pricing
- [ ] Make yourself super-admin: `update public.user_settings set role='super_admin' where user_id='<your-auth-uuid>';`

## Pricing + VAT (super-admin, `/admin/pricing`)
- [ ] Replace every **PLACEHOLDER** price/band with the real figures
- [ ] **Confirm VAT treatments with finance** — payment rails default exempt,
      the rest standard 20%; all editable per item
- [ ] Un-tick "Placeholder price" once confirmed

## Xero (Phase 4)
- [ ] Create a **Custom Connection** in Xero scoped to the Credit Canary org
      (scopes: `accounting.contacts accounting.transactions`)
- [ ] Set `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_TENANT_ID` in Vercel
- [ ] Set `XERO_AUTO_APPROVE_FROM=2026-12-01` (DRAFT before, AUTHORISED + emailed
      on/after)
- [ ] Connect the **HSBCnet → Xero bank feed** *inside Xero* (bank-feed config,
      not code) so payments reconcile for dunning

## Ops
- [ ] Confirm `CRON_SECRET` is set in Vercel (reused by the usage/contract-status
      APIs and every billing cron); rotate it if needed
- [ ] Crons live in `vercel.json`: `billing-run` (`0 6 1 * *`) + retry
      (`0 18 1 * *`), `billing-nudge` (weekly), `billing-reconcile` (daily)
- [ ] Issue each merchant their **usage API keys** from the setup wizard
      (shown once on activation) and document in `docs/billing-api.md`

## Notes
- The invoice engine (`src/lib/billing/engine.ts`) is pure + deterministic:
  every figure is reproducible from stored pricing versions + usage + config.
- Money is integer **pence** everywhere; formatted only at the edge.
- The monthly run is **idempotent** per (account, period) — re-running never
  double-invoices.
