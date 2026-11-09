// Dashboard 3 — Deal Activity. Only the tiles our current-state data supports:
// stuck deals (no recent change), stale deals (missing commercials), and the
// closed-lost breakdowns. Time-in-stage / push-rate / progression need
// stage-change history, which stays in HubSpot (linked out below).

import Link from "next/link";
import { type DashDeal } from "@/lib/dashboards/deals";
import { KpiCard, Panel, Donut, PALETTE, gbp } from "./chartkit";

const HUBSPOT_REPORTS = "https://app.hubspot.com/reports-dashboard/9175484";

function daysSince(d: Date | null): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function DealTable({ rows, valueCol }: { rows: { id: string; name: string | null; owner: string; stage: string | null; extra: string }[]; valueCol: string }) {
  if (rows.length === 0) return <p className="text-sm text-neutral-400">None 🎉</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-neutral-400">
          <tr>
            <th className="px-3 py-1.5">Deal</th>
            <th className="px-3 py-1.5">Owner</th>
            <th className="px-3 py-1.5">Stage</th>
            <th className="px-3 py-1.5 text-right">{valueCol}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-neutral-100">
              <td className="px-3 py-1.5"><Link href={`/hot/${r.id}`} className="text-blue-700 hover:underline">{r.name || "(untitled)"}</Link></td>
              <td className="px-3 py-1.5 text-neutral-600">{r.owner}</td>
              <td className="px-3 py-1.5 text-neutral-600">{r.stage ?? "—"}</td>
              <td className="px-3 py-1.5 text-right text-neutral-700">{r.extra}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function donutSlices(deals: DashDeal[], key: (d: DashDeal) => string | null): { label: string; value: number; color: string }[] {
  const counts = new Map<string, number>();
  for (const d of deals) {
    const k = key(d) || "(No value)";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length]! }));
}

export function ActivityView({ deals }: { deals: DashDeal[] }) {
  const open = deals.filter((d) => d.isOpen);
  const lost = deals.filter((d) => d.isLost);

  const STUCK_DAYS = 30;
  const stuck = open
    .map((d) => ({ d, age: daysSince(d.lastModified) }))
    .filter((x): x is { d: DashDeal; age: number } => x.age != null && x.age >= STUCK_DAYS)
    .sort((a, b) => b.age - a.age);

  const stale = open.filter((d) => (d.tcv == null && (d.amount == null || d.amount === 0)));

  const lostReasonSlices = donutSlices(lost, (d) => d.closedLostReason);
  const lostToSlices = donutSlices(lost, (d) => d.lostTo);
  const lostToHasData = lost.some((d) => d.lostTo);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Open deals" value={open.length.toLocaleString()} />
        <KpiCard label={`Stuck (${STUCK_DAYS}d+ no change)`} value={stuck.length.toLocaleString()} accent />
        <KpiCard label="Missing commercials" value={stale.length.toLocaleString()} sub="open, no TCV" />
        <KpiCard label="Closed Lost" value={lost.length.toLocaleString()} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={`Stuck deals — no change in ${STUCK_DAYS}+ days`} hint="Open deals, oldest last-modified first.">
          <DealTable
            valueCol="Days stuck"
            rows={stuck.slice(0, 12).map(({ d, age }) => ({ id: d.id, name: d.name, owner: d.ownerName, stage: d.stageLabel, extra: `${age}d` }))}
          />
        </Panel>
        <Panel title="Stale deals — missing commercials" hint="Open deals with no TCV / amount set.">
          <DealTable
            valueCol="TCV"
            rows={stale.slice(0, 12).map((d) => ({ id: d.id, name: d.name, owner: d.ownerName, stage: d.stageLabel, extra: "—" }))}
          />
        </Panel>
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
