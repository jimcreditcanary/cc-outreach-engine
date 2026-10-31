// Usage reporting — the data logic behind POST /api/billing/usage. Pure helpers
// (period normalization, idempotency comparison) are unit-tested; recordUsage
// does the idempotent upsert.

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

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
