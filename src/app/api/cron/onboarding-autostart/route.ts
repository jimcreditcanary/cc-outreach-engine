// GET /api/cron/onboarding-autostart — daily scan: mark the company an Active
// Customer for any deal closed-won in the last window (does NOT auto-start an
// onboarding case — that's manual), and alert the team. CRON_SECRET-guarded
// (Vercel Cron sends the bearer).

import { serviceClient } from "@/lib/db/client";
import { markClosedWonCustomers } from "@/lib/onboarding/autostart";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await markClosedWonCustomers(serviceClient());
  return Response.json({ ok: true, ...result });
}
