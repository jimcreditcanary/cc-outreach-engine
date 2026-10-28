// Daily HubSpot → Supabase mirror (disaster-recovery snapshot). Pages the full
// CRM into the hs_mirror_* tables so a broken HubSpot connection can't leave
// veepveep without its data. Guarded by CRON_SECRET (Vercel Cron Bearer, or
// ?token=). See src/lib/mirror/hubspot.ts + migration 047.

import { serviceClient } from "@/lib/db/client";
import { runHubspotMirror } from "@/lib/mirror/hubspot";

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
  const res = await runHubspotMirror(serviceClient());
  return Response.json(res, { status: res.ok ? 200 : 500 });
}
