// Which catalogue items a given onboarding case may be billed for. Single source
// for the onboarding product_group → catalogue mapping, shared by the setup
// wizard (which greys out-of-scope items with a reason, U4) and the save action
// (which refuses an out-of-scope item server-side). `core` and `comms` are
// always offered; everything else needs the matching onboarding product group,
// plus the faster_payments↔settlement_accounts rule.

import type { CatalogueEntry } from "./catalogue";

export function itemInScope(entry: CatalogueEntry, productGroups: string[]): boolean {
  if (entry.productGroup === "core" || entry.productGroup === "comms") return true;
  if (productGroups.includes(entry.productGroup)) return true;
  if (entry.key === "faster_payments" && productGroups.includes("settlement_accounts")) return true;
  return false;
}

export function scopeReason(entry: CatalogueEntry): string {
  return `Not in this case's product groups (needs “${entry.productGroup}”).`;
}
