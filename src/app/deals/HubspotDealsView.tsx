// HubSpot-backed deals list (P3 + deals upgrades). Read-only. Adds a stage
// multi-filter, last-engagement + days-since columns, and a meeting-planned
// indicator — all from auto-maintained HubSpot deal properties (no extra
// scope). Isolated; the Supabase deals page is untouched.

import Link from "next/link";
import { getCrm } from "@/lib/crm";
import { dealPipelines } from "@/lib/hubspot/repo";
import { SortableTh } from "@/components/SortableTh";
import { parseSort } from "@/lib/table/sort";
import { fmtDate } from "@/lib/format/datetime";
import { StageFilterDropdown } from "@/components/StageFilterDropdown";

const SORT_COLS = ["name", "amount", "close_date", "last_contacted", "created_at"] as const;

function money(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP", maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency ?? ""} ${amount.toLocaleString()}`.trim();
  }
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export async function HubspotDealsView({ q, sortRaw, after, stagesRaw }: { q?: string; sortRaw?: string; after?: string; stagesRaw?: string }) {
  const sort = parseSort(sortRaw, SORT_COLS, { col: "amount", dir: "desc" });
  const stages = [...new Set((stagesRaw ?? "").split(",").map((s) => s.trim()).filter(Boolean))];

  const [pipelines, page] = await Promise.all([
    dealPipelines(),
    getCrm().listDeals({ q, stages, after, limit: 100, sort: { col: sort.col as typeof SORT_COLS[number], dir: sort.dir } }),
  ]);

  const hdrParams = { ...(q ? { q } : {}), ...(stages.length ? { stages: stages.join(",") } : {}) };
  const nextParams = new URLSearchParams({ ...hdrParams, ...(sortRaw ? { sort: sortRaw } : {}), ...(page.after ? { after: page.after } : {}) });

  return (
    <main className="px-4 py-6 md:px-8">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold">Deals</h1>
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700" title="Reading live from HubSpot (read-only)">HubSpot</span>
        </div>
        <span className="text-sm text-neutral-500">{page.total.toLocaleString()}{q || stages.length ? " matches" : ""} · showing {page.records.length}</span>
      </header>

      {/* Stage filter — a single multi-stage dropdown, grouped by pipeline. */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <StageFilterDropdown pipelines={pipelines} selected={stages} q={q} sortRaw={sortRaw} />
        {stages.length > 0 && <Link href="/deals" className="text-xs text-blue-700 hover:underline">clear filter</Link>}
      </div>

      <form className="mb-3">
        <input name="q" defaultValue={q ?? ""} placeholder="Search deals…" className="w-full rounded border border-neutral-300 px-3 py-2 text-sm" />
        {stages.length > 0 && <input type="hidden" name="stages" value={stages.join(",")} />}
      </form>

      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs uppercase text-neutral-400">
          <tr>
            <SortableTh label="Deal" col="name" sort={sort} basePath="/deals" params={hdrParams} className="py-1" />
            <th>Stage</th>
            <SortableTh label="Amount" col="amount" sort={sort} basePath="/deals" params={hdrParams} />
            <SortableTh label="Last engaged" col="last_contacted" sort={sort} basePath="/deals" params={hdrParams} />
            <th>Days</th>
            <th>Meeting</th>
            <SortableTh label="Close" col="close_date" sort={sort} basePath="/deals" params={hdrParams} />
          </tr>
        </thead>
        <tbody>
          {page.records.map((d) => {
            const days = daysSince(d.last_contacted);
            const daysCls = days == null ? "text-neutral-400" : days > 60 ? "text-red-600 font-medium" : days > 30 ? "text-amber-600" : "text-neutral-500";
            return (
              <tr key={d.id} className="border-t border-neutral-100 hover:bg-neutral-100">
                <td className="py-1.5">
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 hover:underline">{d.name || "—"}</a>
                </td>
                <td className="text-neutral-600">{d.stage ?? "—"}</td>
                <td className="text-neutral-600">{money(d.amount, d.currency)}</td>
                <td className="text-neutral-600">{d.last_contacted ? fmtDate(d.last_contacted) : "—"}</td>
                <td className={daysCls}>{days == null ? "—" : `${days}d`}</td>
                <td className="text-neutral-600">
                  {d.next_meeting_at
                    ? <span title={d.next_meeting_name ?? undefined}>📅 {fmtDate(d.next_meeting_at)}</span>
                    : <span className="text-neutral-300">—</span>}
                </td>
                <td className="text-neutral-600">{d.close_date ? fmtDate(d.close_date) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>

      <div className="mt-4 flex items-center justify-between text-sm">
        {after ? <Link href={`/deals?${new URLSearchParams(hdrParams)}${sortRaw ? `&sort=${sortRaw}` : ""}`} className="text-blue-700 hover:underline">⟲ Start</Link> : <span />}
        {page.after ? <Link href={`/deals?${nextParams}`} className="text-blue-700 hover:underline">Next →</Link> : <span className="text-neutral-300">End</span>}
      </div>

      <p className="mt-6 text-xs text-neutral-400">Live HubSpot deals (read-only). “Last engaged” is HubSpot’s last-contacted; it gets richer once Postmark sends are logged as HubSpot activities.</p>
    </main>
  );
}
