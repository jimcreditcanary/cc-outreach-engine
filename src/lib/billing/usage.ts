// Usage reporting — the data logic behind POST /api/billing/usage. Pure helpers
// (period normalization, idempotency comparison) are unit-tested; recordUsage
// does the idempotent upsert.

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { catalogueEntry, type Metric } from "./catalogue";

type DB = SupabaseClient;

export const usageRecordSchema = z.object({
  period_month: z.string().min(4),                 // "2026-01" or "2026-01-15" → 1st of month
  quantity: z.number().nonnegative(),
  value: z.number().nullish(),
  principal: z.number().nullish(),
  application_outcome: z.string().nullish(),
  idempotency_key: z.string().min(8).max(200),
});
export type UsageRecordInput = z.infer<typeof usageRecordSchema>;

/** Accept a single record or a batch array. */
export const usageBodySchema = z.union([usageRecordSchema, z.array(usageRecordSchema).min(1).max(500)]);

/** Normalise any ISO-ish date to the 1st of its month, "YYYY-MM-01". */
export function normalizePeriodMonth(input: string): string {
  const m = input.trim().match(/^(\d{4})-(\d{2})/);
  if (!m) throw new Error(`invalid period_month: ${input}`);
  return `${m[1]}-${m[2]}-01`;
}

interface StoredUsage {
  period_month: string;
  quantity: number;
  value: number | null;
  principal: number | null;
  application_outcome: string | null;
}

/** True when an incoming record matches a stored one on every billed field. */
export function usagePayloadEqual(stored: StoredUsage, incoming: UsageRecordInput): boolean {
  return (
    stored.period_month === normalizePeriodMonth(incoming.period_month) &&
    Number(stored.quantity) === Number(incoming.quantity) &&
    (stored.value ?? null) === (incoming.value ?? null) &&
    (stored.principal ?? null) === (incoming.principal ?? null) &&
    (stored.application_outcome ?? null) === (incoming.application_outcome ?? null)
  );
}

export interface BillingItemLite {
  id: string;
  account_id: string;
  item_type: string;
}

/** Resolve the billing item a usage key authorises (by SHA-256 hash). */
export async function findItemByKeyHash(db: DB, hash: string): Promise<BillingItemLite | null> {
  const { data } = await db
    .from("billing_items")
    .select("id, account_id, item_type")
    .eq("usage_api_key_hash", hash)
    .eq("active", true)
    .maybeSingle();
  return (data as BillingItemLite | null) ?? null;
}

export type RecordStatus = "created" | "duplicate" | "conflict";

/** Idempotent insert: new key → created; same key+payload → duplicate; same key
 *  + different payload → conflict (the caller maps that to HTTP 409). */
export async function recordUsage(db: DB, itemId: string, rec: UsageRecordInput): Promise<RecordStatus> {
  const row = {
    billing_item_id: itemId,
    period_month: normalizePeriodMonth(rec.period_month),
    quantity: rec.quantity,
    value: rec.value ?? null,
    principal: rec.principal ?? null,
    application_outcome: rec.application_outcome ?? null,
    source: "api",
    idempotency_key: rec.idempotency_key,
    raw: rec as unknown as Record<string, unknown>,
  };
  const ins = await db.from("billing_usage_records").insert(row);
  if (!ins.error) return "created";
  if (ins.error.code !== "23505") throw ins.error; // not a unique-violation → real error

  // Key already used — compare payloads.
  const { data: existing } = await db
    .from("billing_usage_records")
    .select("period_month, quantity, value, principal, application_outcome")
    .eq("idempotency_key", rec.idempotency_key)
    .maybeSingle();
  if (!existing) throw ins.error;
  return usagePayloadEqual(existing as StoredUsage, rec) ? "duplicate" : "conflict";
}

// ─── client-level multi-product feed (internal) ───────────────────────────────
// One call per client per month carrying usage for every variable product the
// client is set up for: { client_ref, period_month, usage: [{item_type, qty…}] }.
// Auth is CRON_SECRET (internal, from veepveep's platform), not per-item keys.
// Semantics are SET/restate per (product, month): re-sending a month overwrites
// that product's total (last write wins), so monthly feeds are safe to resend.

export const clientUsageItemSchema = z.object({
  item_type: z.string().min(1),
  quantity: z.number().nonnegative(),
  value: z.number().nullish(),
  principal: z.number().nullish(),
  application_outcome: z.string().nullish(),
  idempotency_key: z.string().min(8).max(200).optional(),
});
export type ClientUsageItem = z.infer<typeof clientUsageItemSchema>;

export const clientUsageSchema = z.object({
  client_ref: z.string().min(1),
  period_month: z.string().min(4),
  usage: z.array(clientUsageItemSchema).min(1).max(100),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a client reference to a billing account id. Accepts (in order) the
 *  HubSpot company id, the billing account id, or the onboarding case id — so
 *  whatever stable id veepveep holds for the merchant works. */
export async function resolveClientAccountId(db: DB, ref: string): Promise<string | null> {
  const byCompany = await db.from("billing_accounts").select("id").eq("hubspot_company_id", ref).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (byCompany.data) return (byCompany.data as { id: string }).id;
  if (UUID_RE.test(ref)) {
    const byId = await db.from("billing_accounts").select("id").eq("id", ref).maybeSingle();
    if (byId.data) return (byId.data as { id: string }).id;
    const byCase = await db.from("billing_accounts").select("id").eq("onboarding_case_id", ref).maybeSingle();
    if (byCase.data) return (byCase.data as { id: string }).id;
  }
  return null;
}

export type ClientUsageStatus = "recorded" | "not_configured";
export interface ClientUsageResult { item_type: string; status: ClientUsageStatus; quantity?: number }

// ─── ingest guardrails (A1/A2/A3/A4) ─────────────────────────────────────────

// Reject a value/principal this large — a 100× unit error (pounds posted where
// pence are expected) would invoice catastrophically. Global backstop for now;
// a per-client ceiling (needs a column) is a follow-up. Tunable via env.
const VALUE_CEILING_PENCE = Number(process.env.BILLING_USAGE_CEILING_PENCE) || 5_000_000_00; // £5,000,000

export interface UsageValidationDetail {
  unknown: string[];                                                     // A1: not a catalogue item_key
  over_ceiling: { item_type: string; field: "value" | "principal"; amount: number }[]; // A2
  bad_shape: { item_type: string; reason: string }[];                    // A4
}
export class UsageValidationError extends Error {
  constructor(public detail: UsageValidationDetail) { super("usage validation failed"); this.name = "UsageValidationError"; }
}
export class PeriodInvoicedError extends Error {
  constructor(public invoice: { id: string; xero_invoice_id: string | null; period_month: string }) { super("period already invoiced"); this.name = "PeriodInvoicedError"; }
}

/** A4 — which posted fields a metric expects. Returns an error string or null.
 *  `value` is the pre-computed % amount (payment rails); `principal` is Monevo's
 *  lending total. Count-based metrics must carry neither. */
export function usageShapeError(metric: Metric, it: { quantity: number; value?: number | null; principal?: number | null }): string | null {
  const hasValue = it.value != null;
  const hasPrincipal = it.principal != null;
  const valueMetric = metric === "per_txn_pct" || metric === "per_txn_fixed_and_pct";
  const principalMetric = metric === "pct_of_principal";
  if (hasValue && !valueMetric) return `value posted for '${metric}' (a count-based metric)`;
  if (hasPrincipal && !principalMetric) return `principal posted for '${metric}'`;
  if (metric === "per_txn_pct" && !hasValue) return `'${metric}' needs a pre-computed value`;
  if (principalMetric && !hasPrincipal) return `'pct_of_principal' needs principal`;
  return null;
}

/** Validate a client usage batch against the catalogue (A1), the value ceiling
 *  (A2) and each item's metric shape (A4). Pure — no DB. */
export function validateUsageBatch(items: ClientUsageItem[], ceilingPence = VALUE_CEILING_PENCE): UsageValidationDetail {
  const d: UsageValidationDetail = { unknown: [], over_ceiling: [], bad_shape: [] };
  for (const it of items) {
    const entry = catalogueEntry(it.item_type);
    if (!entry) { d.unknown.push(it.item_type); continue; } // unknown key → skip further checks
    if ((it.value ?? 0) > ceilingPence) d.over_ceiling.push({ item_type: it.item_type, field: "value", amount: it.value! });
    if ((it.principal ?? 0) > ceilingPence) d.over_ceiling.push({ item_type: it.item_type, field: "principal", amount: it.principal! });
    const se = usageShapeError(entry.metric, it);
    if (se) d.bad_shape.push({ item_type: it.item_type, reason: se });
  }
  return d;
}
export function usageBatchHasErrors(d: UsageValidationDetail): boolean {
  return d.unknown.length > 0 || d.over_ceiling.length > 0 || d.bad_shape.length > 0;
}

/** Record (set/restate) usage for each product against the client's items.
 *  Guardrails: the batch is validated up-front and rejected ATOMICALLY (nothing
 *  written) on an unknown key / over-ceiling value / bad metric shape (A1/A2/A4,
 *  → UsageValidationError); a month that's already been invoiced is locked
 *  (A3, → PeriodInvoicedError). A valid product the client isn't set up for is
 *  reported as not_configured and logged, not billed (A5). */
export async function recordClientUsage(db: DB, accountId: string, periodMonth: string, items: ClientUsageItem[]): Promise<ClientUsageResult[]> {
  const period = normalizePeriodMonth(periodMonth);

  // A1/A2/A4 — validate the whole batch first; reject atomically.
  const detail = validateUsageBatch(items);
  if (usageBatchHasErrors(detail)) throw new UsageValidationError(detail);

  // A3 — an already-invoiced month is locked (no silent overwrite of billed usage).
  const { data: inv } = await db.from("billing_invoices").select("id, xero_invoice_id, period_month").eq("account_id", accountId).eq("period_month", period).maybeSingle();
  if (inv) throw new PeriodInvoicedError(inv as { id: string; xero_invoice_id: string | null; period_month: string });

  const results: ClientUsageResult[] = [];
  for (const it of items) {
    const { data: item } = await db.from("billing_items").select("id").eq("account_id", accountId).eq("item_type", it.item_type).eq("active", true).maybeSingle();
    if (!item) {
      // A5 — valid catalogue key the client isn't set up for: logged + reported,
      // never billed. (Persisting it would need an unmatched-usage table.)
      console.warn(`[billing-usage] not_configured: account ${accountId} ${period} ${it.item_type} (qty ${it.quantity}, value ${it.value ?? "-"})`);
      results.push({ item_type: it.item_type, status: "not_configured" });
      continue;
    }
    const key = it.idempotency_key ?? `platform:${accountId}:${it.item_type}:${period}`;
    const { error } = await db.from("billing_usage_records").upsert({
      billing_item_id: (item as { id: string }).id, period_month: period, quantity: it.quantity,
      value: it.value ?? null, principal: it.principal ?? null, application_outcome: it.application_outcome ?? null,
      source: "api", idempotency_key: key, raw: it as unknown as Record<string, unknown>,
    }, { onConflict: "idempotency_key" });
    if (error) throw error;
    results.push({ item_type: it.item_type, status: "recorded", quantity: it.quantity });
  }
  return results;
}
