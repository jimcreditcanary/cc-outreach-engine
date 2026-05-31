// Pipeline + sales dashboard. Plain numbers, no chart libs — every metric
// is one Supabase query so it stays fast and easy to extend.

import Link from "next/link";
import { serviceClient } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const STAGES = ["Identify", "Qualify / Discovery", "Develop", "Commit", "Nurture", "Closed Won", "Closed Lost"];

const fmt = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const fmtCount = (n: number) => n.toLocaleString("en-GB");

function daysAgo(d: number): string {
  const dt = new Date(Date.now() - d * 86_400_000);
  return dt.toISOString();
}

interface DealRow {
  id: string;
  status: string;
  stage: string | null;
  value: number | null;
  tcv: number | null;
  arr: number | null;
  proposal_exists: boolean;
  created_at: string;
  organisation: { tier: number | null } | null;
}

export default async function DashboardPage() {
  const db = serviceClient();
  const since7 = daysAgo(7);
  const since30 = daysAgo(30);

  const [
    { data: deals },
    { count: sentCount7 },
    { count: queuedCount },
    { count: approvedCount },
    { count: replyCount7 },
    { count: clickCount7 },
    { count: bounceCount30 },
    { count: newContacts7 },
    { count: prospectCount },
    { data: stageChangeEvents },
  ] = await Promise.all([
    db.from("deals").select("id, status, stage, value, tcv, arr, proposal_exists, created_at, organisation:organisations(tier)").limit(2000),
    db.from("sends").select("*", { count: "exact", head: true }).eq("status", "sent").gte("ts", since7),
    db.from("sends").select("*", { count: "exact", head: true }).eq("status", "queued"),
    db.from("sends").select("*", { count: "exact", head: true }).eq("status", "approved"),
    db.from("events").select("*", { count: "exact", head: true }).eq("type", "reply").gte("ts", since7),
    db.from("events").select("*", { count: "exact", head: true }).eq("type", "click").gte("ts", since7),
    db.from("events").select("*", { count: "exact", head: true }).eq("type", "bounce").gte("ts", since30),
    db.from("contacts").select("*", { count: "exact", head: true }).gte("created_at", since7),
    db.from("contacts").select("*", { count: "exact", head: true }).eq("label", "Prospect"),
    db.from("events").select("ts, payload").eq("type", "crm_change").gte("ts", since7).limit(500),
  ]);

  const rows = (deals ?? []) as unknown as DealRow[];
  const dealSize = (d: DealRow) => Number(d.tcv ?? d.value ?? 0);

  // Pipeline (open deals only)
  const open = rows.filter((d) => d.status === "open");
  const openTcv = open.reduce((s, d) => s + dealSize(d), 0);
  const openArr = open.reduce((s, d) => s + Number(d.arr ?? 0), 0);
  const t1 = open.filter((d) => d.proposal_exists);

  // Sales (won / lost over last 30 days — using ts proxy: deals updated)
  const wonAll = rows.filter((d) => d.status === "won");
  const lostAll = rows.filter((d) => d.status === "lost");
  const winRate = wonAll.length + lostAll.length > 0 ? (wonAll.length / (wonAll.length + lostAll.length)) * 100 : 0;

  // Pipeline by stage
  const byStage = STAGES.map((s) => {
    const stageDeals = open.filter((d) => (d.stage ?? "") === s);
    return {
      stage: s,
      count: stageDeals.length,
      tcv: stageDeals.reduce((sum, d) => sum + dealSize(d), 0),
      arr: stageDeals.reduce((sum, d) => sum + Number(d.arr ?? 0), 0),
    };
  });
  const unstaged = open.filter((d) => !d.stage || !STAGES.includes(d.stage));
  const unstagedRow = unstaged.length > 0 ? {
    stage: "(no stage)",
    count: unstaged.length,
    tcv: unstaged.reduce((s, d) => s + dealSize(d), 0),
    arr: unstaged.reduce((s, d) => s + Number(d.arr ?? 0), 0),
  } : null;

  // Recent deal movements (status changes) from event log
  const dealStatusChanges = (stageChangeEvents ?? []).filter((e) => {
    const msg = (e.payload as { message?: string } | null)?.message ?? "";
    return /Deal status →/.test(msg);
  }).length;

  const KPI = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-neutral-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-neutral-400">{sub}</div>}
    </div>
  );

  return (
    <main className="w-full px-[50px] py-8">
      <header className="mb-6 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-neutral-500">Pipeline, outreach activity and lead movement. Numbers, not charts.</p>
      </header>

      {/* Top KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label="Open pipeline (TCV)" value={fmt(openTcv)} sub={`${open.length} open deal${open.length === 1 ? "" : "s"}`} />
        <KPI label="Open pipeline (ARR)" value={fmt(openArr)} sub={`${t1.length} live (T1)`} />
        <KPI label="Sent — last 7d" value={fmtCount(sentCount7 ?? 0)} sub={`${fmtCount(replyCount7 ?? 0)} replies · ${fmtCount(clickCount7 ?? 0)} clicks`} />
        <KPI label="Queue / awaiting send" value={`${fmtCount(queuedCount ?? 0)} / ${fmtCount(approvedCount ?? 0)}`} sub={`<Link href="/queue">Open queue →</Link>`.replace(/<[^>]+>/g, "Open queue →")} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label="Won (all-time)" value={fmtCount(wonAll.length)} sub={fmt(wonAll.reduce((s, d) => s + dealSize(d), 0))} />
        <KPI label="Lost (all-time)" value={fmtCount(lostAll.length)} sub={`Win rate ${winRate.toFixed(0)}%`} />
        <KPI label="New contacts — 7d" value={fmtCount(newContacts7 ?? 0)} sub={`${fmtCount(prospectCount ?? 0)} active prospects`} />
        <KPI label="Bounces — 30d" value={fmtCount(bounceCount30 ?? 0)} sub={`${fmtCount(dealStatusChanges)} deal status changes — 7d`} />
      </div>

      {/* Pipeline by stage */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Pipeline by stage</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-neutral-400">
            <tr><th className="py-1">Stage</th><th className="text-right">Deals</th><th className="text-right">TCV</th><th className="text-right">ARR</th></tr>
          </thead>
          <tbody>
            {byStage.filter((s) => s.count > 0).map((s) => (
              <tr key={s.stage} className="border-t border-neutral-100">
                <td className="py-1.5"><Link href={`/deals?status=open`} className="text-blue-700 hover:underline">{s.stage}</Link></td>
                <td className="text-right text-neutral-700">{fmtCount(s.count)}</td>
                <td className="text-right text-neutral-700">{fmt(s.tcv)}</td>
                <td className="text-right text-neutral-700">{fmt(s.arr)}</td>
              </tr>
            ))}
            {unstagedRow && (
              <tr className="border-t border-neutral-100 text-neutral-400">
                <td className="py-1.5">{unstagedRow.stage}</td>
                <td className="text-right">{fmtCount(unstagedRow.count)}</td>
                <td className="text-right">{fmt(unstagedRow.tcv)}</td>
                <td className="text-right">{fmt(unstagedRow.arr)}</td>
              </tr>
            )}
            <tr className="border-t-2 border-neutral-300 font-semibold">
              <td className="py-1.5">Total open</td>
              <td className="text-right">{fmtCount(open.length)}</td>
              <td className="text-right">{fmt(openTcv)}</td>
              <td className="text-right">{fmt(openArr)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <p className="text-xs text-neutral-400">
        Numbers refresh on page load. Replies/clicks/bounces come from Postmark events; deal status changes come from your CRM timeline.
      </p>
    </main>
  );
}
