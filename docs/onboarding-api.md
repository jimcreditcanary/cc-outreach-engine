# Onboarding Export API

Read-only export of the onboarding "block" for external dev / provisioning
automation — the config you need to stand up a merchant's dev/sandbox setup once
they're onboarded. Three `GET` endpoints under `/api/onboarding`, plus an
approval **webhook**. Base URL is the app origin (prod:
`https://www.veepveep.co.uk`).

**Config only — no sensitive PII.** The payload is deliberately safe to hand to
a developer or pipe into another system:

- **Bank accounts** carry only the masked `account_tail` — never the full
  account number or sort code.
- **UBOs** carry `name` + declared `ownership_percent` only — no DOB, address,
  PEP status, or consent.
- The **merchant-form token** (the customer's form link) is never included.
- Uploads and generated documents are listed as **metadata only** (kind,
  filename, size, timestamps) — no file contents or URLs.

---

## Auth

A single shared key in the `ONBOARDING_API_KEY` env var, sent either way:

```
Authorization: Bearer <ONBOARDING_API_KEY>
# or
X-API-Key: <ONBOARDING_API_KEY>
```

- `503 { "error": "not_configured" }` — the key isn't set on the server yet.
- `401 { "error": "unauthorized" }` — missing or wrong key.

---

## GET /api/onboarding — customer directory

Lists onboarding customers and their IDs (the entry point: get a `case_id` /
`deal_id`, then fetch the block).

**Query:**

- `status` — `onboarded` (default; true customers), `all` (every non-cancelled
  case), or any specific case status (e.g. `in_review`).
- `deal_id` — shortcut: return one live case's **block** for a HubSpot deal id
  instead of the list (see the block shape below). `404 no_case_for_deal` if
  none.

Newest first, capped at 500.

```bash
curl -sS "https://www.veepveep.co.uk/api/onboarding?status=all" \
  -H "Authorization: Bearer $ONBOARDING_API_KEY"
```

**Response:**

```json
{
  "ok": true,
  "status": "all",
  "count": 2,
  "customers": [
    {
      "case_id": "7c1f…",
      "deal_id": "31520000001",      // HubSpot deal id (nullable)
      "company_id": "28140000050",   // HubSpot company id (nullable)
      "company_number": "06596920",  // Companies House number (nullable)
      "company_name": "Acme Ltd",
      "status": "onboarded",
      "product_groups": ["tu_credit", "open_banking_data"],
      "approved_at": "2026-11-04T09:12:00Z",
      "created_at": "2026-10-20T14:03:00Z",
      "updated_at": "2026-11-04T09:12:00Z"
    }
  ]
}
```

---

## GET /api/onboarding/{caseId} — one case's block

The full config-only block for a single case. `404 { "error": "not_found" }`
if the case is gone.

```bash
curl -sS "https://www.veepveep.co.uk/api/onboarding/7c1f…" \
  -H "Authorization: Bearer $ONBOARDING_API_KEY"
```

(The `?deal_id=` form of `GET /api/onboarding` returns the **same** block,
wrapped as `{ "ok": true, "case": { … } }`, keyed by HubSpot deal id instead of
`case_id`.)

**Response — `{ "ok": true, "case": <block> }`:**

```jsonc
{
  "case_id": "7c1f…",
  "deal_id": "31520000001",
  "company_id": "28140000050",
  "company_number": "06596920",
  "status": "onboarded",
  "product_groups": ["tu_credit", "open_banking_data"],
  "api_sandbox_required": true,
  "approved_at": "2026-11-04T09:12:00Z",
  "created_at": "2026-10-20T14:03:00Z",
  "updated_at": "2026-11-04T09:12:00Z",
  "submitted_at": "2026-11-01T18:40:00Z",   // when the merchant submitted the form

  "company": {                               // Companies House snapshot
    "name": "ACME LTD",
    "type": "ltd",
    "status": "active",
    "registered_office": { /* address object */ },
    "sic_codes": ["64999"]
  },

  "business": {                              // merchant-declared trading details
    "trading_name": "Acme",
    "trading_address": "…",
    "principal_office": "…",
    "phone": "…",
    "email": "ops@acme.example",
    "website": "https://acme.example",
    "socials": { /* { platform: url } */ }
  },

  "compliance": {
    "ico_number": "…",
    "fca_frn": "…",
    "vat_number": "…",
    "trade_body": "…",
    "privacy_policy_url": "…",
    "dpo": "…"                               // DPO name/contact as entered
  },

  "signatory": { "name": "…", "title": "…", "email": "…" },

  "ubos": [                                  // names + declared ownership ONLY
    { "name": "Jane Doe", "ownership_percent": 60 }
  ],
  "ubo_count": 1,

  "bank_accounts": [                         // masked tail ONLY
    {
      "purpose": "settlement",
      "account_name": "Acme Ltd",
      "bank_name": "HSBC",
      "account_tail": "6411",                // last 4 digits; no full number / sort code
      "cop_result": "match"
    }
  ],
  "direct_debit": null,                      // DD questionnaire block, or null

  "uploads": [                               // metadata only — no contents/URLs
    { "kind": "proof_of_address", "filename": "poa.pdf", "content_type": "application/pdf", "size_bytes": 182344, "created_at": "…" }
  ],
  "documents": [                             // generated docs — metadata only
    { "doc_kind": "merchant_onboarding_form", "filename": "Acme — Merchant Onboarding Form.docx", "generated_at": "…" }
  ]
}
```

---

## Webhook — `onboarding.approved`

When a case is **approved**, the app POSTs the same config-only block to a
configured endpoint (best-effort — a webhook failure never blocks the approval).

- **URL / secret:** set in **Settings → Onboarding export API** (stored in
  `app_settings`), which takes precedence over the `ONBOARDING_WEBHOOK_URL` /
  `ONBOARDING_WEBHOOK_SECRET` env vars. If no URL is configured, nothing is sent.
- **Headers:** `content-type: application/json`, and `x-webhook-secret: <secret>`
  when a secret is set — verify this on your side.

**Body:**

```json
{
  "event": "onboarding.approved",
  "case": { /* the block above */ }
}
```

To backfill or re-pull on demand instead of waiting for the webhook, call
`GET /api/onboarding/{caseId}` (or `?deal_id=…`).

---

## Config

| Var | Where | Purpose |
|---|---|---|
| `ONBOARDING_API_KEY` | env (Vercel) | Bearer / `X-API-Key` for all three GETs. A random hex string. |
| `ONBOARDING_WEBHOOK_URL` | Settings UI (wins) or env | Where approvals POST to. |
| `ONBOARDING_WEBHOOK_SECRET` | Settings UI (wins) or env | Sent as `x-webhook-secret` for the receiver to verify. |

The Settings UI (`/settings` → "Onboarding export API") writes the webhook URL /
secret to `app_settings` (migration 072); the env vars are the fallback and are
used until that's set. `ONBOARDING_API_KEY` is env-only.
