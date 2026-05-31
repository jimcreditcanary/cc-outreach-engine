// Send drip cron — drains approved drafts in small batches throughout the
// UK sending window. Each call honours the warm-up ramp + daily cap +
// suppressions + bounce/complaint auto-pause. Guarded by CRON_SECRET.

import { serviceClient } from "@/lib/db/client";
import { runSendBatch } from "@/lib/send/runBatch";

export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("token") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const batch = Number(new URL(req.url).searchParams.get("batch") ?? process.env.CRON_SEND_BATCH ?? 10);
  const res = await runSendBatch(serviceClient(), { batch });
  return Response.json(res);
}
