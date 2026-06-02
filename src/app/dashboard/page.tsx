// Pipeline + sales dashboard. Plain numbers, no chart libs — every metric
// is one Supabase query so it stays fast and easy to extend.

import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { OwnerFilter } from "@/components/OwnerFilter";
import { resolveOwnerFilter } from "@/lib/auth/owner";
import { STAGES, stageProbability, stageProbabilityLabel } from "@/lib/pipeline/stages";

export const dynamic = "force-dynamic";

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

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const { owner } = await searchParams;
  const db = serviceClient();
  const ownerId = await resolveOwnerFilter(owner);
  const since7 = daysAgo(7);
  const since30 = daysAgo(30);

  // For event-type counts (reply / click / bounce), the events table has no
  // owner_id column. We INNER-JOIN through contacts.owner_id instead of
  // pre-fetching ids + .in()-ing them — the IN-list URL hits Supabase's
  // ~8KB limit past a few hundred contacts and 400s.
  const eventOwnerJoin = (col: "*" | "count" = "*") =>
    ownerId
      ? `${col === "count" ? "" : "*, "}contacts!inner(owner_id)`.replace(/^,\s/, "")
      : "*";

  // Build each query and optionally narrow by owner. PostgrestFilterBuilder's
  // chained types don't survive being passed through a generic wrapper, so we
  // keep the .eq() calls inline.
  const dealsQ      = db.from("deals").select("id, status, stage, value, tcv, arr, proposal_exists, created_at, organisation:organisations(tier)").limit(2000);
  const sent7Q      = db.from("sends").select("*", { count: "exact", head: true }).eq("status", "sent").gte("ts", since7);
  const queuedQ     = db.from("sends").select("*", { count: "exact", head: true }).eq("status", "queued");
  const approvedQ   = db.from("sends").select("*", { count: "exact", head: true }).eq("status", "approved");
  const newCt7Q     = db.from("contacts").select("*", { count: "exact", head: true }).gte("created_at", since7);
  const prospectQ   = db.from("contacts").select("*", { count: "exact", head: true }).eq("label", "Prospect");

  // Event-count queries with optional owner-filter via JOIN.
  const eventCountSelect = ownerId ? "contacts!inner(owner_id)" : "*";
  const replyQ  = ownerId
    ? db.from("events").select(eventCountSelect, { count: "exact", head: true }).eq("type", "reply").gte("ts", since7).eq("contacts.owner_id", ownerId)
    : db.from("events").select("*", { count: "exact", head: true }).eq("type", "reply").gte("ts", since7);
  const clickQ  = ownerId
    ? db.from("events").select(eventCountSelect, { count: "exact", head: true }).eq("type", "click").gte("ts", since7).eq("contacts.owner_id", ownerId)
    : db.from("events").select("*", { count: "exact", head: true }).eq("type", "click").gte("ts", since7);
  const bounceQ = ownerId
    ? db.from("events").select(eventCountSelect, { count: "exact", head: true }).eq("type", "bounce").gte("ts", since30).eq("contacts.owner_id", ownerId)
    : db.from("events").select("*", { count: "exact", head: true }).eq("type", "bounce").gte("ts", since30);
  void eventOwnerJoin; // helper retained for future symmetry

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
    ownerId ? dealsQ.eq("owner_id", ownerId)    : dealsQ,
    ownerId ? sent7Q.eq("owner_id", ownerId)    : sent7Q,
    ownerId ? queuedQ.eq("owner_id", ownerId)   : queuedQ,
    ownerId ? approvedQ.eq("owner_id", ownerId) : approvedQ,
    replyQ,
    clickQ,
    bounceQ,
    ownerId ? newCt7Q.eq("owner_id", ownerId)   : newCt7Q,
    ownerId ? prospectQ.eq("owner_id", ownerId) : prospectQ,
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

  // Pipeline by stage. Weighted = stage probability × TCV/ARR so the dashboard
  // shows what we'd realistically book if every deal closed at its stage's
  // historical conversion rate.
  const byStage = STAGES.map((s) => {
    const stageDeals = open.filter((d) => (d.stage ?? "") === s);
    const tcv = stageDeals.reduce((sum, d) => sum + dealSize(d), 0);
    const arr = stageDeals.reduce((sum, d) => sum + Number(d.arr ?? 0), 0);
    const prob = stageProbability(s);
    return { stage: s, count: stageDeals.length, tcv, arr, weightedTcv: tcv * prob, weightedArr: arr * prob, probLabel: stageProbabilityLabel(s) };
  });
  const unstaged = open.filter((d) => !d.stage || !(STAGES as readonly string[]).includes(d.stage));
  const unstagedRow = unstaged.length > 0 ? {
    stage: "(no stage)",
    count: unstaged.length,
    tcv: unstaged.reduce((s, d) => s + dealSize(d), 0),
    arr: unstaged.reduce((s, d) => s + Number(d.arr ?? 0), 0),
    weightedTcv: 0,
    weightedArr: 0,
    probLabel: "—",
  } : null;

  // Workspace-wide weighted pipeline = sum of per-deal (TCV × stage probability).
  const weightedTcv = open.reduce((s, d) => s + dealSize(d) * stageProbability(d.stage), 0);
  const weightedArr = open.reduce((s, d) => s + Number(d.arr ?? 0) * stageProbability(d.stage), 0);

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
    <main className="px-8 py-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-neutral-200 pb-3">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-neutral-500">Pipeline, outreach activity and lead movement. Numbers, not charts.</p>
        </div>
        <OwnerFilter current={owner} pathname="/dashboard" />
      </header>

      {/* Top KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label="Open pipeline (TCV)" value={fmt(openTcv)} sub={`${open.length} open deal${open.length === 1 ? "" : "s"}`} />
        <KPI label="Weighted pipeline (TCV)" value={fmt(weightedTcv)} sub={`Stage probability × deal size · ARR ${fmt(weightedArr)}`} />
        <KPI label="Sent — last 7d" value={fmtCount(sentCount7 ?? 0)} sub={`${fmtCount(replyCount7 ?? 0)} replies · ${fmtCount(clickCount7 ?? 0)} clicks`} />
        <KPI label="Queue / awaiting send" value={`${fmtCount(queuedCount ?? 0)} / ${fmtCount(approvedCount ?? 0)}`} sub="Open queue →" />
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
            <tr>
              <th className="py-1">Stage</th>
              <th className="text-right">Prob.</th>
              <th className="text-right">Deals</th>
              <th className="text-right">TCV</th>
              <th className="text-right">Weighted TCV</th>
              <th className="text-right">ARR</th>
              <th className="text-right">Weighted ARR</th>
            </tr>
          </thead>
          <tbody>
            {byStage.filter((s) => s.count > 0).map((s) => (
              <tr key={s.stage} className="border-t border-neutral-100">
                <td className="py-1.5"><Link href={`/deals?status=open`} className="text-blue-700 hover:underline">{s.stage}</Link></td>
                <td className="text-right text-neutral-500">{s.probLabel}</td>
                <td className="text-right text-neutral-700">{fmtCount(s.count)}</td>
                <td className="text-right text-neutral-700">{fmt(s.tcv)}</td>
                <td className="text-right font-medium text-neutral-900">{fmt(s.weightedTcv)}</td>
                <td className="text-right text-neutral-700">{fmt(s.arr)}</td>
                <td className="text-right font-medium text-neutral-900">{fmt(s.weightedArr)}</td>
              </tr>
            ))}
            {unstagedRow && (
              <tr className="border-t border-neutral-100 text-neutral-400">
                <td className="py-1.5">{unstagedRow.stage}</td>
                <td className="text-right">{unstagedRow.probLabel}</td>
                <td className="text-right">{fmtCount(unstagedRow.count)}</td>
                <td className="text-right">{fmt(unstagedRow.tcv)}</td>
                <td className="text-right">{fmt(unstagedRow.weightedTcv)}</td>
                <td className="text-right">{fmt(unstagedRow.arr)}</td>
                <td className="text-right">{fmt(unstagedRow.weightedArr)}</td>
              </tr>
            )}
            <tr className="border-t-2 border-neutral-300 font-semibold">
              <td className="py-1.5">Total open</td>
              <td className="text-right text-neutral-400"></td>
              <td className="text-right">{fmtCount(open.length)}</td>
              <td className="text-right">{fmt(openTcv)}</td>
              <td className="text-right">{fmt(weightedTcv)}</td>
              <td className="text-right">{fmt(openArr)}</td>
              <td className="text-right">{fmt(weightedArr)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-neutral-400">
          Weighted = stage probability × deal size. Defaults: Identify 10% · Qualify 25% · Develop 50% · Commit 75% · Nurture 5%.
          Tweak in <code>src/lib/pipeline/stages.ts</code>.
        </p>
      </section>

      <p className="text-xs text-neutral-400">
        Numbers refresh on page load. Replies/clicks/bounces come from Postmark events; deal status changes come from your CRM timeline.
      </p>
    </main>
  );
}
