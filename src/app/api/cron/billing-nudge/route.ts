// GET /api/cron/billing-nudge — weekly notice-period + anniversary nudges to
// deal owners. CRON_SECRET-guarded.

import { serviceClient } from "@/lib/db/client";
import { runNoticeNudge } from "@/lib/billing/nudge";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const summary = await runNoticeNudge(serviceClient());
  return Response.json({ ok: true, ...summary });
}
