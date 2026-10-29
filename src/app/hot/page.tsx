// Hot — the deal re-engagement radar. Every OPEN deal in the operator's name,
// scored against a 2-week engagement rule: anything not contacted in ≥14 days
// (or never) is "due for a touch". One click drafts a tailored next-step nudge
// (the same MEDDICC-appraise + draft engine as Outreach › Nurture) into the
// review queue — nothing sends from here.
//
// Deals with an upcoming meeting already booked are treated as handled and
// drop to the bottom (no nudge needed — you're seeing them soon).

import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { hubspotEnabled } from "@/lib/hubspot/client";
import { listOwnerOpenDeals } from "@/lib/hubspot/repo";
import { resolveHubspotOwner } from "@/lib/hubspot/owner";
import { fmtDate } from "@/lib/format/datetime";
import { PendingButton } from "@/components/PendingButton";
import { draftDealNudgeAction } from "./actions";

export const dynamic = "force-dynamic";
// The ✨ Draft nudge button appraises + drafts via Claude (can take ~15s).
export const maxDuration = 60;

const DUE_DAYS = 14; // the "engage every 2 weeks" rule

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

interface DraftRef { id: string; subject: string | null; status: string }

export default async function HotPage() {
  const me = await currentUser();
  if (!me) redirect("/login");

  if (!hubspotEnabled()) {
    return (
      <main className="px-4 py-6 md:px-8">
        <header className="mb-4 border-b border-neutral-200 pb-3">
          <h1 className="text-xl font-semibold">Hot</h1>
        </header>
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Deals read live from HubSpot. Set <code>HUBSPOT_TOKEN</code> to use this view.
        </p>
      </main>
    );
  }

  const db = serviceClient();
  const ownerId = await resolveHubspotOwner(db, me.id);

  // The operator's open deals + any deal-nurture drafts already in flight, so a
  // deal that's already been drafted shows "review in queue" not another button.
  const [deals, { data: sendsData }] = await Promise.all([
    listOwnerOpenDeals(ownerId, 100),
    db
      .from("hs_sends")
      .select("id, subject, status, meta, ts")
      .in("status", ["queued", "approved", "sent"])
      .order("ts", { ascending: false })
      .limit(400),
  ]);

  // Most-recent deal-nurture draft per deal id.
  const draftByDeal = new Map<string, DraftRef>();
  for (const row of (sendsData ?? []) as { id: string; subject: string | null; status: string; meta: Record<string, unknown> | null }[]) {
    const meta = row.meta ?? {};
    if (meta["kind"] !== "deal-nurture") continue;
    const dealId = meta["deal_id"] ? String(meta["deal_id"]) : "";
    if (!dealId || draftByDeal.has(dealId)) continue;
    draftByDeal.set(dealId, { id: row.id, subject: row.subject, status: row.status });
  }

  const now = Date.now();
  const hasUpcomingMeeting = (iso: string | null) => !!iso && new Date(iso).getTime() >= now;

  // Split: deals with a booked meeting are "handled" (bottom); the rest are the
  // working list, most-overdue first (never-contacted sorts to the very top).
  const scheduled = deals.filter((d) => hasUpcomingMeeting(d.next_meeting_at));
  const working = deals
    .filter((d) => !hasUpcomingMeeting(d.next_meeting_at))
    .sort((a, b) => (daysSince(b.last_contacted) ?? 1e9) - (daysSince(a.last_contacted) ?? 1e9));

  const isDue = (iso: string | null) => {
    const d = daysSince(iso);
    return d == null || d >= DUE_DAYS;
  };
  const dueCount = working.filter((d) => isDue(d.last_contacted)).length;

  return (
    <main className="px-4 py-6 md:px-8">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold">Hot</h1>
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700" title="Open deals read live from HubSpot">HubSpot</span>
        </div>
        <span className="text-sm text-neutral-500">
          {deals.length} open · <span className={dueCount ? "font-medium text-red-600" : ""}>{dueCount} due a touch</span>
        </span>
      </header>

      <p className="mb-5 text-sm text-neutral-500">
        Your open deals, worst-neglected first. Anything not contacted in {DUE_DAYS}+ days is <span className="font-medium text-red-600">due</span> — hit
        <span className="font-medium"> ✨ Draft nudge</span> to drop a tailored next-step email into the <Link href="/outreach?tab=nurture" className="text-blue-700 hover:underline">review queue</Link>. Nothing sends until you approve it.
      </p>

      {working.length === 0 && scheduled.length === 0 ? (
        <p className="text-neutral-500">No open deals in your name right now.</p>
      ) : (
        <ul className="space-y-2">
          {working.map((d) => {
            const days = daysSince(d.last_contacted);
            const due = isDue(d.last_contacted);
            const daysCls = days == null ? "bg-red-100 text-red-700" : days >= DUE_DAYS ? "bg-red-100 text-red-700" : days >= 7 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800";
            const draft = draftByDeal.get(d.id);
            return (
              <li key={d.id} className={`rounded-lg border p-3 shadow-sm ${due ? "border-red-200 bg-red-50/30" : "border-neutral-200 bg-white"}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 hover:underline">{d.name || "(untitled deal)"}</a>
                  {d.stage && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">{d.stage}</span>}
                  <span className="text-neutral-500">{money(d.amount, d.currency)}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${daysCls}`}>
                    {days == null ? "never contacted" : `${days}d ago`}
                  </span>
                  <span className="ml-auto">
                    {draft ? (
                      <Link href="/outreach?tab=nurture" className="rounded border border-purple-300 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-50">
                        {draft.status === "sent" ? "nudge sent — view" : `draft ${draft.status} — review`}
                      </Link>
                    ) : (
                      <form action={draftDealNudgeAction}>
                        <input type="hidden" name="deal_id" value={d.id} />
                        <PendingButton
                          className="rounded border border-amber-300 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
                          pendingLabel="Appraising + drafting…"
                        >
                          ✨ Draft nudge
                        </PendingButton>
                      </form>
                    )}
                  </span>
                </div>
                {d.next_step && <p className="mt-1 text-xs text-neutral-500">Next step: {d.next_step}</p>}
                {draft?.subject && <p className="mt-1 text-xs text-neutral-400 italic">↳ {draft.subject}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {scheduled.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Meeting booked ({scheduled.length})</h2>
          <ul className="space-y-2">
            {scheduled.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-emerald-200 bg-emerald-50/30 p-3 text-sm shadow-sm">
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 hover:underline">{d.name || "(untitled deal)"}</a>
                {d.stage && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">{d.stage}</span>}
                <span className="text-neutral-500">{money(d.amount, d.currency)}</span>
                <span className="ml-auto rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800" title={d.next_meeting_name ?? undefined}>
                  📅 {d.next_meeting_at ? fmtDate(d.next_meeting_at) : "upcoming"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
