// Daily lead-invite chase job. Sends the 48h / 7-day follow-ups to invited leads
// who haven't booked a call or opted for sandbox. No-op until LEAD_INVITE_ENABLED
// is "true". Guarded by CRON_SECRET (Vercel Cron Bearer, or ?token=).

import { serviceClient } from "@/lib/db/client";
import { runLeadChases } from "@/lib/leads/chase";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("token") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const res = await runLeadChases(serviceClient());
  return Response.json({ ok: true, ...res });
}
