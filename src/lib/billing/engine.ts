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
  // graduated mode: from_units is an EXCLUSIVE lower bound (units above this).
  // volume mode:    [from_units, to_units] is an INCLUSIVE range the volume lands in.
  from_units: number;
  to_units: number | null; // inclusive upper bound; null = unbounded (top band)
  unit_price_pence: number;
  minimum_type: "none" | "monthly" | "on_band_hit";
  minimum_pence: number;
  unit_cap_pence?: number | null;
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
  product_group?: string | null;          // drives per-group minimums
  band_mode?: "volume" | "graduated";     // default 'volume'
  config: ItemConfig;
  override?: ItemConfig | null; // merged over config
  bands: EngineBand[];
  usage?: EngineUsage | null;   // aggregated usage for M-1
}

export interface GroupMinimumInput {
  product_group: string;
  minimum_pence: number;
  vat_treatment?: VatTreatment; // top-up VAT; default 'standard'
}

export interface EngineInput {
  periodMonth: string;         // "YYYY-MM-01" — month M being invoiced
  isFirstInvoice: boolean;
  contractStartDate: string;   // "YYYY-MM-DD"
  contractEndDate: string | null;
  items: EngineItem[];
  groupMinimums?: GroupMinimumInput[]; // category floors (e.g. all TU ≥ £X/mo)
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

function ym(dateISO: string): string { return dateISO.slice(0, 7); } // YYYY-MM

function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(dateISO: string, months: number): string {
  const d = new Date(`${dateISO.slice(0, 10)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Resolve a product's RELATIVE escalation schedule (start_month offsets, e.g.
 *  platform fee Yr1/2/3) into the absolute { from_date, amount_pence } schedule
 *  the engine's monthlyAmount reads, anchored on the contract start date. */
export function resolveEscalation(
  relative: { start_month: number; amount_pence: number }[] | undefined,
  contractStartISO: string,
): { from_date: string; amount_pence: number }[] | undefined {
  if (!Array.isArray(relative) || !relative.length) return undefined;
  return relative.map((r) => ({ from_date: addMonths(contractStartISO, r.start_month), amount_pence: r.amount_pence }));
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

/** Volume (whole-volume) charge: the quantity lands in ONE band [from,to]; every
 *  unit is charged at that band's rate, and that band's monthly minimum floors
 *  the line. (Jim's confirmed model for OB AIS / CoP.) */
export function volumeCharge(quantity: number, bands: EngineBand[]): { amount_pence: number; band: EngineBand | null; floor_pence: number } {
  const sorted = [...bands].sort((a, b) => a.from_units - b.from_units);
  // The band whose inclusive [from,to] range contains the quantity (top band to=null).
  const band = sorted.find((b) => quantity >= b.from_units && (b.to_units == null || quantity <= b.to_units))
    ?? sorted[sorted.length - 1] ?? null;
  if (!band) return { amount_pence: 0, band: null, floor_pence: 0 };
  const floor = band.minimum_type === "monthly" ? band.minimum_pence
    : band.minimum_type === "on_band_hit" && quantity > 0 ? band.minimum_pence : 0;
  return { amount_pence: Math.max(quantity * band.unit_price_pence, floor), band, floor_pence: floor };
}

function line(item: EngineItem, description: string, quantity: number, unit: number, net: number, calc: Record<string, unknown>): InvoiceLine {
  const vat = vatPence(net, item.vat_treatment);
  return { billing_item_id: item.billing_item_id, description, quantity, unit_amount_pence: unit, line_amount_pence: net, vat_rate: item.vat_treatment === "standard" ? 0.2 : 0, vat_pence: vat, calc };
}

/** Usage-based charge for a transaction/usage item from aggregated M-1 usage.
 *  billMinimums applies committed monthly floors (volume minimums) — true within
 *  contract, false after cancellation so trailing usage never conjures a floor. */
function usageCharge(item: EngineItem, cfg: ItemConfig, usage: EngineUsage, billMinimums: boolean): InvoiceLine[] {
  const q = usage.quantity ?? 0;
  const value = usage.value ?? 0;
  const principal = usage.principal ?? 0;
  const pct = cfg.pct ?? 0;
  const cap = cfg.cap_pence ?? null;
  const gbp = (p: number) => `£${(p / 100).toFixed(2)}`;

  // Included (sold as part of a fixed line): bill £0 and ignore any reported
  // usage — the "OB can be included or sold separately" rule, for every metric.
  if (cfg.included) return [line(item, `${item.label} — included`, q, 0, 0, { included: true })];

  switch (item.metric) {
    case "per_request":
    case "per_account_month":
    case "per_message":
    case "per_number_month": {
      const priced = item.bands.length && item.bands.some((b) => b.unit_price_pence > 0 || b.minimum_pence > 0);
      if (priced) {
        if ((item.band_mode ?? "volume") === "graduated") {
          const g = graduatedCharge(q, item.bands);
          return [line(item, `${item.label} — ${q} units`, q, 0, g.amount_pence, { metric: item.metric, mode: "graduated", graduated: g.breakdown, floor_pence: g.floor_pence })];
        }
        const v = volumeCharge(q, item.bands);
        const net = billMinimums ? v.amount_pence : q * (v.band?.unit_price_pence ?? 0);
        return [line(item, `${item.label} — ${q} units`, q, v.band?.unit_price_pence ?? 0, net, {
          metric: item.metric, mode: "volume", floor_pence: billMinimums ? v.floor_pence : 0,
          band: v.band ? { from: v.band.from_units, to: v.band.to_units, unit_price_pence: v.band.unit_price_pence } : null,
        })];
      }
      const unit = cfg.amount_pence ?? 0;
      return [line(item, `${item.label} — ${q} units`, q, unit, q * unit, { metric: item.metric, unit_pence: unit })];
    }
    case "per_txn_fixed":
    case "per_txn_pct":
    case "per_txn_fixed_and_pct": {
      // Payment rails. The £/txn (fixed) component is priced by VeepVeep from the
      // transaction COUNT. The %-of-value component is PRE-COMPUTED at source
      // (per-txn cap already applied there) and posted as `value` — VeepVeep
      // bills it AS-IS on its own "1 unit" line and never re-applies the % or
      // cap; those are contractual/description only (M1, Jim 2026-11-06).
      const out: InvoiceLine[] = [];
      const fixed = cfg.fixed_pence ?? 0;
      if (item.metric !== "per_txn_pct" && fixed > 0 && q > 0) {
        out.push(line(item, `${item.label} — ${q} txns × ${gbp(fixed)}`, q, fixed, q * fixed, { metric: item.metric, component: "fixed", quantity: q, fixed_pence: fixed }));
      }
      if (item.metric !== "per_txn_fixed" && value > 0) {
        const capTxt = cap != null ? `, capped at ${gbp(cap)}/txn` : "";
        out.push(line(item, `${item.label} — ${pct}% of value${capTxt} (computed at source)`, 1, value, value, { metric: item.metric, component: "value", value, pct, cap_pence: cap, as_posted: true }));
      }
      return out;
    }
    case "pct_of_principal": {
      const pctPart = Math.round(principal * (pct / 100));
      const perApp = (cfg.per_application_pence ?? 0) * q;
      return [line(item, `${item.label}`, q, 0, pctPart + perApp, { metric: item.metric, principal, pct, pct_part: pctPart, per_application_pence: cfg.per_application_pence ?? 0, applications: q })];
    }
    case "per_application": {
      const per = cfg.per_application_pence ?? cfg.amount_pence ?? 0;
      return [line(item, `${item.label} — ${q} applications`, q, per, q * per, { metric: item.metric, per_application_pence: per })];
    }
    default:
      return [];
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

  // Net billed per product_group (for category minimums). A group appears here
  // only if it has at least one configured item, so an un-sold category is never
  // floored.
  const groupNet = new Map<string, number>();
  const noteGroup = (g: string | null | undefined, net: number) => { if (g) groupNet.set(g, (groupNet.get(g) ?? 0) + net); };

  for (const item of input.items) {
    const cfg = { ...item.config, ...(item.override ?? {}) } as ItemConfig & { escalation?: { from_date: string; amount_pence: number }[] };

    // Setup fee — one-off on the first invoice.
    if (item.item_type === "setup_fee") {
      if (input.isFirstInvoice && !cfg.included && (cfg.amount_pence ?? 0) > 0) {
        lines.push(line(item, `${item.label} — one-off`, 1, cfg.amount_pence!, cfg.amount_pence!, { one_off: true }));
      }
      continue;
    }

    // Recurring monthly fees (platform / support / any flat_monthly product) —
    // in advance, pro-rata on first invoice. (setup_fee is handled above.)
    if (item.metric === "flat_monthly") {
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

    // Usage-based items — M-1 in arrears. A committed monthly minimum bills even
    // at zero usage WHILE in contract; after cancellation only real trailing
    // usage bills (no phantom floor).
    const usage = item.usage ?? { quantity: 0 };
    if (recurringStopped && (usage.quantity ?? 0) === 0 && (usage.value ?? 0) === 0 && !cfg.included) { noteGroup(item.product_group, 0); continue; }
    const uls = usageCharge(item, cfg, usage, !recurringStopped);
    let groupSum = 0;
    for (const ul of uls) {
      if (ul.line_amount_pence !== 0 || cfg.included) lines.push(ul);
      groupSum += ul.line_amount_pence;
    }
    noteGroup(item.product_group, groupSum);
  }

  // Category minimums: top up any product_group whose billed net falls short of
  // its monthly floor (e.g. all TU items must total ≥ £X/month).
  if (!recurringStopped) {
    for (const gm of input.groupMinimums ?? []) {
      if (!groupNet.has(gm.product_group)) continue; // category not sold to this account
      const net = groupNet.get(gm.product_group)!;
      if (net >= gm.minimum_pence) continue;
      const topUp = gm.minimum_pence - net;
      const vat = gm.vat_treatment ?? "standard";
      const topUpLine: InvoiceLine = {
        billing_item_id: null,
        description: `${gm.product_group} — category minimum top-up`,
        quantity: 1, unit_amount_pence: topUp, line_amount_pence: topUp,
        vat_rate: vat === "standard" ? 0.2 : 0, vat_pence: vatPence(topUp, vat),
        calc: { group_minimum: true, product_group: gm.product_group, minimum_pence: gm.minimum_pence, billed_net_pence: net, top_up_pence: topUp },
      };
      lines.push(topUpLine);
    }
  }

  const subtotal = lines.reduce((s, l) => s + l.line_amount_pence, 0);
  const vat = lines.reduce((s, l) => s + l.vat_pence, 0);
  const result: InvoiceResult = { period_month: period, lines, subtotal_pence: subtotal, vat_pence: vat, total_pence: subtotal + vat, prorated, due_date: dueDate };
  if (lines.length === 0) result.skipped = "no billable lines";
  return result;
}
