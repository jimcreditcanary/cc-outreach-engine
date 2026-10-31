// POST /api/billing/usage/internal — client-level usage feed from veepveep's
// platform. One call per client per month carries usage for every variable
// product the client is set up for. Auth: CRON_SECRET bearer (internal).
// SET/restate semantics per product+month — safe to resend. See
// /docs/billing-api.md.

import { serviceClient } from "@/lib/db/client";
import { clientUsageSchema, resolveClientAccountId, recordClientUsage } from "@/lib/billing/usage";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }
  const parsed = clientUsageSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: "validation", issues: parsed.error.issues }, { status: 400 });

  const db = serviceClient();
  const accountId = await resolveClientAccountId(db, parsed.data.client_ref);
  if (!accountId) return Response.json({ ok: false, error: "client not found", client_ref: parsed.data.client_ref }, { status: 404 });

  try {
    const results = await recordClientUsage(db, accountId, parsed.data.period_month, parsed.data.usage);
    return Response.json({ ok: true, account_id: accountId, period_month: parsed.data.period_month, results });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
