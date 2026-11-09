// Dashboard — Deal Activity. Only the tiles our current-state data supports:
// stale deals (missing commercials) and the closed-lost breakdowns.
// Time-in-stage / push-rate need stage-change history, which stays in HubSpot
// (linked out below).

import Link from "next/link";
import { type DashDeal } from "@/lib/dashboards/deals";
import { fmtDate } from "@/lib/format/datetime";
import { KpiCard, Panel, Donut, PALETTE } from "./chartkit";

const HUBSPOT_REPORTS = "https://app.hubspot.com/reports-dashboard/9175484";

function daysSince(d: Date | null): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

type Align = "left" | "right";
function Table({ headers, align, rows }: { headers: string[]; align: Align[]; rows: React.ReactNode[][] }) {
  if (rows.length === 0) return <p className="py-4 text-sm text-neutral-400">None to show 🎉</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-neutral-400">
          <tr>{headers.map((h, i) => <th key={i} className={`px-3 py-1.5 ${align[i] === "right" ? "text-right" : ""}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((cells, ri) => (
            <tr key={ri} className="border-t border-neutral-100">
              {cells.map((c, ci) => (
                <td key={ci} className={`px-3 py-1.5 ${align[ci] === "right" ? "text-right tabular-nums" : ""} ${ci === 0 ? "" : "text-neutral-600"}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function dealLink(d: DashDeal) {
  return <Link href={`/hot/${d.id}`} className="text-blue-700 hover:underline">{d.name || "(untitled)"}</Link>;
}

function donutSlices(deals: DashDeal[], key: (d: DashDeal) => string | null): { label: string; value: number; color: string }[] {
  const counts = new Map<string, number>();
  for (const d of deals) {
    const k = key(d) || "(No value)";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length]! }));
}

export function ActivityView({ deals }: { deals: DashDeal[] }) {
  const open = deals.filter((d) => d.isOpen);
  const lost = deals.filter((d) => d.isLost);

  // Stale: open, no commercial value set — oldest last-activity first.
  const stale = open
    .filter((d) => d.value <= 0)
    .sort((a, b) => (a.lastModified?.getTime() ?? 0) - (b.lastModified?.getTime() ?? 0));

  const lostReasonSlices = donutSlices(lost, (d) => d.closedLostReason);
  const lostToSlices = donutSlices(lost, (d) => d.lostTo);
  const lostToHasData = lost.some((d) => d.lostTo);

  const lastActivity = (d: DashDeal) => {
    const age = daysSince(d.lastModified);
    if (!d.lastModified) return <span className="text-neutral-400">never</span>;
    return <span>{fmtDate(d.lastModified.toISOString())}{age != null && <span className="text-neutral-400"> · {age}d</span>}</span>;
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Open deals" value={open.length.toLocaleString()} />
        <KpiCard label="Missing commercials" value={stale.length.toLocaleString()} sub="open, no value" />
        <KpiCard label="Closed Lost" value={lost.length.toLocaleString()} />
      </div>

      <Panel title="Stale deals — missing commercials" hint="Open deals with no TCV / amount set — line items likely need adding in HubSpot.">
        <Table
          headers={["Deal", "Owner", "Stage", "Last activity"]}
          align={["left", "left", "left", "right"]}
          rows={stale.slice(0, 15).map((d) => [dealLink(d), d.ownerName, d.stageLabel ?? "—", lastActivity(d)])}
        />
        {stale.length > 15 && <p className="mt-2 text-xs text-neutral-400">Showing 15 of {stale.length}.</p>}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Closed Lost reason">
          <Donut slices={lostReasonSlices} centerValue={String(lost.length)} centerSub="lost" emptyLabel="No closed-lost deals" />
        </Panel>
        <Panel title="Lost to" hint={lostToHasData ? undefined : "No 'lost to' values recorded yet."}>
          <Donut slices={lostToSlices} centerValue={String(lost.length)} centerSub="lost" emptyLabel="No 'lost to' data" />
        </Panel>
      </div>

      <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-600">
        <span className="font-medium text-neutral-700">Stage-movement analytics stay in HubSpot.</span>{" "}
        Time-in-stage, deal push-rate and progression need stage-change history we don't hold locally.{" "}
        <a href={HUBSPOT_REPORTS} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 hover:underline">Open the Deal Activity dashboard in HubSpot ↗</a>
      </div>
    </div>
  );
}
