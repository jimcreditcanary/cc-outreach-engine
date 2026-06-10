import { serviceClient } from "@/lib/db/client";
import { approveDraft, rejectDraft, updateDraft, regenerateDraft, sendDraftNow, bulkApproveDrafts } from "../actions";
import { PendingButton } from "@/components/PendingButton";
import { OwnerFilter } from "@/components/OwnerFilter";
import { resolveOwnerFilter } from "@/lib/auth/owner";
import { BulkApproveBar } from "./BulkApproveBar";
import { SectorBadge } from "@/components/SectorBadge";

export const dynamic = "force-dynamic";
// Regenerate + Send-now invoke Claude / Postmark — give them runway.
export const maxDuration = 60;

// Curated, specific reasons — each is actionable feedback for the voice loop.
const REJECT_REASONS = [
  "Doesn't sound like me / too AI",
  "Wrong or weak angle",
  "Not relevant to this person",
  "Too salesy / pushy",
  "Weak or missing link / CTA",
  "Factually wrong or risky claim",
  "Bad timing",
  "Other (see note)",
];

interface Draft {
  id: string;
  subject: string | null;
  body_text: string | null;
  angle: string | null;
  contact: {
    full_name: string | null;
    email: string | null;
    organisation: { name: string | null; sector: string | null } | null;
  } | null;
}

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const { owner } = await searchParams;
  const db = serviceClient();
  const ownerId = await resolveOwnerFilter(owner);
  let q1 = db
    .from("sends")
    .select("id, subject, body_text, angle, contact:contacts(full_name, email, organisation:organisations(name, sector))")
    .eq("status", "queued")
    .order("ts", { ascending: false });
  let q2 = db
    .from("sends")
    // body_text included so the recent activity rows can expand inline
    // and show what actually went out — no extra round-trip per click.
    .select("id, subject, status, ts, body_text, contact:contacts(id, full_name, email)")
    .in("status", ["approved", "sent", "suppressed", "failed"])
    .order("ts", { ascending: false })
    .limit(30);
  if (ownerId) {
    q1 = q1.eq("owner_id", ownerId);
    q2 = q2.eq("owner_id", ownerId);
  }
  const [{ data }, { data: recentData }] = await Promise.all([q1, q2]);
  const drafts = (data ?? []) as unknown as Draft[];
  const recent = (recentData ?? []) as unknown as Array<{ id: string; subject: string | null; status: string; ts: string; body_text: string | null; contact: { id: string; full_name: string | null; email: string | null } | null }>;

  // Cross-owner peek: if my filter is empty, count drafts that exist
  // under other owners so we can tell the operator they're hiding behind
  // a filter, not actually missing. Skipped when filter is already "all".
  let elsewhereCount = 0;
  if (ownerId && drafts.length === 0) {
    const { count } = await serviceClient()
      .from("sends")
      .select("*", { count: "exact", head: true })
      .eq("status", "queued")
      .neq("owner_id", ownerId);
    elsewhereCount = count ?? 0;
  }

  return (
    <main className="px-8 py-6">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Approval queue</h1>
        <OwnerFilter current={owner} pathname="/queue" />
        <span className="text-sm text-neutral-500">{drafts.length} draft{drafts.length === 1 ? "" : "s"}</span>
      </header>

      {drafts.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
          <p>Nothing in your queue to review.</p>
          <p className="mt-2 text-xs text-neutral-500">
            Drafts arrive here automatically — either from{" "}
            <a href="/sequences" className="text-blue-700 hover:underline">an active sequence</a>{" "}
            (review-mode steps) or the daily cron at 06:30 UTC. Hit{" "}
            <strong>Check for due actions</strong> on /sequences if you just added contacts and don&apos;t want to wait.
          </p>
          {elsewhereCount > 0 && (
            <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              ⚠ {elsewhereCount} draft{elsewhereCount === 1 ? "" : "s"} waiting under another operator&apos;s filter. Switch{" "}
              <strong>Owner → All users</strong> at the top of this page to see them.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Bulk-approve outbox — checkboxes inside each draft card POST to
              this form via HTML form="bulk-approve" association, so per-draft
              edit forms keep working independently. */}
          <form id="bulk-approve" action={bulkApproveDrafts} className="hidden" aria-hidden />
          <BulkApproveBar total={drafts.length} />

        <ul className="space-y-5">
          {drafts.map((d) => {
            const org = d.contact?.organisation;
            return (
              <li key={d.id} className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="mb-1 flex flex-wrap items-center gap-x-2 text-sm text-neutral-500">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="draft_id" value={d.id} form="bulk-approve" className="h-4 w-4" />
                  </label>
                  <span className="font-medium text-neutral-800">{d.contact?.full_name ?? "—"}</span>
                  <span>&lt;{d.contact?.email ?? "?"}&gt;</span>
                  {org?.name && (
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5">{org.name}</span>
                  )}
                  <SectorBadge sector={org?.sector} />
                </div>
                {d.angle && <p className="mb-2 text-xs uppercase tracking-wide text-amber-700">{d.angle}</p>}
                <form action={updateDraft} className="space-y-2">
                  <input type="hidden" name="id" value={d.id} />
                  <input
                    name="subject"
                    defaultValue={d.subject ?? ""}
                    className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm font-semibold"
                  />
                  <textarea
                    name="body_text"
                    defaultValue={d.body_text ?? ""}
                    rows={14}
                    className="w-full rounded border border-neutral-300 px-2 py-1.5 font-sans text-sm leading-relaxed text-neutral-700"
                  />
                  <div className="flex flex-wrap gap-2">
                    <PendingButton
                      formAction={sendDraftNow}
                      className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                      pendingLabel="Sending…"
                    >
                      Save &amp; send now
                    </PendingButton>
                    <PendingButton
                      formAction={approveDraft}
                      className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                      pendingLabel="Approving…"
                    >
                      Save &amp; approve (cron sends)
                    </PendingButton>
                    <PendingButton
                      formAction={updateDraft}
                      className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
                      pendingLabel="Saving…"
                    >
                      Save
                    </PendingButton>
                    <PendingButton
                      formAction={regenerateDraft}
                      className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
                      pendingLabel="Regenerating…"
                      title="Re-run the AI with the current prompt (replaces this draft)"
                    >
                      ↻ Regenerate
                    </PendingButton>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2 rounded border border-neutral-200 bg-neutral-50 p-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">Reject — why?</span>
                    <select name="reason" defaultValue={REJECT_REASONS[0]} className="rounded border border-neutral-300 px-2 py-1 text-sm">
                      {REJECT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <input
                      name="note"
                      placeholder="what specifically? (helps it learn)"
                      className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
                    />
                    <PendingButton
                      formAction={rejectDraft}
                      className="rounded border border-red-300 px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50"
                      pendingLabel="Rejecting…"
                    >
                      Reject
                    </PendingButton>
                  </div>
                </form>
              </li>
            );
          })}
        </ul>
        </>
      )}

      {recent.length > 0 && (
        <section className="mt-10 border-t border-neutral-200 pt-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Recent activity ({recent.length})
          </h2>
          <p className="mb-3 text-xs text-neutral-400">
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">approved</span> means it&apos;ll go on the next cron run (or click &ldquo;Send now&rdquo;).{" "}
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">sent</span> has actually left.
          </p>
          <ul className="divide-y divide-neutral-100 text-sm">
            {recent.map((r) => {
              const colour =
                r.status === "sent" ? "bg-emerald-100 text-emerald-800" :
                r.status === "approved" ? "bg-amber-100 text-amber-800" :
                r.status === "failed" ? "bg-red-100 text-red-700" :
                "bg-neutral-200 text-neutral-700";
              return (
                <li key={r.id}>
                  <details className="group">
                    <summary className="flex cursor-pointer items-center gap-2 py-1 list-none [&::-webkit-details-marker]:hidden">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${colour}`}>{r.status}</span>
                      <span className="font-medium">{r.contact?.full_name ?? "?"}</span>
                      <span className="text-neutral-500">&lt;{r.contact?.email ?? "?"}&gt;</span>
                      <span className="text-neutral-700">— {r.subject ?? ""}</span>
                      <span className="ml-auto text-xs text-neutral-400">{new Date(r.ts).toLocaleString("en-GB")}</span>
                      <span className="text-neutral-300 group-open:hidden">▸</span>
                      <span className="hidden text-neutral-300 group-open:inline">▾</span>
                    </summary>
                    <div className="my-2 ml-1 rounded border border-neutral-200 bg-neutral-50 p-3 text-xs">
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                        To {r.contact?.email ?? "?"}  ·  {r.subject ?? "(no subject)"}
                      </div>
                      {r.body_text ? (
                        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-sm text-neutral-800">
                          {r.body_text}
                        </pre>
                      ) : (
                        <p className="italic text-neutral-400">(body not captured for this send)</p>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
