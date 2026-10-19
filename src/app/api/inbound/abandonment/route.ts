// POST /api/inbound/abandonment — the website calls this when an identified
// visitor (known email, e.g. from a cc_cid link or a partial form) browses a
// key page/flow but doesn't get in touch. We enqueue a light, personalised
// follow-up for that contact. Keyed by LEAD_API_KEY (same as /api/leads);
// only acts on contacts already in HubSpot (no contact creation here).

import { serviceClient } from "@/lib/db/client";
import { activeBackend } from "@/lib/crm";
import { findContactByEmail } from "@/lib/hubspot/repo";
import { enqueueInboundFollowup } from "@/lib/mailer/inbound";

export const dynamic = "force-dynamic";

function authorized(req: Request, bodyKey: string | null): boolean {
  const expected = process.env.LEAD_API_KEY;
  if (!expected) return true;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return bearer === expected || req.headers.get("x-api-key") === expected || bodyKey === expected;
}

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* allow empty */ }
  const str = (k: string): string | null => (typeof body[k] === "string" && (body[k] as string).trim() ? (body[k] as string).trim() : null);

  if (!authorized(req, str("key"))) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  if (activeBackend() !== "hubspot") return Response.json({ ok: true, matched: false, note: "HubSpot backend not active." });

  const email = str("email")?.toLowerCase();
  if (!email) return Response.json({ ok: false, error: "email is required." }, { status: 400 });

  const contact = await findContactByEmail(email);
  if (!contact) return Response.json({ ok: true, matched: false });

  await enqueueInboundFollowup(serviceClient(), {
    hsContactId: contact.id, kind: "abandonment",
    page: str("page") ?? str("url"), asset: str("asset"),
  });
  return Response.json({ ok: true, matched: true, contact_id: contact.id });
}
