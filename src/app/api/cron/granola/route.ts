// Granola sync cron — every 15 min. For every operator with a token,
// pulls new transcripts, matches them to meetings, fills our DB, and
// ships an AI-drafted follow-up email to the primary contact.
//
// Idempotent: re-running won't double-create transcripts or double-send
// follow-ups (granola_note_id unique + granola_followup_send_id null check).
// Guarded by CRON_SECRET (matches all other crons).

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
