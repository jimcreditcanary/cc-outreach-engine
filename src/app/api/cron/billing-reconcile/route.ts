// GET /api/cron/billing-reconcile — daily scan: create a billing_account for any
// onboarded case that doesn't have one yet (self-heals a failed inline create on
// approval). CRON_SECRET-guarded (Vercel Cron sends the bearer).

import { serviceClient } from "@/lib/db/client";
import { reconcileBilling } from "@/lib/billing/provision";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await reconcileBilling(serviceClient());
  return Response.json({ ok: true, ...result });
}
