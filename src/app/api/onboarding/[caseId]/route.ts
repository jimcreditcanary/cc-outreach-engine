// GET /api/onboarding/{caseId} — the config-only onboarding block for one case
// (for external dev / provisioning automation). See ../route.ts for the auth
// and payload notes.
//
//   curl "https://www.veepveep.co.uk/api/onboarding/<caseId>" \
//     -H "Authorization: Bearer $ONBOARDING_API_KEY"

import { serviceClient } from "@/lib/db/client";
import { buildOnboardingExport, onboardingApiKeyOk } from "@/lib/onboarding/export";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request, { params }: { params: Promise<{ caseId: string }> }): Promise<Response> {
  if (!process.env.ONBOARDING_API_KEY) return Response.json({ ok: false, error: "not_configured" }, { status: 503 });
  if (!onboardingApiKeyOk(req)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { caseId } = await params;
  const db = serviceClient();
  const block = await buildOnboardingExport(db, caseId);
  if (!block) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  return Response.json({ ok: true, case: block });
}
