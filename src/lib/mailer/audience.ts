// Resolve a HubSpot segment to a list of recipients. Paginates the Search API
// (capped — a campaign targets a segment, not the whole 10k base; deep paging
// past 10k is a HubSpot limit and the cue for the read-mirror later).

import { hsFetch } from "../hubspot/client";
import type { AudienceContact, Segment } from "./types";

interface HsObj { id: string | number; properties: Record<string, string | null | undefined> }

export async function fetchAudience(segment: Segment, cap = 2000): Promise<AudienceContact[]> {
  const filters: { propertyName: string; operator: string; value?: string }[] = [
    { propertyName: "email", operator: "HAS_PROPERTY" },
  ];
  if (segment.kind === "new_leads") filters.push({ propertyName: "hs_lead_status", operator: "EQ", value: "NEW" });
  if (segment.kind === "source") filters.push({ propertyName: "lead_source", operator: "EQ", value: segment.source });

  const out: AudienceContact[] = [];
  const seen = new Set<string>();
  let after: string | undefined;

  while (out.length < cap) {
    const res = await hsFetch<{ results: HsObj[]; paging?: { next?: { after?: string } } }>(
      `/crm/v3/objects/contacts/search`,
      {
        method: "POST",
        body: {
          filterGroups: [{ filters }],
          properties: ["email", "firstname", "lastname", "lead_source", "hs_lead_status"],
          limit: 100,
          after,
          sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
        },
      },
    );
    for (const c of res.results ?? []) {
      const email = (c.properties.email ?? "").trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push({
        hs_contact_id: String(c.id),
        email,
        first_name: (c.properties.firstname ?? "").trim() || null,
        company_name: null, // resolved lazily only if a template needs it
      });
      if (out.length >= cap) break;
    }
    after = res.paging?.next?.after;
    if (!after) break;
  }
  return out;
}
