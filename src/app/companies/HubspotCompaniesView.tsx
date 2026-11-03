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
import { NavSelect } from "@/components/NavSelect";
import { propOptions } from "@/lib/hubspot/schema";
import { listOwners, ownerOptions } from "@/lib/hubspot/owners";

const SORT_COLS = ["name", "industry", "created_at"] as const;

export interface CompanyFilters { owner?: string; target?: string; client?: string; icp?: string; partner?: string; onb?: string }

export async function HubspotCompaniesView({
  q, sortRaw, after, filters = {},
}: { q?: string; sortRaw?: string; after?: string; filters?: CompanyFilters }) {
  const sort = parseSort(sortRaw, SORT_COLS, { col: "name", dir: "asc" });
  const crm = getCrm();
  const triState = (v?: string) => (v === "yes" ? true : v === "no" ? false : undefined);
  const [page, onboardingOpts, targetOpts, owners] = await Promise.all([
    crm.listCompanies({
      q, after, limit: 100, sort: { col: sort.col as typeof SORT_COLS[number], dir: sort.dir },
      ownerId: filters.owner, targetGroup: filters.target, onboardingStatus: filters.onb,
      currentClient: triState(filters.client), icp: triState(filters.icp), partner: triState(filters.partner),
    }),
    propOptions("companies", "onboarding_status"),
    propOptions("companies", "target_group"),
    listOwners(),
  ]);
  // HubSpot option values can differ from their labels (e.g. "Accountants" → "Services");
  // show the human label.
  const onboardingLabel = new Map(onboardingOpts.map((o) => [o.value, o.label]));
  const targetLabel = new Map(targetOpts.map((o) => [o.value, o.label]));

  // Active filters flow into the sort + pagination links so they survive.
  const filterParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) if (v) filterParams[k] = v;
  const hdrParams = { ...(q ? { q } : {}), ...filterParams };
  const nextParams = new URLSearchParams({ ...hdrParams, ...(sortRaw ? { sort: sortRaw } : {}), ...(page.after ? { after: page.after } : {}) });

  return (
    <main className="px-4 py-6 md:px-8">
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

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-neutral-400">Filter</span>
        <NavSelect basePath="/companies" param="owner" value={filters.owner} allLabel="Any owner" ariaLabel="Filter by owner"
          options={ownerOptions(owners).map((o) => ({ value: o.id, label: o.name }))} />
        <NavSelect basePath="/companies" param="target" value={filters.target} allLabel="Any target group" ariaLabel="Filter by target group"
          options={targetOpts.map((o) => ({ value: o.value, label: o.label }))} />
        <NavSelect basePath="/companies" param="onb" value={filters.onb} allLabel="Any onboarding" ariaLabel="Filter by onboarding"
          options={onboardingOpts.map((o) => ({ value: o.value, label: o.label }))} />
        <NavSelect basePath="/companies" param="client" value={filters.client} allLabel="Customer: any" ariaLabel="Filter by customer"
          options={[{ value: "yes", label: "Customers" }, { value: "no", label: "Non-customers" }]} />
        <NavSelect basePath="/companies" param="icp" value={filters.icp} allLabel="ICP: any" ariaLabel="Filter by ICP"
          options={[{ value: "yes", label: "ICP only" }, { value: "no", label: "Non-ICP" }]} />
        <NavSelect basePath="/companies" param="partner" value={filters.partner} allLabel="Partner: any" ariaLabel="Filter by partner"
          options={[{ value: "yes", label: "Partners" }, { value: "no", label: "Non-partners" }]} />
      </div>

      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs uppercase text-neutral-400">
          <tr>
            <SortableTh label="Name" col="name" sort={sort} basePath="/companies" params={hdrParams} className="py-1" />
            <th>Website</th>
            <th>Current client</th>
            <th>Onboarding</th>
            <th>Target group</th>
            <th>Owner</th>
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
              <td className="text-neutral-600">{o.owner_name ?? <span className="text-neutral-300">—</span>}</td>
              <td className="w-10 text-right">
                <a href={o.url} target="_blank" rel="noopener noreferrer" title="Open in HubSpot" className="text-neutral-400 hover:text-orange-600">↗</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>

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
