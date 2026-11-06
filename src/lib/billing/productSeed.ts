// Billing v2 — the Product Library bootstrap, translated from billingv2.xlsx.
//
// This is the CANONICAL product list the seed writes into the DB. After seeding,
// the DB (billing_pricing_tables + billing_pricing_bands) is the source of truth
// and the /admin product-library UI edits it — new products can be added there.
// catalogue.ts derives its shape (key/label/metric/vat/group) from this array.
//
// UNITS. Prices here are written in NATURAL units for readability and converted
// to the DB's integer pence at seed time:
//   • gbp() turns pounds into pence (unit prices, minimums, caps).
//   • `pct` is a PERCENT number (0.5 = 0.5%), matching the engine (pctPart =
//     value × pct/100). The sheet's decimal fractions (0.005) are ×100 here.
// Band ranges are inclusive [from,to]; the top band has to=null (unbounded).
//
// band_mode 'volume' (confirmed with Jim): the month's total volume lands in ONE
// tier; every unit is charged at that tier's rate and that tier's monthly
// minimum applies. (Not graduated slices.)

import type { Metric, VatTreatment } from "./catalogue";

const gbp = (pounds: number): number => Math.round(pounds * 100);

export interface SeedBand {
  from: number;
  to: number | null;
  unit_pence: number;
  min_monthly_pence?: number; // the tier's monthly minimum (volume mode)
  cap_pence?: number;         // per-txn cap on a % component
}

export interface SeedProduct {
  key: string;                // item_type — stable product key
  label: string;
  group: string;              // product_group (onboarding-aligned where it maps)
  metric: Metric;
  type: "fixed" | "variable";
  vat: VatTreatment;
  frequency?: "monthly" | "one_off" | null; // billing_frequency (fixed lines); null = usage/arrears
  band_mode?: "volume" | "graduated";        // default 'volume'
  config?: Record<string, unknown>;          // amount_pence / fixed_pence / pct / cap_pence / per_application_pence / escalation_relative / included
  bands?: SeedBand[];                         // volume tiers; omitted → single flat band at unit_pence
  unit_pence?: number;                        // flat per-unit price (single-band products)
  notes?: string;                             // internal_notes
}

// ─── core (always offered) ────────────────────────────────────────────────────
const CORE: SeedProduct[] = [
  { key: "setup_fee", label: "Setup / Integration Fee", group: "core", metric: "flat_monthly", type: "fixed", vat: "standard", frequency: "one_off",
    config: { amount_pence: gbp(10000) }, notes: "One-off, billed on the first invoice." },
  { key: "platform_fee", label: "Platform fee", group: "core", metric: "flat_monthly", type: "fixed", vat: "standard", frequency: "monthly",
    config: { amount_pence: gbp(2500), escalation_relative: [
      { start_month: 0, amount_pence: gbp(2500) },   // Year 1
      { start_month: 12, amount_pence: gbp(3500) },  // Year 2
      { start_month: 24, amount_pence: gbp(4500) },  // Year 3
    ] }, notes: "Escalates yearly. escalation_relative is resolved to absolute dates against contract_start at account setup." },
  { key: "support_fee", label: "Support fee", group: "core", metric: "flat_monthly", type: "fixed", vat: "standard", frequency: "monthly",
    config: { amount_pence: gbp(500) } },
];

// ─── Open Banking (AIS) — banded (volume), or sold "included" per account ──────
const OPEN_BANKING: SeedProduct[] = [
  { key: "open_banking_ais", label: "Open Banking (AIS)", group: "open_banking_data", metric: "per_account_month", type: "variable", vat: "standard", band_mode: "volume",
    config: { included: false },
    bands: [
      { from: 0,      to: 1000,   unit_pence: gbp(0.33), min_monthly_pence: gbp(250) },
      { from: 1001,   to: 5000,   unit_pence: gbp(0.25), min_monthly_pence: gbp(1000) },
      { from: 5001,   to: 12500,  unit_pence: gbp(0.20), min_monthly_pence: gbp(1500) },
      { from: 12501,  to: 25000,  unit_pence: gbp(0.16), min_monthly_pence: gbp(2000) },
      { from: 25001,  to: 50000,  unit_pence: gbp(0.10), min_monthly_pence: gbp(2500) },
      { from: 50001,  to: 100000, unit_pence: gbp(0.08), min_monthly_pence: gbp(4000) },
      { from: 100001, to: null,   unit_pence: gbp(0.04), min_monthly_pence: gbp(5000) }, // band 7 minimum £5,000 (Jim 2026-11-06)
    ],
    notes: "Can be sold INCLUDED (fixed, zero-rated): set the account item's config.included=true and any OB usage reported via the API is ignored (not double-billed)." },
  // C2 — explicit £0 fixed line for OB AIS sold as part of a package (as opposed
  // to the variable banded product above with included=true). A visible £0
  // monthly line on the invoice; no usage key.
  { key: "open_banking_ais_fixed", label: "Open Banking (AIS) — included (fixed)", group: "open_banking_data", metric: "flat_monthly", type: "fixed", vat: "standard", frequency: "monthly",
    config: { included: true, amount_pence: gbp(0) }, notes: "OB AIS sold included in a package — bills a £0 monthly line; OB usage reported via the API is ignored." },
];

// ─── TU credit (flat per-request) ─────────────────────────────────────────────
const TU: SeedProduct[] = ([
  ["tu_call_report_qs", "TU Call Report — Quotation Search", 1.25],
  ["tu_call_report_ca", "TU Call Report — Hard Search", 1.25],
  ["tu_auto_address_search", "TU Auto Address Search", 0.78],
  ["tu_affordability", "TU Affordability", 2.50],
  ["tu_true_vision", "TU TrueVision", 2.50],
  ["tu_callml", "TU CallML", 1.25],
  ["tu_watchlist", "TU Watchlist", 0.37],
  ["tu_deceased", "TU Deceased", 0.52],
  ["tu_bank_account_id", "TU Bank Account ID", 0.32],
  ["tu_bank_element", "TU Bank Element", 0.68],
  ["tu_bank_account_premium", "TU Bank Account Premium", 0.44],
  ["tu_ownership_fraud", "TU Ownership Fraud", 0.45],
  ["tu_realtime_fraud", "TU Real-time Fraud", 0.65],
] as [string, string, number][]).map(([key, label, price]) => ({
  key, label, group: "tu_credit", metric: "per_request" as Metric, type: "variable" as const, vat: "standard" as VatTreatment, unit_pence: gbp(price),
}));

// ─── Monevo broker fee — one product, two components ──────────────────────────
const MONEVO: SeedProduct[] = [
  { key: "monevo_broker_fee", label: "Monevo broker fee", group: "tu_monevo", metric: "pct_of_principal", type: "variable", vat: "standard",
    config: { pct: 0.5, per_application_pence: gbp(2.50) },
    notes: "Two components (Jim 2026-11-01): 0.5% of total loan principal + £2.50 per application. Usage reports quantity = applications, principal = total principal." },
];

// ─── Confirmation of Payee — banded (volume) ──────────────────────────────────
const COP: SeedProduct[] = [
  { key: "cop", label: "Confirmation of Payee", group: "confirmation_of_payee", metric: "per_request", type: "variable", vat: "standard", band_mode: "volume",
    bands: [
      { from: 0,     to: 1000,  unit_pence: gbp(0.50) },
      { from: 1001,  to: 5000,  unit_pence: gbp(0.25) },
      { from: 5001,  to: 10000, unit_pence: gbp(0.20) },
      { from: 10001, to: 25000, unit_pence: gbp(0.15) },
      { from: 25001, to: null,  unit_pence: gbp(0.10) },
    ] },
];

// ─── Payment rails (VAT exempt) — per-request fixed + % of value, some capped ──
const PAYMENTS: SeedProduct[] = [
  { key: "pay_by_bank", label: "Pay by Bank", group: "pay_by_bank", metric: "per_txn_fixed_and_pct", type: "variable", vat: "exempt",
    config: { fixed_pence: gbp(0.10), pct: 0.5, cap_pence: gbp(3) }, notes: "£0.10/txn + 0.5% of value, % capped at £3/txn." },
  { key: "faster_payments", label: "Faster Payments", group: "faster_payments", metric: "per_txn_fixed", type: "variable", vat: "exempt",
    config: { fixed_pence: gbp(0.25) }, notes: "gbp0.25 per payment." },
  { key: "settlement_accounts", label: "Settlement accounts", group: "settlement_accounts", metric: "per_account_month", type: "variable", vat: "exempt", frequency: "monthly",
    unit_pence: gbp(1), notes: "£1 per settlement account per month. Usage reports quantity = open accounts." },
  { key: "sweeping_vrp", label: "Sweeping VRP", group: "sweeping_vrp", metric: "per_txn_fixed_and_pct", type: "variable", vat: "exempt",
    config: { fixed_pence: gbp(0.10), pct: 0.5 }, notes: "£0.10/txn + 0.5% of value (uncapped)." },
  { key: "cvrp", label: "CVRP", group: "cvrp", metric: "per_txn_fixed_and_pct", type: "variable", vat: "exempt",
    config: { fixed_pence: gbp(0.10), pct: 0.75, cap_pence: gbp(3) }, notes: "£0.10/txn + 0.75% of value, % capped at £3/txn." },
  { key: "direct_debits", label: "Direct Debits", group: "direct_debits", metric: "per_txn_fixed_and_pct", type: "variable", vat: "exempt",
    config: { fixed_pence: gbp(0.10), pct: 0.75, cap_pence: gbp(3) }, notes: "£0.10/txn + 0.75% of value, % capped at £3/txn." },
  { key: "cards", label: "Card Payments", group: "cards", metric: "per_txn_fixed_and_pct", type: "variable", vat: "exempt",
    config: { fixed_pence: gbp(0.10), pct: 0.95 }, notes: "£0.10/txn + 0.95% of value. NOTE: no onboarding product-group for cards yet — add one if sold standalone." },
];

// ─── Communications ───────────────────────────────────────────────────────────
// Comms are chargeable for VAT → standard (Jim 2026-11-06, supersedes the
// earlier 2026-11-01 "exempt" call).
const COMMS: SeedProduct[] = [
  { key: "comms_email", label: "Communications — Email", group: "comms", metric: "per_message", type: "variable", vat: "standard", unit_pence: gbp(0) },
  { key: "comms_sms", label: "Communications — SMS", group: "comms", metric: "per_message", type: "variable", vat: "standard", unit_pence: gbp(0.06), notes: "Could be banded like other volume products in future." },
  { key: "comms_whatsapp", label: "Communications — WhatsApp", group: "comms", metric: "per_message", type: "variable", vat: "standard", unit_pence: gbp(0.01) },
  // C1 — the per-number-per-month rental (£2.50/number/mo) that sits alongside
  // the per-message charge for SMS and WhatsApp. Usage reports quantity = active
  // numbers. VAT standard (comms are chargeable).
  { key: "comms_sms_numbers", label: "Communications — SMS numbers", group: "comms", metric: "per_number_month", type: "variable", vat: "standard", unit_pence: gbp(2.50), notes: "£2.50 per SMS number per month." },
  { key: "comms_whatsapp_numbers", label: "Communications — WhatsApp numbers", group: "comms", metric: "per_number_month", type: "variable", vat: "standard", unit_pence: gbp(2.50), notes: "£2.50 per WhatsApp number per month." },
];

export const PRODUCTS: SeedProduct[] = [
  ...CORE, ...OPEN_BANKING, ...TU, ...MONEVO, ...COP, ...PAYMENTS, ...COMMS,
];

// Product-group monthly minimums (the sheet's "minimum spend for a whole
// category e.g. TU"). Value TBC by Jim — seeded at 0 (no floor) with a note.
export interface SeedGroupMinimum { product_group: string; minimum_pence: number; note: string }
export const GROUP_MINIMUMS: SeedGroupMinimum[] = [
  { product_group: "tu_credit", minimum_pence: 0, note: "Category minimum spend across all TU items (sheet note). Set the pounds value." },
];
