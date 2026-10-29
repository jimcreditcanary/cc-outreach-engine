// POST /api/internal/api-onboarding — fire (or re-fire) the API-sandbox request
// for an onboarding case. The wizard calls requestApiSandbox directly on
// completion; this endpoint is the programmatic/retry hook. Guarded by the
// existing CRON_SECRET bearer (no new secret).
//
//   curl -X POST .../api/internal/api-onboarding \
//     -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
//     -d '{"caseId":"…"}'

import { serviceClient } from "@/lib/db/client";
import { requestApiSandbox } from "@/lib/onboarding/notify";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let caseId = new URL(req.url).searchParams.get("caseId") ?? "";
  if (!caseId) {
    try {
      const body = (await req.json()) as { caseId?: string };
      caseId = (body?.caseId ?? "").trim();
    } catch { /* no/!json body */ }
  }
  if (!caseId) return Response.json({ ok: false, error: "caseId required" }, { status: 400 });

  const sent = await requestApiSandbox(serviceClient(), caseId);
  if (!sent) return Response.json({ ok: false, error: "case not found" }, { status: 404 });
  return Response.json({ ok: true });
}
