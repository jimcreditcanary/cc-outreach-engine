// Campaigns console (P5 mailer UI). Compose a campaign from a HubSpot segment,
// review the queue, approve, and send a batch — the UI over the same mailer lib
// the CLI uses. Approval-queue-first: queueing never sends; Send only goes out
// on an explicit action, with all guardrails.

import { serviceClient } from "@/lib/db/client";
import { hubspotEnabled } from "@/lib/hubspot/client";
import { isDryRun } from "@/lib/send/postmark";
import { campaignSummaries } from "@/lib/mailer/summary";
import { fmtDateTime } from "@/lib/format/datetime";
import { PendingButton } from "@/components/PendingButton";
import { queueCampaignAction, approveCampaignAction, sendBatchAction, discardQueuedAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

export default async function CampaignsPage() {
  const db = serviceClient();
  const enabled = hubspotEnabled();
  const dry = isDryRun();
  const campaigns = await campaignSummaries(db);
  const totalApproved = campaigns.reduce((n, c) => n + c.approved, 0);

  return (
    <main className="px-4 py-6 md:px-8">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold">Campaigns</h1>
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700">HubSpot</span>
        </div>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${dry ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
          {dry ? "Dry run — sends are simulated (no Postmark token)" : "Live sending enabled"}
        </span>
      </header>

      {!enabled && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Set <code>HUBSPOT_TOKEN</code> to resolve audiences from HubSpot. Existing campaigns still show below.
        </p>
      )}

      {/* New campaign */}
      <form action={queueCampaignAction} className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-2">
        <div>
          <label className={lbl}>Segment</label>
          <select name="segment_kind" className={field} defaultValue="new_leads">
            <option value="new_leads">New leads (hs_lead_status = NEW)</option>
            <option value="all">All contacts with an email</option>
            <option value="source">By lead source…</option>
          </select>
        </div>
        <div>
          <label className={lbl}>Source (if “By lead source”)</label>
          <input name="source" placeholder="whitepaper" className={field} />
        </div>
        <div>
          <label className={lbl}>Campaign name</label>
          <input name="campaign" placeholder="auto: segment-date" className={field} />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={lbl}>Cooldown (days)</label>
            <input name="cooldown" type="number" defaultValue={28} className={field} />
          </div>
          <div className="flex-1">
            <label className={lbl}>Max recipients</label>
            <input name="cap" type="number" defaultValue={2000} className={field} />
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>Subject</label>
          <input name="subject" required placeholder="A note for {{first_name}}" className={field} />
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>Body — supports {"{{first_name}}"} and {"{{company}}"}</label>
          <textarea name="body" required rows={7} placeholder={"Hi {{first_name}},\n\n…\n\nBest,\nJim"} className={`${field} font-mono`} />
        </div>
        <div className="sm:col-span-2">
          <PendingButton className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50" pendingLabel="Queuing…" disabled={!enabled}>
            Queue campaign
          </PendingButton>
          <span className="ml-3 text-xs text-neutral-500">Queues to review — nothing sends until you approve + send.</span>
        </div>
      </form>

      {/* Global send */}
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 p-3">
        <span className="text-sm text-neutral-700"><strong>{totalApproved.toLocaleString()}</strong> approved &amp; ready to send</span>
        <form action={sendBatchAction} className="ml-auto flex items-center gap-2">
          <label className="text-xs text-neutral-500">Batch</label>
          <input name="batch" type="number" defaultValue={50} className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm" />
          <PendingButton className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50" pendingLabel="Sending…" disabled={totalApproved === 0}>
            {dry ? "Send batch (dry run)" : "Send batch"}
          </PendingButton>
        </form>
      </div>

      {/* Campaign list */}
      {campaigns.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-500">No campaigns yet. Queue one above.</p>
      ) : (
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs uppercase text-neutral-400">
            <tr>
              <th className="py-1">Campaign</th>
              <th>Queued</th>
              <th>Approved</th>
              <th>Sent</th>
              <th>Engagement</th>
              <th>Last activity</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.campaign} className="border-t border-neutral-100 align-top hover:bg-neutral-50">
                <td className="py-2 font-medium text-neutral-800">{c.campaign}<div className="text-xs font-normal text-neutral-400">{c.total.toLocaleString()} total{c.suppressed ? ` · ${c.suppressed} suppressed` : ""}{c.failed ? ` · ${c.failed} failed` : ""}</div></td>
                <td>{c.queued.toLocaleString()}</td>
                <td>{c.approved.toLocaleString()}</td>
                <td>{c.sent.toLocaleString()}</td>
                <td className="text-neutral-600">{c.clicked}c · {c.replied}r{c.bounced ? ` · ${c.bounced}b` : ""}</td>
                <td className="text-neutral-500">{c.lastActivity ? fmtDateTime(c.lastActivity) : "—"}</td>
                <td className="w-44 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {c.queued > 0 && (
                      <form action={approveCampaignAction}>
                        <input type="hidden" name="campaign" value={c.campaign} />
                        <PendingButton className="rounded border border-emerald-300 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50" pendingLabel="…" title="Approve all queued in this campaign">✓ Approve {c.queued}</PendingButton>
                      </form>
                    )}
                    {(c.queued > 0 || c.approved > 0) && (
                      <form action={discardQueuedAction}>
                        <input type="hidden" name="campaign" value={c.campaign} />
                        <PendingButton className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100" pendingLabel="…" title="Discard queued/approved (keeps sent history)">Discard</PendingButton>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </main>
  );
}
