// Daily HubSpot → Supabase mirror (disaster-recovery snapshot). Pages the full
// CRM into the hs_mirror_* tables so a broken HubSpot connection can't leave
// veepveep without its data. Guarded by CRON_SECRET (Vercel Cron Bearer, or
// ?token=). On any object failure (or a fatal error) it emails an ops alert so
// a silently broken sync doesn't go unnoticed. See src/lib/mirror/hubspot.ts.

import { serviceClient } from "@/lib/db/client";
import { runHubspotMirror, type MirrorResult } from "@/lib/mirror/hubspot";
import { sendMirrorAlert } from "@/lib/mirror/alert";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // full-base pagination takes a while

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("token") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });

  let res: MirrorResult;
  try {
    res = await runHubspotMirror(serviceClient());
  } catch (e) {
    // Fatal — the job threw before finishing (e.g. HubSpot/DB unreachable).
    const msg = (e as Error)?.message ?? String(e);
    await sendMirrorAlert("⚠️ HubSpot mirror failed — fatal error", [
      "The nightly HubSpot → Supabase mirror threw before finishing.", "", msg, "",
      "Check hs_mirror_runs in Supabase and the Vercel cron logs.",
    ]);
    return Response.json({ ok: false, fatal: msg }, { status: 500 });
  }

  if (!res.ok) {
    const failed = res.objects.filter((o) => !o.ok);
    await sendMirrorAlert(`⚠️ HubSpot mirror failed — ${failed.map((o) => o.object_type).join(", ")}`, [
      "The nightly HubSpot → Supabase mirror did not fully succeed:", "",
      ...failed.map((o) => `• ${o.object_type}: ${o.error ?? "unknown error"}`), "",
      "Check hs_mirror_runs in Supabase and the Vercel cron logs.",
    ]);
  }

  return Response.json(res, { status: res.ok ? 200 : 500 });
}
