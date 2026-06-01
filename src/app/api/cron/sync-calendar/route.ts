// Hourly cron — syncs the calendar for every operator who's connected MS.
// Guarded by CRON_SECRET. In v1 there's only Jim, but the loop is per-user
// so adding teammates Just Works.

import { serviceClient } from "@/lib/db/client";
import { syncCalendar } from "@/lib/meetings/sync";

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
  const { data: rows } = await db.from("ms_oauth_tokens").select("user_id");
  const results: { user_id: string; ok: boolean; reason?: string; upserted?: number }[] = [];
  for (const r of rows ?? []) {
    try {
      const res = await syncCalendar(db, r.user_id as string);
      results.push({ user_id: r.user_id as string, ok: res.ok, reason: res.reason, upserted: res.upserted });
    } catch (e) {
      results.push({ user_id: r.user_id as string, ok: false, reason: (e as Error).message });
    }
  }
  return Response.json({ ok: true, results });
}
