// Inbound follow-up drafting job. Processes pending inbound_followups
// (download / enquiry / abandonment) into personalised, event-aware drafts in
// the review queue. Runs frequently so warm inbound gets a prompt follow-up.
// Guarded by CRON_SECRET (Vercel Cron Bearer, or ?token=).

import { serviceClient } from "@/lib/db/client";
import { runInboundFollowups } from "@/lib/mailer/inbound";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("token") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const res = await runInboundFollowups(serviceClient(), { limit: 15 });
  return Response.json({ ok: true, ...res });
}
