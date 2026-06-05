// Granola sync cron — every 15 min. For every operator with a token
// in user_settings.granola_api_token, pulls fresh notes from the
// Granola public API (https://public-api.granola.ai), matches them to
// meetings by ms_event_id (primary) or time+attendees (fallback),
// fills meetings.transcript, runs the post-meeting summary + MEDDICC
// re-seed, and ships the warm follow-up email to the primary contact.
//
// Idempotent + safe to re-run. Guarded by CRON_SECRET.

import { serviceClient } from "@/lib/db/client";
import { syncAllGranola } from "@/lib/granola/sync";

export const maxDuration = 120;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("token") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const res = await syncAllGranola(serviceClient());
  return Response.json({ ok: true, ...res });
}
