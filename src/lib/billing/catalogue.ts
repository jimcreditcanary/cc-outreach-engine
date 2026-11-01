// Billing item catalogue — the shared metric/VAT/status vocabulary, plus a
// derived view of the product library's SHAPE (key/label/metric/vat/group).
//
// Billing v2: the product list is no longer a closed code set. Its source of
// truth is productSeed.ts (which the seed writes into the DB) and, after
// seeding, the DB itself — the /admin product-library UI can add products.
// CATALOGUE below is derived from productSeed so the setup wizard + labels track
// it. Prices/bands/config live in billing_pricing_tables/_bands, are
// super-admin-editable and effective-dated — never here.

import { PRODUCTS } from "./productSeed";

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

// Derived from the product library bootstrap (productSeed.ts) — the single
// source. VAT defaults there are editable + finance-confirmed before go-live;
// payment rails = exempt, everything else standard 20%.
export const CATALOGUE: CatalogueEntry[] = PRODUCTS.map((p) => ({
  key: p.key, label: p.label, metric: p.metric, vat: p.vat, productGroup: p.group,
}));

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
