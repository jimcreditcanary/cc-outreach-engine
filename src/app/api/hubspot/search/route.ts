// Type-ahead search over live HubSpot companies / contacts / deals, backing the
// HubspotPicker on the meeting page. Auth-gated by middleware (operators only).
// Returns a small {id,label,sublabel}[] for the dropdown.

import { NextResponse, type NextRequest } from "next/server";
import { getCrm } from "@/lib/crm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json([]);

  const crm = getCrm();
  try {
    if (type === "company") {
      const page = await crm.listCompanies({ q, limit: 15 });
      return NextResponse.json(page.records.map((r) => ({
        id: r.id, label: r.name ?? "(unnamed)", sublabel: r.website ?? undefined,
      })));
    }
    if (type === "contact") {
      const page = await crm.listContacts({ q, limit: 15 });
      return NextResponse.json(page.records.map((r) => ({
        id: r.id,
        label: r.full_name || r.email || "(unnamed)",
        sublabel: [r.company_name, r.email].filter(Boolean).join(" · ") || undefined,
      })));
    }
    if (type === "deal") {
      const page = await crm.listDeals({ q, limit: 15 });
      return NextResponse.json(page.records.map((r) => ({
        id: r.id,
        label: r.name ?? "(untitled)",
        sublabel: [r.stage, r.owner_name].filter(Boolean).join(" · ") || undefined,
      })));
    }
    return NextResponse.json([]);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
