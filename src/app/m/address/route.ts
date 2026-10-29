// GET /m/address?postcode=... — public address lookup for the merchant form's
// AddressLookup component. Static route, so it takes precedence over /m/[token].
// Behind the Postcoder adapter (fixture mock until POSTCODER_API_KEY is set).

import { getPostcoder } from "@/lib/integrations/postcoder";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const postcode = (new URL(req.url).searchParams.get("postcode") ?? "").trim();
  if (!postcode) return Response.json({ addresses: [] });
  const addresses = await getPostcoder().lookup(postcode);
  return Response.json({ addresses });
}
