// HubSpot mailer (P5) domain types. The mailer sends outbound campaigns to
// HubSpot-sourced segments via Postmark, logging to public.hs_sends (hybrid:
// metrics in Supabase keyed by HubSpot contact id, suppression shared, key
// events mirrored to HubSpot).

export type HsSendStatus = "queued" | "approved" | "sent" | "suppressed" | "failed" | "skipped";

/** A candidate recipient resolved from HubSpot. */
export interface AudienceContact {
  hs_contact_id: string;
  email: string;
  first_name: string | null;
  company_name: string | null;
}

/** Which HubSpot contacts a campaign targets. */
export type Segment =
  | { kind: "new_leads" }              // hs_lead_status = NEW
  | { kind: "source"; source: string } // lead_source = <source>
  | { kind: "all" };                   // everyone with an email

export function segmentLabel(s: Segment): string {
  switch (s.kind) {
    case "new_leads": return "new-leads";
    case "source": return `source:${s.source}`;
    case "all": return "all";
  }
}

export function parseSegment(spec: string): Segment {
  const t = spec.trim().toLowerCase();
  if (t === "new_leads" || t === "new-leads" || t === "new") return { kind: "new_leads" };
  if (t === "all") return { kind: "all" };
  if (t.startsWith("source:")) return { kind: "source", source: spec.trim().slice("source:".length) };
  throw new Error(`Unknown segment "${spec}". Use: new_leads | all | source:<value>`);
}
