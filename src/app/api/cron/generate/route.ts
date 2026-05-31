// Daily generate cron — drops a fresh batch of drafts into the queue every
// morning so Jim has something to review with coffee. Guarded by
// CRON_SECRET (Vercel Cron sends it as a Bearer token; also accepts ?token=).

import { serviceClient } from "@/lib/db/client";
import { runGenerateBatch } from "@/lib/generate/runBatch";

export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unset → open (dev)
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("token") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? process.env.CRON_GENERATE_BATCH ?? 10);
  const res = await runGenerateBatch(serviceClient(), limit);
  return Response.json({ ok: true, ...res });
}
