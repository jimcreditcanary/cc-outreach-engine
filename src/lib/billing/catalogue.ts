// Billing item catalogue — the single source of truth for the closed set of
// item types, their default metric, VAT treatment and the onboarding product
// group that unlocks them. Used by the seed script (to create one PLACEHOLDER
// pricing table per item) and by the app (validation + the Phase-2 setup wizard,
// which only offers items whose product group the case was onboarded for).
//
// Prices/bands are NOT here — they live in billing_pricing_tables, are
// super-admin-editable and effective-dated. These are only the catalogue shape.

export const METRICS = [
  "per_request",
  "per_account_month",
  "per_txn_fixed",
  "per_txn_pct",
  "per_txn_fixed_and_pct",
  "per_message",
  "per_number_month",
  "flat_monthly",
  "pct_of_principal",
  "per_application",
] as const;
export type Metric = (typeof METRICS)[number];

export const VAT_TREATMENTS = ["standard", "exempt", "out_of_scope"] as const;
export type VatTreatment = (typeof VAT_TREATMENTS)[number];

export const ACCOUNT_STATUSES = ["setup_pending", "active", "notice_given", "cancelled", "disputed"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export interface CatalogueEntry {
  /** item_type — stable key, matches billing_pricing_tables.item_type / billing_items.item_type. */
  key: string;
  label: string;
  metric: Metric;
  /** Default VAT treatment. EDITABLE by a super-admin + confirmed with finance
   *  before go-live (Assumption 3). Payment-rail items default exempt. */
  vat: VatTreatment;
  /** Onboarding product-group key that unlocks this item (matches the wizard's
   *  product_groups), or "core" (always offered) / "comms". */
  productGroup: string;
}

// VAT defaults per brief Assumption 3 — PLACEHOLDER, super-admin editable,
// finance-confirmed before go-live. Payment rails = exempt; everything else
// standard 20%.
export const CATALOGUE: CatalogueEntry[] = [
  { key: "setup_fee", label: "Setup fee", metric: "flat_monthly", vat: "standard", productGroup: "core" },
  { key: "platform_fee", label: "Platform fee", metric: "flat_monthly", vat: "standard", productGroup: "core" },
  { key: "support_fee", label: "Support fee", metric: "flat_monthly", vat: "standard", productGroup: "core" },
  { key: "open_banking_ais", label: "Open Banking (AIS)", metric: "per_account_month", vat: "standard", productGroup: "open_banking_data" },
  { key: "tu_call_report", label: "TU Call Report", metric: "per_request", vat: "standard", productGroup: "tu_credit" },
  { key: "tu_auto_search", label: "TU Auto Search", metric: "per_request", vat: "standard", productGroup: "tu_credit" },
  { key: "tu_affordability", label: "TU Affordability", metric: "per_request", vat: "standard", productGroup: "tu_credit" },
  { key: "tu_true_vision", label: "TU TrueVision", metric: "per_request", vat: "standard", productGroup: "tu_credit" },
  { key: "tu_callml", label: "TU CallML", metric: "per_request", vat: "standard", productGroup: "tu_credit" },
  { key: "tu_watchlist", label: "TU Watchlist", metric: "per_request", vat: "standard", productGroup: "tu_credit" },
  { key: "tu_deceased", label: "TU Deceased", metric: "per_request", vat: "standard", productGroup: "tu_credit" },
  { key: "tu_bank_account_id", label: "TU Bank Account ID", metric: "per_request", vat: "standard", productGroup: "tu_credit" },
  { key: "tu_bank_element", label: "TU Bank Element", metric: "per_request", vat: "standard", productGroup: "tu_credit" },
  { key: "tu_bank_account_premium", label: "TU Bank Account Premium", metric: "per_request", vat: "standard", productGroup: "tu_credit" },
  { key: "tu_ownership_fraud", label: "TU Ownership Fraud", metric: "per_request", vat: "standard", productGroup: "tu_credit" },
  { key: "tu_realtime_fraud", label: "TU Real-time Fraud", metric: "per_request", vat: "standard", productGroup: "tu_credit" },
  { key: "monevo_broker_fee", label: "Monevo broker fee", metric: "pct_of_principal", vat: "standard", productGroup: "tu_monevo" },
  { key: "pay_by_bank", label: "Pay by Bank", metric: "per_txn_fixed_and_pct", vat: "exempt", productGroup: "pay_by_bank" },
  { key: "faster_payments", label: "Faster Payments", metric: "per_txn_fixed", vat: "exempt", productGroup: "faster_payments" },
  { key: "settlement_accounts", label: "Settlement accounts", metric: "per_account_month", vat: "exempt", productGroup: "settlement_accounts" },
  { key: "sweeping_vrp", label: "Sweeping VRP", metric: "per_txn_fixed_and_pct", vat: "exempt", productGroup: "sweeping_vrp" },
  { key: "cvrp", label: "CVRP", metric: "per_txn_fixed_and_pct", vat: "exempt", productGroup: "cvrp" },
  { key: "direct_debits", label: "Direct Debits", metric: "per_txn_fixed", vat: "exempt", productGroup: "direct_debits" },
  { key: "comms_email", label: "Communications — Email", metric: "per_message", vat: "standard", productGroup: "comms" },
  { key: "comms_sms", label: "Communications — SMS", metric: "per_message", vat: "standard", productGroup: "comms" },
  { key: "comms_whatsapp", label: "Communications — WhatsApp", metric: "per_message", vat: "standard", productGroup: "comms" },
];

export const ITEM_TYPES = CATALOGUE.map((c) => c.key);
export type ItemType = (typeof ITEM_TYPES)[number];

const BY_KEY = new Map(CATALOGUE.map((c) => [c.key, c]));
export function catalogueEntry(key: string): CatalogueEntry | undefined {
  return BY_KEY.get(key);
}
export function isItemType(key: string): boolean {
  return BY_KEY.has(key);
}
export function labelFor(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}
