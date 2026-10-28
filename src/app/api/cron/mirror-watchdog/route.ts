// Mirror watchdog. Catches the case the failure-alert can't: the nightly mirror
// cron not firing at all (e.g. a Vercel scheduling outage). Runs a few hours
// after the mirror and alerts if any object has no successful run in the last
// ~26h. Guarded by CRON_SECRET. See /api/cron/hubspot-mirror.

import { serviceClient } from "@/lib/db/client";
import { sendMirrorAlert } from "@/lib/mirror/alert";

export const dynamic = "force-dynamic";

const OBJECTS = ["companies", "contacts", "deals"] as const;
const MAX_AGE_H = Number(process.env.MIRROR_MAX_AGE_HOURS ?? "26");

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("token") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });

  const db = serviceClient();
  const since = new Date(Date.now() - MAX_AGE_H * 3600_000).toISOString();
  const stale: { object: string; lastSuccess: string | null }[] = [];

  for (const obj of OBJECTS) {
    const { data: recent } = await db
      .from("hs_mirror_runs")
      .select("id")
      .eq("object_type", obj)
      .eq("ok", true)
      .gte("started_at", since)
      .limit(1);
    if (recent && recent.length > 0) continue; // fresh success — fine

    // Stale: report when it last succeeded (if ever) for context.
    const { data: last } = await db
      .from("hs_mirror_runs")
      .select("finished_at")
      .eq("object_type", obj)
      .eq("ok", true)
      .order("id", { ascending: false })
      .limit(1);
    stale.push({ object: obj, lastSuccess: (last?.[0] as { finished_at: string } | undefined)?.finished_at ?? null });
  }

  if (stale.length > 0) {
    await sendMirrorAlert(`⚠️ HubSpot mirror stale — ${stale.map((s) => s.object).join(", ")}`, [
      `No successful mirror run in the last ${MAX_AGE_H}h for: ${stale.map((s) => s.object).join(", ")}.`,
      "The nightly mirror cron may not be firing.", "",
      ...stale.map((s) => `• ${s.object}: last success ${s.lastSuccess ?? "never"}`), "",
      "Check the Vercel cron dashboard, or run it manually: npm run hubspot-mirror",
    ]);
    return Response.json({ ok: false, stale }, { status: 500 });
  }

  return Response.json({ ok: true, checked: OBJECTS, maxAgeHours: MAX_AGE_H });
}
