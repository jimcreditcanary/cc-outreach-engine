// Hourly cron — syncs calendars for every connected operator:
//   - Outlook for everyone with an ms_oauth_tokens row
//   - Google Calendar for everyone with a user_settings.google_ics_url
// Guarded by CRON_SECRET. Loops are per-user so adding teammates Just Works.

import { serviceClient } from "@/lib/db/client";
import { syncCalendar } from "@/lib/meetings/sync";
import { syncGoogleCalendar } from "@/lib/google/sync";

export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("token") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const db = serviceClient();
  const results: { user_id: string; source: string; ok: boolean; reason?: string; upserted?: number }[] = [];

  const { data: msRows } = await db.from("ms_oauth_tokens").select("user_id");
  for (const r of msRows ?? []) {
    try {
      const res = await syncCalendar(db, r.user_id as string);
      results.push({ user_id: r.user_id as string, source: "outlook", ok: res.ok, reason: res.reason, upserted: res.upserted });
    } catch (e) {
      results.push({ user_id: r.user_id as string, source: "outlook", ok: false, reason: (e as Error).message });
    }
  }

  const { data: gRows } = await db.from("user_settings").select("user_id").not("google_ics_url", "is", null);
  for (const r of gRows ?? []) {
    try {
      const res = await syncGoogleCalendar(db, r.user_id as string);
      results.push({ user_id: r.user_id as string, source: "google", ok: res.ok, reason: res.reason, upserted: res.upserted });
    } catch (e) {
      results.push({ user_id: r.user_id as string, source: "google", ok: false, reason: (e as Error).message });
    }
  }

  return Response.json({ ok: true, results });
}
