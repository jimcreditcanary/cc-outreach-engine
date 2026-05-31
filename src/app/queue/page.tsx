import { serviceClient } from "@/lib/db/client";
import { approveDraft, rejectDraft, updateDraft, regenerateDraft, sendDraftNow } from "../actions";
import { PendingButton } from "@/components/PendingButton";

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

export default async function QueuePage() {
  const db = serviceClient();
  const [{ data }, { data: recentData }] = await Promise.all([
    db
      .from("sends")
      .select("id, subject, body_text, angle, contact:contacts(full_name, email, organisation:organisations(name, sector))")
      .eq("status", "queued")
      .order("ts", { ascending: false }),
    // Recently-acted-on: approved (awaiting send) + sent + suppressed/failed.
    db
      .from("sends")
      .select("id, subject, status, ts, contact:contacts(id, full_name, email)")
      .in("status", ["approved", "sent", "suppressed", "failed"])
      .order("ts", { ascending: false })
      .limit(30),
  ]);
  const drafts = (data ?? []) as unknown as Draft[];
  const recent = (recentData ?? []) as unknown as Array<{ id: string; subject: string | null; status: string; ts: string; contact: { id: string; full_name: string | null; email: string | null } | null }>;

  return (
    <main className="px-8 py-6">
      <header className="mb-6 flex items-baseline justify-between border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Approval queue</h1>
        <span className="text-sm text-neutral-500">{drafts.length} draft{drafts.length === 1 ? "" : "s"}</span>
      </header>

      {drafts.length === 0 ? (
        <p className="text-neutral-500">
          Nothing to review. Generate drafts with <code className="rounded bg-neutral-200 px-1">npm run generate</code>.
        </p>
      ) : (
        <ul className="space-y-5">
          {drafts.map((d) => {
            const org = d.contact?.organisation;
            return (
              <li key={d.id} className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="mb-1 flex flex-wrap items-center gap-x-2 text-sm text-neutral-500">
                  <span className="font-medium text-neutral-800">{d.contact?.full_name ?? "—"}</span>
                  <span>&lt;{d.contact?.email ?? "?"}&gt;</span>
                  {org?.name && (
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5">
                      {org.name}
                      {org.sector ? ` · ${org.sector}` : ""}
                    </span>
                  )}
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
                    <button
                      formAction={rejectDraft}
                      className="rounded border border-red-300 px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      Reject
                    </button>
                  </div>
                </form>
              </li>
            );
          })}
        </ul>
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
          <ul className="space-y-1 text-sm">
            {recent.map((r) => {
              const colour =
                r.status === "sent" ? "bg-emerald-100 text-emerald-800" :
                r.status === "approved" ? "bg-amber-100 text-amber-800" :
                r.status === "failed" ? "bg-red-100 text-red-700" :
                "bg-neutral-200 text-neutral-700";
              return (
                <li key={r.id} className="flex items-center gap-2 border-b border-neutral-100 py-1">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${colour}`}>{r.status}</span>
                  <span className="font-medium">{r.contact?.full_name ?? "?"}</span>
                  <span className="text-neutral-500">&lt;{r.contact?.email ?? "?"}&gt;</span>
                  <span className="text-neutral-700">— {r.subject ?? ""}</span>
                  <span className="ml-auto text-xs text-neutral-400">{new Date(r.ts).toLocaleString("en-GB")}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
