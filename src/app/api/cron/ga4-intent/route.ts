// GA4 high-intent ingestion (hourly). Pulls site visits by cc_cid and raises
// high-intent HubSpot tasks for engaged contacts. Guarded by CRON_SECRET.

import { serviceClient } from "@/lib/db/client";
import { runGa4Intent } from "@/lib/mailer/intent";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("token") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const res = await runGa4Intent(serviceClient(), {});
  return Response.json({ ok: true, ...res });
}
