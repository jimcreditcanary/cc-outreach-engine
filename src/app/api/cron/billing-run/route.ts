// GET /api/cron/billing-run — the monthly invoice run (Vercel Cron `0 6 1 * *`,
// with a retry run 12h later). Idempotent per (account, period): the retry only
// picks up accounts that have no invoice yet. CRON_SECRET-guarded. `?period=
// YYYY-MM-01` overrides the period (for backfills).

import { serviceClient } from "@/lib/db/client";
import { runBilling } from "@/lib/billing/invoiceRun";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const period = new URL(req.url).searchParams.get("period") ?? undefined;
  const summary = await runBilling(serviceClient(), period ?? undefined);
  return Response.json({ ok: true, ...summary });
}
