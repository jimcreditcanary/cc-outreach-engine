# Onboarding Agent — build vs. brief reconciliation

_Generated 2026-11-03. Checks the current code against the original "Onboarding Agent Brief" (Steps 1–10) and the 9-point feedback round. Flags what's built, what's partial, and what's genuinely been looked over._

## 1. The 9 feedback items — all shipped

| # | Item | Status | Where |
|---|------|--------|-------|
| 1–2 | Mark Active Customer → onboarding + billing blocks appear with Start onboarding | ✅ | `HubspotCompanyDetail.tsx` (blocks gated on `customer`) |
| 3a | Active directors from CH, matched to contacts by first+last, "Add to HubSpot" when missing | ✅ | `StakeholdersStep` + `PersonRow`, `enrich.ts`, `personName.ts` |
| 3b | UBOs from PSCs, matched / add | ✅ | same |
| 3c | Corporate PSC → recurse associated companies to reach individual UBOs | ✅ (pre-existing, depth-2) | `enrich.ts:194 insertPscTree` |
| 3d | Keep "New contact" | ✅ | `StakeholdersStep` |
| 4 | Role assignment → multi-select | ✅ | `addStakeholderAction` (getAll `roles`) |
| 5 | Finish button moved up + prominent | ✅ | top of `StakeholdersStep` |
| 6 | Finish not creating documents | ✅ fixed | `completeInternalAction` now calls `generateDocsForCase` |
| 7a | Send form to customer = product-gated link, no email | ✅ | link surfaced on finish + company block; customer email removed |
| 7b | Then route to ops@creditcanary.co.uk for review | ✅ | `notifyMerchantSubmitted` → ops@ |
| note | Log everything as case history | ✅ | `logCaseEvent` + visible timeline on finish |
| note | Remove "Save toggle" button | ✅ | folded into finish form |
| 8 | Customer page = directory; View → company page | ✅ | `customers/page.tsx`, `/customers/[id]` redirects |
| 9 | Blocks carry the onboarding link for the salesperson | ✅ | onboarding block "Copy onboarding link" |

**No emails to the customer anywhere.** Internal emails (ops@, sandbox) retained.

---

## 2. Brief Steps 1–10

Legend: ✅ built · 🟡 partial · ❌ missing · ↪ changed by feedback.

### Step 1 — Confirm company ✅
CH search → pick entity, shows number/status/address. `status_detail` shows on the enrichment page. Fine.

### Step 2 — Product groups ✅
- ✅ **Communications (Email / SMS / WhatsApp)** added (light-touch, no document) — catalog now has all 11 groups.
- ✅ Settlement Accounts → Faster Payments auto-select works.

### Step 3 — Roles ✅ / 🟡
- ✅ 6 roles, multi-select, HubSpot association, directors/UBOs surfaced + match/add.
- 🟡 New-contact form captures First/Last/Email/Job title — **missing LinkedIn URL and Mobile Number** (brief 1.3.x).
- Note: director/UBO add-to-HubSpot is **operator-confirmed via a button**, not fully automatic (deliberate — avoids silently creating records).

### Step 4 — API sandbox 🟡
- ✅ yes/no toggle + internal request email.
- 🟡 Request email does **not yet include the technical contacts** specifically (brief says share "all technical contacts + company name"). Currently sends deal/company/products.

### Step 5 — CH deep enrichment ✅ / 🟡
- ✅ profile, officers (current + resigned ≤12m), PSC/UBO chain, charges, insolvency flags, accounts/CS due + overdue, SIC, previous names.
- 🟡 **Financials: only the latest filed period is parsed** (`accounts.ts`), and current assets / current liabilities aren't explicitly captured — brief wants **last two years** of cash / current assets / employees / current liabilities.
- ❌ **Incorporation Certificate** (from filings) not fetched.
- 🟡 Years-trading, per-director PSC flag, and insolvency **filings table** (strike-off/gazette) not surfaced.
- ✅ Directors compared to contacts + add-missing with name de-shout + job=occupation (feedback item 3a).

### Step 6 — Customer form ↪ / 🟡 / ❌  ← **biggest gap**
The email/nudge machinery is **intentionally removed** (↪ feedback: link not email; the 2/4/7-day nudges and deal-owner chase are not applicable). The **form itself is an MVP skeleton** — it captures far less than the brief:
- ✅ captured: trading name/address/principal office, phone, email, website; ICO, FCA FRN, DPO (single), privacy-policy URL (+ Claude assessment ✅), trade body; signatory; UBO KYC (DOB, ownership %, residential address, PEP, consent); bank accounts (encrypted) + **CoP check ✅**; DD basics (collects, SUN, description, volume, avg value).
- ❌ **not captured** (brief Step 6): VAT number; company-email non-personal validation; **multiple DPOs** with name/title/email/phone; social-media URLs; bank-statement upload Q's; **max transaction value, B2B/B2C split, payment provider, per-payment-type reasons**; **branded SUN flow + bank-statement display example**; the full **DD sub-form** (transfer all/partial, max collection limit, frequency + split, before/after, signup method, schedule type + tooltips, collection dates, advance-notice method, auto-represent, Gift Aid); UBO **email + mobile**; the entire **TU questionnaire** (CMC/PI, search type, shared email, ICO enforcement notice, data transfer, industry body, **ISO 27001 / PCI DSS / SOC2** + the ~40-question **infosec questionnaire** with document uploads + flags/exec-summaries).
- ❌ **Field-level attribution** ("Updated on {date} by {email} ({role})"), **Save-and-Continue vs Continue** validation split, and **multi-contact collaborative editing** (economic buyer + cc'd roles) — not built.
- 🟡 Gov.uk-style **playback → "Submit for Approval"** and a **"don't know / ask later"** option — partial / unconfirmed.
- Infosec **upload** mechanism exists (`uploads.ts` + AI extraction), but the structured questionnaire that drives it does not.

### Step 7 — UBO checks 🟡 / ❌
- ✅ Call Validate ID&V + PEP/sanctions screening per UBO (`uboChecks.ts`).
- ❌ On fail, the brief emails the UBO a form for passport + utility bill — **not built**, and under the new rule this must be a **shared link, not an email to the UBO**.

### Step 8 — Supporting documents + approval ✅ / 🟡
- ✅ Doc generation from 5 templates (TU Credit EUA, TU Monevo EUA, TU DD xlsx, merchant form, DD questionnaire) — now runs at finish (item 6).
- 🟡 **Google Drive filing is mock until configured** — needs `GOOGLE_SERVICE_ACCOUNT_JSON` + `ONBOARDING_DRIVE_ROOT_FOLDER_ID` (point it at the brief's Drive folder). Folder tree (Onboarding Forms / Supporting Docs / Project Management) is coded.
- ✅ ops@ review email on submit; approver sign-off → `onboarded` with event log + approver/date.
- 🟡 Drive-folder links not yet surfaced on the company page.

### Step 9 — Project Tracker ❌
- Drive "Project Management" folder is created, but the **"Project Tracker" Google Doc** (Key Contacts / Actions / Q&A) is **not generated** (needs Google Docs API).

### Step 10 — Company view ✅ / 🟡
- ✅ Once a case exists, the block shows status and the case link (Start only shows with no case).
- 🟡 Doesn't yet show **"Onboarded" with approver + date** explicitly on the company page (status badge only).

---

## 3. Prioritised gaps (your call on what to build next)

**Quick, bounded:**
1. ✅ ~~Add the **Communications** product group~~ — done (light-touch, no document).
2. New-contact **LinkedIn + Mobile** fields.
3. Include **technical contacts** in the API-sandbox request.
4. Surface **Drive links + "Onboarded by/date"** on the company page.
5. Config: set the **Google Drive** service-account + root-folder envs to make filing real.

**Larger bodies of work (the brief's core, mostly not built):**
6. The **full customer questionnaire** — DD sub-form, TU questionnaire, infosec (~40 Qs), VAT/social/multiple-DPO, transaction profile, branded SUN. This is the single biggest outstanding piece.
7. **Field-level attribution + Save-and-Continue/Continue + multi-contact editing** on the customer form.
8. **UBO fail → document upload** flow (as a link, not an email).
9. Two-year **financials** + **incorporation certificate** in enrichment.
10. **Project Tracker** Google Doc generation.
