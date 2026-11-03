# Step 6 — Customer onboarding questionnaire: build scope

_2026-11-03. Scopes the full customer-facing questionnaire from the brief's Step 6, against what exists today. The current `/m/[token]` form is a single-page MVP; the brief wants a multi-page, product-gated, collaboratively-editable KYC/CDD/infosec questionnaire with gov.uk-style playback. This is a project of its own — roughly **6–8 focused build sessions** — so it's phased below._

## Principles (carry over from the rework)
- **No email to the customer, ever.** One shared link; the salesperson sends it. (So the brief's "branded email to economic buyer", nudges and chase emails are out of scope — replaced by the link already live.)
- **Product-gated.** Pages and questions appear only for the selected product groups (same `requires*` helpers in `productGroups.ts`).
- **Everything logged as case history** (`logCaseEvent` → `onboarding_events`).
- **Reuse what's built**, don't rebuild: field encryption (`crypto.ts`), uploads + AI extraction (`uploads.ts`), CoP (`cop.ts`), Postcoder address lookup, privacy-policy AI assessment (`privacyAssessment.ts`), the branded token-form shell at `/m/[token]`.

## Current state → target delta
**Built today (single page, one submit):** entity read-back; business (trading name/address/phone/email/website); compliance (ICO, FCA FRN, DPO single, privacy URL, trade body); signatory; settlement account (encrypted + CoP); basic DD (collects?/SUN/description/volume/avg); per-UBO KYC (DOB/%/address/PEP/consent); infosec file upload only.

**The brief additionally needs:** a 5-page wizard with progress bar; per-field autosave; **Save-and-Continue (no validation) vs Continue (validate)**; **field-level attribution** ("Updated on {date} by {email} ({role})"); **multi-contact editing**; a **"don't know / ask later"** option; gov.uk-style **playback → Submit for Approval**; and a much larger field set (VAT, multiple DPOs, socials, transaction profile, B2B/B2C, full DD sub-form, disbursal accounts + CoP, UBO email/mobile, the complete **TU questionnaire + ~30-question two-branch infosec section**), plus several behind-the-scenes checks.

---

## The architectural shift (foundation — do this first)
Today the form is one big POST validated on submit. The brief's Save-and-Continue, per-field attribution, multi-editor and "don't know" all require **incremental per-field persistence**. Proposed model:

- Keep the **typed/encrypted/validated** data where it already lives (bank accounts, UBO KYC, uploads, privacy assessment).
- Add a flexible **`onboarding_form_answers`** key-value store for the long-tail questionnaire: `(case_id, field_key, value, is_unknown, updated_by_email, updated_by_role, updated_at)`. One row per field = free per-field attribution + autosave + "don't know" (`is_unknown=true`) + Save-and-Continue (write without validating).
- Add **`onboarding_form_progress`** (`case_id`, `page`, `completed_at`) to drive the progress bar and the Submit gate.
- **Editor identity without a login:** one shared token; on entry the opener **self-identifies** by picking their name from the case's stakeholders (stored in a cookie for the session), feeding `updated_by_email/role`. (Decision below — alternative is per-contact sub-links.)

Autosave = a debounced server action per field → upsert into `onboarding_form_answers`. Continue validates the current page's required fields; Save-and-Continue skips validation.

---

## Page-by-page field inventory

### Page 1 — Confirm Company Details
Required unless noted. (✅ = field exists today.)
- Trading Name ✅, Trading Address ✅, **Website URL** ✅ → behind the scenes: privacy-policy AI (✅ `privacyAssessment.ts`) answers URL-works / up-to-date / CRA reference / specific purposes / CRAIN or Bureau notice / meets TU minimum guidance (add the TU guidance text to the agent markdown).
- Company Telephone ✅, **Company Email** ✅ + **non-personal-domain validation** (new: reject gmail/outlook/etc.).
- ICO Number ✅, **VAT Number** (optional, new), FCA FRN ✅ (required when TU Credit).
- **DPO — multiple**, each First/Last/Job Title/Email/Phone (new; today it's one free-text field).
- **Social media URLs** — Facebook / LinkedIn / Twitter / Instagram (optional, new).

### Page 2 — Confirm UBOs
- "Confirm the UBO list is complete" (required attestation, new).
- Per UBO (pre-filled from enrichment): DOB ✅, Residential Address ✅ (Postcoder + manual), **Email** (new), **Mobile** (new). (PEP/% already captured.)

### Page 3 — Confirm Disbursal Accounts _(only if Pay-by-Bank / Sweeping VRP / CVRP / Direct Debits / Faster Payments / Settlement selected)_
- Multiple accounts: Account Name / Sort Code / Account Number (encrypted ✅ pattern) — today only one settlement + one DD account; make it a **repeatable list**.
- **CoP check per account** (✅ `cop.ts`) → show Full / Close / No Match; store full result in back end.

### Page 4 — Confirm Payments Details _(if Communications / Pay-by-Bank / Sweeping VRP / CVRP selected)_
- Recent bank statement? Yes → upload / No → explain (new).
- What will they take payments for? (new) · Expected monthly volume ✅ · Average value ✅ · **Maximum transaction value** (new).
- **B2B / B2C** (if both → % split) (new).
- How do you currently collect payments + provider? (required, new).
- **Per-payment-type reason** — one reason per selected payment product (new, dynamic).
- **Direct Debit sub-form** _(if Direct Debits selected)_ — mostly new:
  - Active SUN? Yes → Number/Provider · No → branded-SUN consent (Yes only) + **bank-statement display** (live prefill example).
  - Transfer All / Partial · Max collection limit per customer/month · Frequency (Weekly/Monthly/Quarterly/Annual/Other) + split if multiple · Collect Before/After service · Signup method (Paper/Telephone/eDD/API[pre]/Xero, multi) · Schedule (Fixed/Rolling/Ad-hoc + tooltips) · Collection dates (free text) · Advance-notice method (Letter/Email[pre], "charges apply for letters" tooltip) · Auto-represent failed (Yes[pre]/No).
  - **Gift Aid** question — only if Companies House shows the entity is a registered charity (new conditional, keyed off enrichment).

### Page 5 — Confirm Infosec Questionnaire _(only if TU Credit and/or TU Monevo selected)_
All new except the upload mechanism (✅ `uploads.ts` + AI extraction).
- CMC / PI firm? · Search type in keeping with business? (Yes pre) · Shared email account? · ICO Enforcement/Decision Notice ever? · Data transfer outside UK/EEA? · Industry-body membership required? → if member, valid & current?
- **Certifications:** ISO 27001 (Yes → Expiry/Assessor) · PCI DSS (Yes → Expiry/Assessor) · SOC2 (Yes → Expiry/Assessor) · Intending ISO 27001 (audit <3 months)? · Other security arrangements? Yes → detail / No → explain.
- **Branch on >10 employees:**
  - **≤10 (small):** antivirus + HIDS · own username/password (Yes only) · min-password policy · router defaults changed · MFA on email · Windows Defender · personal devices? · VPN? · removable-media control? — each Yes/No with "explain why" on the risk answer.
  - **>10 (large):** documented InfoSec Policy **upload** (→ flag if >12 months old) · annual security-awareness training · antivirus + HIDS on servers/workstations · system logging · personal devices · VPN · patching regime · 256-bit encryption before egress · annual pen testing **upload** (→ age flag + **AI exec summary** if medium/high findings) · cyber insurance **upload** (→ age flag) · encryption at rest + in transit detail (free text).

### Playback + submit
- Gov.uk-style **"check your answers"** page replaying every answer, grouped by page, each with a Change link.
- **Submit for Approval** enabled only when all validated/required fields are complete (unknowns allowed where "don't know" is permitted; those route to the economic buyer for a later pass).
- On submit: persist, advance to `merchant_submitted`, **sync answers to HubSpot** fields, route to ops@ (already wired).

---

## Cross-cutting mechanics
1. **Per-field attribution** — "Updated on {date} by {email} ({role})" under each field, from `onboarding_form_answers`.
2. **Save-and-Continue vs Continue** — two buttons per page; the former writes without validation, the latter validates then advances + marks the page complete.
3. **"Don't know / ask later"** — a toggle per eligible field; stored as `is_unknown`, surfaced to the economic buyer at the end.
4. **Multi-contact editing** — one link, opener self-identifies from the stakeholder list (feeds attribution). _Decision needed (below)._
5. **Progress bar** — 5 steps (hide Disbursal/Payments/Infosec when not gated), driven by `onboarding_form_progress`.
6. **Autosave** — debounced per-field server action.

## Behind-the-scenes processing
| Trigger | Processing | Status |
|---|---|---|
| Website URL | Privacy-policy AI (CRA/CRAIN/TU guidance) | ✅ exists, wire to page 1 |
| Company email | Non-personal-domain validation | new (small) |
| Disbursal accounts | CoP per account | ✅ exists, make repeatable |
| Bank statement / InfoSec policy / pen test / cyber insurance | Upload + AI extraction | ✅ mechanism exists |
| InfoSec policy / pen test / cyber insurance | **Age flag >12 months** | new (small) |
| Pen test | **AI exec summary** if med/high findings (scope, findings, ratings, remediation) | new (medium) |
| Charity (CH) | Gift Aid question gate | new (small) |

---

## Phased delivery plan
Rough sizing: **S** ≈ a few hours, **M** ≈ half a session, **L** ≈ a full session+.

| Phase | Scope | Size | Depends on |
|---|---|---|---|
| **P0 Foundation** | `onboarding_form_answers` + `onboarding_form_progress` migrations; multi-page shell + progress bar; autosave; Save-and-Continue / Continue; "don't know"; editor self-identify; playback skeleton; Submit-for-Approval gate | **L** | — |
| **P1 Company details** | expanded page 1 (VAT, multiple DPOs, socials) + company-email validation + privacy-AI wire | **M** | P0 |
| **P2 UBO confirm** | page 2 (email/mobile + list-complete attestation) | **S–M** | P0 |
| **P3 Disbursal accounts** | repeatable accounts + CoP per account | **M** | P0 |
| **P4 Payments + DD sub-form** | page 4 (transaction profile, B2B/B2C, collection method, per-type reasons, full DD sub-form, SUN/branded SUN, Gift-Aid-on-charity) | **L** | P0 |
| **P5 Infosec questionnaire** | page 5 (TU gating, certs, ≤10/>10 branches, uploads + age flags + pen-test exec summary) | **L** | P0 |
| **P6 Playback + sync** | full "check your answers" + HubSpot field sync + attribution surfacing + multi-contact access + doc regeneration from new fields | **M–L** | P1–P5 |

Suggested order: **P0 → P4 → P5 → P1 → P2 → P3 → P6** (do the two biggest, riskiest pages right after the framework; smaller pages slot in; playback/sync last). Each phase ships behind the existing token form and is independently testable with a live case.

## Open decisions (need your call)
1. **Editor identity:** one shared link + self-identify (simplest, recommended), **or** per-contact sub-links? The latter gives firmer attribution but means generating/sharing several links.
2. **"Don't know" scope:** which fields may be deferred to the economic buyer vs. hard-required? (Brief implies most CDD can be "don't know"; KYC identity fields probably can't.)
3. **HubSpot sync targets:** which questionnaire answers map to which HubSpot properties (some may need new custom properties created).
4. **Brief numbering nit:** the DD/SUN questions are numbered against "1.2.1.4" but SUN = Direct Debits (1.2.1.7); I'll gate the DD sub-form on **Direct Debits** (matches the code today). Confirm.
5. **TU minimum good-practice guidance** text for the privacy-policy check — needs supplying to add to the agent markdown.
6. **Document impact:** new fields flow into the generated pack (merchant form / DD questionnaire docx) — confirm the template tags to extend.
