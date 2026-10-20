// HubSpot-backed companies list (P2). Rendered by /companies when the active
// CRM backend is HubSpot; the Supabase page is left untouched. Read-only for
// now — add/delete + sector/tier/partner fields arrive for HubSpot in P3.
// Names link out to the HubSpot record until the detail page is ported.

import Link from "next/link";
import { getCrm } from "@/lib/crm";
import { SortableTh } from "@/components/SortableTh";
import { parseSort } from "@/lib/table/sort";
import { PageTabs, CRM_TABS } from "@/components/PageTabs";
import { OnboardingBadge } from "@/components/OnboardingBadge";
import { propOptions } from "@/lib/hubspot/schema";

const SORT_COLS = ["name", "industry", "created_at"] as const;

export async function HubspotCompaniesView({
  q, sortRaw, after,
}: { q?: string; sortRaw?: string; after?: string }) {
  const sort = parseSort(sortRaw, SORT_COLS, { col: "name", dir: "asc" });
  const crm = getCrm();
  const [page, onboardingOpts, targetOpts] = await Promise.all([
    crm.listCompanies({ q, after, limit: 100, sort: { col: sort.col as typeof SORT_COLS[number], dir: sort.dir } }),
    propOptions("companies", "onboarding_status"),
    propOptions("companies", "target_group"),
  ]);
  // HubSpot option values can differ from their labels (e.g. "Accountants" → "Services");
  // show the human label.
  const onboardingLabel = new Map(onboardingOpts.map((o) => [o.value, o.label]));
  const targetLabel = new Map(targetOpts.map((o) => [o.value, o.label]));

  const hdrParams = { ...(q ? { q } : {}) };
  const nextParams = new URLSearchParams({ ...hdrParams, ...(sortRaw ? { sort: sortRaw } : {}), ...(page.after ? { after: page.after } : {}) });

  return (
    <main className="px-8 py-6">
      <PageTabs tabs={CRM_TABS} />
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold text-neutral-800">Companies</h2>
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700" title="Reading live from HubSpot (CRM_BACKEND=hubspot)">HubSpot</span>
        </div>
        <span className="text-sm text-neutral-500">{page.total.toLocaleString()}{q ? " matches" : ""} · showing {page.records.length}</span>
      </header>

      <form className="mb-3">
        <input name="q" defaultValue={q ?? ""} placeholder="Search companies…" className="w-full rounded border border-neutral-300 px-3 py-2 text-sm" />
      </form>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-neutral-400">
          <tr>
            <SortableTh label="Name" col="name" sort={sort} basePath="/companies" params={hdrParams} className="py-1" />
            <th>Website</th>
            <th>Current client</th>
            <th>Onboarding</th>
            <th>Target group</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {page.records.map((o) => (
            <tr key={o.id} className="border-t border-neutral-100 hover:bg-neutral-100">
              <td className="py-1.5">
                <Link href={`/companies/${o.id}`} className="font-medium text-blue-700 hover:underline">{o.name || "—"}</Link>
              </td>
              <td className="text-neutral-600">{o.website ?? "—"}</td>
              <td>
                {o.current_client === true ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">Yes</span>
                  : o.current_client === false ? <span className="text-xs text-neutral-400">No</span>
                  : <span className="text-neutral-300">—</span>}
              </td>
              <td className="text-neutral-600">{o.onboarding_status ? <OnboardingBadge status={onboardingLabel.get(o.onboarding_status) ?? o.onboarding_status} /> : <span className="text-neutral-300">—</span>}</td>
              <td className="text-neutral-600">{o.target_group ? (targetLabel.get(o.target_group) ?? o.target_group) : <span className="text-neutral-300">—</span>}</td>
              <td className="w-10 text-right">
                <a href={o.url} target="_blank" rel="noopener noreferrer" title="Open in HubSpot" className="text-neutral-400 hover:text-orange-600">↗</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex items-center justify-between text-sm">
        {after ? <Link href={`/companies?${new URLSearchParams(hdrParams)}${sortRaw ? `&sort=${sortRaw}` : ""}`} className="text-blue-700 hover:underline">⟲ Start</Link> : <span />}
        {page.after ? <Link href={`/companies?${nextParams}`} className="text-blue-700 hover:underline">Next →</Link> : <span className="text-neutral-300">End</span>}
      </div>

      <p className="mt-6 text-xs text-neutral-400">
        Live HubSpot view (read-only). Add/edit/delete and sector/tier/partner fields move over in P3.
      </p>
    </main>
  );
}
