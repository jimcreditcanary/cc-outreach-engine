// HubSpot-backed contacts list (P2). Rendered by /contacts when the active CRM
// backend is HubSpot; the Supabase page is left completely untouched. Read-only
// for now — inline add/delete, mark-actioned, guessed-email review, owner
// scoping and CSV export still run on the Supabase path and arrive for HubSpot
// in P3. Names link out to the HubSpot record until the detail page is ported.

import Link from "next/link";
import { getCrm } from "@/lib/crm";
import { SortableTh } from "@/components/SortableTh";
import { parseSort } from "@/lib/table/sort";
import { PageTabs, CRM_TABS } from "@/components/PageTabs";

const SORT_COLS = ["full_name", "job_title", "email", "created_at"] as const;

export async function HubspotContactsView({
  q, newOnly, sortRaw, after,
}: { q?: string; newOnly: boolean; sortRaw?: string; after?: string }) {
  const sort = parseSort(sortRaw, SORT_COLS, newOnly ? { col: "created_at", dir: "desc" } : { col: "full_name", dir: "asc" });
  const crm = getCrm();

  const [page, allCount, newCount] = await Promise.all([
    crm.listContacts({ q, newOnly, after, limit: 100, sort: { col: sort.col as typeof SORT_COLS[number], dir: sort.dir } }),
    crm.listContacts({ limit: 1 }).then((p) => p.total),
    crm.listContacts({ newOnly: true, limit: 1 }).then((p) => p.total),
  ]);

  const hdrParams = { ...(q ? { q } : {}), ...(newOnly ? { status: "new" } : {}) };
  const nextParams = new URLSearchParams({ ...hdrParams, ...(sortRaw ? { sort: sortRaw } : {}), ...(page.after ? { after: page.after } : {}) });

  return (
    <main className="px-4 py-6 md:px-8">
      <PageTabs tabs={CRM_TABS} />
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold text-neutral-800">Contacts</h2>
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700" title="Reading live from HubSpot (CRM_BACKEND=hubspot)">HubSpot</span>
        </div>
        <span className="text-sm text-neutral-500">{page.total.toLocaleString()}{q ? " matches" : ""} · showing {page.records.length}</span>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <ContactTab href="/contacts" active={!newOnly} label="All contacts" count={allCount} />
        <ContactTab href="/contacts?status=new" active={newOnly} label="New leads" count={newCount} accent />
      </div>

      <form className="mb-3">
        <input name="q" defaultValue={q ?? ""} placeholder="Search name, email or company…" className="w-full rounded border border-neutral-300 px-3 py-2 text-sm" />
        {newOnly && <input type="hidden" name="status" value="new" />}
      </form>

      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs uppercase text-neutral-400">
          <tr>
            <SortableTh label="Name" col="full_name" sort={sort} basePath="/contacts" params={hdrParams} className="py-1" />
            <th>Company</th>
            <SortableTh label="Title" col="job_title" sort={sort} basePath="/contacts" params={hdrParams} />
            <SortableTh label="Email" col="email" sort={sort} basePath="/contacts" params={hdrParams} />
          </tr>
        </thead>
        <tbody>
          {page.records.map((c) => (
            <tr key={c.id} className={`border-t border-neutral-100 hover:bg-neutral-100 ${c.is_new ? "bg-emerald-50/40" : ""}`}>
              <td className="py-1.5">
                <Link href={`/contacts/${c.id}`} className="font-medium text-blue-700 hover:underline">{c.full_name || "—"}</Link>
                {c.is_new && <span className="ml-2 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">New</span>}
              </td>
              <td className="text-neutral-600">{c.company_name ?? "—"}</td>
              <td className="text-neutral-600">{c.job_title ?? "—"}</td>
              <td className="text-neutral-600">
                {c.email ?? "—"}
                {c.email_bounced && <span className="ml-1 rounded bg-red-100 px-1 text-xs text-red-700">bounced</span>}
                {c.email_guessed && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-700" title="Inferred (email_status = Extrapolated) — unverified">guessed</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <div className="mt-4 flex items-center justify-between text-sm">
        {after ? <Link href={`/contacts?${new URLSearchParams(hdrParams)}${sortRaw ? `&sort=${sortRaw}` : ""}`} className="text-blue-700 hover:underline">⟲ Start</Link> : <span />}
        {page.after ? <Link href={`/contacts?${nextParams}`} className="text-blue-700 hover:underline">Next →</Link> : <span className="text-neutral-300">End</span>}
      </div>

      <p className="mt-6 text-xs text-neutral-400">
        Live HubSpot view (read-only). Add/edit, mark-actioned, guessed-email review, owner filter and CSV export still run on the Supabase view and move over in P3.
      </p>
    </main>
  );
}

function ContactTab({ href, active, label, count, accent }: { href: string; active: boolean; label: string; count: number; accent?: boolean }) {
  const on = accent ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900";
  const chipOn = accent ? "bg-emerald-200 text-emerald-900" : "bg-amber-200 text-amber-900";
  return (
    <Link href={href} className={`rounded-md border px-3 py-1.5 font-medium transition-colors ${active ? on : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"}`}>
      {label} <span className={`ml-1 rounded px-1.5 text-xs ${active ? chipOn : "bg-neutral-100 text-neutral-500"}`}>{count.toLocaleString()}</span>
    </Link>
  );
}
