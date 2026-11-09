// Dashboard 1 — Revenue (Closed Won / Lost), speaking to billing. Booked figures
// come from won/lost deals in the mirror; actuals + run-rate come from the
// billing ledger.

import { type DashDeal, recentMonths, monthKey, monthLabel, sum } from "@/lib/dashboards/deals";
import { type BillingRevenue } from "@/lib/dashboards/billing";
import { KpiCard, Panel, ColumnChart, PALETTE, gbp, numK } from "./chartkit";

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

export function RevenueView({ deals, billing }: { deals: DashDeal[]; billing: BillingRevenue }) {
  const won = deals.filter((d) => d.isWon);
  const lost = deals.filter((d) => d.isLost);
  const closedCount = won.length + lost.length;
  const winRate = closedCount > 0 ? won.length / closedCount : 0;

  const tcvSum = sum(won.map((d) => d.tcv ?? d.amount));
  const avgTcv = won.length ? tcvSum / won.length : 0;

  const ttc = won.filter((d) => d.createdAt && d.closeDate).map((d) => daysBetween(d.createdAt!, d.closeDate!));
  const avgDaysToClose = ttc.length ? Math.round(sum(ttc) / ttc.length) : null;

  const months = recentMonths(6);
  const labels = months.map(monthLabel);
  const wonInMonth = (k: string) => won.filter((d) => d.closeDate && monthKey(d.closeDate) === k);

  // Closed Won TCV by month
  const tcvByMonth = months.map((k) => sum(wonInMonth(k).map((d) => d.tcv ?? d.amount)));
  // Closed Won avg ARR by month
  const arrByMonth = months.map((k) => {
    const ds = wonInMonth(k).filter((d) => d.avgArr != null);
    return ds.length ? sum(ds.map((d) => d.avgArr)) / ds.length : 0;
  });

  // Closed Won by owner (count), stacked by top owners
  const ownerTotals = new Map<string, number>();
  for (const d of won) ownerTotals.set(d.ownerName, (ownerTotals.get(d.ownerName) ?? 0) + 1);
  const topOwners = [...ownerTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n]) => n);
  const ownerSeries = topOwners.map((name, i) => ({
    name,
    color: PALETTE[i % PALETTE.length]!,
    values: months.map((k) => wonInMonth(k).filter((d) => d.ownerName === name).length),
  }));

  // Closed Won by type (TCV)
  const typeLabel = (t: string | null) => (t === "newbusiness" ? "New Business" : t === "existingbusiness" ? "Existing Business" : "Other");
  const hasType = won.some((d) => d.dealType);
  const typeNames = [...new Set(won.map((d) => typeLabel(d.dealType)))];
  const typeSeries = typeNames.map((name, i) => ({
    name,
    color: name === "New Business" ? PALETTE[0]! : name === "Existing Business" ? PALETTE[5]! : PALETTE[2]!,
    values: months.map((k) => sum(wonInMonth(k).filter((d) => typeLabel(d.dealType) === name).map((d) => d.tcv ?? d.amount))),
  }));

  // Won vs Lost (count) by month — honours "Closed Won / Lost"
  const lostInMonth = (k: string) => lost.filter((d) => d.closeDate && monthKey(d.closeDate) === k);
  const wonLostSeries = [
    { name: "Won", color: PALETTE[0]!, values: months.map((k) => wonInMonth(k).length) },
    { name: "Lost", color: "#ef4444", values: months.map((k) => lostInMonth(k).length) },
  ];

  // Billing: invoiced by month aligned to window (Paid vs Outstanding)
  const bmByKey = new Map(billing.byMonth.map((m) => [m.month, m]));
  const billedSeries = [
    { name: "Paid", color: PALETTE[0]!, values: months.map((k) => bmByKey.get(k)?.paid ?? 0) },
    { name: "Outstanding", color: PALETTE[2]!, values: months.map((k) => bmByKey.get(k)?.outstanding ?? 0) },
  ];

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Closed-Won TCV" value={gbp(tcvSum)} sub={`${won.length} won`} accent />
        <KpiCard label="Average TCV" value={gbp(avgTcv)} />
        <KpiCard label="Win rate" value={`${Math.round(winRate * 100)}%`} sub={`${won.length} / ${closedCount} closed`} />
        <KpiCard label="Avg days to close" value={avgDaysToClose == null ? "—" : String(avgDaysToClose)} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Invoiced (billed)" value={gbp(billing.totalInvoiced)} sub="all time" />
        <KpiCard label="Outstanding" value={gbp(billing.totalOutstanding)} sub={`${gbp(billing.totalPaid)} paid`} />
        <KpiCard label="Live MRR" value={gbp(billing.mrr)} sub={billing.latestMonth ? `${monthLabel(billing.latestMonth)} billed` : "—"} accent />
        <KpiCard label="Live ARR" value={gbp(billing.arr)} sub={`${billing.activeAccounts} active accounts`} accent />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Closed Won — TCV by month">
          <ColumnChart categories={labels} series={[{ name: "TCV", color: PALETTE[0]!, values: tcvByMonth }]} unit="gbp" />
        </Panel>
        <Panel title="Closed Won — Average ARR by month">
          <ColumnChart categories={labels} series={[{ name: "Avg ARR", color: PALETTE[1]!, values: arrByMonth }]} unit="gbp" emptyLabel="No ARR on won deals in range" />
        </Panel>
        <Panel title="Closed Won by month — by owner" hint="Count of won deals, stacked by deal owner.">
          <ColumnChart categories={labels} series={ownerSeries.length ? ownerSeries : [{ name: "Won", color: PALETTE[0]!, values: months.map(() => 0) }]} unit="count" />
        </Panel>
        <Panel title="Closed Won by type — TCV" hint={hasType ? undefined : "Deal type populates after the next HubSpot mirror sync."}>
          <ColumnChart categories={labels} series={typeSeries.length ? typeSeries : [{ name: "Other", color: PALETTE[2]!, values: tcvByMonth }]} unit="gbp" />
        </Panel>
        <Panel title="Won vs Lost by month" hint="Count of deals closed each month.">
          <ColumnChart categories={labels} series={wonLostSeries} unit="count" />
        </Panel>
        <Panel title="Billing — invoiced by month" hint="Actuals from the billing ledger: paid vs outstanding.">
          <ColumnChart categories={labels} series={billedSeries} unit="gbp" emptyLabel="No invoices in range" />
        </Panel>
      </div>
      <p className="text-xs text-neutral-400">Booked figures from won/lost deals (HubSpot mirror). Billing figures from the invoice ledger; MRR is the latest billed month, ARR = MRR × 12. {numK(deals.length)} deals in scope.</p>
    </div>
  );
}
