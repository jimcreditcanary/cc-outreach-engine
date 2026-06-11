import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import {
  setSequenceStatusAction,
  setSequenceAutoSendAction,
  deleteSequenceAction,
  addContactsToSequenceAction,
  removeContactFromSequenceAction,
  markActionDoneAction,
  skipActionAction,
  updateSequenceMetaAction,
} from "../actions";
import { PendingButton } from "@/components/PendingButton";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { RowIconAction } from "@/components/RowIconAction";
import { Combobox } from "@/components/Combobox";
import { SEQUENCE_STEPS, STEP_BADGE, isEmailStep, type StepKind } from "@/lib/sequences/steps";
import { currentUserId } from "@/lib/auth/owner";
import { fmtDate } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";

interface SeqContact {
  contact_id: string;
  current_step: number;
  started_at: string;
  status: string;
  contact: {
    id: string;
    full_name: string | null;
    email: string | null;
    job_title: string | null;
    organisation: { id: string; name: string | null } | null;
  } | null;
}

interface ActionRow {
  id: string;
  contact_id: string;
  step_index: number;
  kind: string;
  due_at: string;
  status: string;
  send_id: string | null;
}

export default async function SequenceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = serviceClient();
  const me = await currentUserId();
  const { data: seq } = await db.from("sequences").select("*").eq("id", id).maybeSingle();
  if (!seq) notFound();

  // Picker source = the operator's own contacts (rule 1: only your own).
  // Then we exclude anyone already in any LIVE sequence (rule 2).
  // Skipped contacts (contacts.skipped_at IS NOT NULL) are hidden from
  // the picker — operator already said "no" once, don't surface them again.
  // Reversible from the contact page.
  let pickerQ = db.from("contacts").select("id, full_name, email, organisation:organisations(name)").is("skipped_at", null).order("full_name").limit(5000);
  if (me) pickerQ = pickerQ.eq("owner_id", me);

  const [{ data: contactsData }, { data: actionsData }, { data: allContacts }, { data: lockedRows }, { data: conferencesData }, { data: sampleData }] = await Promise.all([
    db
      .from("sequence_contacts")
      .select(`
        contact_id, current_step, started_at, status,
        contact:contacts(id, full_name, email, job_title, organisation:organisations(id, name))
      `)
      .eq("sequence_id", id)
      .order("started_at", { ascending: false })
      .limit(2000),
    db
      .from("sequence_actions")
      .select("id, contact_id, step_index, kind, due_at, status, send_id")
      .eq("sequence_id", id)
      .eq("status", "pending")
      .order("due_at", { ascending: true })
      .limit(2000),
    pickerQ,
    // Contacts already enrolled in any LIVE sequence (excluding this one)
    // — we filter them out of the picker so nobody runs through two
    // sequences at the same time.
    db
      .from("sequence_contacts")
      .select("contact_id, sequence:sequences!inner(id, status)")
      .eq("sequence.status", "live")
      .neq("sequence_id", id)
      .limit(50000),
    db.from("conferences").select("id, name").order("start_date", { ascending: false, nullsFirst: false }).limit(500),
    // Most recent draft per step kind in this sequence — surfaced inside
    // the cadence cards so the operator can SEE the actual AI output rather
    // than guess from a label.
    db
      .from("sequence_actions")
      .select("kind, created_at, send:sends(subject, body_text, status, contact:contacts(full_name, organisation:organisations(name)))")
      .eq("sequence_id", id)
      .not("send_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const contacts = (contactsData ?? []) as unknown as SeqContact[];
  const actions = (actionsData ?? []) as ActionRow[];
  const conferences = (conferencesData ?? []) as { id: string; name: string }[];
  const lockedSet = new Set(((lockedRows ?? []) as { contact_id: string }[]).map((r) => r.contact_id));

  // Build the "latest sample per step-kind" map for the cadence preview.
  type SampleSend = {
    subject: string | null;
    body_text: string | null;
    status: string | null;
    contact: { full_name: string | null; organisation: { name: string | null } | { name: string | null }[] | null } | { full_name: string | null; organisation: { name: string | null } | { name: string | null }[] | null }[] | null;
  };
  type SampleRow = { kind: string; send: SampleSend | SampleSend[] | null };
  const sampleByKind = new Map<string, { subject: string | null; body_text: string | null; status: string | null; recipient: string | null }>();
  for (const row of (sampleData ?? []) as SampleRow[]) {
    const s = Array.isArray(row.send) ? row.send[0] : row.send;
    if (!s || sampleByKind.has(row.kind)) continue;
    const ct = Array.isArray(s.contact) ? s.contact[0] : s.contact;
    const org = ct ? (Array.isArray(ct.organisation) ? ct.organisation[0] : ct.organisation) : null;
    const recipient = ct?.full_name ? `${ct.full_name}${org?.name ? ` (${org.name})` : ""}` : null;
    sampleByKind.set(row.kind, { subject: s.subject, body_text: s.body_text, status: s.status, recipient });
  }

  const totalContacts = contacts.length;
  const replied = contacts.filter((c) => c.status === "replied").length;
  const completed = contacts.filter((c) => c.status === "completed").length;
  const pendingActions = actions.length;

  // Group pending actions by contact for the per-contact action list.
  const actionsByContact = new Map<string, ActionRow[]>();
  for (const a of actions) {
    const arr = actionsByContact.get(a.contact_id) ?? [];
    arr.push(a);
    actionsByContact.set(a.contact_id, arr);
  }

  // Build the contact-picker options. Exclude contacts already in THIS
  // sequence (rule, obvious) AND anyone already enrolled in another live
  // sequence (lockedSet).
  const inSequence = new Set(contacts.map((c) => c.contact_id));
  type AllContact = { id: string; full_name: string | null; email: string | null; organisation: { name: string | null } | null | { name: string | null }[] };
  const pickOptions = ((allContacts ?? []) as unknown as AllContact[])
    .filter((c) => !inSequence.has(c.id) && !lockedSet.has(c.id))
    .map((c) => {
      const org = Array.isArray(c.organisation) ? c.organisation[0] : c.organisation;
      return {
        id: c.id,
        label: c.full_name ?? c.email ?? "(unnamed)",
        sublabel: org?.name ? `${org.name}${c.email ? ` · ${c.email}` : ""}` : c.email ?? undefined,
      };
    });

  const STATUS_COLOR: Record<string, string> = {
    live: "bg-emerald-100 text-emerald-800",
    paused: "bg-amber-100 text-amber-800",
    complete: "bg-neutral-200 text-neutral-700",
  };

  return (
    <main className="px-8 py-6">
      <Link href="/sequences" className="text-sm text-blue-700 hover:underline">← Sequences</Link>
      <header className="mb-4 mt-2 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <div>
          <h1 className="text-xl font-semibold">{seq.name}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            <span className={`mr-2 rounded px-1.5 py-0.5 text-xs ${STATUS_COLOR[seq.status] ?? "bg-neutral-100"}`}>{seq.status}</span>
            <span className={`mr-2 rounded px-1.5 py-0.5 text-xs ${seq.auto_send ? "bg-blue-100 text-blue-800" : "bg-neutral-200 text-neutral-700"}`}>
              {seq.auto_send ? "auto-send" : "review first"}
            </span>
            {totalContacts} contact{totalContacts === 1 ? "" : "s"} · {replied} replied · {pendingActions} outstanding action{pendingActions === 1 ? "" : "s"} · {completed} completed
          </p>
          <form action={setSequenceAutoSendAction} className="mt-2 flex items-center gap-1.5 text-xs text-neutral-600">
            <input type="hidden" name="id" value={seq.id} />
            <label className="flex items-center gap-1.5" title="On = AI-drafted emails ship in the next send window. Off = land in /queue for approval first.">
              <input type="checkbox" name="auto_send" defaultChecked={seq.auto_send} />
              Auto-send emails (saves on toggle)
            </label>
            <PendingButton className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100" pendingLabel="…">
              Save
            </PendingButton>
          </form>
        </div>
        <div className="flex gap-2">
          {seq.status !== "live" && (
            <form action={setSequenceStatusAction}>
              <input type="hidden" name="id" value={seq.id} />
              <input type="hidden" name="status" value="live" />
              <PendingButton className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" pendingLabel="…">Resume</PendingButton>
            </form>
          )}
          {seq.status === "live" && (
            <form action={setSequenceStatusAction}>
              <input type="hidden" name="id" value={seq.id} />
              <input type="hidden" name="status" value="paused" />
              <PendingButton className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700" pendingLabel="…">Pause</PendingButton>
            </form>
          )}
          {seq.status !== "complete" && (
            <form action={setSequenceStatusAction}>
              <input type="hidden" name="id" value={seq.id} />
              <input type="hidden" name="status" value="complete" />
              <PendingButton className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100" pendingLabel="…">Mark complete</PendingButton>
            </form>
          )}
          <form>
            <input type="hidden" name="id" value={seq.id} />
            <ConfirmSubmit
              formAction={deleteSequenceAction}
              className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
              message={`Delete "${seq.name}"? Contacts + actions + queued drafts go with it.`}
            >
              Delete
            </ConfirmSubmit>
          </form>
        </div>
      </header>

      {/* Per-sequence campaign theme + optional conference link.
          Theme is injected into every AI email draft for this sequence so
          they all sing the same tune. */}
      <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-3">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Campaign context</h2>
        <form action={updateSequenceMetaAction} className="space-y-2">
          <input type="hidden" name="id" value={seq.id} />
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Theme / style for AI emails
            </label>
            <textarea
              name="theme"
              defaultValue={seq.theme ?? ""}
              rows={3}
              placeholder={"e.g. \"Money 2020 Vegas attendees — lead with the cost-of-living theme and reference our recent case study with X.\""}
              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            />
            <p className="mt-1 text-xs text-neutral-400">Injected into every email draft. Leave blank for the default voice.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Linked event (optional)
            </label>
            <Combobox
              name="conference_id"
              defaultValue={seq.conference_id ?? ""}
              options={conferences.map((c) => ({ id: c.id, label: c.name }))}
              placeholder="Tie this sequence to a conference…"
            />
          </div>
          <PendingButton className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" pendingLabel="Saving…">
            Save context
          </PendingButton>
        </form>
      </section>

      {/* Full-width horizontal cadence — one expandable card per day,
          evenly distributed across the row. Click a card to see the actual
          proposed draft (for email steps, sampled from the most recent
          generation in this sequence) or the coaching note (for manual). */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">The cadence</h2>
        {(() => {
          const byDay = new Map<number, typeof SEQUENCE_STEPS>();
          for (const s of SEQUENCE_STEPS) {
            const arr = byDay.get(s.day) ?? [];
            arr.push(s);
            byDay.set(s.day, arr);
          }
          const days = Array.from(byDay.keys()).sort((a, b) => a - b);
          return (
            <div className="flex w-full items-stretch gap-1">
              {days.map((day, idx) => (
                <Fragment key={day}>
                  <details className="group flex-1 min-w-0 rounded-md border border-neutral-200 bg-white open:bg-neutral-50 open:shadow-sm">
                    <summary className="cursor-pointer list-none p-2">
                      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                        <span>Day {day}</span>
                        <span className="text-neutral-300 group-open:hidden">▸</span>
                        <span className="hidden text-neutral-300 group-open:inline">▾</span>
                      </div>
                      <div className="mt-1 flex flex-col gap-1">
                        {byDay.get(day)!.map((s, i) => (
                          <span
                            key={i}
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${STEP_BADGE[s.kind]}`}
                          >
                            {s.shortLabel}
                            {s.auto && <span className="text-emerald-700/70" aria-label="auto-drafts">✦</span>}
                          </span>
                        ))}
                      </div>
                    </summary>
                    <div className="space-y-3 border-t border-neutral-100 p-2 text-xs">
                      {byDay.get(day)!.map((s, i) => {
                        const sample = sampleByKind.get(s.kind);
                        return (
                          <div key={i}>
                            <div className="font-semibold text-neutral-800">{s.label}</div>
                            {s.notes && <div className="mt-0.5 text-neutral-500">{s.notes}</div>}
                            {isEmailStep(s) && (
                              sample ? (
                                <div className="mt-1.5 rounded border border-neutral-200 bg-white p-2">
                                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-neutral-400">
                                    <span>Proposed draft</span>
                                    {sample.status && (
                                      <span className={`rounded px-1 py-0.5 ${sample.status === "sent" ? "bg-emerald-100 text-emerald-800" : sample.status === "approved" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}`}>
                                        {sample.status}
                                      </span>
                                    )}
                                  </div>
                                  {sample.recipient && <div className="mt-0.5 text-[10px] text-neutral-400">for {sample.recipient}</div>}
                                  <div className="mt-1 font-medium text-neutral-800">{sample.subject ?? "(no subject)"}</div>
                                  <div className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-neutral-600">
                                    {sample.body_text ?? "(no body)"}
                                  </div>
                                  <Link href="/queue" className="mt-2 inline-block text-blue-700 hover:underline">See all drafts in /queue ↗</Link>
                                </div>
                              ) : (
                                <div className="mt-1.5 rounded border border-dashed border-neutral-200 bg-white p-2 text-neutral-400 italic">
                                  No sample yet — add a contact and the engine will draft a personalised version here.
                                </div>
                              )
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                  {idx < days.length - 1 && <span className="self-center px-0.5 text-neutral-300">→</span>}
                </Fragment>
              ))}
            </div>
          );
        })()}
        <p className="mt-1 text-xs text-neutral-400">✦ = AI auto-drafts the email. Click any day to see the proposed draft / coaching note.</p>
      </section>

      {/* Add contacts */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Add contacts</h2>
        <form action={addContactsToSequenceAction} className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <input type="hidden" name="sequence_id" value={seq.id} />
          <div className="flex-1 min-w-[20rem]">
            <Combobox
              name="contact_id"
              options={pickOptions}
              placeholder="Type to search contacts to add…"
              required
            />
          </div>
          <PendingButton className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700" pendingLabel="Adding…">
            Add to sequence
          </PendingButton>
        </form>
        <p className="mt-1 text-xs text-neutral-400">
          Tip: shows only your assigned contacts who aren&apos;t already in another live sequence.
          The engine then runs every hour at :15 UTC to advance due steps — or hit <strong>Check for due actions</strong> on /sequences.
        </p>
      </section>

      {/* Outstanding actions, grouped by contact */}
      {pendingActions > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Outstanding actions ({pendingActions})</h2>
          <ul className="space-y-3">
            {Array.from(actionsByContact.entries()).map(([contactId, list]) => {
              const sc = contacts.find((c) => c.contact_id === contactId);
              return (
                <li key={contactId} className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
                  <div className="mb-2 flex flex-wrap items-baseline gap-2 text-sm">
                    {sc?.contact ? (
                      <Link href={`/contacts/${sc.contact.id}`} className="font-medium text-blue-700 hover:underline">
                        {sc.contact.full_name ?? sc.contact.email ?? "(unnamed)"}
                      </Link>
                    ) : <span className="font-medium">(unknown contact)</span>}
                    {sc?.contact?.organisation?.name && <span className="text-neutral-500">— {sc.contact.organisation.name}</span>}
                    {sc?.contact?.job_title && <span className="text-xs text-neutral-400">· {sc.contact.job_title}</span>}
                    <span className="ml-auto text-xs text-neutral-400">step {(sc?.current_step ?? 0) + 1}/{SEQUENCE_STEPS.length}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {list.map((a) => {
                      const step = SEQUENCE_STEPS[a.step_index];
                      const overdue = new Date(a.due_at).getTime() < Date.now() - 86_400_000;
                      return (
                        <li key={a.id} className="flex flex-wrap items-center gap-2 rounded border border-neutral-100 px-2 py-1.5">
                          <span className={`rounded px-1.5 py-0.5 text-xs ${STEP_BADGE[a.kind as StepKind] ?? "bg-neutral-100"}`}>
                            Day {step?.day ?? "?"}
                          </span>
                          <span className="text-sm">{step?.label ?? a.kind}</span>
                          {isEmailStep(a.kind as StepKind) && a.send_id && (
                            <Link href={`/queue`} className={`text-xs hover:underline ${seq.auto_send ? "text-emerald-600" : "text-amber-600"}`}>
                              {seq.auto_send ? "auto-send queued · ships next window ↗" : "draft in queue · review + approve ↗"}
                            </Link>
                          )}
                          {isEmailStep(a.kind as StepKind) && !a.send_id && (
                            <span
                              className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700"
                              title="The AI couldn't draft this — most likely the contact has no email, no linked company, or the company has no sector set. Fix on the contact page, then hit 'Check for due actions' on /sequences."
                            >
                              draft not generated — fix contact
                            </span>
                          )}
                          {overdue && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">overdue</span>}
                          <span className="ml-auto text-xs text-neutral-400">due {fmtDate(a.due_at)}</span>
                          <form action={markActionDoneAction}>
                            <input type="hidden" name="id" value={a.id} />
                            <PendingButton className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700" pendingLabel="…">
                              Mark done
                            </PendingButton>
                          </form>
                          <form action={skipActionAction}>
                            <input type="hidden" name="id" value={a.id} />
                            <PendingButton className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100" pendingLabel="…">
                              Skip
                            </PendingButton>
                          </form>
                          {step?.notes && (
                            <details className="basis-full text-xs text-neutral-500">
                              <summary className="cursor-pointer">coaching note</summary>
                              <p className="mt-1">{step.notes}</p>
                            </details>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Contacts in this sequence */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Contacts ({totalContacts})</h2>
        {contacts.length === 0 ? (
          <p className="text-sm text-neutral-400">Nobody added yet — search above.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-neutral-400">
              <tr><th className="py-1">Contact</th><th>Company</th><th>Status</th><th className="text-right">Step</th><th>Started</th><th></th></tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const ct = c.contact;
                return (
                  <tr key={c.contact_id} className="border-t border-neutral-100 hover:bg-neutral-100">
                    <td className="py-1.5">{ct ? <Link href={`/contacts/${ct.id}`} className="font-medium text-blue-700 hover:underline">{ct.full_name ?? "(unnamed)"}</Link> : "—"}</td>
                    <td className="text-neutral-600">{ct?.organisation?.name ?? "—"}</td>
                    <td>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${
                        c.status === "active" ? "bg-emerald-100 text-emerald-800" :
                        c.status === "replied" ? "bg-blue-100 text-blue-800" :
                        c.status === "completed" ? "bg-neutral-200 text-neutral-700" :
                        "bg-amber-100 text-amber-800"
                      }`}>{c.status}</span>
                    </td>
                    <td className="text-right text-neutral-700">{c.current_step}/{SEQUENCE_STEPS.length}</td>
                    <td className="text-xs text-neutral-500">{fmtDate(c.started_at)}</td>
                    <td className="w-10 text-right">
                      <form action={removeContactFromSequenceAction}>
                        <input type="hidden" name="sequence_id" value={seq.id} />
                        <input type="hidden" name="contact_id" value={c.contact_id} />
                        <RowIconAction kind="remove" title="Remove from sequence" />
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
