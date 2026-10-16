// HubSpot-backed deals list (P3). Read-only — deals were descoped to a basic
// list; names link out to the HubSpot deal record. Isolated; the Supabase
// deals page (with MEDDICC nudges etc.) is untouched and used when
// CRM_BACKEND=supabase.

import Link from "next/link";
import { getCrm } from "@/lib/crm";
import { SortableTh } from "@/components/SortableTh";
import { parseSort } from "@/lib/table/sort";
import { fmtDate } from "@/lib/format/datetime";

const SORT_COLS = ["name", "amount", "close_date", "created_at"] as const;

function money(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP", maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency ?? ""} ${amount.toLocaleString()}`.trim();
  }
}

export async function HubspotDealsView({ q, sortRaw, after }: { q?: string; sortRaw?: string; after?: string }) {
  const sort = parseSort(sortRaw, SORT_COLS, { col: "amount", dir: "desc" });
  const page = await getCrm().listDeals({ q, after, limit: 100, sort: { col: sort.col as typeof SORT_COLS[number], dir: sort.dir } });

  const hdrParams = { ...(q ? { q } : {}) };
  const nextParams = new URLSearchParams({ ...hdrParams, ...(sortRaw ? { sort: sortRaw } : {}), ...(page.after ? { after: page.after } : {}) });

  return (
    <main className="px-8 py-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold">Deals</h1>
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700" title="Reading live from HubSpot (read-only)">HubSpot</span>
        </div>
        <span className="text-sm text-neutral-500">{page.total.toLocaleString()}{q ? " matches" : ""} · showing {page.records.length}</span>
      </header>

      <form className="mb-3">
        <input name="q" defaultValue={q ?? ""} placeholder="Search deals…" className="w-full rounded border border-neutral-300 px-3 py-2 text-sm" />
      </form>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-neutral-400">
          <tr>
            <SortableTh label="Deal" col="name" sort={sort} basePath="/deals" params={hdrParams} className="py-1" />
            <th>Pipeline</th>
            <th>Stage</th>
            <SortableTh label="Amount" col="amount" sort={sort} basePath="/deals" params={hdrParams} />
            <SortableTh label="Close" col="close_date" sort={sort} basePath="/deals" params={hdrParams} />
          </tr>
        </thead>
        <tbody>
          {page.records.map((d) => (
            <tr key={d.id} className="border-t border-neutral-100 hover:bg-neutral-100">
              <td className="py-1.5">
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 hover:underline">{d.name || "—"}</a>
              </td>
              <td className="text-neutral-600">{d.pipeline ?? "—"}</td>
              <td className="text-neutral-600">{d.stage ?? "—"}</td>
              <td className="text-neutral-600">{money(d.amount, d.currency)}</td>
              <td className="text-neutral-600">{d.close_date ? fmtDate(d.close_date) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex items-center justify-between text-sm">
        {after ? <Link href={`/deals?${new URLSearchParams(hdrParams)}${sortRaw ? `&sort=${sortRaw}` : ""}`} className="text-blue-700 hover:underline">⟲ Start</Link> : <span />}
        {page.after ? <Link href={`/deals?${nextParams}`} className="text-blue-700 hover:underline">Next →</Link> : <span className="text-neutral-300">End</span>}
      </div>

      <p className="mt-6 text-xs text-neutral-400">Live HubSpot deals (read-only). Open a deal in HubSpot with its link.</p>
    </main>
  );
}
