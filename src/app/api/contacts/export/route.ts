// CSV export of the Contacts list. Authenticated (not in middleware's public
// allow-list) and reachable via the "Export CSV" link on /contacts. Applies
// the SAME filters the page uses — search term, owner scope, New-leads tab —
// so the file matches what the operator is looking at, but returns EVERY
// matching row rather than a single page.

import type { NextRequest } from "next/server";
import { serviceClient } from "@/lib/db/client";
import { resolveOwnerFilter } from "@/lib/auth/owner";
import { contactSearchOr } from "@/lib/contacts/search";
import { fmtDateTime } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

const RICH = "full_name, email, job_title, email_status, status, lead_source, created_at, organisation:organisations(name)";
const BASE = "full_name, email, job_title, email_status, organisation:organisations(name)";

interface Row {
  full_name: string | null;
  email: string | null;
  job_title: string | null;
  email_status: string | null;
  status?: string | null;
  lead_source?: string | null;
  created_at?: string | null;
  organisation: { name: string | null } | null;
}

/** Quote a CSV cell only when it contains a delimiter, quote or newline. */
function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") ?? undefined;
  const owner = sp.get("owner") ?? undefined;
  const newOnly = sp.get("status") === "new";

  const db = serviceClient();
  const ownerId = await resolveOwnerFilter(owner);
  const searchOr = await contactSearchOr(db, q);

  // Probe once to see if the status/lead_source/created_at columns exist
  // (migration 036); fall back to base columns if not.
  let cols = RICH;
  {
    const { error } = await db.from("contacts").select(RICH).limit(1);
    if (error && /status|lead_source|created_at/.test(error.message)) cols = BASE;
  }
  const rich = cols === RICH;

  // Page through all matching rows.
  const PAGE = 1000;
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db
      .from("contacts")
      .select(cols)
      .order("full_name", { ascending: true })
      .range(from, from + PAGE - 1);
    if (searchOr) query = query.or(searchOr);
    if (ownerId) query = query.eq("owner_id", ownerId);
    if (newOnly) query = query.eq("status", "new");
    const { data, error } = await query;
    if (error) break;
    const batch = (data ?? []) as unknown as Row[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const headers = rich
    ? ["Name", "Company", "Job title", "Email", "Email status", "Status", "Lead source", "Created"]
    : ["Name", "Company", "Job title", "Email", "Email status"];
  const lines = [headers.map(cell).join(",")];
  for (const r of rows) {
    const base = [r.full_name, r.organisation?.name ?? "", r.job_title, r.email, r.email_status];
    const extra = rich
      ? [r.status ?? "", r.lead_source ?? "", r.created_at ? fmtDateTime(r.created_at) : ""]
      : [];
    lines.push([...base, ...extra].map(cell).join(","));
  }
  // Prepend a UTF-8 BOM so Excel opens accented names correctly.
  const csv = "﻿" + lines.join("\r\n") + "\r\n";

  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = newOnly ? "-new-leads" : "";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts${suffix}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
