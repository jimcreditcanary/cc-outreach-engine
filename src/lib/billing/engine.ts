// The deterministic invoice engine. PURE — no DB, no network, no clock. Given an
// account's items, their effective pricing bands, and the usage reported for the
// prior month, it produces the invoice lines for a billing period with a full
// `calc` audit so every figure is reproducible from stored data.
//
// All money is integer PENCE. The billing model (brief Assumption 1): an invoice
// dated the 1st of month M covers (a) recurring fees for M in advance, (b) usage
// for M-1 in arrears, and (c) on the FIRST invoice only, a pro-rata charge for
// the partial first month.

import type { Metric, VatTreatment } from "./catalogue";
import type { ItemConfig } from "./itemConfig";
import { firstMonthProration } from "./preview";
import { vatPence } from "./money";

export interface EngineBand {
  from_units: number;      // exclusive lower bound (units above this)
  to_units: number | null; // inclusive upper bound; null = unbounded
  unit_price_pence: number;
  minimum_type: "none" | "monthly" | "on_band_hit";
  minimum_pence: number;
}

export interface EngineUsage {
  quantity: number;
  value?: number | null;      // total txn value (for % metrics)
  principal?: number | null;  // total principal (pct_of_principal)
}

export interface EngineItem {
  billing_item_id: string;
  item_type: string;
  label: string;
  metric: Metric;
  vat_treatment: VatTreatment;
  config: ItemConfig;
  override?: ItemConfig | null; // merged over config
  bands: EngineBand[];
  usage?: EngineUsage | null;   // aggregated usage for M-1
}

export interface EngineInput {
  periodMonth: string;         // "YYYY-MM-01" — month M being invoiced
  isFirstInvoice: boolean;
  contractStartDate: string;   // "YYYY-MM-DD"
  contractEndDate: string | null;
  items: EngineItem[];
  dueDays?: number;            // net terms; default 14
}

export interface InvoiceLine {
  billing_item_id: string | null;
  description: string;
  quantity: number;
  unit_amount_pence: number;   // indicative unit amount (0 where not meaningful)
  line_amount_pence: number;   // net
  vat_rate: number;            // 0 or 0.2
  vat_pence: number;
  calc: Record<string, unknown>;
}

export interface InvoiceResult {
  period_month: string;
  lines: InvoiceLine[];
  subtotal_pence: number;
  vat_pence: number;
  total_pence: number;
  prorated: boolean;
  due_date: string;
  skipped?: string;            // reason, when nothing is billed
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const RECURRING_TYPES = new Set(["platform_fee", "support_fee"]);

function ym(dateISO: string): string { return dateISO.slice(0, 7); } // YYYY-MM

function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monthly amount for a period, honouring an escalation schedule if present. */
export function monthlyAmount(cfg: ItemConfig & { escalation?: { from_date: string; amount_pence: number }[] }, periodMonthISO: string): number {
  const esc = cfg.escalation;
  if (Array.isArray(esc) && esc.length) {
    const applicable = esc
      .filter((e) => e.from_date.slice(0, 7) <= ym(periodMonthISO))
      .sort((a, b) => a.from_date.localeCompare(b.from_date));
    if (applicable.length) return applicable[applicable.length - 1]!.amount_pence;
  }
  return cfg.amount_pence ?? 0;
}

/** Graduated (tiered) charge for a quantity across bands, with minimums. */
export function graduatedCharge(quantity: number, bands: EngineBand[]): { amount_pence: number; breakdown: { from: number; to: number | null; units: number; unit_price_pence: number; subtotal_pence: number }[]; floor_pence: number } {
  const sorted = [...bands].sort((a, b) => a.from_units - b.from_units);
  let amount = 0;
  let floor = 0;
  const breakdown: { from: number; to: number | null; units: number; unit_price_pence: number; subtotal_pence: number }[] = [];
  for (const b of sorted) {
    const upper = b.to_units ?? quantity;
    const units = Math.max(0, Math.min(quantity, upper) - b.from_units);
    const subtotal = units * b.unit_price_pence;
    amount += subtotal;
    breakdown.push({ from: b.from_units, to: b.to_units, units, unit_price_pence: b.unit_price_pence, subtotal_pence: subtotal });
    if (b.minimum_type === "monthly") floor = Math.max(floor, b.minimum_pence);
    else if (b.minimum_type === "on_band_hit" && quantity > b.from_units) floor = Math.max(floor, b.minimum_pence);
  }
  return { amount_pence: Math.max(amount, floor), breakdown, floor_pence: floor };
}

function line(item: EngineItem, description: string, quantity: number, unit: number, net: number, calc: Record<string, unknown>): InvoiceLine {
  const vat = vatPence(net, item.vat_treatment);
  return { billing_item_id: item.billing_item_id, description, quantity, unit_amount_pence: unit, line_amount_pence: net, vat_rate: item.vat_treatment === "standard" ? 0.2 : 0, vat_pence: vat, calc };
}

/** Usage-based charge for a transaction/usage item from aggregated M-1 usage. */
function usageCharge(item: EngineItem, cfg: ItemConfig, usage: EngineUsage): InvoiceLine | null {
  const q = usage.quantity ?? 0;
  const value = usage.value ?? 0;
  const principal = usage.principal ?? 0;
  const pct = cfg.pct ?? 0;
  const cap = cfg.cap_pence ?? null;

  switch (item.metric) {
    case "per_request":
    case "per_account_month":
    case "per_message":
    case "per_number_month": {
      if (cfg.included) return line(item, `${item.label} — included`, q, 0, 0, { included: true });
      // Prefer graduated bands; fall back to a flat per-unit amount.
      if (item.bands.length && item.bands.some((b) => b.unit_price_pence > 0 || b.minimum_pence > 0)) {
        const g = graduatedCharge(q, item.bands);
        return line(item, `${item.label} — ${q} units`, q, 0, g.amount_pence, { metric: item.metric, graduated: g.breakdown, floor_pence: g.floor_pence });
      }
      const unit = cfg.amount_pence ?? 0;
      return line(item, `${item.label} — ${q} units`, q, unit, q * unit, { metric: item.metric, unit_pence: unit });
    }
    case "per_txn_fixed":
    case "per_txn_pct":
    case "per_txn_fixed_and_pct": {
      const fixed = cfg.fixed_pence ?? 0;
      const fixedPart = item.metric === "per_txn_pct" ? 0 : q * fixed;
      const pctPart = item.metric === "per_txn_fixed" ? 0 : Math.round(value * (pct / 100));
      let net = fixedPart + pctPart;
      const calc: Record<string, unknown> = { metric: item.metric, quantity: q, value, fixed_pence: fixed, pct, fixed_part: fixedPart, pct_part: pctPart };
      if (cap != null) { const capTotal = q * cap; if (net > capTotal) { calc.capped_from = net; net = capTotal; } calc.cap_pence = cap; }
      return line(item, `${item.label} — ${q} txns`, q, 0, net, calc);
    }
    case "pct_of_principal": {
      const pctPart = Math.round(principal * (pct / 100));
      const perApp = (cfg.per_application_pence ?? 0) * q;
      return line(item, `${item.label}`, q, 0, pctPart + perApp, { metric: item.metric, principal, pct, pct_part: pctPart, per_application_pence: cfg.per_application_pence ?? 0, applications: q });
    }
    case "per_application": {
      const per = cfg.per_application_pence ?? cfg.amount_pence ?? 0;
      return line(item, `${item.label} — ${q} applications`, q, per, q * per, { metric: item.metric, per_application_pence: per });
    }
    default:
      return null;
  }
}

// ─── the engine ─────────────────────────────────────────────────────────────

export function computeInvoice(input: EngineInput): InvoiceResult {
  const period = input.periodMonth.slice(0, 10);
  const dueDate = addDays(period, input.dueDays ?? 14);
  const lines: InvoiceLine[] = [];
  let prorated = false;

  const periodYm = ym(period);
  const endYm = input.contractEndDate ? ym(input.contractEndDate) : null;
  const recurringStopped = endYm != null && periodYm > endYm; // cancelled before this month

  for (const item of input.items) {
    const cfg = { ...item.config, ...(item.override ?? {}) } as ItemConfig & { escalation?: { from_date: string; amount_pence: number }[] };

    // Setup fee — one-off on the first invoice.
    if (item.item_type === "setup_fee") {
      if (input.isFirstInvoice && !cfg.included && (cfg.amount_pence ?? 0) > 0) {
        lines.push(line(item, `${item.label} — one-off`, 1, cfg.amount_pence!, cfg.amount_pence!, { one_off: true }));
      }
      continue;
    }

    // Recurring monthly fees (platform / support) — in advance, pro-rata on first invoice.
    if (item.metric === "flat_monthly" && RECURRING_TYPES.has(item.item_type)) {
      if (cfg.included) { lines.push(line(item, `${item.label} — included`, 1, 0, 0, { included: true })); continue; }
      if (recurringStopped) continue; // no recurring after cancellation
      const amount = monthlyAmount(cfg, period);
      if (amount <= 0) continue;
      // Pro-rata the partial first month (the contract-start month) on the first invoice.
      if (input.isFirstInvoice && ym(input.contractStartDate) < periodYm) {
        const pr = firstMonthProration(input.contractStartDate);
        if (!pr.isFirstOfMonth) {
          const partial = Math.round(amount * pr.factor);
          prorated = true;
          lines.push(line(item, `${item.label} — ${input.contractStartDate.slice(0, 7)} pro-rata (${pr.partialDays}/${pr.monthDays} days)`, 1, 0, partial, { prorata: true, factor: pr.factor, partial_days: pr.partialDays, month_days: pr.monthDays, monthly_pence: amount }));
        }
      }
      lines.push(line(item, `${item.label} — ${periodYm} (in advance)`, 1, amount, amount, { advance: true, monthly_pence: amount }));
      continue;
    }

    // Usage-based items — M-1 in arrears. Billed even after cancellation (trailing usage).
    const usage = item.usage ?? { quantity: 0 };
    if ((usage.quantity ?? 0) === 0 && !cfg.included) continue; // nothing reported
    const ul = usageCharge(item, cfg, usage);
    if (ul && (ul.line_amount_pence !== 0 || cfg.included)) lines.push(ul);
  }

  const subtotal = lines.reduce((s, l) => s + l.line_amount_pence, 0);
  const vat = lines.reduce((s, l) => s + l.vat_pence, 0);
  const result: InvoiceResult = { period_month: period, lines, subtotal_pence: subtotal, vat_pence: vat, total_pence: subtotal + vat, prorated, due_date: dueDate };
  if (lines.length === 0) result.skipped = "no billable lines";
  return result;
}
