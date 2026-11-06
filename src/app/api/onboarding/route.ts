// GET /api/onboarding — onboarding export for external dev / provisioning
// automation (config only; no sensitive PII). Two modes:
//   • list:   GET /api/onboarding            → { customers: [{case_id, deal_id, …}] }
//             GET /api/onboarding?status=all → every non-cancelled case
//             (default status=onboarded)
//   • lookup: GET /api/onboarding?deal_id=…  → the live case's block for a deal
//
// AUTH: a shared key in ONBOARDING_API_KEY, as
//   Authorization: Bearer <key>   or   X-API-Key: <key>
// Returns 503 until the key is configured, 401 on a bad/absent key.
//
//   curl "https://www.veepveep.co.uk/api/onboarding?status=all" \
//     -H "Authorization: Bearer $ONBOARDING_API_KEY"

import { serviceClient } from "@/lib/db/client";
import { liveCaseForDeal } from "@/lib/onboarding/cases";
import { listOnboardingCustomers, buildOnboardingExport, onboardingApiKeyOk } from "@/lib/onboarding/export";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request): Promise<Response> {
  if (!process.env.ONBOARDING_API_KEY) return Response.json({ ok: false, error: "not_configured" }, { status: 503 });
  if (!onboardingApiKeyOk(req)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const db = serviceClient();
  const url = new URL(req.url);
  const dealId = url.searchParams.get("deal_id");
  if (dealId) {
    const c = await liveCaseForDeal(db, dealId);
    if (!c) return Response.json({ ok: false, error: "no_case_for_deal" }, { status: 404 });
    return Response.json({ ok: true, case: await buildOnboardingExport(db, c.id) });
  }

  const status = url.searchParams.get("status") ?? "onboarded";
  const customers = await listOnboardingCustomers(db, status);
  return Response.json({ ok: true, status, count: customers.length, customers });
}
