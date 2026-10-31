// POST /api/billing/usage — report usage for one billing item.
// Auth: bearer = that item's usage key (ccb_…). Body: a single record or a batch
// array. Idempotent per idempotency_key; a repeat with a different payload is a
// 409. See /docs/billing-api.md.

import { serviceClient } from "@/lib/db/client";
import { hashUsageKey } from "@/lib/billing/usageKey";
import { findItemByKeyHash, recordUsage, usageBodySchema, type UsageRecordInput, type RecordStatus } from "@/lib/billing/usage";

export const dynamic = "force-dynamic";

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : null;
}

export async function POST(req: Request): Promise<Response> {
  const token = bearer(req);
  if (!token) return Response.json({ ok: false, error: "missing bearer token" }, { status: 401 });

  const db = serviceClient();
  const item = await findItemByKeyHash(db, hashUsageKey(token));
  if (!item) return Response.json({ ok: false, error: "invalid usage key" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }
  const parsed = usageBodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: "validation", issues: parsed.error.issues }, { status: 400 });

  const records: UsageRecordInput[] = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const results: { idempotency_key: string; status: RecordStatus }[] = [];
  try {
    for (const rec of records) {
      results.push({ idempotency_key: rec.idempotency_key, status: await recordUsage(db, item.id, rec) });
    }
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  const hasConflict = results.some((r) => r.status === "conflict");
  const payload = { ok: !hasConflict, item: item.item_type, results };
  return Response.json(payload, { status: hasConflict ? 409 : 200 });
}
