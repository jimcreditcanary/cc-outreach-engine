// Tag creditcanary.co.uk links in an outbound email so GA4 can attribute the
// visit to the specific contact. Adds UTM params + a per-contact id (cc_cid =
// HubSpot contact id). The website's GA4 captures cc_cid, and the GA4 Data API
// lets us pull "who visited what" back into HubSpot as high-intent signal.

const CC_LINK = /https?:\/\/(www\.)?creditcanary\.co\.uk\/[^\s"'<>)\]]*/g;

export function tagLinks(body: string, opts: { cid: string; campaign?: string }): string {
  if (!body) return body;
  return body.replace(CC_LINK, (match) => {
    const trail = /[.,;:!?]+$/.exec(match)?.[0] ?? ""; // don't swallow sentence punctuation
    const raw = trail ? match.slice(0, -trail.length) : match;
    try {
      const u = new URL(raw);
      u.searchParams.set("utm_source", "outreach");
      u.searchParams.set("utm_medium", "email");
      if (opts.campaign) u.searchParams.set("utm_campaign", opts.campaign);
      u.searchParams.set("cc_cid", opts.cid);
      return u.toString() + trail;
    } catch {
      return match;
    }
  });
}
