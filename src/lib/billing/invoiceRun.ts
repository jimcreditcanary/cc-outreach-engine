// Monthly invoice run orchestration. Pulls stored data (accounts, items, bands,
// prior-month usage), runs the pure engine, raises the Xero invoice (mock until
// Xero is wired), and persists invoices + lines. Idempotent per (account,
// period) via the unique index on billing_invoices — a re-run never duplicates.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getXero } from "@/lib/integrations/xero";
import { getCrm } from "@/lib/crm";
import { listBillingItems, listBands, currentPricingByItemType, currentGroupMinimums, updateBillingAccount } from "./repo";
import { computeInvoice, resolveEscalation, type EngineItem, type EngineInput, type GroupMinimumInput, type InvoiceResult } from "./engine";
import type { Metric, VatTreatment } from "./catalogue";
import type { ItemConfig } from "./itemConfig";
import { asPricedSnapshot } from "./pricingSnapshot";
import { londonToday, londonFirstOfThisMonth } from "./clock";

type DB = SupabaseClient;

function prevMonth(periodISO: string): string {
  const [y, m] = periodISO.split("-").map(Number) as [number, number];
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}-01`;
}

async function aggregateUsage(db: DB, itemId: string, usageMonth: string): Promise<{ quantity: number; value: number | null; principal: number | null }> {
  const { data } = await db.from("billing_usage_records").select("quantity, value, principal").eq("billing_item_id", itemId).eq("period_month", usageMonth);
  let quantity = 0, value = 0, principal = 0, hasV = false, hasP = false;
  for (const r of (data ?? []) as { quantity: number; value: number | null; principal: number | null }[]) {
    quantity += Number(r.quantity) || 0;
    if (r.value != null) { value += Number(r.value); hasV = true; }
    if (r.principal != null) { principal += Number(r.principal); hasP = true; }
  }
  return { quantity, value: hasV ? value : null, principal: hasP ? principal : null };
}

async function buildEngineItems(db: DB, accountId: string, usageMonth: string, contractStartDate: string): Promise<EngineItem[]> {
  const [items, pricing] = await Promise.all([listBillingItems(db, accountId), currentPricingByItemType(db)]);
  const out: EngineItem[] = [];
  for (const it of items) {
    if (!it.active) continue;

    // Prefer the price SNAPSHOT frozen at activation (L2/L3) — so an in-place
    // catalogue band edit never reprices a live contract. Fall back to the live
    // catalogue only when the item has no snapshot (pre-074, or never activated).
    const snap = asPricedSnapshot(it.priced_snapshot);
    const table = pricing.get(it.item_type);
    const metric = (snap?.metric ?? table?.metric ?? "flat_monthly") as Metric;
    const bands = snap ? snap.bands : (table ? (await listBands(db, table.id)).map((b) => ({ from_units: b.from_units, to_units: b.to_units, unit_price_pence: b.unit_price_pence, minimum_type: b.minimum_type, minimum_pence: b.minimum_pence, unit_cap_pence: b.unit_cap_pence })) : []);

    // Config = snapshot (catalogue ⊕ item, frozen) or, when none, the live
    // catalogue defaults with the per-account item config layered on top. Then
    // resolve any relative escalation schedule to absolute dates vs the start.
    const baseCfg: ItemConfig = snap ? { ...snap.config } : { ...((table?.config ?? {}) as unknown as ItemConfig), ...(it.config as ItemConfig) };
    const cfg: ItemConfig = baseCfg;
    if (!cfg.escalation) {
      const esc = resolveEscalation(cfg.escalation_relative, contractStartDate);
      if (esc) cfg.escalation = esc;
    }

    out.push({
      billing_item_id: it.id,
      item_type: it.item_type,
      label: table?.name ?? it.item_type,
      metric,
      vat_treatment: (snap?.vat_treatment ?? (it.vat_treatment as VatTreatment) ?? (table?.vat_treatment as VatTreatment) ?? "standard"),
      product_group: snap?.product_group ?? table?.product_group ?? null,
      band_mode: snap?.band_mode ?? table?.band_mode ?? "volume",
      config: cfg,
      override: (it.override as ItemConfig) ?? null,
      bands,
      usage: await aggregateUsage(db, it.id, usageMonth),
    });
  }
  return out;
}

/** Has a setup fee already been carried on a prior invoice for this account?
 *  Gates the one-off so a trigger that fires in a later month never double-bills
 *  (and never silently drops the fee when it fires after the first invoice). */
async function setupFeeBilled(db: DB, accountId: string): Promise<boolean> {
  const { data: setupItem } = await db.from("billing_items").select("id").eq("account_id", accountId).eq("item_type", "setup_fee").maybeSingle();
  if (!setupItem) return false;
  const { count } = await db.from("billing_invoice_lines").select("id", { count: "exact", head: true }).eq("billing_item_id", (setupItem as { id: string }).id);
  return (count ?? 0) > 0;
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

export async function runBilling(db: DB, period?: string, opts: { dryRun?: boolean } = {}): Promise<RunSummary> {
  // Arrears-only: the run on the 1st bills the month that JUST ENDED. issueDate
  // (the run's month-start) drives the due date; periodMonth is the billed month.
  const { dryRun = false } = opts;
  const issueDate = londonFirstOfThisMonth();
  const periodMonth = period ?? prevMonth(issueDate);
  const runDate = londonToday();
  // Safety gate: even an 'auto' account only authorises once the global cutover
  // date has passed, so nothing auto-sends before go-live (X1).
  const globalCutover = !!process.env.XERO_AUTO_APPROVE_FROM && runDate >= process.env.XERO_AUTO_APPROVE_FROM;
  const xero = getXero();
  const crm = getCrm();
  const groupMinimums: GroupMinimumInput[] = (await currentGroupMinimums(db)).map((g) => ({ product_group: g.product_group, minimum_pence: g.minimum_pence }));

  // Dry run (X5): compute everything but write nothing to the DB or Xero.
  let runId = "dry-run";
  if (!dryRun) {
    const { data: run } = await db.from("billing_invoice_runs").insert({ period_month: periodMonth, run_date: runDate, status: "running" }).select("id").single();
    runId = run!.id as string;
  }

  const summary: RunSummary = { period_month: periodMonth, invoiced: 0, skipped: 0, flagged: [], errors: [], total_pence: 0 };

  // Active + notice_given bill normally; cancelled may still have trailing usage; disputed are flagged.
  // billing_type is selected resiliently (added in migration 073) — before it
  // exists every account falls back to 'auto'.
  type AccRow = { id: string; status: string; contract_start_date: string | null; contract_end_date: string | null; contract_signed_at: string | null; hubspot_company_id: string | null; finance_contact_id: string | null; xero_contact_id: string | null; billing_type?: string };
  const baseCols = "id, status, contract_start_date, contract_end_date, contract_signed_at, hubspot_company_id, finance_contact_id, xero_contact_id";
  const statuses = ["active", "notice_given", "cancelled", "disputed"];
  const q = (cols: string) => db.from("billing_accounts").select(cols).in("status", statuses) as unknown as Promise<{ data: AccRow[] | null; error: { message: string } | null }>;
  let accRes = await q(`${baseCols}, billing_type`);
  if (accRes.error && /billing_type/i.test(accRes.error.message)) accRes = await q(baseCols);

  for (const acc of (accRes.data ?? []) as AccRow[]) {
    try {
      if (acc.status === "disputed") { summary.flagged.push({ account_id: acc.id, reason: "disputed" }); continue; }
      // Bill once the contract has started by the end of the billed month (a
      // mid-month start is pro-rated by the engine), i.e. skip only accounts that
      // start in a LATER month than the one being billed.
      if (!acc.contract_start_date || acc.contract_start_date.slice(0, 7) > periodMonth.slice(0, 7)) { summary.skipped += 1; continue; }

      // Idempotent: skip if this account already has an invoice for the period.
      const { data: existing } = await db.from("billing_invoices").select("id").eq("account_id", acc.id).eq("period_month", periodMonth).maybeSingle();
      if (existing) { summary.skipped += 1; continue; }
      const { count: priorCount } = await db.from("billing_invoices").select("id", { count: "exact", head: true }).eq("account_id", acc.id);
      const isFirstInvoice = (priorCount ?? 0) === 0;

      const items = await buildEngineItems(db, acc.id, periodMonth, acc.contract_start_date);
      // L4: a setup fee bills per its trigger (default on_contract_signed), once.
      const hasSetup = items.some((i) => i.item_type === "setup_fee");
      const setupFeeAlreadyBilled = hasSetup ? await setupFeeBilled(db, acc.id) : false;
      const input: EngineInput = {
        periodMonth, isFirstInvoice, contractStartDate: acc.contract_start_date, contractEndDate: acc.contract_end_date,
        items, groupMinimums, issueDate, contractSigned: !!acc.contract_signed_at, setupFeeAlreadyBilled,
      };
      const result = computeInvoice(input);
      if (result.lines.length === 0) { summary.skipped += 1; continue; }

      if (dryRun) { summary.invoiced += 1; summary.total_pence += result.total_pence; continue; }

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

      // 'draft' accounts always raise a Xero DRAFT; 'auto' accounts authorise
      // only once the global cutover has passed (X1).
      const approve = globalCutover && (acc.billing_type ?? "auto") !== "draft";
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

  if (!dryRun) {
    await db.from("billing_invoice_runs").update({ status: summary.errors.length ? "error" : "complete", finished_at: new Date().toISOString(), summary, errors: summary.errors }).eq("id", runId);
  }
  return summary;
}
