import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { currentUser } from "@/lib/auth/server";
import { generateBriefAction, updateMeetingAction, deleteMeetingAction, setSalesRelevantAction, saveTranscriptAction, generatePostSummaryAction } from "../actions";
import { PendingButton } from "@/components/PendingButton";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { Combobox } from "@/components/Combobox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

export default async function MeetingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = serviceClient();
  const { data: m } = await db.from("meetings").select("*, organisation:organisations(id, name), primary_contact:contacts(id, full_name), deal:deals(id, title)").eq("id", id).maybeSingle();
  // Separate lookup so the page still loads if migration 031 (granola_*
  // columns) hasn't run yet — m just won't have granola_followup_send_id
  // and this query will skip cleanly.
  type GranolaFollowup = { id: string; subject: string | null; status: string; ts: string };
  let granolaFollowup: GranolaFollowup | null = null;
  const followupId = (m && (m as { granola_followup_send_id?: string | null }).granola_followup_send_id) || null;
  if (followupId) {
    const { data: f } = await db.from("sends").select("id, subject, status, ts").eq("id", followupId).maybeSingle();
    granolaFollowup = (f as GranolaFollowup | null);
  }
  if (!m) notFound();

  // Soft per-user fence: a user can still load any meeting by direct URL
  // (handy when sharing links across the team), but if it's not theirs we
  // flag it so they know they're looking at someone else's calendar.
  const meUser = await currentUser();
  const notMine = meUser && m.owner_id && m.owner_id !== meUser.id;

  const [{ data: orgs }, { data: orgContacts }, { data: orgDeals }] = await Promise.all([
    db.from("organisations").select("id, name").order("name").limit(1000),
    m.organisation_id ? db.from("contacts").select("id, full_name").eq("organisation_id", m.organisation_id).order("full_name") : Promise.resolve({ data: [] }),
    m.organisation_id ? db.from("deals").select("id, title, status").eq("organisation_id", m.organisation_id).order("status") : Promise.resolve({ data: [] }),
  ]);

  const attendees = (m.attendees ?? []) as { name: string | null; email: string | null; response: string | null; contact_id: string | null }[];
  const start = new Date(m.start_at);
  const end = m.end_at ? new Date(m.end_at) : null;

  return (
    <main className="px-8 py-6">
      <Link href="/meetings" className="text-sm text-blue-700 hover:underline">← Meetings</Link>
      {notMine && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ⚠ This meeting is on someone else&apos;s calendar. You can read it but the brief, notes and transcript belong to its owner.
        </div>
      )}
      <header className="mb-4 mt-2 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">{m.subject ?? "(no subject)"}</h1>
        <p className="text-sm text-neutral-500">
          {start.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          {end && ` → ${end.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}
          {m.location && ` · ${m.location}`}
          {m.online_url && (
            <> · <a href={m.online_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">join Teams</a></>
          )}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        {/* LEFT: brief + notes */}
        <div className="space-y-6">
          <section>
            <div className="mb-2 flex items-center gap-3">
              <h2 className="font-semibold">AI prep brief</h2>
              <form action={generateBriefAction}>
                <input type="hidden" name="id" value={m.id} />
                <PendingButton className="rounded border border-neutral-300 px-2 py-0.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100" pendingLabel="Prepping…">
                  {m.brief ? "Regenerate" : "✨ Generate brief"}
                </PendingButton>
              </form>
              {m.brief_generated_at && <span className="text-xs text-neutral-400">{new Date(m.brief_generated_at).toLocaleString("en-GB")}</span>}
            </div>
            {m.brief ? (
              <pre className="whitespace-pre-wrap break-words rounded-lg border border-amber-200 bg-amber-50/40 p-4 font-sans text-sm text-amber-900">{m.brief}</pre>
            ) : (
              <p className="rounded border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
                No brief yet. Hit Generate to get target questions + watch-outs based on the contact, MEDDICC gaps and recent activity.
              </p>
            )}
          </section>

          <section>
            <h2 className="mb-2 font-semibold">Post-meeting notes</h2>
            <form action={updateMeetingAction}>
              <input type="hidden" name="id" value={m.id} />
              <input type="hidden" name="organisation_id" value={m.organisation_id ?? ""} />
              <input type="hidden" name="primary_contact_id" value={m.primary_contact_id ?? ""} />
              <input type="hidden" name="deal_id" value={m.deal_id ?? ""} />
              <textarea name="notes" defaultValue={m.notes ?? ""} rows={8} className={field} placeholder="What was said, decisions, action items…" />
              <div className="mt-2">
                <PendingButton className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" pendingLabel="Saving…">
                  Save notes
                </PendingButton>
              </div>
            </form>
          </section>

          {/* Granola sync banner — shows when a transcript was pulled
              automatically and when/where the follow-up email landed. */}
          {(m.granola_synced_at || granolaFollowup) && (
            <section className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="rounded bg-blue-200 px-1.5 py-0.5 text-xs font-semibold text-blue-900">Granola</span>
                {m.granola_synced_at && (
                  <span className="text-xs text-blue-900">
                    Transcript pulled {new Date(m.granola_synced_at).toLocaleString("en-GB")}
                  </span>
                )}
                {(() => {
                  const f = granolaFollowup;
                  if (!f) return null;
                  return (
                    <span className="ml-auto text-xs">
                      Follow-up email{" "}
                      <span className={`rounded px-1.5 py-0.5 font-medium ${f.status === "sent" ? "bg-emerald-100 text-emerald-800" : f.status === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
                        {f.status}
                      </span>
                      {f.status === "sent" && f.ts && (
                        <span className="ml-1 text-blue-900">at {new Date(f.ts).toLocaleString("en-GB")}</span>
                      )}
                      {" — "}
                      <span className="italic">{f.subject}</span>
                    </span>
                  );
                })()}
              </div>
            </section>
          )}

          {/* Transcript + AI post-meeting summary */}
          <section>
            <div className="mb-2 flex items-center gap-3">
              <h2 className="font-semibold">Transcript → AI summary</h2>
              <span className="text-xs text-neutral-400">
                Granola fills this automatically if you&apos;ve connected it under <a href="/settings" className="text-blue-700 hover:underline">Settings</a>.
                Otherwise paste a transcript (or rough notes) and let the AI write the summary.
              </span>
            </div>
            <form action={generatePostSummaryAction} className="space-y-2">
              <input type="hidden" name="id" value={m.id} />
              <textarea
                name="transcript"
                defaultValue={m.transcript ?? ""}
                rows={10}
                className={`${field} font-mono text-xs`}
                placeholder={"Paste the Teams / Zoom / Otter transcript here, or rough notes if no transcript.\n\nThe AI will produce a structured post-meeting summary and (if a deal is linked) re-seed MEDDICC from the new context."}
              />
              <div className="flex flex-wrap gap-2">
                <PendingButton
                  formAction={saveTranscriptAction}
                  className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
                  pendingLabel="Saving…"
                >
                  Save transcript
                </PendingButton>
                <PendingButton
                  className="rounded bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800"
                  pendingLabel="Summarising + re-seeding MEDDICC…"
                >
                  ✨ {m.post_summary ? "Regenerate summary" : "Generate summary"}
                </PendingButton>
                {m.post_summary_generated_at && (
                  <span className="self-center text-xs text-neutral-400">
                    Last: {new Date(m.post_summary_generated_at).toLocaleString("en-GB")}
                  </span>
                )}
              </div>
            </form>
            {m.post_summary && (
              <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 font-sans text-sm text-emerald-900">{m.post_summary}</pre>
            )}
          </section>
        </div>

        {/* RIGHT: linkage + attendees */}
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 font-semibold">CRM linkage</h2>
            <form action={updateMeetingAction} className="space-y-2">
              <input type="hidden" name="id" value={m.id} />
              <input type="hidden" name="notes" value={m.notes ?? ""} />
              <div>
                <label className={lbl}>Company</label>
                <Combobox
                  name="organisation_id"
                  defaultValue={m.organisation_id ?? ""}
                  options={(orgs ?? []).map((o) => ({ id: o.id, label: o.name ?? "(unnamed)" }))}
                  placeholder="Type to search companies…"
                />
              </div>
              <div>
                <label className={lbl}>Primary contact</label>
                <Combobox
                  name="primary_contact_id"
                  defaultValue={m.primary_contact_id ?? ""}
                  options={(orgContacts ?? []).map((c) => ({ id: c.id, label: c.full_name ?? "(unnamed)" }))}
                  placeholder="Type to search contacts…"
                />
              </div>
              <div>
                <label className={lbl}>Deal</label>
                <Combobox
                  name="deal_id"
                  defaultValue={m.deal_id ?? ""}
                  options={(orgDeals ?? []).map((d) => ({ id: d.id, label: d.title ?? "(untitled)", sublabel: d.status }))}
                  placeholder="Type to search deals…"
                />
              </div>
              <PendingButton className="rounded bg-neutral-700 px-3 py-1 text-sm font-medium text-white hover:bg-neutral-800" pendingLabel="Saving…">
                Save linkage
              </PendingButton>
            </form>
          </section>

          <section>
            <h2 className="mb-2 font-semibold">Attendees ({attendees.length})</h2>
            <ul className="space-y-1 text-sm">
              {attendees.map((a, i) => (
                <li key={i} className="text-neutral-700">
                  {a.contact_id ? (
                    <Link href={`/contacts/${a.contact_id}`} className="text-blue-700 hover:underline">{a.name ?? a.email}</Link>
                  ) : (
                    <span>{a.name ?? a.email}</span>
                  )}
                  {a.email && a.name && <span className="text-xs text-neutral-400"> · {a.email}</span>}
                  {!a.contact_id && a.email && <span className="ml-1 text-xs text-neutral-400">(not in CRM)</span>}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 font-semibold">Actions</h2>
            <div className="space-y-2 text-sm">
              <form action={setSalesRelevantAction}>
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="relevant" value={m.sales_relevant ? "false" : "true"} />
                <PendingButton className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100" pendingLabel="…">
                  {m.sales_relevant ? "Mark non-sales (hide)" : "Mark sales-relevant"}
                </PendingButton>
              </form>
              <form action={deleteMeetingAction}>
                <input type="hidden" name="id" value={m.id} />
                <ConfirmSubmit
                  formAction={deleteMeetingAction}
                  className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                  message={`Delete this meeting record? (Won't touch Outlook.)`}
                >
                  Delete
                </ConfirmSubmit>
              </form>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
