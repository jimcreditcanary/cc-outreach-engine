
# Credit Canary — Targeting Map

---

## 0. Operating principles (apply to every generated touch)

- **The focus of outreach is about driving relevance and not looking for quick wins or hard sells.** Keep Credit Canary in the consideration set with a genuinely useful, well-timed touch. The tone of outreach should be one of a thought-leader, low-pressure — *"if useful, let's talk; if not, no worries, I'll resurface in a few months."* Never drip-spam, never "just circling back", never quote the previous email.
- **Anonymisation is HARD (see §1).** Never name a client, quote a logo, or imply whose proof a metric belongs to. Convert every proof to a descriptor. A post-generation check rejects any draft containing a roster name.
- **Lead with one angle.** Pick the single most compelling signal for that contact; don't stack three. As much as possible, we need to put forward proprtiary insights first either as standalone statments e.g. *here is what we are seeing in the market* or *the market has said this, here is our response to this based on data*. The CTA should drive to my calendar invite link: https://creditcanary.pipedrive.com/scheduler/Mlm4k3h0/meeting-with-james-fell 
- **Payments loop (see §5).** When leading with payments, lead with the loop — *risk dictates payments, payments dictate risk* — not a rail list. 
- **Engagement = clicks and replies only.** Never opens.

---

## 1. Anonymisation lookup (proof → descriptor)

Every proof metric below is real but must be attributed only by descriptor. 

**Keep the metric, drop the name.** Reject any draft containing the left-column names.

| Real client (NEVER write) | Descriptor to use | Proof metrics (anonymised, usable) |
|---|---|---|
| **TSB** | "a tier 1 UK retail bank" | 40% of loan declines converted into responsible approvals; 4× increase in customer response rate; live within 6 months (pilot → expansion). Lever: Open Banking income identification + affordability on *declined* applications. |
| **GMB Credit Union** | "a large national credit union" | 28% increase in new lending; 13,000 admin hours saved; 50% lower origination cost; manual review cut from ~45 min. Same year, no extra staff or marketing spend. |
| **NE First Credit Union** | "a regional credit union" | Application review 45 min → 5 min (89% faster); 75% fewer missed payments via proactive pre-arrears intervention; 60% auto-decline efficiency. |

These are the key ones for now - we can update this table overtime. 

---

## 2. Capability spine (shared vocabulary)

Credit Canary's platform comprises **six modules** + a set of **data connections** + a set of **payment rails**.

Sector lanes below reference these by name.

**Modules**
- **Originate** — branded, on-brand application journeys; Open Banking data injection; real-time eligibility; verified data capture. Proof: 40%+ higher conversion vs incumbents, 85%+ zero-touch decision rate, <90s application time, 60% lower data cost.
- **Unify** — one enriched profile from bureau + Open Banking + internal/broker/CRM data. This is underpinned with a suite of proprietary ML models that cover both data quality, propensity models and more,
- **Decide** — configurable scorecards (weighted/rules), real-time affordability, explainable auto-decisioning; route edge cases to humans with full context. There is also the ability to risk price every decision e.g. people with good credit can be rewarded by the lender with X cheaper % APR or more lending options.
- **Pay** — every rail (Direct Debit, Pay by Bank, Faster Payments, BACS, settlement); pay-in, pay-out, reconcile. <1s execution, 99.9% reconciliation accuracy. We can also do settlement accounts too, allowing for more innovative use cases e.g. sweeping VRP.
- **Act** — proactive/next-best-action layer (pre-arrears intervention, collections workflow) delivered at scale via the lenders communication channel of choice.
- **Performance** — portfolio performance + payment-signal feedback into risk models, curated for specific roles.

**Data connections (`/connect/*`)** — Out of the box, Credit Canary offers:
 - Open Banking
 - Confirmation of Payee
 - Companies House Data
 - Physical IDV&V
 - Digital ID&V, as well as checks for Fraud, Deceased, PEPS, Sanctions and more
 - Transunion Bureau Data, namely: True Vision, Affordability and Call Report

We also have a banking app offering that we provide for clients as required.

---

## 3. Sector lanes

Each lane: who we're talking to, the problems, the CC capability that answers them, the proof to cite (anonymised), the content asset to attach, and the angle to lead with.

### bank — `/audience/banks.html`
- **Buyers:** Head of Unsecured Lending, Chief Risk Officer, Head of Credit Risk, Head of Collections, Director of Lending Transformation, Chief Operating Officer, Chief Customer Officer, Head of Product, Head of Propositions.
- **Problems:** false declines (rigid affordability + static bureau data reject creditworthy applicants); rising cost-to-serve (manual underwriting, 10–15 siloed systems); Consumer Duty demands individualised, outcomes-based assessment.
- **Capability:** Unify + Decide (explainable, affordability-rich decisioning); Originate; Pay feeding Performance.
- **Proof:** tier 1 UK retail bank — 40% of declines converted to responsible approvals, 4× response rate uplift.
- **Content:** TSB case study (anonymised), `/use-cases/income-identification`, `/use-cases/affordability-analysis`.
- **Angle:** "Reworking declines into responsible approvals" — the revenue hiding in the decline pile.

### building_society — `/audience/building-societies.html`
- **Buyers** CEO, Head of Mortgages/Lending, Head of Intermediary/Broker, COO, Head of Operations, Head of Transformation
- **Problems:** lengthy manual mortgage underwriting (paper-heavy, multi-day); poor broker connectivity (60%+ cite intermediary digital as top priority); disproportionate regulatory cost vs scale.
- **Opportunity hook:** UK government doubling the mutual/co-op sector (£165.7bn, 3.5% of GDP); 50% of building-society CEOs changed since 2021.
- **Capability:** Decide (complex-case decisioning) + Unify + Originate (broker connectivity).
- **Proof:** complex-case review <5 min, 89% faster decisions `[REVIEW: which descriptor]`.
- **Content:** `/use-cases/complex-case-decisioning`, `/audience/building-societies`.
- **Angle:** "A once-in-a-generation mutual growth moment — modernise mortgage decisioning before competitors capture it."

### credit_union — `/audience/credit-unions.html`
- **Buyers** CEO, COO, Head of Lending, Head of Loans, Underwriting Lead, Lending Manager, Operations Manager, Head of Credit.
- **Problems:** manual underwriting (45+ min/application); disconnected systems block broker/car-finance origination; paying over the odds for limited bureau data, missing real-time income/expenditure.
- **Capability:** Originate + Unify + Decide (AI underwriting, up to 89% review-time reduction) + Act (pre-arrears).
- **Proof:** large national credit union — 28% more lending, 13k hours saved, 50% lower origination cost. Regional credit union — 45→5 min reviews, 75% fewer missed payments.
- **Content:** GMB + NE First case studies (anonymised), `/use-cases/complex-case-decisioning`.
- **Angle:** "Grow lending without growing the team" / "see who needs help before they miss a payment."

### direct_lender — `/audience/direct-lenders.html`
- **Buyers** Head of Unsecured Lending, Chief Risk Officer, Head of Credit Risk, Head of Collections, Director of Lending Transformation, Chief Operating Officer, Chief Customer Officer, Head of Product, Head of Propositions.
- **Problems:** data gaps (thin-file, single-CRA, stale snapshots); scaling across product lines (cards, BNPL, car finance, personal loans) hits a wall; regulation catching up (BNPL under FCA, tighter CRA sharing).
- **Capability:** Unify (multi-source) + Decide (adaptive scorecards) + Pay (close the loop) + straight-through processing.
- **Proof:** STP <2s, zero manual touchpoints; Originate 40%+ conversion uplift.
- **Content:** `/use-cases/straight-through-processing`, `/use-cases/smart-origination`.
- **Angle:** "Data quality is your moat — out-decision the banks, one platform across every product line."

### sme_lender — `/audience/sme-lenders.html`
- **Buyers** CEO, COO, Head of Lending, Head of Underwriting, Head of Credit, Head of Operations.
- **Problems:** opaque borrower data (SMEs lack corporate-grade reporting); slow manual underwriting (weeks); collections without real-time cash-flow visibility.
- **Capability:** Unify (Open Banking + Xero + Companies House + bureau) + Decide (AI appraisal agents) + Act (collections).
- **Proof:** AI appraisal in minutes; accurate end-of-day balances widening the funnel.
- **Content:** `/use-cases/affordability-analysis`, `/audience/sme-lenders`.
- **Angle:** "See the full picture of business health — real liquidity, not just filed accounts."

### broker — `/audience/brokers.html`
- **Buyers** Principal/Owner, Head of Lending Panel / Marketplace / Lenders, Operations Director.
- **Problems:** wasted lead spend when the panel declines; limited lender-panel reach; slow lender connectivity.
- **Capability:** Originate (lead enrichment) + Unify (enriched profile lenders trust) + Decide (Decisioning API pre-filter / lender matching).
- **Proof:** conversion lifted from sub-15% to 80%+ (marketplace proof, transferable). `[REVIEW]`
- **Content:** `/audience/brokers`, `/use-cases/smart-origination`.
- **Angle:** "Stop wasting placed-and-declined lead spend — enrich the lead, match it to a lender that says yes."

### marketplace — `/audience/marketplaces.html`
- **Buyers** CEO/Founder, Head of Partnerships, Head of Product, Lender Ops.
- **Problems:** slow lender onboarding (weeks, bespoke); poor conversion (industry avg <15%); fragmented per-lender reporting.
- **Capability:** Originate (whitelabel journeys) + Decide (sub-second pre-approved offers via API) + central product/pricing/rules management.
- **Proof:** conversion sub-15% → 80%+; pre-approved offers in <1s.
- **Content:** `/audience/marketplaces`, `/use-cases/smart-origination`.
- **Angle:** "Seamless lead-to-lender handoff — pre-approved offers in under a second, conversion past 80%."

### utility — `/audience/utilities.html`
- **Buyers** Head of Credit/Collections, Head of Customer Debt, Director of Green Finance/Propositions.
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

**Risk dictates payments, payments dictate risk.** Payment behaviour (DD failures, Pay-by-Bank patterns) is a live risk signal; feeding it back into Decide/Performance catches problems earlier than any bureau refresh. Lead with the *loop*, not a rail list. Collections is where the loop is most visible: when a payment is missed, the next-best-action is data-driven (Act).

To add a bit more detail here, these payments contracts are way more lucrative than the decisioning and can be an easier win, especially if they have reviews pending.

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

### Monitor List
https://www.fca.org.uk/news
https://www.psr.org.uk/news-and-updates/
https://www.bankofengland.co.uk/news

---

## 7. Sector enum reconciliation 

261 of 496 curated orgs don't map to the 8 enum lanes from their `industry` value. For these, can you surface them daily, maybe 5-10 a day, and I'll provide the necessary intelligence.