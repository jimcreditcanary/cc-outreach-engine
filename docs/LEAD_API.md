# Lead Capture API

Send leads from creditcanary.co.uk forms (whitepaper downloads, gated
content, "talk to us") straight into the Veepveep CRM. Creating or updating
a contact, linking a company, and logging the activity all happen in one call.

## Endpoint

```
POST https://www.veepveep.co.uk/api/leads
```

## Auth

Send the API key (ask Jim — it's stored in Vercel as `LEAD_API_KEY`). Any one of:

- `Authorization: Bearer <KEY>`  ← preferred
- `X-API-Key: <KEY>`
- `"key": "<KEY>"` in the JSON body

Requests are also restricted by Origin to the creditcanary.co.uk domains, so
a browser `fetch` from the live site works. To allow another origin, Jim adds
it to the `LEAD_ALLOWED_ORIGINS` env var.

## Body

JSON (`Content-Type: application/json`) **or** a normal HTML form post. Fields:

| Field        | Required | Notes |
|--------------|----------|-------|
| `email`      | **yes**  | The identity key. Matched case-insensitively. |
| `name`       | no       | Full name. Falls back to the email's local part. |
| `company`    | no       | Company name. Linked if it exists, else created. |
| `job_title`  | no       | |
| `source`     | no       | Where it came from — `whitepaper`, `website`, `linkedin`, … Defaults to `website`. |
| `asset`      | no       | What they engaged with — the whitepaper/resource title. Drives the timeline + alert. |
| `url`        | no       | The page URL. Defaults to the `Referer` header. |
| `message`    | no       | Free text (for enquiry forms). |
| `phone`      | no       | Aliased to mobile. |
| `kind`       | no       | `download` \| `enquiry` \| `lead`. Auto-detected: `download` if `asset` is present, else `lead`. |
| `website`    | no       | **Honeypot** — leave it as a hidden field; if filled, the lead is silently dropped (bot defence). |

## Response

```json
{ "ok": true, "contact_id": "…", "organisation_id": "…", "created": true, "status": "new" }
```

- `created` — `true` if a brand-new contact was made, `false` if an existing one was matched and appended to.
- `status` — `"new"` for a fresh lead, `"existing"` if they were already in the CRM.

Errors return `{ "ok": false, "error": "…" }` with a 4xx status (`400` bad body,
`401` bad key, `422` validation).

## What it does in the CRM

1. **Contact** — matched by email (never duplicated). New ones are flagged
   **New** so they appear instantly under the *New leads* filter on /contacts.
   Existing contacts keep their status — a known contact downloading a paper
   is appended to, not re-created.
2. **Company** — linked from the contact's existing org, matched by name, or
   created from `company`.
3. **Timeline event** — e.g. *"📄 Downloaded "Risk & Liquidity" · via whitepaper"*
   with the date, on the contact's timeline.
4. **Alert** — appears on /alerts for triage (deduped per contact + asset + day).
5. **Email** — notifies the lead owner.

## Examples

### Whitepaper download (the Risk & Liquidity page)

```bash
curl -X POST https://www.veepveep.co.uk/api/leads \
  -H "Authorization: Bearer $LEAD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane@lender.co.uk",
    "name": "Jane Smith",
    "company": "Lender Ltd",
    "source": "whitepaper",
    "asset": "Risk & Liquidity",
    "url": "https://www.creditcanary.co.uk/resources/whitepapers/risk-liquidity"
  }'
```

### Browser fetch (gated-download form)

```js
const res = await fetch("https://www.veepveep.co.uk/api/leads", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${LEAD_API_KEY}`, // injected at build/runtime
  },
  body: JSON.stringify({
    email: form.email.value,
    name: form.name.value,
    company: form.company.value,
    source: "whitepaper",
    asset: "Risk & Liquidity",
    url: window.location.href,
    website: form.website.value, // honeypot (hidden field)
  }),
});
const { ok } = await res.json();
if (ok) {
  // reveal the download link / redirect to the PDF
}
```

> The marketing site is static, so the key shipped to the browser is visible
> in network requests. That's expected — it's a low-privilege, write-only
> token (worst case is junk leads, which land in /alerts for triage). Don't
> reuse it for anything else.

## Notes

- One call per download. Re-downloads by the same person add another timeline
  entry (useful — repeat interest) but won't duplicate the contact or, for the
  same asset on the same day, the alert.
- `source` and `asset` are what make the CRM useful — always send them so the
  team can see exactly where leads come from and what they're reading.
