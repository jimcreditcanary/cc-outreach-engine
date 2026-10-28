// Daily HubSpot → Supabase mirror (disaster-recovery snapshot). Pages the full
// CRM into the hs_mirror_* tables so a broken HubSpot connection can't leave
// veepveep without its data. Guarded by CRON_SECRET (Vercel Cron Bearer, or
// ?token=). On any object failure (or a fatal error) it emails an ops alert so
// a silently broken sync doesn't go unnoticed. See src/lib/mirror/hubspot.ts.

import { serviceClient } from "@/lib/db/client";
import { runHubspotMirror, type MirrorResult } from "@/lib/mirror/hubspot";
import { sendTransactional } from "@/lib/send/postmark";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // full-base pagination takes a while

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("token") === secret;
}

function alertRecipient(): string {
  return (
    process.env.OPS_ALERT_EMAIL ??
    process.env.INBOUND_LEAD_EMAIL ??
    process.env.POSTMARK_REPLY_TO ??
    "jim@creditcanary.co.uk"
  );
}

async function alertFailure(summary: string, detail: string): Promise<void> {
  const lines = ["The nightly HubSpot → Supabase mirror did not fully succeed.", "", detail, "", "Check hs_mirror_runs in Supabase and the Vercel cron logs."];
  await sendTransactional({
    to: alertRecipient(),
    subject: `⚠️ HubSpot mirror failed — ${summary}`,
    textBody: lines.join("\n"),
    htmlBody: `<p>The nightly HubSpot → Supabase mirror did not fully succeed.</p><pre>${detail}</pre><p>Check <code>hs_mirror_runs</code> in Supabase and the Vercel cron logs.</p>`,
    tag: "ops-mirror-failure",
  }).catch(() => {});
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });

  let res: MirrorResult;
  try {
    res = await runHubspotMirror(serviceClient());
  } catch (e) {
    // Fatal — the job threw before finishing (e.g. HubSpot/DB unreachable).
    await alertFailure("fatal error", (e as Error)?.message ?? String(e));
    return Response.json({ ok: false, fatal: (e as Error)?.message ?? String(e) }, { status: 500 });
  }

  if (!res.ok) {
    const failed = res.objects.filter((o) => !o.ok);
    const detail = failed.map((o) => `• ${o.object_type}: ${o.error ?? "unknown error"}`).join("\n");
    await alertFailure(failed.map((o) => o.object_type).join(", "), detail);
  }

  return Response.json(res, { status: res.ok ? 200 : 500 });
}
