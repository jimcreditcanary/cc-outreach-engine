// Daily scheduled job (build brief §11). Refreshes regulatory/market signals
// so the morning surface and generation have fresh triggers. Guarded by
// CRON_SECRET (Vercel Cron sends it as a Bearer token; also accepts ?token=).
//
// Drafting + the send drip stay operator-triggered (approval queue, §14) —
// add them as separate crons once warmed.

import { serviceClient } from "@/lib/db/client";
import { refreshSignals } from "@/lib/signals/refresh";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unset → open (dev)
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("token") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const { inserted, log } = await refreshSignals(serviceClient());
  return Response.json({ ok: true, inserted, log });
}
