// POST /api/leads — external lead capture for creditcanary.co.uk forms
// (whitepaper downloads, gated content, "talk to us"). Creates or appends
// to a contact + company and logs the activity to the CRM timeline.
//
// AUTH: a shared key in `LEAD_API_KEY` (env). Accepted as:
//   Authorization: Bearer <key>   ·   X-API-Key: <key>   ·   body { key }
// The marketing site is static, so a browser-side fetch can't truly hide
// the key — it's treated as a low-privilege, write-only token. Defence in
// depth: an Origin allow-list (LEAD_ALLOWED_ORIGINS, defaults to the
// creditcanary domains) + a honeypot field. Worst case is junk leads, which
// land in /alerts for triage, not data exposure.
//
// CORS is opened to the allow-listed origins so a browser fetch works.
//
// Example:
//   curl -X POST https://www.veepveep.co.uk/api/leads \
//     -H "Authorization: Bearer $LEAD_API_KEY" -H "Content-Type: application/json" \
//     -d '{"email":"jane@lender.co.uk","name":"Jane Smith","company":"Lender Ltd",
//          "source":"whitepaper","asset":"Risk & Liquidity",
//          "url":"https://www.creditcanary.co.uk/resources/whitepapers/risk-liquidity"}'

import { serviceClient } from "@/lib/db/client";
import { captureLead, type LeadKind } from "@/lib/leads/capture";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DEFAULT_ORIGINS = ["https://creditcanary.co.uk", "https://www.creditcanary.co.uk"];

function allowedOrigins(): string[] {
  return [...DEFAULT_ORIGINS, ...(process.env.LEAD_ALLOWED_ORIGINS?.split(/\s+/).filter(Boolean) ?? [])];
}

/** CORS headers: reflect the request Origin when it's allow-listed. */
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = allowedOrigins().includes(origin) ? origin : DEFAULT_ORIGINS[0]!;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
}

export async function OPTIONS(req: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

function authorized(req: Request, bodyKey: string | null): boolean {
  const expected = process.env.LEAD_API_KEY;
  if (!expected) return true; // unset (local/dev) → open, like the other guards
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const header = req.headers.get("x-api-key");
  return bearer === expected || header === expected || bodyKey === expected;
}

export async function POST(req: Request): Promise<Response> {
  // Parse JSON or form-encoded.
  let body: Record<string, unknown> = {};
  const ctype = req.headers.get("content-type") ?? "";
  try {
    if (ctype.includes("application/json")) {
      body = (await req.json()) as Record<string, unknown>;
    } else {
      const form = await req.formData();
      for (const [k, v] of form.entries()) body[k] = typeof v === "string" ? v : "";
    }
  } catch {
    return json(req, { ok: false, error: "Invalid request body." }, 400);
  }

  const str = (k: string): string | null => {
    const v = body[k];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };

  if (!authorized(req, str("key"))) return json(req, { ok: false, error: "Unauthorized." }, 401);

  // Honeypot — bots fill hidden fields; fake success so they don't retry.
  if (str("website") || str("_gotcha")) return json(req, { ok: true, contact_id: null });

  const email = str("email");
  if (!email) return json(req, { ok: false, error: "email is required." }, 400);

  const kindRaw = (str("kind") ?? (str("asset") ? "download" : "lead")).toLowerCase();
  const kind: LeadKind = kindRaw === "download" || kindRaw === "enquiry" ? (kindRaw as LeadKind) : "lead";

  const res = await captureLead(serviceClient(), {
    email,
    name: str("name") ?? str("full_name"),
    company: str("company") ?? str("company_name"),
    job_title: str("job_title") ?? str("title"),
    source: str("source") ?? "website",
    asset: str("asset") ?? str("resource") ?? str("whitepaper"),
    url: str("url") ?? req.headers.get("referer"),
    message: str("message"),
    mobile: str("mobile") ?? str("phone"),
    kind,
    createCompany: true, // a named company on a gated download is qualified
    notify: true,
  });

  if (!res.ok) return json(req, res, 422);
  return json(req, {
    ok: true,
    contact_id: res.contact_id,
    organisation_id: res.organisation_id,
    created: res.created_contact,
    status: res.is_new_lead ? "new" : "existing",
  });
}
