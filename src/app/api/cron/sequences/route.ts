// Hourly sequences engine tick — advances every active sequence-contact,
// creates due actions, queues AI drafts for email steps. Guarded by
// CRON_SECRET, same shape as the other crons.

import { serviceClient } from "@/lib/db/client";
import { advanceAllSequences } from "@/lib/sequences/engine";

// Engine generates one AI draft per due email step — give it runway.
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("token") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const res = await advanceAllSequences(serviceClient());
  return Response.json({ ok: true, ...res });
}
