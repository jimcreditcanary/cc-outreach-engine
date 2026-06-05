import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { currentUser } from "@/lib/auth/server";
import { generateBriefAction, updateMeetingAction, deleteMeetingAction, setSalesRelevantAction, saveTranscriptAction, generatePostSummaryAction, addAttendeeToCrmAction } from "../actions";
import { PendingButton } from "@/components/PendingButton";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { Combobox } from "@/components/Combobox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";
// Inline-duplicated SECTORS — see /companies, /linkedin which do the same.
// Worth a future cleanup into a central const.
const SECTORS = ["bank", "broker", "building_society", "credit_union", "direct_lender", "marketplace", "sme_lender", "utility"];

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

  // Pre-load orgs for the per-attendee "Add to CRM" Combobox. One round trip
  // even if there are many attendees; bounded at 2000.
  const { data: orgsData } = await db
    .from("organisations")
    .select("id, name")
    .order("name")
    .limit(2000);
  const orgOptions = ((orgsData ?? []) as { id: string; name: string | null }[])
    .map((o) => ({ id: o.id, label: o.name ?? "(unnamed)" }));

  // Team-member detection — collect every email that belongs to one of our
  // operators (auth.users + user_settings.reply_to_email + from_email).
  // Used to render a muted "team" chip for those attendees instead of an
  // "Add to CRM" button, since they're already operators, not prospects.
  const teamEmails = new Set<string>();
  try {
    const { adminClient } = await import("@/lib/auth/admin");
    const { data: usersRes } = await adminClient().auth.admin.listUsers({ page: 1, perPage: 100 });
    for (const u of usersRes?.users ?? []) if (u.email) teamEmails.add(u.email.toLowerCase());
    const { data: settings } = await db.from("user_settings").select("reply_to_email, from_email");
    for (const s of (settings ?? []) as { reply_to_email: string | null; from_email: string | null }[]) {
      if (s.reply_to_email) teamEmails.add(s.reply_to_email.toLowerCase());
      // from_email looks like "Name <addr>" — strip to bare addr
      const m = (s.from_email ?? "").match(/<([^>]+)>/);
      const fromAddr = (m?.[1] ?? s.from_email ?? "").trim().toLowerCase();
      if (fromAddr.includes("@")) teamEmails.add(fromAddr);
    }
  } catch { /* best-effort */ }

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

          {/* Granola is OFF for non-sales meetings. Surface that here so
              Jim doesn't wait for a transcript that will never come. */}
          {!m.sales_relevant && (
            <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500">
              <strong>Non-sales meeting</strong> — Granola sync is off and no follow-up will be sent. Hit
              &quot;Mark sales-relevant&quot; on the right to flip it on.
            </section>
          )}

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
            <ul className="divide-y divide-neutral-100">
              {attendees.map((a, i) => {
                const email = (a.email ?? "").toLowerCase();
                const isTeam = !!email && teamEmails.has(email);
                const isInCrm = !!a.contact_id;
                const initial = (a.name ?? a.email ?? "?").trim().charAt(0).toUpperCase();
                return (
                  <li key={i} className="py-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      {/* Avatar bubble — colour codes the row: emerald for
                          team, blue for in-CRM, grey for unknown. Quick scan. */}
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${
                          isTeam ? "bg-emerald-100 text-emerald-700"
                          : isInCrm ? "bg-blue-100 text-blue-700"
                          : "bg-neutral-100 text-neutral-500"
                        }`}
                        aria-hidden
                      >
                        {initial}
                      </span>
                      <div className="min-w-0 flex-1 truncate">
                        {isInCrm ? (
                          <Link href={`/contacts/${a.contact_id}`} className="font-medium text-blue-700 hover:underline">
                            {a.name ?? a.email}
                          </Link>
                        ) : (
                          <span className="font-medium text-neutral-800">{a.name ?? a.email}</span>
                        )}
                        {a.email && a.name && (
                          <span className="ml-1 text-xs text-neutral-400">· {a.email}</span>
                        )}
                      </div>
                      {/* Trailing status: team-chip / opens-contact / add-popup */}
                      {isTeam ? (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">team</span>
                      ) : isInCrm ? (
                        <span className="text-[11px] text-neutral-400">in CRM</span>
                      ) : a.email ? (
                        <details className="relative">
                          <summary className="cursor-pointer list-none rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 [&::-webkit-details-marker]:hidden">
                            + Add to CRM
                          </summary>
                          {/* Inline popup — pre-filled name + email, picker
                              for company (existing OR create with sector).
                              Existing-email contacts get auto-linked rather
                              than duplicated. */}
                          <form action={addAttendeeToCrmAction} className="absolute right-0 z-10 mt-1 w-80 space-y-2 rounded-lg border border-neutral-200 bg-white p-3 text-xs shadow-lg">
                            <input type="hidden" name="meeting_id" value={m.id} />
                            <input type="hidden" name="email" value={a.email} />
                            <div>
                              <label className={lbl}>Full name</label>
                              <input name="full_name" defaultValue={a.name ?? ""} required className={field} />
                            </div>
                            <div>
                              <label className={lbl}>Job title (optional)</label>
                              <input name="job_title" placeholder="e.g. Head of Risk" className={field} />
                            </div>
                            <div className="text-[11px] text-neutral-500">
                              <span className="uppercase tracking-wide text-neutral-400">Email:</span> {a.email}
                            </div>
                            <div>
                              <label className={lbl}>Company (existing)</label>
                              <Combobox name="organisation_id" options={orgOptions} placeholder="Type to search…" />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className={lbl}>…or new company</label>
                                <input name="new_org_name" placeholder="Company name" className={field} />
                              </div>
                              <div>
                                <label className={lbl}>Sector (if new)</label>
                                <select name="sector" defaultValue="" className={field}>
                                  <option value="">—</option>
                                  {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                              </div>
                            </div>
                            <div className="flex justify-end">
                              <PendingButton
                                className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                                pendingLabel="Adding…"
                              >
                                Add contact
                              </PendingButton>
                            </div>
                          </form>
                        </details>
                      ) : null}
                    </div>
                  </li>
                );
              })}
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
