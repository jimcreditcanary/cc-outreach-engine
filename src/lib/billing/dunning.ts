// Dunning (Phase 5). Syncs paid status from Xero, finds overdue invoices, logs
// them, and emails each deal owner their outstanding list. recordContacted backs
// the per-row toggle on /billing/outstanding.

import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "@/lib/auth/admin";
import { sendTransactional } from "@/lib/send/postmark";
import { appendSignatureHtml, appendSignatureText } from "@/lib/send/signature";
import { getXero } from "@/lib/integrations/xero";
import { formatPence } from "./money";

type DB = SupabaseClient;

const DAY = 86_400_000;
function appUrl(): string { return (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.veepveep.co.uk").replace(/\/$/, ""); }
export function daysOverdue(dueDate: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`)) / DAY);
}

interface InvoiceRow { id: string; account_id: string; period_month: string; total_pence: number; due_date: string | null; paid_at: string | null; xero_invoice_id: string | null; xero_status: string | null; }
interface AccountRow { id: string; hubspot_company_id: string | null; deal_owner_user_id: string | null; }

export interface OutstandingRow {
  invoice_id: string; account_id: string; company: string | null; period_month: string;
  total_pence: number; due_date: string | null; days_overdue: number; xero_invoice_id: string | null;
  deal_owner_user_id: string | null; contacted_customer: boolean | null; note: string | null;
}

/** Pull paid status from Xero for still-open invoices and stamp paid_at. */
export async function syncPaidStatus(db: DB): Promise<number> {
  const xero = getXero();
  const { data } = await db.from("billing_invoices").select("id, xero_invoice_id").is("paid_at", null).not("xero_invoice_id", "is", null);
  let synced = 0;
  for (const inv of (data ?? []) as { id: string; xero_invoice_id: string }[]) {
    try {
      const s = await xero.getInvoiceStatus(inv.xero_invoice_id);
      if (s.paid) { await db.from("billing_invoices").update({ paid_at: new Date().toISOString(), xero_status: "PAID" }).eq("id", inv.id); synced += 1; }
    } catch { /* best-effort */ }
  }
  return synced;
}

/** Overdue (unpaid, past due) invoices with company + latest contacted status. */
export async function loadOutstanding(db: DB, today = new Date().toISOString().slice(0, 10)): Promise<OutstandingRow[]> {
  const { data: invs } = await db.from("billing_invoices")
    .select("id, account_id, period_month, total_pence, due_date, paid_at, xero_invoice_id, xero_status")
    .is("paid_at", null).lt("due_date", today).order("due_date", { ascending: true });
  const invoices = (invs ?? []) as InvoiceRow[];
  if (!invoices.length) return [];

  const accIds = [...new Set(invoices.map((i) => i.account_id))];
  const { data: accs } = await db.from("billing_accounts").select("id, hubspot_company_id, deal_owner_user_id").in("id", accIds);
  const accById = new Map((accs ?? []).map((a) => [(a as AccountRow).id, a as AccountRow]));

  const { data: dun } = await db.from("billing_dunning_log").select("invoice_id, contacted_customer, note, reported_on").in("invoice_id", invoices.map((i) => i.id)).order("reported_on", { ascending: false });
  const latestDun = new Map<string, { contacted_customer: boolean | null; note: string | null }>();
  for (const d of (dun ?? []) as { invoice_id: string; contacted_customer: boolean | null; note: string | null }[]) {
    if (!latestDun.has(d.invoice_id)) latestDun.set(d.invoice_id, { contacted_customer: d.contacted_customer, note: d.note });
  }

  return invoices.map((i) => {
    const a = accById.get(i.account_id);
    const d = latestDun.get(i.id);
    return {
      invoice_id: i.id, account_id: i.account_id, company: a?.hubspot_company_id ?? null, period_month: i.period_month,
      total_pence: i.total_pence, due_date: i.due_date, days_overdue: i.due_date ? daysOverdue(i.due_date, today) : 0,
      xero_invoice_id: i.xero_invoice_id, deal_owner_user_id: a?.deal_owner_user_id ?? null,
      contacted_customer: d?.contacted_customer ?? null, note: d?.note ?? null,
    };
  });
}

export interface DunningSummary { synced: number; outstanding: number; owners_emailed: number; errors: { owner: string; error: string }[] }

/** The 15th-of-month cron: sync paid, log overdue, email each deal owner. */
export async function runDunning(db: DB, today = new Date().toISOString().slice(0, 10)): Promise<DunningSummary> {
  const synced = await syncPaidStatus(db);
  const rows = await loadOutstanding(db, today);
  const summary: DunningSummary = { synced, outstanding: rows.length, owners_emailed: 0, errors: [] };
  if (!rows.length) return summary;

  // Log each overdue invoice for today (idempotent per invoice+date).
  await db.from("billing_dunning_log").upsert(
    rows.map((r) => ({ invoice_id: r.invoice_id, account_id: r.account_id, deal_owner_user_id: r.deal_owner_user_id, reported_on: today })),
    { onConflict: "invoice_id,reported_on", ignoreDuplicates: true },
  );

  // Group by deal owner and email.
  const byOwner = new Map<string, OutstandingRow[]>();
  for (const r of rows) { if (!r.deal_owner_user_id) continue; const arr = byOwner.get(r.deal_owner_user_id) ?? []; arr.push(r); byOwner.set(r.deal_owner_user_id, arr); }

  for (const [ownerId, list] of byOwner) {
    try {
      const { data } = await adminClient().auth.admin.getUserById(ownerId);
      const to = data?.user?.email;
      if (!to) { summary.errors.push({ owner: ownerId, error: "no email" }); continue; }
      const link = `${appUrl()}/billing/outstanding`;
      const lines = list.map((r) => `• ${r.company ?? r.account_id.slice(0, 8)} — ${formatPence(r.total_pence)} — ${r.days_overdue} days overdue (${r.period_month})`);
      await sendTransactional({
        to, subject: `Billing: ${list.length} unpaid invoice${list.length === 1 ? "" : "s"} to chase`,
        textBody: appendSignatureText([`Your accounts with unpaid invoices:`, "", ...lines, "", `Mark who you've chased: ${link}`].join("\n")),
        htmlBody: appendSignatureHtml(`<p>Your accounts with unpaid invoices:</p><ul>${list.map((r) => `<li>${r.company ?? r.account_id.slice(0, 8)} — ${formatPence(r.total_pence)} — ${r.days_overdue} days overdue (${r.period_month})</li>`).join("")}</ul><p><a href="${link}">Mark who you've chased</a>.</p>`),
        tag: "billing-dunning",
      });
      summary.owners_emailed += 1;
    } catch (e) { summary.errors.push({ owner: ownerId, error: (e as Error).message }); }
  }
  return summary;
}

/** Record whether the deal owner has chased the customer (per-row toggle). */
export async function recordContacted(db: DB, invoiceId: string, contacted: boolean, note: string, userId: string | null): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: acc } = await db.from("billing_invoices").select("account_id").eq("id", invoiceId).maybeSingle();
  await db.from("billing_dunning_log").upsert(
    { invoice_id: invoiceId, account_id: (acc as { account_id: string } | null)?.account_id ?? null, deal_owner_user_id: userId, reported_on: today, contacted_customer: contacted, contacted_at: contacted ? new Date().toISOString() : null, note: note || null },
    { onConflict: "invoice_id,reported_on" },
  );
}
