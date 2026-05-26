# Credit Canary — Targeting Map

> **Status: v0 draft, Claude-generated from creditcanary.co.uk content + the build brief.**
> Jim to review and correct. `[REVIEW]` marks anything inferred (buyer titles, angle
> phrasing, sector reconciliation) rather than lifted from the site.
>
> This is **engine config**. It defines, per sector: the problems buyers face → the Credit
> Canary capability that answers them → the anonymised proof → the content asset to attach →
> the angle to lead with. Plus the anonymisation lookup, regulatory triggers, and the
> payments loop. The generator and the daily queue read this; nothing here is sent verbatim.

---

## 0. Operating principles (apply to every generated touch)

- **Relevance, not a hard sell.** Keep CC in the consideration set with a genuinely useful,
  well-timed touch. Tone: thought-leader, low-pressure — *"if useful, let's talk; if not, no
  worries, I'll resurface in a few months."* Never drip-spam, never "just circling back",
  never quote the previous email.
- **Anonymisation is HARD (see §1).** Never name a client, quote a logo, or imply whose proof
  a metric belongs to. Convert every proof to a descriptor. A post-generation check rejects
  any draft containing a roster name.
- **Lead with one angle.** Pick the single most compelling signal for that contact; don't
  stack three.
- **Payments loop (see §5).** When leading with payments, lead with the loop — *risk dictates
  payments, payments dictate risk* — not a rail list.
- **Engagement = clicks and replies only.** Never opens.

---

## 1. Anonymisation lookup (proof → descriptor)

Every proof metric below is real but must be attributed only by descriptor. **Keep the metric,
drop the name.** Reject any draft containing the left-column names.

| Real client (NEVER write) | Descriptor to use | Proof metrics (anonymised, usable) |
|---|---|---|
| **TSB** | "a tier 1 UK retail bank" | 40% of loan declines converted into responsible approvals; 4× increase in customer response rate; live within 6 months (pilot → expansion). Lever: Open Banking income identification + affordability on *declined* applications. |
| **GMB Credit Union** | "a large national credit union" | 28% increase in new lending; 13,000 admin hours saved; 50% lower origination cost; manual review cut from ~45 min. Same year, no extra staff or marketing spend. |
| **NE First Credit Union** | "a regional credit union" | Application review 45 min → 5 min (89% faster); 75% fewer missed payments via proactive pre-arrears intervention; 60% auto-decline efficiency. |

> `[REVIEW]` Add any other clients/logos that must never appear (current pipeline, partners,
> reference accounts) with their descriptors.

---

## 2. Capability spine (shared vocabulary)

CC's platform is **six modules** + a set of **data connections**. Sector lanes below reference
these by name.

**Modules**
- **Originate** — branded, on-brand application journeys; Open Banking data injection; real-time
  eligibility; verified data capture. Proof: 40%+ higher conversion vs incumbents, 85%+
  zero-touch decision rate, <90s application time, 60% lower data cost.
- **Unify** — one enriched profile from bureau + Open Banking + internal/broker/CRM data.
- **Decide** — configurable scorecards (weighted/rules), real-time affordability, explainable
  auto-decisioning; route edge cases to humans with full context.
- **Pay** — every rail (Direct Debit, Pay by Bank, Faster Payments, BACS, settlement); pay-in,
  pay-out, reconcile. <1s execution, 99.9% reconciliation accuracy.
- **Act** — proactive/next-best-action layer (pre-arrears intervention, collections workflow).
- **Performance** — portfolio performance + payment-signal feedback into risk models.

**Data connections (`/connect/*`)** — Open Banking, HMRC, Confirmation of Payee, Company
Information, Identity Score, Physical IDV, TrueVision, TransUnion Affordability, Call & Report,
Call & Validate, Standalone Checks.

---

## 3. Sector lanes

Each lane: who we're talking to, the problems, the CC capability that answers them, the proof
to cite (anonymised), the content asset to attach, and the angle to lead with.

### bank — `/audience/banks.html`
- **Buyers** `[REVIEW]`: Head of Unsecured Lending, Chief Risk Officer, Head of Credit Risk, Head of Collections, Director of Lending Transformation.
- **Problems:** false declines (rigid affordability + static bureau data reject creditworthy applicants); rising cost-to-serve (manual underwriting, 10–15 siloed systems); Consumer Duty demands individualised, outcomes-based assessment.
- **Capability:** Unify + Decide (explainable, affordability-rich decisioning); Originate; Pay feeding Performance.
- **Proof:** tier 1 UK retail bank — 40% of declines converted to responsible approvals, 4× response rate.
- **Content:** TSB case study (anonymised), `/use-cases/income-identification`, `/use-cases/affordability-analysis`.
- **Angle:** "Reworking declines into responsible approvals" — the revenue hiding in the decline pile.

### building_society — `/audience/building-societies.html`
- **Buyers** `[REVIEW]`: CEO, Head of Mortgages/Lending, Head of Intermediary/Broker, COO.
- **Problems:** lengthy manual mortgage underwriting (paper-heavy, multi-day); poor broker connectivity (60%+ cite intermediary digital as top priority); disproportionate regulatory cost vs scale.
- **Opportunity hook:** UK government doubling the mutual/co-op sector (£165.7bn, 3.5% of GDP); 50% of building-society CEOs changed since 2021.
- **Capability:** Decide (complex-case decisioning) + Unify + Originate (broker connectivity).
- **Proof:** complex-case review <5 min, 89% faster decisions `[REVIEW: which descriptor]`.
- **Content:** `/use-cases/complex-case-decisioning`, `/audience/building-societies`.
- **Angle:** "A once-in-a-generation mutual growth moment — modernise mortgage decisioning before competitors capture it."

### credit_union — `/audience/credit-unions.html`
- **Buyers** `[REVIEW]`: CEO, Lending Manager, Operations Manager, Head of Credit.
- **Problems:** manual underwriting (45+ min/application); disconnected systems block broker/car-finance origination; paying over the odds for limited bureau data, missing real-time income/expenditure.
- **Capability:** Originate + Unify + Decide (AI underwriting, up to 89% review-time reduction) + Act (pre-arrears).
- **Proof:** large national credit union — 28% more lending, 13k hours saved, 50% lower origination cost. Regional credit union — 45→5 min reviews, 75% fewer missed payments.
- **Content:** GMB + NE First case studies (anonymised), `/use-cases/complex-case-decisioning`.
- **Angle:** "Grow lending without growing the team" / "see who needs help before they miss a payment."

### direct_lender — `/audience/direct-lenders.html`
- **Buyers** `[REVIEW]`: CEO/Founder, CRO, Head of Credit, Head of Product.
- **Problems:** data gaps (thin-file, single-CRA, stale snapshots); scaling across product lines (cards, BNPL, car finance, personal loans) hits a wall; regulation catching up (BNPL under FCA, tighter CRA sharing).
- **Capability:** Unify (multi-source) + Decide (adaptive scorecards) + Pay (close the loop) + straight-through processing.
- **Proof:** STP <2s, zero manual touchpoints; Originate 40%+ conversion uplift.
- **Content:** `/use-cases/straight-through-processing`, `/use-cases/smart-origination`.
- **Angle:** "Data quality is your moat — out-decision the banks, one platform across every product line."

### sme_lender — `/audience/sme-lenders.html`
- **Buyers** `[REVIEW]`: Head of Credit, Head of Underwriting, CRO, Founder.
- **Problems:** opaque borrower data (SMEs lack corporate-grade reporting); slow manual underwriting (weeks); collections without real-time cash-flow visibility.
- **Capability:** Unify (Open Banking + Xero + Companies House + bureau) + Decide (AI appraisal agents) + Act (collections).
- **Proof:** AI appraisal in minutes; accurate end-of-day balances widening the funnel. `[REVIEW: SME-specific proof metric?]`
- **Content:** `/use-cases/affordability-analysis`, `/audience/sme-lenders`.
- **Angle:** "See the full picture of business health — real liquidity, not just filed accounts."

### broker — `/audience/brokers.html`
- **Buyers** `[REVIEW]`: Principal/Owner, Head of Lending Panel, Operations Director.
- **Problems:** wasted lead spend when the panel declines; limited lender-panel reach; slow lender connectivity.
- **Capability:** Originate (lead enrichment) + Unify (enriched profile lenders trust) + Decide (Decisioning API pre-filter / lender matching).
- **Proof:** conversion lifted from sub-15% to 80%+ (marketplace proof, transferable). `[REVIEW]`
- **Content:** `/audience/brokers`, `/use-cases/smart-origination`.
- **Angle:** "Stop wasting placed-and-declined lead spend — enrich the lead, match it to a lender that says yes."

### marketplace — `/audience/marketplaces.html`
- **Buyers** `[REVIEW]`: CEO/Founder, Head of Partnerships, Head of Product, Lender Ops.
- **Problems:** slow lender onboarding (weeks, bespoke); poor conversion (industry avg <15%); fragmented per-lender reporting.
- **Capability:** Originate (whitelabel journeys) + Decide (sub-second pre-approved offers via API) + central product/pricing/rules management.
- **Proof:** conversion sub-15% → 80%+; pre-approved offers in <1s.
- **Content:** `/audience/marketplaces`, `/use-cases/smart-origination`.
- **Angle:** "Seamless lead-to-lender handoff — pre-approved offers in under a second, conversion past 80%."

### utility — `/audience/utilities.html`
- **Buyers** `[REVIEW]`: Head of Credit/Collections, Head of Customer Debt, Director of Green Finance/Propositions.
- **Problems:** spiralling domestic energy debt (>£4.4bn, +71% since 2023); rising Direct Debit failure (0.9% → 2%+); green-finance origination at scale (Warm Homes Plan); regulatory complexity (Ofgem Debt Relief Scheme, Consumer Duty).
- **Capability:** Pay (DD/Open Banking/Pay by Bank) + Act (proactive pre-arrears) + Decide (affordability + green-finance models) + Originate.
- **Proof:** collections — 2.4× collection-rate uplift, 60–80% arrangement conversion. `[REVIEW: utility-specific descriptor]`
- **Content:** `/use-cases/collections-optimisation`, `/use-cases/utilities-calculator`, `/audience/utilities`.
- **Angle:** "Two problems, one platform — cut energy debt with proactive intervention while standing up green-finance lending."

---

## 4. Problem lanes (cross-sector, from `/use-cases/*`)

Use when a signal points at a specific problem rather than a sector.

| Problem lane | Asset | Anonymised proof |
|---|---|---|
| Affordability analysis | `/use-cases/affordability-analysis` | 25+ banks connected, 1000s of risk flags, 7yr transaction depth, 3 affordability methods |
| Income identification | `/use-cases/income-identification` | <2 min verification; 54% of fraud uses fake payslips (Open Banking solves) |
| Complex-case decisioning | `/use-cases/complex-case-decisioning` | <5 min review, 89% faster, 110 hrs saved/month |
| Smart origination | `/use-cases/smart-origination` | 40%+ higher conversion, 85%+ zero-touch, <90s apply, 60% lower data cost |
| Straight-through processing | `/use-cases/straight-through-processing` | <2s processing, zero manual touchpoints, 99.9% uptime |
| Collections optimisation | `/use-cases/collections-optimisation` | 2.4× collection uplift, 60–80% conversion, £30bn UK DD failure problem |
| Payments automation | `/use-cases/payments-automation` | 5 rails, <1s execution, 99.9% reconciliation |

---

## 5. The payments loop (lead with this when angle = payments)

> **Risk dictates payments, payments dictate risk.** Payment behaviour (DD failures, Pay-by-Bank
> patterns) is a live risk signal; feeding it back into Decide/Performance catches problems
> earlier than any bureau refresh. Lead with the *loop*, not a rail list. Collections is where
> the loop is most visible: when a payment is missed, the next-best-action is data-driven (Act).

---

## 6. Regulatory triggers → angle

When one of these lands as a signal (press, consultation, deadline), it's a reason to reach out.

| Trigger | Lands for | Lead capability / angle |
|---|---|---|
| **APP fraud reimbursement** | banks, direct_lenders, marketplaces | Confirmation of Payee — verify payee before payout |
| **Consumer Duty** (outcomes, vulnerable customers) | all lending sectors | Affordability + Act — individualised, outcomes-based assessment & proactive support |
| **BNPL under FCA oversight** | direct_lenders, marketplaces | Decide + affordability — get BNPL decisioning regulator-ready |
| **Tighter CRA data-sharing rules** | direct_lenders, banks | Unify + Open Banking — reduce single-CRA dependence |
| **Ofgem Debt Relief Scheme / energy debt** | utility | Act + Pay — proactive pre-arrears, affordable arrangements |
| **Warm Homes Plan / green finance** | utility | Originate + Decide — stand up consumer green-finance lending |
| **Mutual-sector doubling (gov co-op/mutual policy)** | building_society, credit_union | modernise decisioning to capture the growth window |

> `[REVIEW]` Add specific live consultations/deadlines you want monitored as RSS/press triggers.

---

## 7. Sector enum reconciliation `[REVIEW — needs Jim's call]`

261 of 496 curated orgs don't map to the 8 enum lanes from their `industry` value. Proposed mapping:

| Raw `industry` value | Proposed lane | Note |
|---|---|---|
| Auto Finance / Automotive | `direct_lender` | car-finance lenders; CU car-finance partnerships also relevant |
| Platforms | `marketplace` | `[REVIEW]` confirm vs a partner classification |
| Banks, Auto Finance (combo) | `bank` | take primary |
| CDFI | `credit_union` | `[REVIEW]` closest community-lending lane, or its own |
| Bureaus | — | likely **partner/vendor**, not buyer — exclude? |
| Consulting / Management Consultants | — | likely **partner** (Partner Category set) — exclude from outreach |
| Insurance / Telco / Internet Software | — | `[REVIEW]` out of current ICP sectors? |
| (blank, 211) | use `customer_sub_category` | Loans/Mortgages/Credit Cards/BNPL/DCA/Broker/P2P — `[REVIEW]` decide whether sub-category drives the lane |

**Decision needed:** keep the 8-value enum and drive unmapped orgs off `customer_sub_category`,
or extend the enum (e.g. add `auto_finance`)? Once you decide, I'll backfill `sector` and tag
the content assets accordingly.
