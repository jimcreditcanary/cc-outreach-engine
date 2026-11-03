# Onboarding Agent — gap analysis (current state)

_2026-11-03, after the full Step-6 questionnaire build (P0–P6), the Credit Canary logo, and broadened "don't know". Supersedes `onboarding-brief-reconciliation.md`. This lists what's **still missing** against the brief (Steps 1–10) — not what's built._

Legend: ❌ not built · ⚙️ built but needs config/activation · 🟡 partial · ↪ descoped by Jim.

## What's now complete (was flagged before, now done)
The entire customer form (brief Step 6) is built behind `ONBOARDING_FORM_V2`: multi-page wizard, self-identify, per-field "updated by" attribution, Save-and-Continue vs Continue, **"don't know → ask the economic buyer"** (now on every payment + infosec question), gov.uk-style playback → Submit for approval. All brief product groups (incl. Communications). Company details (VAT, multiple DPOs, socials, non-personal-email check, privacy-policy AI). UBO email/mobile + list attestation. Repeatable disbursal accounts + CoP per account. Full payments + DD sub-form + Gift Aid. TU + infosec questionnaire with ≤10/>10 branches, uploads, and the behind-the-scenes **doc age-flag + pen-test exec-summary**. Credit Canary logo on the form.

---

## Still missing — build work

### 1. UBO check fail → document request (Step 7) ❌
If Call Validate ID&V or PEP fails, the brief sends the UBO a form to upload a passport + a utility bill / bank statement (<3 months). **Not built.** Under the no-customer-email rule this must be a **shared link**, not an email. We already capture each UBO's email/mobile (P2), so the hook exists — the link flow + upload capture don't.

### 2. Project Tracker Google Doc (Step 9) ❌
The Drive "Project Management" folder is created, but the **"Project Tracker" Google Doc** (Key Contacts / Actions / Q&A) is not generated — needs the Google Docs API.

### 3. Enrichment depth (Step 1.5) 🟡
- **Incorporation Certificate** (from filings) — not fetched.
- **Two-year financials** — only the latest filed period is parsed; **current assets / current liabilities** aren't explicitly captured (brief wants cash / current assets / employees / current liabilities for the last two years).
- **Insolvency filings table** (strike-off / gazette) and per-director **PSC flag** — not surfaced.

### 4. Reports as PDFs in the doc pack (Step 8) 🟡
Generated EUA / merchant-form / DD docs are produced and filed, and client uploads go to "Supporting Docs", but the **Call Validate / CoP results aren't rendered as PDFs** and linked into the pack.

### 5. Small items
- **New-contact form** (stakeholders step) is missing **LinkedIn URL + Mobile** (brief 1.3).
- **API-sandbox request** doesn't yet include the **technical contacts** (brief 1.4 — "share all technical contacts + company name").
- **Company page** doesn't surface **"Onboarded by / date"** or the **Drive-folder link** (brief Step 8/10).

---

## Built, but needs activation (config, not code)

### 6. Go live on the new form ⚙️
The whole questionnaire is behind **`ONBOARDING_FORM_V2`**. Verify on prod with `?v2=1`, then set `ONBOARDING_FORM_V2=1` in Vercel.

### 7. Google Drive filing ⚙️
Mock until `GOOGLE_SERVICE_ACCOUNT_JSON` + `ONBOARDING_DRIVE_ROOT_FOLDER_ID` (point it at the brief's Drive folder) are set. Folder tree + filing code is done.

### 8. HubSpot write-backs ⚙️
- **Role → deal association + type** (Step 1.3) and the `onboarding_case_id` stamp no-op until the Private App token gets `crm.objects.deals.write` + `crm.schemas.deals.write` + the association labels, then run `npm run onboarding-setup-props` + `npm run onboarding-setup-associations`.

### 9. Live integration keys ⚙️
Call Validate / TransUnion (ID&V + PEP), CoP PSP, Postcoder — all mock until their keys + contracts are set. Companies House is live.

---

## Descoped by Jim
- ↪ **HubSpot field sync of the questionnaire answers** on submit (Step 6 "related fields updated") — Jim: "not bothered" (2026-11-03). Doc regeneration + ops@ routing on submit already happen.

---

## Suggested priority if continuing
1. **Flip `ONBOARDING_FORM_V2`** after a prod `?v2=1` check — unlocks everything above for real use.
2. **Set the Google Drive envs** — makes doc filing real (otherwise docs generate but don't file).
3. **UBO fail → upload link** (Step 7) — the one remaining customer-facing flow.
4. Enrichment depth + reports-as-PDFs + the small items — polish.
5. Project Tracker Google Doc — nice-to-have.
