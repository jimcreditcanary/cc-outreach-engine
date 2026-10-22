// Outreach workflow surface. Two tabs:
//   Outbound — draft a (small) run from a HubSpot segment, review, send.
//   Nurture  — appraise open deals (MEDDICC) and draft a next-step nudge.
// Both feed one review queue; the send bar flushes the whole approved queue.
// Larger drafting runs happen via `npm run workflow` / `npm run nurture` / cron;
// this page is the review + send cockpit.

import { serviceClient } from "@/lib/db/client";
import { hubspotEnabled } from "@/lib/hubspot/client";
import { listContactLists } from "@/lib/hubspot/repo";
import { isDryRun } from "@/lib/send/postmark";
import { fmtDateTime } from "@/lib/format/datetime";
import { PendingButton } from "@/components/PendingButton";
import { PageTabs } from "@/components/PageTabs";
import { draftRunAction, nurtureRunAction, approveDraftAction, discardDraftAction, editDraftAction, sendBatchAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // the in-app draft run researches + writes per contact

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

interface Meta { contact_name?: string; confidence?: string; page_url?: string; page_title?: string; angle?: string; kind?: string; deal_name?: string; stage?: string }
interface Row {
  id: string; hs_contact_id: string; email: string; subject: string | null; body_text: string | null;
  campaign: string | null; status: string; meta: Meta | null; ts: string; sent_at: string | null;
  clicked: boolean; replied: boolean; bounced: boolean;
}

function confBadge(c?: string) {
  const cls = c === "high" ? "bg-emerald-100 text-emerald-800" : c === "medium" ? "bg-amber-100 text-amber-800" : "bg-neutral-100 text-neutral-500";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${cls}`}>{c ?? "—"}</span>;
}

const isNurture = (r: Row) => r.meta?.kind === "deal-nurture";

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab === "nurture" ? "nurture" : "outbound";
  const db = serviceClient();
  const dry = isDryRun();
  const hsLists = tab === "outbound" && hubspotEnabled() ? await listContactLists() : [];
  const { data } = await db
    .from("hs_sends")
    .select("id, hs_contact_id, email, subject, body_text, campaign, status, meta, ts, sent_at, clicked, replied, bounced")
    .order("ts", { ascending: false })
    .limit(300);
  const rows = (data ?? []) as unknown as Row[];

  // Global queue counts (the send bar flushes everything approved).
  const readyAll = rows.filter((r) => r.status === "approved").length;
  const reviewAll = rows.filter((r) => r.status === "queued").length;

  // Per-tab lists — outbound vs deal-nurture drafts.
  const scoped = rows.filter((r) => (tab === "nurture" ? isNurture(r) : !isNurture(r)));
  const toReview = scoped.filter((r) => r.status === "queued");
  const ready = scoped.filter((r) => r.status === "approved");
  const sent = scoped.filter((r) => r.status === "sent").slice(0, 25);

  const wfTabs = [
    { href: "/outreach?tab=outbound", label: "Outbound", active: tab === "outbound" },
    { href: "/outreach?tab=nurture", label: "Nurture", active: tab === "nurture" },
  ];

  return (
    <main className="px-4 py-6 md:px-8">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold">Workflow</h1>
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700">HubSpot</span>
        </div>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${dry ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
          {dry ? "Dry run — sends are simulated" : "Live sending enabled"}
        </span>
      </header>

      {!hubspotEnabled() && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Set <code>HUBSPOT_TOKEN</code> to draft from HubSpot segments.</p>
      )}

      {/* Global send bar — flushes the whole approved queue (outbound + nurture). */}
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3">
        <span className="text-sm text-neutral-700"><strong>{readyAll}</strong> ready to send · <strong>{reviewAll}</strong> to review <span className="text-neutral-400">(across outbound + nurture)</span></span>
        <form action={sendBatchAction} className="ml-auto flex items-center gap-2">
          <input name="batch" type="number" defaultValue={50} className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm" />
          <PendingButton className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50" pendingLabel="Sending…" disabled={readyAll === 0}>
            {dry ? "Send batch (dry)" : "Send batch"}
          </PendingButton>
        </form>
      </div>

      <PageTabs tabs={wfTabs} />

      {/* ───────────── Outbound tab ───────────── */}
      {tab === "outbound" && (
        <form action={draftRunAction} className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-4">
          <div className="sm:col-span-4">
            <h2 className="text-sm font-semibold text-neutral-800">Draft an outbound run</h2>
            <p className="text-xs text-neutral-500">Research + hyper-personalise one email per contact in a segment, tied to a single inspiring CC page.</p>
          </div>
          <div>
            <label className={lbl}>Segment</label>
            <select name="segment_kind" className={field} defaultValue="new_leads">
              <option value="new_leads">New leads</option>
              <option value="all">All with email</option>
              <option value="source">By lead source…</option>
              {hsLists.length > 0 && (
                <optgroup label="HubSpot lists">
                  {hsLists.map((l) => <option key={l.id} value={`list:${l.id}`}>{l.name}{l.size != null ? ` (${l.size})` : ""}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <div>
            <label className={lbl}>Source (if by source)</label>
            <input name="source" placeholder="whitepaper" className={field} />
          </div>
          <div>
            <label className={lbl}>How many (max 6 here)</label>
            <input name="limit" type="number" min="1" max="6" defaultValue={3} className={field} />
          </div>
          <div>
            <label className={lbl}>Campaign</label>
            <input name="campaign" placeholder="auto" className={field} />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="auto_send" defaultChecked /> Auto-approve high-confidence drafts</label>
          <div className="sm:col-span-2 sm:text-right">
            <PendingButton className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50" pendingLabel="Researching + drafting…" disabled={!hubspotEnabled()}>
              Draft run
            </PendingButton>
          </div>
          <p className="text-xs text-neutral-500 sm:col-span-4">
            Researches + drafts each contact (slow). For bigger batches: <code>npm run workflow -- &lt;segment&gt; --limit=N</code>.
            {hubspotEnabled() && hsLists.length === 0 && <span className="text-amber-700"> · No HubSpot lists shown — add the <code>crm.lists.read</code> scope to the Service Key to target saved segments.</span>}
          </p>
        </form>
      )}

      {/* ───────────── Nurture tab ───────────── */}
      {tab === "nurture" && (
        <form action={nurtureRunAction} className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <div className="w-full">
            <h2 className="text-sm font-semibold text-neutral-800">Nurture your open deals</h2>
            <p className="text-xs text-neutral-500">Appraise each open deal (MEDDICC) → draft a next-step nudge. Deals contacted this week are skipped.</p>
          </div>
          <div>
            <label className={lbl}>How many (max 6)</label>
            <input name="limit" type="number" min="1" max="6" defaultValue={3} className="w-28 rounded border border-neutral-300 px-2 py-1.5 text-sm" />
          </div>
          <PendingButton className="rounded bg-neutral-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50" pendingLabel="Appraising + drafting…" disabled={!hubspotEnabled()}>
            Nurture deals
          </PendingButton>
          <p className="w-full text-xs text-neutral-500">Bigger weekly run: <code>npm run nurture -- --limit=20</code>.</p>
        </form>
      )}

      {/* To review */}
      <h2 className="mb-2 text-sm font-semibold text-neutral-700">To review <span className="text-neutral-400">({toReview.length})</span></h2>
      {toReview.length === 0 ? <p className="mb-6 text-sm text-neutral-500">Nothing to review on this tab. Draft a run above.</p> : (
        <div className="mb-8 space-y-2">
          {toReview.map((r) => <DraftCard key={r.id} r={r} editable />)}
        </div>
      )}

      {/* Ready to send */}
      {ready.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-neutral-700">Ready to send <span className="text-neutral-400">({ready.length})</span></h2>
          <div className="mb-8 space-y-2">{ready.map((r) => <DraftCard key={r.id} r={r} editable />)}</div>
        </>
      )}

      {/* Recently sent */}
      {sent.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-neutral-700">Recently sent</h2>
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
            <tbody>
              {sent.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100">
                  <td className="py-1.5 font-medium text-neutral-700">{r.meta?.contact_name ?? r.email}</td>
                  <td className="text-neutral-600">{r.subject}</td>
                  <td className="text-right text-xs text-neutral-500">{r.clicked ? "clicked " : ""}{r.replied ? "replied " : ""}{r.bounced ? "bounced " : ""}{r.sent_at ? fmtDateTime(r.sent_at) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}
    </main>
  );
}

function DraftCard({ r, editable }: { r: Row; editable?: boolean }) {
  const name = r.meta?.contact_name ?? r.email;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-4 py-2">
        <span className="font-medium text-neutral-800">{name}</span>
        <span className="text-xs text-neutral-400">{r.email}</span>
        {confBadge(r.meta?.confidence)}
        {r.meta?.kind === "deal-nurture" && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-purple-700" title={r.meta.deal_name ?? undefined}>deal{r.meta.stage ? ` · ${r.meta.stage}` : ""}</span>}
        {r.status === "approved" && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-blue-700">approved</span>}
        <div className="ml-auto flex gap-1">
          {r.status === "queued" && (
            <form action={approveDraftAction}><input type="hidden" name="id" value={r.id} />
              <PendingButton className="rounded border border-emerald-300 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50" pendingLabel="…">✓ Approve</PendingButton>
            </form>
          )}
          <form action={discardDraftAction}><input type="hidden" name="id" value={r.id} />
            <PendingButton className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100" pendingLabel="…">Discard</PendingButton>
          </form>
        </div>
      </div>
      <div className="px-4 py-2 text-sm">
        <div className="mb-1 text-neutral-500"><span className="font-medium text-neutral-700">Subject:</span> {r.subject}</div>
        <p className="whitespace-pre-wrap text-neutral-700">{r.body_text}</p>
        {r.meta?.page_title && <p className="mt-2 text-xs text-neutral-400">↳ links: {r.meta.page_title} · {r.meta.page_url}</p>}
        {r.meta?.angle && <p className="mt-0.5 text-xs text-neutral-400">↳ angle: {r.meta.angle}</p>}
        {editable && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-blue-700">Edit</summary>
            <form action={editDraftAction} className="mt-2 space-y-2">
              <input type="hidden" name="id" value={r.id} />
              <input name="subject" defaultValue={r.subject ?? ""} className={field} />
              <textarea name="body_text" defaultValue={r.body_text ?? ""} rows={7} className={`${field} font-mono`} />
              <PendingButton className="rounded bg-neutral-800 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-700" pendingLabel="Saving…">Save edit</PendingButton>
            </form>
          </details>
        )}
      </div>
    </div>
  );
}
