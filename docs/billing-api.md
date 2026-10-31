# Billing API

Phase 3 of the billing agent. Three endpoints, all under `/api/billing`. Base
URL is the app origin (prod: `https://www.veepveep.co.uk`).

All money in request/response bodies that refers to pricing is in **pence**
(usage `value`/`principal` are the raw amounts you report, in your own units).

---

## POST /api/billing/usage

Report usage for **one billing item**. The bearer token is that item's usage
key (`ccb_…`), issued once when billing was activated. Each key authorises usage
for its single item only.

**Auth:** `Authorization: Bearer ccb_<item usage key>`

**Body:** a single record, or an array (batch, max 500):

```json
{
  "period_month": "2026-01",        // "YYYY-MM" or any date in the month → 1st
  "quantity": 1240,                  // required, ≥ 0
  "value": 95000,                    // optional — txn value, for % metrics
  "principal": 1500000,              // optional — loan principal (pct_of_principal)
  "application_outcome": "accepted", // optional — Monevo per-application outcome
  "idempotency_key": "jan-2026-tu-calls"  // required, globally unique
}
```

**Idempotency:** the first call with a given `idempotency_key` is `created`. A
repeat with the **same** payload is `duplicate` (no double-count). A repeat with
a **different** payload is a `conflict` and the whole response is `409`.

**Responses:** `200` (all created/duplicate), `409` (any conflict), `400`
(validation), `401` (bad/missing key). Body:

```json
{ "ok": true, "item": "tu_call_report", "results": [ { "idempotency_key": "jan-2026-tu-calls", "status": "created" } ] }
```

```bash
# single
curl -sS -X POST https://www.veepveep.co.uk/api/billing/usage \
  -H "Authorization: Bearer ccb_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"period_month":"2026-01","quantity":1240,"idempotency_key":"jan-2026-tu-calls"}'

# batch
curl -sS -X POST https://www.veepveep.co.uk/api/billing/usage \
  -H "Authorization: Bearer ccb_..." -H "Content-Type: application/json" \
  -d '[{"period_month":"2026-01","quantity":10,"idempotency_key":"a"},
       {"period_month":"2026-02","quantity":20,"idempotency_key":"b"}]'
```

---

## POST /api/billing/contract-status

Internal contract-status sink. Writes a `contract_status_event` and, for known
statuses, updates the billing account.

**Auth:** `Authorization: Bearer $CRON_SECRET`

**Body:**

```json
{ "account_id": "<uuid>", "status": "signed", "effective_at": "2026-01-10T00:00:00Z" }
```

- Identify the account by `account_id` **or** `hubspot_deal_id`.
- `status: "signed"` → stamps `contract_signed_at` (the invoice engine then bills
  the setup fee per the item's `billing_trigger`).
- `status` ∈ `active | notice_given | cancelled | disputed` → sets the account
  status (`cancelled` also stamps `contract_end_date`).

**Responses:** `200`, `400`, `401`, `404`.

```bash
curl -sS -X POST https://www.veepveep.co.uk/api/billing/contract-status \
  -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"hubspot_deal_id":"527446528212","status":"signed","effective_at":"2026-01-10"}'
```

---

## GET /api/billing/pricing/{item_type}

The current effective pricing table + bands for an item type. Internal.

**Auth:** `Authorization: Bearer $CRON_SECRET`

```bash
curl -sS https://www.veepveep.co.uk/api/billing/pricing/tu_call_report \
  -H "Authorization: Bearer $CRON_SECRET"
```

```json
{ "ok": true, "item_type": "tu_call_report",
  "table": { "id": "…", "metric": "per_request", "vat_treatment": "standard", "is_placeholder": true, "version": 1, "effective_from": "2026-10-30" },
  "bands": [ { "from_units": 0, "to_units": null, "unit_price_pence": 0, "minimum_type": "none", "minimum_pence": 0 } ] }
```

Item types are the 26 keys in `src/lib/billing/catalogue.ts`.
