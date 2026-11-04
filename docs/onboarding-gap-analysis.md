# Onboarding Agent — gap analysis + close-out plan

_Updated 2026-11-04. Supersedes `onboarding-brief-reconciliation.md`. Lists what remains against the brief (Steps 1–10) and a plan to finish._

Legend: ❌ not built · ⚙️ built, needs config · 🟡 partial · ✅ done · ↪ descoped.

## Done (live in prod)
The full Step-6 customer questionnaire (P0–P6) is **live and the default** — `ONBOARDING_FORM_V2=1`, served on the branded host **dd.creditcanary.co.uk/m/<token>** (wizard; root bounces to the marketing site). Self-identify, per-field attribution, Save-and-Continue, "don't know → economic buyer" on every payment/infosec question, playback → Submit. Company details (VAT, multiple DPOs, socials, non-personal-email check, privacy-AI). UBO email/mobile + list attestation. Repeatable disbursal accounts + CoP. Full payments + DD sub-form + Gift Aid. TU + infosec questionnaire (≤10/>10 branches, uploads, doc age-flag + pen-test exec-summary). Credit Canary logo. ✅ **UBO-fail → document-upload link (Step 7)** — `/u/<token>`, passport + proof of address, auto-opened on a failed check, link shared from `/review`. Migrations applied through 069.

---

## Remaining — build work (code)

| # | Gap | Brief | Size | Depends on |
|---|-----|-------|------|-----------|
| B1 | New-contact form: **LinkedIn + Mobile** (mobile → HubSpot `mobilephone`; LinkedIn needs a contact property) | 1.3 | S | — |
| B2 | **API-sandbox request includes the technical contacts** (not just deal/company) | 1.4 | S | — |
| B3 | Company page: **"Onboarded by / date"** + **Drive-folder link** | 8/10 | S | Drive (C1) for the link |
| B4 | Enrichment: **incorporation certificate** (CH filing history) | 1.5 | M | — |
| B5 | Enrichment: **two-year financials** (current assets / liabilities; parse 2 periods, not just latest) | 1.5 | M | — |
| B6 | Enrichment: **insolvency filings table** + per-director **PSC flag** surfaced | 1.5 | S–M | — |
| B7 | **Reports as PDFs in the pack** — render Call Validate / CoP results to PDF + file alongside the docs | 8 | M | Drive (C1) to file |
| B8 | **Project Tracker Google Doc** (Key Contacts / Actions / Q&A) | 9 | M | Drive (C1) + Google Docs API |

## Remaining — config / activation (your side, no code)

| # | Item | Unblocks |
|---|------|----------|
| C1 | **Google Drive**: set `GOOGLE_SERVICE_ACCOUNT_JSON` + `ONBOARDING_DRIVE_ROOT_FOLDER_ID` (point at the brief's Drive folder) | real doc filing; B3 link, B7, B8 |
| C2 | **HubSpot deal-write**: add `crm.objects.deals.write` + `crm.schemas.deals.write` + association labels to the Private App token, then `npm run onboarding-setup-props` + `npm run onboarding-setup-associations` | role→deal sync + `onboarding_case_id` stamp |
| C3 | **Live integration keys**: Call Validate / TransUnion (ID&V + PEP), CoP PSP, Postcoder | real checks (mock until set; flows already work on mocks) |

## Descoped
↪ HubSpot field-sync of questionnaire answers on submit — "not bothered". Doc regen + ops@ routing already happen.

---

## Close-out plan

**Phase 1 — polish batch (me, ~½–1 session, no external deps).** B1 + B2 + B6, and B3 minus the Drive link. All small, self-contained, immediate value. Ship behind the usual push → deploy.

**Phase 2 — enrichment depth (me, ~1 session).** B4 + B5 (+ finish B6). Pure Companies House + iXBRL work; extends the existing `enrich.ts` / `accounts.ts`. No external deps.

**Phase 3 — your config (parallel with Phase 1/2, ~15 min each).** C1 (Drive) and C2 (HubSpot scope). C1 is the important one — it turns doc *generation* (already working) into doc *filing*, and unblocks B3's link, B7 and B8.

**Phase 4 — Drive-dependent build (me, after C1).** B7 (reports as PDFs) + B8 (Project Tracker Doc) + wire B3's Drive link. These only make sense once Drive is live.

**Phase 5 — go fully live on real data (you, when ready).** C3 (integration keys/contracts). The onboarding runs end-to-end on mocks today; flipping these makes the ID&V / CoP / address checks real. Can be last.

### Recommended order
1. **You:** set the Google Drive envs (C1) — highest leverage, unblocks three build items.
2. **Me:** Phase 1 polish batch while you do that.
3. **Me:** Phase 2 enrichment depth.
4. **Me:** Phase 4 once Drive is live.
5. **You:** integration keys (C3) whenever you're ready to run on live data.

After Phases 1–4 + C1/C2, the brief is fully built; C3 is purely "turn the mocks into live providers".
