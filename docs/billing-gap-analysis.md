# Billing Agent — Conformance Gap Analysis & Fix Plan

**Date:** 2026-11-06
**Target:** `billing-agent-claude-code-brief.md` (v2 brief, 06-Nov decisions)
**Against:** the shipped billing subsystem (migrations 058–063, `src/lib/billing/*`, `src/app/billing/*`, `src/app/admin/*`).

## Verdict

The billing agent is **substantially built and runs end-to-end on mocks** — catalogue, billing accounts, the pricing engine (bands, escalation, category minimums, rounding, first-month pro-rata), the monthly Xero ACCREC run (idempotent), the 15th overdue chase, super-admin pricing, and a live Xero client sitting behind the mock. **None of the gaps below stop it running.**

But it was built to an **earlier, simpler model** than this v2 brief. The catalogue is a product+bands schema (**no `variant_id`**); the contract-lifecycle layer (term / renewal / versioning) is largely absent; several **money-correctness, API-guardrail and security** items diverge from the 06-Nov decisions. Those are the real pre-go-live risks.

Two things are **decisions, not bugs** — resolve them first because they gate the fixes:

1. **Comms VAT.** The brief (06-Nov) says you confirmed email/SMS/WhatsApp are **standard**-rated. The code seeds them **exempt** with the comment "Comms are VAT-exempt (Jim 2026-11-01)" (`productSeed.ts:135-137`). Newer decision wins unless you say otherwise. **Which is correct?**
2. **Catalogue architecture.** The brief's data model is a flat catalogue with `variant_id`; the code uses `billing_pricing_tables` (product) + `billing_pricing_bands` (band) with multi-component items as a single combined-config product. This is **functionally workable** and I recommend **keeping it** and closing the functional gaps rather than a full refactor — but it changes the usage-API shape (keys, no `variant_id`). Confirm you're happy to diverge from the brief's variant model.

---

## Confirmed working ✅ (don't touch)

- All seven spec tables exist (named differently); money stored as **integer pence** throughout.
- **Banded pricing** — one band per month by total quantity, all units at that band's rate, floored by that band's minimum, band recorded on the line. Correct + tested (`engine.ts:145-154`).
- **Category minimums** per product group — top-up line added (`engine.ts:282-298`).
- **Escalation** — ordered `{start_month, amount}` steps anchored to contract start; this is how platform-fee Y1/Y2/Y3 is modelled (`engine.ts:104-122`).
- **Rounding** — integer pence, per-line, summed. **First-month pro-rata** — flat-only, actual days.
- **Seed values mostly correct:** all 13 TU prices incl. both `tu_call_report_qs` + `tu_call_report_ca`; CoP bands incl. the b4=10001 boundary; OB b4 max=25000; setup/support fees; every payment rail's fixed/pct/cap values; payments VAT = exempt, core/OB/TU/Monevo/CoP = standard.
- **Monthly run** → Xero **ACCREC** sales invoice, itemised, **idempotent** (existing-invoice check on account+period); invoice+lines persisted (`invoiceRun.ts`, `xero.ts:103`).
- **15th chase** = **overdue** (unpaid AND past due date), one email per deal owner, links to `/billing/outstanding` (`dunning.ts:46-105`).
- **super_admin role** exists, gates the pricing catalogue + the dedicated override path; user-admin toggle present (`role.ts`, `admin/pricing/*`, `admin/users`).
- **Live Xero client fully coded** behind the mock; flips on when `XERO_CLIENT_ID/SECRET` are set (`xero.ts:130-133`).
- Monevo substance correct (both components priced by VeepVeep); included-item usage stored but zero-billed.

---

## Gaps by severity

### 🔴 P0 — Security

| # | Gap | Evidence | Brief |
|---|---|---|---|
| S1 | ✅ **FIXED (2026-11-06)** — `setUserRoleAction` now requires `isSuperAdmin()`; `/admin/users` page also gated. | `auth-actions.ts`, `admin/users/page.tsx` | §0 |
| S2 | ✅ **FIXED (2026-11-06)** — setup-wizard prices are read-only for non-super-admins; the save action takes prices from the catalogue (not the form) unless the caller is super-admin. Deal owners still set item selection, "included" and the setup-fee trigger. | `setup/page.tsx`, `setup/actions.ts` | §3.3, §9.6 |

### 🔴 P0 — Money correctness (wrong invoices)

| # | Gap | Evidence | Brief |
|---|---|---|---|
| M1 | **Payment `txn_value` is recomputed by the engine, not billed as posted.** Engine does `pctPart = round(value × pct/100)` and applies a **monthly** cap `q × cap` — treating `value` as the transaction base. The brief says the % + per-txn cap are **pre-computed at source** and posted as a billable amount (`quantity:1, value`), billed **as-is**; a per-txn cap can't be reconstructed from a monthly aggregate, so capped rails (Pay-by-Bank, CVRP, Direct Debits) will mis-bill when the cap binds. Tests lock in the wrong behaviour. | `engine.ts:196-206`; `engine.test.ts:136-142` | §5.5, §7.1 |
| M2 | **Flat fees billed in advance for the current month, not in arrears.** The run on the 1st should invoice the **month just ended**; the engine emits `"… (in advance)"` recurring lines. Violates "no line may reference a period after the run date." | `engine.ts:252-267` | §5.7 (confirmed: arrears only) |
| M3 | **No day-level final-month pro-rata on cancellation** — the end month still bills the full monthly fee; only whole-month suppression after the end month exists. | `engine.ts:230-231,252-267` | §5.7 |
| M4 | **No flat-item term windows.** `delayed_billing_start_by_month` / `billing_term_months` don't exist in the engine, so a fee can't be bounded to e.g. months 0–11. (Platform steps work via escalation, but genuine term-bounded fees can't be expressed.) **£0 flat lines are also suppressed** (brief says £0 is valid). | grep: 0 hits; `engine.ts:260` | §5.1, §10 |
| M5 | **OB AIS band-7 minimum seeded £4,000, should be £5,000.** Concrete value bug. | `productSeed.ts:71` (`gbp(4000)`) | §5.3, §10 (confirmed £5,000) |

### 🔴 P0 — Usage-API guardrails (financial-risk)

| # | Gap | Evidence | Brief |
|---|---|---|---|
| A1 | **Unknown `item_type` is silently accepted** (stored `not_configured`, HTTP 200). No catalogue validation, no atomic 400. The brief's `tu_call_report` guard never fires. | `usage.ts:145-147` | §7.1(5) |
| A2 | **No per-client monthly ceiling / 100×-error guard** — nothing holds an invoice in DRAFT on an over-value post (a £/pence unit mix-up invoices 100×). | grep: 0 hits | §7.1(6) |
| A3 | **No already-invoiced lock** — a closed period's usage can be overwritten; no 409 + invoice ref returned. | `usage.ts` (no invoice-state check) | §7.1 (confirmed: reject) |
| A4 | **No metric-shape validation** — any `quantity`/`value`/`principal` mix accepted; no reject of `quantity:1+value` on count items or count-only on `txn_value`. | `usage.ts:103-110` | §5.5, §7.1(final) |
| A5 | **Pre-computed `txn_value` path absent** — no `quantity:1` as-posted path, no `txn_count`/`txn_value` fields (ties to M1). Unselected-item usage is **dropped, not stored+logged**. | `usage.ts:103-110,147` | §7.1(3c, 9) |

### 🟠 P1 — Xero / compliance

| # | Gap | Evidence | Brief |
|---|---|---|---|
| X1 | **No per-client Auto/Draft.** AUTHORISED-vs-DRAFT is a single global `XERO_AUTO_APPROVE_FROM` date cutover, not the per-record `billing_type`. | `invoiceRun.ts:103,151-152` | §3.2 |
| X2 | **Xero tax types hard-coded** (`OUTPUT2` / `EXEMPTOUTPUT`); the Xero tax-rates endpoint is never queried. | `xero.ts:114` | §6 |
| X3 | **Daily status-sync is mis-wired.** The daily `billing-reconcile` cron does account provisioning; the real Xero paid-status pull runs only **monthly** (15th, inside dunning), and **amount-due is never persisted**. | `billing-reconcile/route.ts`, `dunning.ts:30-41`, `xero.ts:123-125` | §8 |
| X4 | **Everything runs in UTC** — no `Europe/London` for the 1st/15th boundaries or pro-rata day counts. | `invoiceRun.ts:16-19`, `dunning.ts:16-18` | §8 (confirmed Europe/London) |
| X5 | **No dry-run** on any job (a DRAFT run still writes to Xero + DB). | grep: 0 hits | §8, §11 |
| X6 | Chase-email idempotency relies on the monthly schedule, not an explicit per-owner-per-month guard (a same-day re-run re-sends). | `dunning.ts:83-105` | §11 |

### 🟠 P1 — Contract lifecycle & snapshotting

| # | Gap | Evidence | Brief |
|---|---|---|---|
| L1 | **Contract-lifecycle fields largely absent** — no `term_months`, `auto_renew`, `break_months`; notice stored as **days** not months; `renewal_decision_date` and `end_date` are **not computed**; `status` lacks `draft`/`ended`. | `058_billing_core.sql:64-79` | §3.2 |
| L2 | **No versioned billing record** — `billing_accounts` is edited in place; no `effective_from`/supersede, no "invoiced version frozen". (Versioning exists only on pricing tables.) | `repo.ts:278` | §2, §3.3 |
| L3 | **No line-level price snapshot** — invoices re-read the **current** catalogue for bands/metric/VAT; an in-place band edit reprices live contracts. Only effective-dating/"+ Version" protects history; **no per-client "re-sync from catalogue"** action. | `invoiceRun.ts:39-50` | §3.3, §9.5, §11 |
| L4 | **Setup-fee trigger not enforced** — `billing_trigger` (`on_contract_signed`) is captured but never read; the fee bills on the first invoice regardless of signed state. | `engine.ts:243-248`; `contract-status/route.ts` | §2, §5.1 |
| L5 | **Notice nudge** is **weekly** + a 0–30/0–60-day window, not daily and not keyed to `renewal_decision_date`. | `nudge.ts:41-49`; `vercel.json` | §2, §8 |
| L6 | **"Activate billing" does not create the Xero contact** (done lazily at first run). | `setup/actions.ts:67-106` | §2 |

### 🟡 P1/P2 — Deal-status API

| # | Gap | Evidence | Brief |
|---|---|---|---|
| D1 | Endpoint is `/api/billing/contract-status` (not `/api/deals/{id}/status`); body uses `effective_at` (not `occurred_at`), `source` hard-coded `"api"`, no `meta`; `status` is free-form and special-cases `"signed"` not `"contract_signed"`; **no "Mark contract signed" UI** (CRON-secret API only). | `contract-status/route.ts:15-50` | §7.2, §9.1 |

### 🟡 P2 — Catalogue / seed completeness

| # | Gap | Evidence | Brief |
|---|---|---|---|
| C1 | **`comms_sms` / `comms_whatsapp` per-number-/month £2.50 rows missing** — only the per-message component is seeded. | `productSeed.ts:135-137` | §4, §10 |
| C2 | **`open_banking_ais_fixed` (£0) row missing** — "included" is a config flag, not a seeded fixed row. | `productSeed.ts:62` | §10 |
| C3 | Missing columns: **`variant_id`, `currency`, `unit_discount`** (all grep-zero). Overrides are free-form jsonb, not typed `unit_price_override` / `minimum_monthly_fee_override` / `unit_cap_override`. | migrations | §3.1, §3.3 |
| C4 | Percentages stored as **percent** (`0.5`) not decimal (`0.005`); engine ÷100 (internally consistent). `platform_fee` modelled via escalation, not three rows + `billing_term_months=12`. | `productSeed.ts` | §3, §10 |

### 🟡 P2 — UI

| # | Gap | Evidence | Brief |
|---|---|---|---|
| U1 | Billing-record editor: **not grouped by product_group**, **prices editable not read-only**, **no computed end/renewal dates**, **no VAT-per-line**, **no escalation editor**, **no version history**. | `setup/page.tsx` | §9.3 |
| U2 | **No arbitrary client+month invoice dry-run screen** (only a first-invoice preview in the wizard). | `preview.ts` | §9.7 |
| U3 | **No deal-page billing controls / "Mark contract signed" button** — billing start lives on the Company page. | `deals/[id]/page.tsx` | §9.1 |
| U4 | Onboarding gating **hides** out-of-scope items (brief wants them **greyed with a reason**); the onboarding→catalogue map is **hardcoded** in `productSeed.ts` + an inline `faster_payments` rule, not config. | `setup/page.tsx:57-70` | §4 |
| U5 | No standalone `/admin` client-override screen (override is on the account-detail page); no per-client re-sync (see L3). | `[accountId]/page.tsx:101` | §9.5, §9.6 |

---

## Fix plan (ordered by go-live risk)

### Phase 0 — Decisions ✅ RESOLVED (Jim, 2026-11-06)
- [x] **Comms VAT → standard** (overrides the code's `exempt`). Fix the three comms rows in `productSeed.ts`.
- [x] **Catalogue architecture → keep product + bands** (no `variant_id`; many products have no bands). No refactor — close the gaps on the current model; `variant_id` is **out of scope** (drop it from C3).
- [x] **Payment % component → source pre-computes, VeepVeep bills as-is.** The feed posts the **already-computed final amount** for the % component (source applies the % and the per-txn cap); VeepVeep bills it **`quantity 1 × value`**, applying **no % and no cap**. The flat £/txn component is posted as a **count** and billed `count × rate` as its own line. One usage line carries both, e.g. `{ item_type: "direct_debits", quantity: 1222, value: 1232343 }` → "1,222 × £0.10" + "1 × £12,323.43". `value` is **pence**. Per-txn cap is description-only. This matches the brief's §5.5 (pre-computed at source). **Monevo `pct_of_principal` is the exception — VeepVeep still applies its 0.5%** (no per-txn cap).

### Phase 1 — Security ✅ DONE (2026-11-06)
- [x] **S1** gate `setUserRoleAction` with `isSuperAdmin()` (server-side) + gate the `/admin/users` page.
- [x] **S2** gate the setup-wizard price inputs to super-admin; deal owners get read-only catalogue prices + select/terms only (enforced in the save action too).

### Phase 2 — Money correctness + API guardrails (before any real invoice)
- [ ] **M5** OB band-7 minimum → £5,000 (one-line seed fix + re-seed).
- [ ] **M1 / A5** bill `txn_value` as posted (`line_net = value`); add the `quantity:1` pre-computed path + `txn_count`/`txn_value` fields; move `unit_price`/`cap` to description only; **fix the tests that assert the recompute**.
- [ ] **M2** switch recurring/flat to **arrears** (bill the just-ended month); drop "in advance".
- [ ] **M3** day-level pro-rata of the final month's flat fees to `cancelled_effective_date`.
- [ ] **M4** implement `delayed_billing_start_by_month` + `billing_term_months` windows; allow £0 flat lines.
- [ ] **A1** reject unknown `item_type` atomically (400, list bad keys).
- [ ] **A2** per-client monthly ceiling → hold invoice in DRAFT when exceeded.
- [ ] **A3** reject usage for an already-invoiced period (409 + invoice ref).
- [ ] **A4** metric-shape validation; **A5** store (don't drop) unselected-item usage + flag it.

### Phase 3 — Xero / compliance correctness (before go-live with real creds)
- [ ] **X2** read Xero tax types from the tax-rates endpoint; map standard/exempt to the org's codes.
- [ ] **X1** add per-record `billing_type` (Auto→AUTHORISED+send, Draft→DRAFT); keep the global cutover as a safety override.
- [ ] **X4** move all 1st/15th boundaries + pro-rata day counts to `Europe/London`.
- [ ] **X3** rewire a true daily invoice-status-sync (persist amount-due + status); stop conflating it with provisioning.
- [ ] **X5** add a `--dry-run` to every job; **X6** explicit per-owner-per-month chase guard.

### Phase 4 — Lifecycle & snapshotting
- [ ] **L1** add `term_months`, `auto_renew`, `break_months`, `notice_months`; compute `end_date` + `renewal_decision_date`; add `draft`/`ended` statuses.
- [ ] **L2** versioned billing record (effective_from, supersede, frozen-after-invoice).
- [ ] **L3** snapshot price terms onto the line at activation; add per-client "re-sync from catalogue".
- [ ] **L4** enforce `billing_trigger` (setup fee only after `contract_signed`); **L5** daily notice nudge keyed to `renewal_decision_date` (−30 and on-date); **L6** create Xero contact at activation.
- [ ] **D1** add a "Mark contract signed" button; align the status endpoint (config enum, `contract_signed`).

### Phase 5 — Catalogue/seed + UI polish
- [ ] **C1** comms per-number £2.50 rows; **C2** OB fixed £0 row; **C3** `currency`/`unit_discount`/typed overrides (and `variant_id` iff Phase-0 refactor chosen).
- [ ] **U1** grouped read-only selection + computed dates + VAT-per-line + escalation editor + version history; **U2** client+month dry-run screen; **U3** deal-page controls; **U4** grey out-of-scope items with a reason + config-drive the onboarding map; **U5** client-override admin view.

### Phase 6 — tests + HubSpot line-item pull (last, lowest risk)
- [ ] Extend tests per §11 (band boundaries, pre-computed amounts, arrears, cancellation pro-rata, term windows, escalation step boundaries); integration test vs a Xero demo org.
- [ ] HubSpot line-item pull (reporting only).

---

## Open questions for Jim
1. ~~Comms VAT~~ — ✅ standard.
2. ~~Catalogue model~~ — ✅ keep product + bands (no `variant_id`).
3. ~~Payments feed shape~~ — ✅ feed posts the **final amount** for the % component; VeepVeep bills `1 unit × value` (pence), no %/cap. Flat part billed `count × rate`. Monevo % still computed by us.
4. Payment `cap 3` = £3.00/txn — now description-only (cap not enforced), so this only affects the invoice-line text.
5. Onboarding→catalogue product-group mapping to confirm before go-live (§4).
