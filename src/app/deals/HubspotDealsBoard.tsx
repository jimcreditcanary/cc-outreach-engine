// HubSpot-backed deals board (Phase 4). A kanban of one pipeline's stages, with
// a pipeline switcher. Cards open the Work-Deal page (/hot/[id]). Hot's "due for
// a touch" rule (no contact in ≥14 days) is folded in as a card highlight, so
// the separate Hot radar is retired. Read-only from HubSpot.

import Link from "next/link";
import { getCrm } from "@/lib/crm";
import { dealPipelines } from "@/lib/hubspot/repo";
import { listOwners, ownerOptions } from "@/lib/hubspot/owners";
import { DealOwnerFilter } from "./DealOwnerFilter";
import { refreshDealsAction } from "./boardActions";
import { PendingButton } from "@/components/PendingButton";
import { fmtDate } from "@/lib/format/datetime";

const DUE_DAYS = 14; // the "engage every 2 weeks" rule, inherited from Hot

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
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export async function HubspotDealsBoard({ pipelineId, q, ownerId }: { pipelineId?: string; q?: string; ownerId?: string }) {
  const pipelines = await dealPipelines();
  if (!pipelines.length) {
    return (
      <main className="px-4 py-6 md:px-8">
        <h1 className="text-xl font-semibold">Deals</h1>
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">No HubSpot deal pipelines found. Set <code>HUBSPOT_TOKEN</code>.</p>
      </main>
    );
  }
  const selected = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0]!;
  // A work board of live deals — show open stages only (closed-won/lost would
  // otherwise dominate the row budget). Stalest first within each column.
  const openStages = selected.stages.filter((s) => !s.isClosed);
  const stageIds = openStages.map((s) => s.id);

  const [page, owners] = await Promise.all([
    getCrm().listDeals({ q, stages: stageIds, ownerId, limit: 100, sort: { col: "last_contacted", dir: "asc" } }),
    listOwners(),
  ]);
  const ownerPickList = ownerOptions(owners).map((o) => ({ id: o.id, name: o.name }));

  // Group the page's deals by stage label (labels are unique within a pipeline).
  const byStage = new Map<string, typeof page.records>();
  for (const d of page.records) {
    const key = d.stage ?? "—";
    (byStage.get(key) ?? byStage.set(key, []).get(key)!).push(d);
  }

  return (
    <main className="px-4 py-6 md:px-8">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold">Deals</h1>
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700" title="Live from HubSpot (read-only)">HubSpot</span>
        </div>
        <span className="text-sm text-neutral-500">{page.records.length}{page.after ? "+ (first 100)" : ""} deal{page.records.length === 1 ? "" : "s"}</span>
      </header>

      {/* Pipeline switcher + search */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {pipelines.map((p) => (
          <Link
            key={p.id}
            href={`/deals?pipeline=${p.id}${q ? `&q=${encodeURIComponent(q)}` : ""}${ownerId ? `&owner=${encodeURIComponent(ownerId)}` : ""}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${p.id === selected.id ? "bg-neutral-900 text-white" : "border border-neutral-300 text-neutral-600 hover:bg-neutral-100"}`}
          >
            {p.label}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <form action={refreshDealsAction}>
            <PendingButton className="rounded border border-neutral-300 px-2 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100" pendingLabel="Refreshing…" title="Re-query HubSpot">↻ Refresh</PendingButton>
          </form>
          <DealOwnerFilter owners={ownerPickList} value={ownerId} />
          <form>
            <input type="hidden" name="pipeline" value={selected.id} />
            {ownerId && <input type="hidden" name="owner" value={ownerId} />}
            <input name="q" defaultValue={q ?? ""} placeholder="Search deals…" className="rounded border border-neutral-300 px-3 py-1.5 text-sm" />
          </form>
        </div>
      </div>

      {/* Board: one column per OPEN stage, in HubSpot display order */}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {openStages.map((stage) => {
          const cards = byStage.get(stage.label) ?? [];
          const sum = cards.reduce((s, c) => s + (c.amount ?? 0), 0);
          return (
            <div key={stage.id} className="flex w-72 shrink-0 flex-col rounded-lg bg-neutral-100/70">
              <div className="flex items-baseline justify-between px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-neutral-600">{stage.label}</span>
                <span className="text-[11px] text-neutral-400">{cards.length} · {money(sum, cards[0]?.currency ?? "GBP")}</span>
              </div>
              <div className="flex flex-col gap-2 px-2 pb-2">
                {cards.length === 0 && <p className="px-1 py-2 text-xs text-neutral-300">—</p>}
                {cards.map((d) => {
                  const days = daysSince(d.last_contacted);
                  const due = days != null && days >= DUE_DAYS && !d.next_meeting_at;
                  return (
                    <Link
                      key={d.id}
                      href={`/hot/${d.id}`}
                      className={`block rounded-md border bg-white p-2.5 text-sm shadow-sm hover:shadow ${due ? "border-l-4 border-l-amber-500 border-y-neutral-200 border-r-neutral-200" : "border-neutral-200"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-neutral-800">{d.name || "(untitled)"}</span>
                        {due && <span title={`No contact in ${days} days`} className="shrink-0 text-amber-600">🔥</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-neutral-500">
                        <span>{money(d.amount, d.currency)}</span>
                        {d.last_contacted ? <span className={days != null && days > 30 ? "text-red-600" : ""}>· {days}d</span> : <span>· never</span>}
                        {d.next_meeting_at && <span title={d.next_meeting_name ?? undefined}>· 📅 {fmtDate(d.next_meeting_at)}</span>}
                      </div>
                      {d.owner_name && <div className="mt-0.5 text-[11px] text-neutral-400">👤 {d.owner_name}</div>}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-neutral-400">
        Open stages only · click a card to work the deal (appraise + draft, start onboarding/billing). 🔥 = no contact in ≥{DUE_DAYS} days.
        {page.after ? " Showing the first 100 open deals in this pipeline — use search to narrow." : ""}
      </p>
    </main>
  );
}
