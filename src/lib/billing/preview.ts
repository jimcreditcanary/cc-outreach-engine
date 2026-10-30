// First-invoice preview with proration. Pure + unit-tested. This is a focused
// subset of the full Phase-4 invoice engine: it shows what the FIRST invoice
// looks like at setup time (setup fee + pro-rata partial first month + first
// full month of recurring fees in advance). Usage/transaction items have no
// usage yet, so they show £0 with a note. All money is integer PENCE.

import type { Metric, VatTreatment } from "./catalogue";
import type { ItemConfig } from "./itemConfig";
import { vatPence } from "./money";

export interface PreviewItem {
  item_type: string;
  label: string;
  metric: Metric;
  vat_treatment: VatTreatment;
  config: ItemConfig;
}

export interface PreviewLine {
  label: string;
  description: string;
  net_pence: number;
  vat_pence: number;
  gross_pence: number;
}

export interface InvoicePreview {
  lines: PreviewLine[];
  subtotal_pence: number;
  vat_pence: number;
  total_pence: number;
  notes: string[];
}

function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/** Proration of the partial first month: factor = days from start→month-end
 *  (inclusive) / days in that month. Start on the 1st → factor 1 (full month). */
export function firstMonthProration(startISO: string): { partialDays: number; monthDays: number; factor: number; isFirstOfMonth: boolean } {
  const [y, m, d] = startISO.split("-").map(Number) as [number, number, number];
  const monthDays = daysInMonth(y, m - 1);
  const partialDays = monthDays - d + 1;
  return { partialDays, monthDays, factor: partialDays / monthDays, isFirstOfMonth: d === 1 };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function nextMonthLabel(startISO: string): string {
  const [y, m] = startISO.split("-").map(Number) as [number, number];
  const nm = m === 12 ? 0 : m; // 0-based next month
  const ny = m === 12 ? y + 1 : y;
  return `${MONTHS[nm]} ${ny}`;
}
function startMonthLabel(startISO: string): string {
  const [y, m] = startISO.split("-").map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

function line(label: string, description: string, net: number, treatment: VatTreatment): PreviewLine {
  const vat = vatPence(net, treatment);
  return { label, description, net_pence: net, vat_pence: vat, gross_pence: net + vat };
}

/** Build the first-invoice preview for a set of configured items. */
export function previewFirstInvoice(items: PreviewItem[], contractStartISO: string): InvoicePreview {
  const lines: PreviewLine[] = [];
  const notes: string[] = [];
  const pro = firstMonthProration(contractStartISO);

  for (const it of items) {
    const cfg = it.config;
    // Setup fee — one-off, on the first invoice.
    if (it.item_type === "setup_fee" && !cfg.included && (cfg.amount_pence ?? 0) > 0) {
      lines.push(line(it.label, "One-off setup fee", cfg.amount_pence!, it.vat_treatment));
      continue;
    }
    // Recurring monthly fees (platform / support) — pro-rata partial month + first full month in advance.
    if (it.metric === "flat_monthly" && it.item_type !== "setup_fee") {
      if (cfg.included) { lines.push(line(it.label, "Included", 0, it.vat_treatment)); continue; }
      const monthly = cfg.amount_pence ?? 0;
      if (monthly <= 0) continue;
      if (pro.isFirstOfMonth) {
        lines.push(line(it.label, `${startMonthLabel(contractStartISO)} (in advance)`, monthly, it.vat_treatment));
      } else {
        const prorated = Math.round(monthly * pro.factor);
        lines.push(line(it.label, `${startMonthLabel(contractStartISO)} pro-rata (${pro.partialDays}/${pro.monthDays} days)`, prorated, it.vat_treatment));
        lines.push(line(it.label, `${nextMonthLabel(contractStartISO)} (in advance)`, monthly, it.vat_treatment));
      }
      continue;
    }
    // Everything else is usage/transaction/per-connected-account — no usage yet.
    if (!cfg.included) notes.push(`${it.label}: billed in arrears on usage (nothing on the first invoice).`);
    else lines.push(line(it.label, "Included", 0, it.vat_treatment));
  }

  const subtotal = lines.reduce((s, l) => s + l.net_pence, 0);
  const vat = lines.reduce((s, l) => s + l.vat_pence, 0);
  return { lines, subtotal_pence: subtotal, vat_pence: vat, total_pence: subtotal + vat, notes };
}
