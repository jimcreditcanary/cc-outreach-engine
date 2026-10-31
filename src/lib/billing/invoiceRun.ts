// Monthly invoice run orchestration. Pulls stored data (accounts, items, bands,
// prior-month usage), runs the pure engine, raises the Xero invoice (mock until
// Xero is wired), and persists invoices + lines. Idempotent per (account,
// period) via the unique index on billing_invoices — a re-run never duplicates.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getXero } from "@/lib/integrations/xero";
import { getCrm } from "@/lib/crm";
import { listBillingItems, listBands, currentPricingByItemType, updateBillingAccount } from "./repo";
import { computeInvoice, type EngineItem, type EngineInput, type InvoiceResult } from "./engine";
import type { Metric, VatTreatment } from "./catalogue";
import type { ItemConfig } from "./itemConfig";

type DB = SupabaseClient;

function firstOfThisMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
function prevMonth(periodISO: string): string {
  const [y, m] = periodISO.split("-").map(Number) as [number, number];
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}-01`;
}

async function aggregateUsage(db: DB, itemId: string, periodM1: string): Promise<{ quantity: number; value: number | null; principal: number | null }> {
  const { data } = await db.from("billing_usage_records").select("quantity, value, principal").eq("billing_item_id", itemId).eq("period_month", periodM1);
  let quantity = 0, value = 0, principal = 0, hasV = false, hasP = false;
  for (const r of (data ?? []) as { quantity: number; value: number | null; principal: number | null }[]) {
    quantity += Number(r.quantity) || 0;
    if (r.value != null) { value += Number(r.value); hasV = true; }
    if (r.principal != null) { principal += Number(r.principal); hasP = true; }
  }
  return { quantity, value: hasV ? value : null, principal: hasP ? principal : null };
}

async function buildEngineItems(db: DB, accountId: string, periodM1: string): Promise<EngineItem[]> {
  const [items, pricing] = await Promise.all([listBillingItems(db, accountId), currentPricingByItemType(db)]);
  const out: EngineItem[] = [];
  for (const it of items) {
    if (!it.active) continue;
    const table = pricing.get(it.item_type);
    const metric = (table?.metric ?? "flat_monthly") as Metric;
    const bands = table ? await listBands(db, table.id) : [];
    out.push({
      billing_item_id: it.id,
      item_type: it.item_type,
      label: table?.name ?? it.item_type,
      metric,
      vat_treatment: (it.vat_treatment as VatTreatment) ?? "standard",
      config: it.config as ItemConfig,
      override: (it.override as ItemConfig) ?? null,
      bands: bands.map((b) => ({ from_units: b.from_units, to_units: b.to_units, unit_price_pence: b.unit_price_pence, minimum_type: b.minimum_type, minimum_pence: b.minimum_pence })),
      usage: await aggregateUsage(db, it.id, periodM1),
    });
  }
  return out;
}

async function persistInvoice(db: DB, accountId: string, runId: string, result: InvoiceResult, xero: { invoiceId: string; status: string }): Promise<void> {
  const { data: inv, error } = await db.from("billing_invoices").insert({
    account_id: accountId, run_id: runId, period_month: result.period_month,
    xero_invoice_id: xero.invoiceId, xero_status: xero.status,
    subtotal_pence: result.subtotal_pence, vat_pence: result.vat_pence, total_pence: result.total_pence,
    due_date: result.due_date, prorated: result.prorated,
  }).select("id").single();
  if (error) throw error;
  if (result.lines.length) {
    await db.from("billing_invoice_lines").insert(result.lines.map((l) => ({
      invoice_id: inv.id, billing_item_id: l.billing_item_id, description: l.description,
      quantity: l.quantity, unit_amount_pence: l.unit_amount_pence, line_amount_pence: l.line_amount_pence,
      vat_rate: l.vat_rate, vat_pence: l.vat_pence, calc: l.calc,
    })));
  }
}

export interface RunSummary {
  period_month: string;
  invoiced: number;
  skipped: number;
  flagged: { account_id: string; reason: string }[];
  errors: { account_id: string; error: string }[];
  total_pence: number;
}

export async function runBilling(db: DB, period?: string): Promise<RunSummary> {
  const periodMonth = period ?? firstOfThisMonth();
  const periodM1 = prevMonth(periodMonth);
  const runDate = new Date().toISOString().slice(0, 10);
  const approve = !!process.env.XERO_AUTO_APPROVE_FROM && runDate >= process.env.XERO_AUTO_APPROVE_FROM;
  const xero = getXero();
  const crm = getCrm();

  const { data: run } = await db.from("billing_invoice_runs").insert({ period_month: periodMonth, run_date: runDate, status: "running" }).select("id").single();
  const runId = run!.id as string;

  const summary: RunSummary = { period_month: periodMonth, invoiced: 0, skipped: 0, flagged: [], errors: [], total_pence: 0 };

  // Active + notice_given bill normally; cancelled may still have trailing usage; disputed are flagged.
  const { data: accounts } = await db.from("billing_accounts")
    .select("id, status, contract_start_date, contract_end_date, hubspot_company_id, finance_contact_id, xero_contact_id")
    .in("status", ["active", "notice_given", "cancelled", "disputed"]);

  for (const acc of (accounts ?? []) as { id: string; status: string; contract_start_date: string | null; contract_end_date: string | null; hubspot_company_id: string | null; finance_contact_id: string | null; xero_contact_id: string | null }[]) {
    try {
      if (acc.status === "disputed") { summary.flagged.push({ account_id: acc.id, reason: "disputed" }); continue; }
      if (!acc.contract_start_date || acc.contract_start_date > periodMonth) { summary.skipped += 1; continue; }

      // Idempotent: skip if this account already has an invoice for the period.
      const { data: existing } = await db.from("billing_invoices").select("id").eq("account_id", acc.id).eq("period_month", periodMonth).maybeSingle();
      if (existing) { summary.skipped += 1; continue; }
      const { count: priorCount } = await db.from("billing_invoices").select("id", { count: "exact", head: true }).eq("account_id", acc.id);
      const isFirstInvoice = (priorCount ?? 0) === 0;

      const items = await buildEngineItems(db, acc.id, periodM1);
      const input: EngineInput = { periodMonth, isFirstInvoice, contractStartDate: acc.contract_start_date, contractEndDate: acc.contract_end_date, items };
      const result = computeInvoice(input);
      if (result.lines.length === 0) { summary.skipped += 1; continue; }

      // Ensure a Xero contact (create lazily on first invoice).
      let contactId = acc.xero_contact_id;
      if (!contactId) {
        const company = acc.hubspot_company_id ? await crm.getCompany(acc.hubspot_company_id).catch(() => null) : null;
        const fin = acc.finance_contact_id ? await crm.getContact(acc.finance_contact_id).catch(() => null) : null;
        const c = await xero.ensureContact({
          accountKey: acc.id,
          name: company?.name ?? acc.hubspot_company_id ?? acc.id,
          financeContact: fin ? { name: fin.full_name, email: fin.email, phone: null } : null,
        });
        contactId = c.contactId;
        await updateBillingAccount(db, acc.id, { xero_contact_id: contactId });
      }

      const xi = await xero.createInvoice({
        contactId, reference: `${acc.id.slice(0, 8)}-${periodMonth.slice(0, 7)}`, periodMonth, dueDate: result.due_date,
        lines: result.lines.map((l) => ({ description: l.description, quantity: 1, unitAmountPence: l.line_amount_pence, vatRate: l.vat_rate })),
      }, approve);
      if (approve && xi.status === "AUTHORISED") await xero.emailInvoice(xi.invoiceId).catch(() => {});

      await persistInvoice(db, acc.id, runId, result, xi);
      summary.invoiced += 1;
      summary.total_pence += result.total_pence;
    } catch (e) {
      summary.errors.push({ account_id: acc.id, error: (e as Error).message });
    }
  }

  await db.from("billing_invoice_runs").update({ status: summary.errors.length ? "error" : "complete", finished_at: new Date().toISOString(), summary, errors: summary.errors }).eq("id", runId);
  return summary;
}
