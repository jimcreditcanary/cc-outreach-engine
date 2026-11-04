# Onboarding Agent — gap analysis + close-out plan

_Updated 2026-11-04. Supersedes `onboarding-brief-reconciliation.md`. Lists what remains against the brief (Steps 1–10) and a plan to finish._

Legend: ❌ not built · ⚙️ built, needs config · 🟡 partial · ✅ done · ↪ descoped.

## Done (live in prod)
The full Step-6 customer questionnaire (P0–P6) is **live and the default** — `ONBOARDING_FORM_V2=1`, served on the branded host **dd.creditcanary.co.uk/m/<token>** (wizard; root bounces to the marketing site). Self-identify, per-field attribution, Save-and-Continue, "don't know → economic buyer" on every payment/infosec question, playback → Submit. Company details (VAT, multiple DPOs, socials, non-personal-email check, privacy-AI). UBO email/mobile + list attestation. Repeatable disbursal accounts + CoP. Full payments + DD sub-form + Gift Aid. TU + infosec questionnaire (≤10/>10 branches, uploads, doc age-flag + pen-test exec-summary). Credit Canary logo. ✅ **UBO-fail → document-upload link (Step 7)** — `/u/<token>`, passport + proof of address, auto-opened on a failed check, link shared from `/review`. Migrations applied through 069.

---

## Remaining — build work (code)

| # | Gap | Brief | Size | Depends on |
|---|-----|-------|------|-----------|
| ~~B1~~ | ✅ New-contact form: **LinkedIn + Mobile** — mobile → `mobilephone`; LinkedIn → custom contact prop `linkedin_url` (written best-effort; created by onboarding-setup-props) | 1.3 | S | C2 token scope for LinkedIn to persist |
| ~~B2~~ | ✅ **API-sandbox request lists the technical contacts** (Technical / product stakeholders, name · email · mobile) | 1.4 | S | — |
| ~~B3~~ | ✅ Company page: **"Onboarded by / date"** (from case event). Drive-folder link ↪ descoped (code is there, lights up if Drive is ever set) | 8/10 | S | — |
| ~~B4~~ | ✅ Enrichment: **incorporation certificate** — CH `getIncorporationFiling` → public "view document" link on the enrichment page | 1.5 | M | migration 070 |
| ~~B5~~ | ✅ Enrichment: **two-year financials** — iXBRL now parses current assets/liabilities + net current assets for latest + prior period (`accounts.periods`) | 1.5 | M | migration 070 |
| ~~B6~~ | ✅ Enrichment: **insolvency filings table** (type/dates/practitioners) + per-director **PSC** badge (officer↔PSC name match) | 1.5 | S–M | migration 070 |
| ~~B7~~ | ↪ **descoped** (2026-11-04) — reports-as-PDFs in the pack. Needs Drive; skipped with C1. | 8 | M | Drive (C1) |
| ~~B8~~ | ↪ **descoped** (2026-11-04) — Project Tracker Google Doc. Needs Drive; skipped with C1. | 9 | M | Drive (C1) |
| ~~B9~~ | ✅ **UI polish pass** on the live customer form (Geist font, mobile progress, em-dashes, clutter, padlock trust cue, tap targets) | — | M | — |

**All code build items are complete or descoped. Nothing left to build.**

## Remaining — config / activation (your side, no code)

| # | Item | Unblocks | Status |
|---|------|----------|--------|
| ~~C1~~ | Google Drive envs | doc filing; B3 link, B7, B8 | ↪ **descoped** (2026-11-04) |
| C2 | **HubSpot write scopes**: add `crm.objects.deals.write` + `crm.schemas.deals.write` + `crm.objects.contacts.write` + `crm.schemas.contacts.write` + association labels to the Private App token, then `npm run onboarding-setup-props` (also creates the contact `linkedin_url` prop) + `npm run onboarding-setup-associations` | role→deal status sync + `onboarding_case_id` stamp + B1 LinkedIn persistence | optional — degrades gracefully (HubSpot mirror just no-ops) |
| C3 | **Live integration keys**: Call Validate / TransUnion (ID&V + PEP), CoP PSP, Postcoder | real KYC/CoP/address checks (mock until set; flows already work on mocks) | optional — needed only to run on live data |

Migration 070 ✅ applied 2026-11-04 (B4/B5/B6 now persist).

## Descoped
↪ HubSpot field-sync of questionnaire answers on submit — "not bothered".
↪ Google Drive (C1) and everything that depends on it — B7 (reports-as-PDFs), B8 (Project Tracker Doc), B3's Drive-folder link. Decided 2026-11-04.

---

## UI design review (design-taste-frontend)

**Design read:** a trust-first, regulated financial-onboarding form for external business customers, GOV.UK-style functional language — low variance, minimal motion, branded Tailwind (dials ~ VARIANCE 3 / MOTION 2 / DENSITY 5). The skill treats multi-step wizards as out of scope for the "make it fancy" parts, so this is a targeted polish against its typography / form / contrast / consistency / AI-tell rules, not a redesign.

**Already right:** label-above-input, visible focus rings, full loading/error/done states, one brand accent (navy #003566), consistent rounded shapes, the real logo on the navy header.

**Prioritised improvements (→ item B9):**
1. **Remove em-dashes** (quick; AI-tell). **53 `—`** across the form copy (attribution, intros, labels). The skill hard-bans them — replace with hyphens / restructure.
2. **Adopt the Credit Canary brand typeface** (via `next/font`). The form renders in the system default sans today, which reads generic. Matching the marketing-site font is the single biggest perceived-trust lift.
3. **Mobile progress bar.** The 6 step chips wrap to 2-3 lines at phone width. Collapse to a compact "Step N of M · {page}" + a thin progress line below 640px.
4. **Reduce per-field micro-text clutter.** With "don't know" now on every payment/infosec field *plus* the attribution line, each field carries two grey sub-lines. Shorten the attribution string and de-emphasise/inline the toggle so dense pages stay scannable.
5. **Rhythm + tap targets.** A touch more space between fieldsets and slightly larger input padding (py-2.5) for thumb-friendly mobile entry.
6. **Trust cue.** A small padlock / "stored encrypted" affordance beside the bank-detail and passport fields, where reassurance matters most.
7. **Lock the semantic palette + radius.** navy = primary, emerald = success, amber = warn, red = error; one radius scale. Audit out stray variants.

Added as **B9 — UI polish pass** (size M). Items 1, 3, 4 are the quick, high-visibility wins; 2 is the biggest lift.

---

## Close-out plan

**Phase 1 — polish batch (me, ~½–1 session, no external deps).** ✅ B1 + B2 + B3 (minus the Drive link) shipped 2026-11-04 (commit b6073ab). **B6 remains** (fold into Phase 2 enrichment). All small, self-contained; shipped behind the usual push → deploy.

**Phase 2 — enrichment depth (me, ~1 session).** ✅ B4 + B5 + B6 shipped 2026-11-04 (commit 177a41e). Pure Companies House + iXBRL; extends `enrich.ts` / `accounts.ts` / `ixbrl.ts`. **Needs migration 070 applied** (additive columns; degrades gracefully until then).

**Phase 3 — Drive (C1) + B7/B8 + B3 link.** ↪ **descoped 2026-11-04.** Jim is skipping Google Drive, so doc *filing*, reports-as-PDFs, the Project Tracker Doc and B3's folder link are all off the table. Doc *generation* still works (into the DB); nothing is filed to Drive.

### What's left to complete (2026-11-04)
With Drive descoped, **all code is done.** The only remaining items are optional activation config, both your side, both graceful (the app runs today without them):

1. **C2 — HubSpot write scopes** (if you want the HubSpot mirror): add the deal + contact write scopes + association labels to the Private App token, then run `onboarding-setup-props` + `onboarding-setup-associations`. Turns on deal onboarding-status sync, the `onboarding_case_id` stamp, role→deal associations, and B1 LinkedIn persistence. Until then those just no-op.
2. **C3 — live integration keys** (when you go live on real data): Call Validate (ID&V + PEP/sanctions), TransUnion, CoP PSP, Postcoder. Everything runs on mocks today; these flip the KYC / CoP / address checks to real. Companies House is already keyed (enrichment is live).

That's the whole list. No further build work is outstanding.
