// GET /api/cron/billing-dunning — 15th-of-month dunning (Vercel Cron
// `0 7 15 * *`): sync paid status from Xero, log overdue invoices, and email
// each deal owner their outstanding list. CRON_SECRET-guarded.

import { serviceClient } from "@/lib/db/client";
import { runDunning } from "@/lib/billing/dunning";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const summary = await runDunning(serviceClient());
  return Response.json({ ok: true, ...summary });
}
