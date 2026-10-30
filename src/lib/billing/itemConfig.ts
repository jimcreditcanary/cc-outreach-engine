// Per-item billing config — the jsonb stored on billing_items.config. The setup
// wizard captures only the fields relevant to the item's pricing metric; the
// Phase-4 invoice engine reads them back. All money is integer PENCE.

import type { Metric } from "./catalogue";
import { penceInput, poundsToPence } from "./money";

export interface ItemConfig {
  included?: boolean;            // charged as included (£0) — allowed for support, open banking, comms
  amount_pence?: number;         // flat_monthly monthly amount; or per-unit for per_request/per_account_month/per_message
  fixed_pence?: number;          // per_txn_fixed / per_txn_fixed_and_pct
  pct?: number;                  // per_txn_pct / per_txn_fixed_and_pct / pct_of_principal (percentage, e.g. 1.5 = 1.5%)
  cap_pence?: number | null;     // optional per-txn cap
  per_application_pence?: number; // monevo: amount per application
  per_number_month_pence?: number; // comms sms/whatsapp: per number per month
  setup_kind?: "one_off" | "schedule"; // setup_fee
  billing_trigger?: "on_contract_signed" | "on_go_live"; // setup_fee default on_contract_signed
}

/** Which config fields the wizard shows for a given metric. Drives the form. */
export function fieldsForMetric(metric: Metric): {
  monthly?: boolean; perUnit?: boolean; fixed?: boolean; pct?: boolean; cap?: boolean;
  perApplication?: boolean; perNumberMonth?: boolean; setup?: boolean; includable?: boolean;
} {
  switch (metric) {
    case "flat_monthly": return { monthly: true, includable: true, setup: false };
    case "per_account_month": return { perUnit: true, includable: true };
    case "per_request": return { perUnit: true };
    case "per_message": return { perUnit: true, includable: true };
    case "per_number_month": return { perNumberMonth: true, includable: true };
    case "per_txn_fixed": return { fixed: true, cap: true };
    case "per_txn_pct": return { pct: true, cap: true };
    case "per_txn_fixed_and_pct": return { fixed: true, pct: true, cap: true };
    case "pct_of_principal": return { pct: true, perApplication: true };
    case "per_application": return { perApplication: true };
    default: return {};
  }
}

/** Build an ItemConfig from the wizard form fields for one item (prefix `cfg_<key>_`). */
export function parseItemConfig(metric: Metric, get: (field: string) => string): ItemConfig {
  const f = fieldsForMetric(metric);
  const cfg: ItemConfig = {};
  if (f.includable) cfg.included = get("included") === "on";
  if (cfg.included) return cfg; // included → no amounts
  if (f.monthly) cfg.amount_pence = poundsToPence(get("amount"));
  if (f.perUnit) cfg.amount_pence = penceInput(get("amount_pence"));
  if (f.fixed) cfg.fixed_pence = penceInput(get("fixed_pence"));
  if (f.pct) cfg.pct = Number(get("pct")) || 0;
  if (f.cap) { const c = get("cap_pence").trim(); cfg.cap_pence = c ? penceInput(c) : null; }
  if (f.perApplication) cfg.per_application_pence = penceInput(get("per_application_pence"));
  if (f.perNumberMonth) cfg.per_number_month_pence = penceInput(get("per_number_month_pence"));
  if (metric === "flat_monthly") {
    cfg.setup_kind = (get("setup_kind") as ItemConfig["setup_kind"]) || undefined;
    const trig = get("billing_trigger");
    if (trig) cfg.billing_trigger = trig as ItemConfig["billing_trigger"];
  }
  return cfg;
}

/** Short human summary of a config, for the account/review views. */
export function describeConfig(metric: Metric, cfg: ItemConfig): string {
  if (cfg.included) return "included (£0)";
  const bits: string[] = [];
  const gbp = (p?: number) => (p != null ? `£${(p / 100).toFixed(2)}` : null);
  if (cfg.amount_pence != null) bits.push(metric === "flat_monthly" ? `${gbp(cfg.amount_pence)}/mo` : `${gbp(cfg.amount_pence)}/unit`);
  if (cfg.fixed_pence != null) bits.push(`${gbp(cfg.fixed_pence)}/txn`);
  if (cfg.pct) bits.push(`${cfg.pct}%`);
  if (cfg.cap_pence != null) bits.push(`cap ${gbp(cfg.cap_pence)}`);
  if (cfg.per_application_pence != null) bits.push(`${gbp(cfg.per_application_pence)}/application`);
  if (cfg.per_number_month_pence != null) bits.push(`${gbp(cfg.per_number_month_pence)}/number/mo`);
  return bits.join(" · ") || "—";
}
