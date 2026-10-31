// POST /api/billing/contract-status — internal contract-status event sink.
// Auth: CRON_SECRET bearer. Body: { account_id | hubspot_deal_id, status,
// effective_at? }. Writes a contract_status_event; `signed` stamps
// contract_signed_at (the Phase-4 engine then bills the setup fee per the item's
// billing_trigger); account-status values flip billing_accounts.status.
// See /docs/billing-api.md.

import { z } from "zod";
import { serviceClient } from "@/lib/db/client";
import { getBillingAccountById, updateBillingAccount, logContractStatusEvent, type AccountPatch } from "@/lib/billing/repo";
import { ACCOUNT_STATUSES } from "@/lib/billing/catalogue";

export const dynamic = "force-dynamic";

const schema = z.object({
  account_id: z.string().uuid().optional(),
  hubspot_deal_id: z.string().optional(),
  status: z.string().min(1),
  effective_at: z.string().optional(),
}).refine((b) => b.account_id || b.hubspot_deal_id, { message: "account_id or hubspot_deal_id required" });

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: "validation", issues: parsed.error.issues }, { status: 400 });
  const { account_id, hubspot_deal_id, status } = parsed.data;
  const effectiveAt = parsed.data.effective_at ?? new Date().toISOString();

  const db = serviceClient();
  let account = account_id ? await getBillingAccountById(db, account_id) : null;
  if (!account && hubspot_deal_id) {
    const { data } = await db.from("billing_accounts").select("id").eq("hubspot_deal_id", hubspot_deal_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data) account = await getBillingAccountById(db, (data as { id: string }).id);
  }
  if (!account) return Response.json({ ok: false, error: "billing account not found" }, { status: 404 });

  await logContractStatusEvent(db, account.id, status, "api", { effective_at: effectiveAt, hubspot_deal_id });

  const patch: AccountPatch = {};
  if (status === "signed") patch.contract_signed_at = effectiveAt;
  if ((ACCOUNT_STATUSES as readonly string[]).includes(status)) patch.status = status as AccountPatch["status"];
  if (status === "cancelled") patch.contract_end_date = effectiveAt.slice(0, 10);
  if (Object.keys(patch).length) await updateBillingAccount(db, account.id, patch);

  return Response.json({ ok: true, account_id: account.id, status, contract_signed: status === "signed" });
}
