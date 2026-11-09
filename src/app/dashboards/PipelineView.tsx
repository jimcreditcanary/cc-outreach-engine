// Dashboard 2 — Deal Pipeline. Open deals only: how many, what size, whose, and
// the weighted forecast by close date. All from the mirror.

import { type DashDeal, monthKey, monthLabel, sum } from "@/lib/dashboards/deals";
import { KpiCard, Panel, BarChart, ColumnChart, PALETTE, gbp } from "./chartkit";

function upcomingMonths(n: number, from = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const m = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1));
    out.push(`${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

// Group open deals by "Stage (Pipeline)" and reduce to a value, top N by value.
function byStage(deals: DashDeal[], value: (ds: DashDeal[]) => number, topN = 10): { label: string; value: number }[] {
  const groups = new Map<string, DashDeal[]>();
  for (const d of deals) {
    const key = d.stageLabel ? `${d.stageLabel} (${d.pipelineLabel ?? "—"})` : "Unstaged";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(d);
  }
  return [...groups.entries()]
    .map(([label, ds]) => ({ label, value: value(ds) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);
}

export function PipelineView({ deals }: { deals: DashDeal[] }) {
  const open = deals.filter((d) => d.isOpen);
  const openTcv = sum(open.map((d) => d.value));
  const weighted = sum(open.map((d) => d.weighted));
  const avgSize = open.length ? openTcv / open.length : 0;

  const countByStage = byStage(open, (ds) => ds.length);
  const tcvByStage = byStage(open, (ds) => sum(ds.map((d) => d.value)));
  const arrByStage = byStage(open, (ds) => {
    const a = ds.filter((d) => d.avgArr != null);
    return a.length ? sum(a.map((d) => d.avgArr)) / a.length : 0;
  });
  const carrByStage = byStage(open, (ds) => sum(ds.map((d) => d.carr)));

  // Weighted pipeline by close month (next 6 months)
  const fwd = upcomingMonths(6);
  const fwdLabels = fwd.map(monthLabel);
  const inCloseMonth = (k: string) => open.filter((d) => d.closeDate && monthKey(d.closeDate) === k);
  const weightedByMonth = fwd.map((k) => sum(inCloseMonth(k).map((d) => d.weighted)));
  // Forecast: this month + next quarter (4 months), unweighted TCV
  const fc = upcomingMonths(4);
  const fcLabels = fc.map(monthLabel);
  const tcvByCloseMonth = fc.map((k) => sum(inCloseMonth(k).map((d) => d.value)));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Open deals" value={open.length.toLocaleString()} accent />
        <KpiCard label="Open TCV" value={gbp(openTcv)} />
        <KpiCard label="Weighted pipeline" value={gbp(weighted)} sub="by stage probability" accent />
        <KpiCard label="Avg deal size (TCV)" value={gbp(avgSize)} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Pipeline count by stage">
          <BarChart rows={countByStage.map((r) => ({ ...r, color: PALETTE[0]! }))} unit="count" />
        </Panel>
        <Panel title="TCV by stage">
          <BarChart rows={tcvByStage.map((r) => ({ ...r, color: PALETTE[1]! }))} unit="gbp" />
        </Panel>
        <Panel title="Average ARR by stage">
          <BarChart rows={arrByStage.map((r) => ({ ...r, color: PALETTE[4]! }))} unit="gbp" emptyLabel="No ARR on open deals" />
        </Panel>
        <Panel title="CARR by stage">
          <BarChart rows={carrByStage.map((r) => ({ ...r, color: PALETTE[3]! }))} unit="gbp" emptyLabel="No CARR on open deals" />
        </Panel>
        <Panel title="Weighted pipeline by close date" hint="Open deals × stage probability, by close month.">
          <ColumnChart categories={fwdLabels} series={[{ name: "Weighted", color: PALETTE[0]!, values: weightedByMonth }]} unit="gbp" />
        </Panel>
        <Panel title="Forecast — this month & next quarter" hint="Open-deal TCV by close month (unweighted).">
          <ColumnChart categories={fcLabels} series={[{ name: "TCV", color: PALETTE[1]!, values: tcvByCloseMonth }]} unit="gbp" />
        </Panel>
      </div>
      <p className="text-xs text-neutral-400">{open.length.toLocaleString()} open deals across all pipelines. Stage probabilities come from each HubSpot pipeline's stage metadata.</p>
    </div>
  );
}
