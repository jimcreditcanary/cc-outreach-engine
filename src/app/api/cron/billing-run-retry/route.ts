// GET /api/cron/billing-run-retry — 12h-later retry of the monthly run. Same
// idempotent run; only picks up accounts with no invoice yet for the period.
// CRON_SECRET-guarded.

import { serviceClient } from "@/lib/db/client";
import { runBilling } from "@/lib/billing/invoiceRun";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const summary = await runBilling(serviceClient());
  return Response.json({ ok: true, retry: true, ...summary });
}
