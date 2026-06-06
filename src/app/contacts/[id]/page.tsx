import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { updateContact, deleteContact, mergeContact, addNote, updateNote, deleteNote, generateDraftForContact, unmarkNotOnLinkedIn, unskipContact } from "../../actions";
import { setNewsletterSubscription } from "../../newsletter/actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { PendingButton } from "@/components/PendingButton";
import { CustomFieldInputs, CustomFieldsManager } from "@/components/CustomFieldsSection";
import { OwnerPicker } from "@/components/OwnerPicker";
import { RowIconAction } from "@/components/RowIconAction";
import { Combobox } from "@/components/Combobox";

export const dynamic = "force-dynamic";
// ✨ Generate-draft-for-this-contact calls Claude.
export const maxDuration = 60;

const EMAIL_STATUS = ["unverified", "valid", "bounced"];
const LABELS = ["Lead", "Prospect", "Customer", "Partner", "Potential introducer", "Investor"];
const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

export default async function ContactDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ merge_q?: string }>;
}) {
  const { id } = await params;
  const { merge_q } = await searchParams;
  const db = serviceClient();
  const { data: c } = await db
    .from("contacts")
    .select("*, organisation:organisations(id, name)")
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();
  const org = c.organisation as { id: string; name: string | null } | null;

  const [{ data: events }, { data: sends }, { data: orgs }, { data: notes }, { data: attended }, { data: primaryMeetings }, { data: attendeeMeetings }] = await Promise.all([
    db.from("events").select("type, ts, payload").eq("contact_id", id).order("ts", { ascending: false }).limit(20),
    db.from("sends").select("subject, status, ts, clicked, replied").eq("contact_id", id).order("ts", { ascending: false }).limit(10),
    db.from("organisations").select("id, name").order("name", { ascending: true }).limit(1000),
    db.from("notes").select("id, content, noted_at").eq("contact_id", id).order("noted_at", { ascending: false }).limit(20),
    db.from("conference_attendances")
      .select("matched_via, conference:conferences(id, name, start_date, location)")
      .eq("contact_id", id),
    // Meetings where this contact is the primary.
    db.from("meetings").select("id, subject, start_at, status").eq("primary_contact_id", id).order("start_at", { ascending: false }).limit(50),
    // Meetings where this contact is in the attendees JSONB. PostgREST
    // `.contains` on a jsonb array does an @> containment match — finds
    // any element with at least these fields, ignoring extras.
    db.from("meetings").select("id, subject, start_at, status").contains("attendees", [{ contact_id: id }]).order("start_at", { ascending: false }).limit(50),
  ]);
  const attendances = (attended ?? []) as unknown as { matched_via: string; conference: { id: string; name: string; start_date: string | null; location: string | null } | null }[];
  // Dedupe meetings by id (a contact who's primary AND in attendees would otherwise show twice).
  const meetingsById = new Map<string, { id: string; subject: string | null; start_at: string; status: string | null }>();
  for (const m of [...((primaryMeetings ?? []) as unknown as { id: string; subject: string | null; start_at: string; status: string | null }[]), ...((attendeeMeetings ?? []) as unknown as { id: string; subject: string | null; start_at: string; status: string | null }[])]) {
    meetingsById.set(m.id, m);
  }
  const meetings = Array.from(meetingsById.values());

  // Merge: search other contacts to fold into this one.
  let mergeCandidates: { id: string; full_name: string | null; email: string | null }[] = [];
  if (merge_q) {
    const { data } = await db
      .from("contacts")
      .select("id, full_name, email")
      .or(`full_name.ilike.%${merge_q}%,email.ilike.%${merge_q}%`)
      .neq("id", id)
      .limit(8);
    mergeCandidates = data ?? [];
  }

  return (
    <main className="px-8 py-6">
      <Link href="/contacts" className="text-sm text-blue-700 hover:underline">← Contacts</Link>
      <h1 className="mt-2 text-xl font-semibold">{c.full_name}</h1>
      {org && (
        <p className="mb-4 text-sm text-neutral-500">
          <Link href={`/companies/${org.id}`} className="text-blue-700 hover:underline">{org.name}</Link>
        </p>
      )}

      {c.email && (
        <form action={generateDraftForContact} className="mb-4">
          <input type="hidden" name="contact_id" value={c.id} />
          <PendingButton
            className="rounded bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800"
            pendingLabel="Drafting…"
          >
            ✨ Generate draft for this contact
          </PendingButton>
          <span className="ml-2 text-xs text-neutral-400">Bypasses tier/sector filters — lands in the queue.</span>
        </form>
      )}

      {c.email && (
        <form action={setNewsletterSubscription} className="mb-4 flex items-center gap-2 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
          <input type="hidden" name="contact_id" value={c.id} />
          <input id="news" type="checkbox" name="subscribed" defaultChecked={c.newsletter_subscribed} />
          <label htmlFor="news">Subscribe to monthly newsletter</label>
          <PendingButton className="ml-auto rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100" pendingLabel="…">Update</PendingButton>
        </form>
      )}

      {c.not_on_linkedin && (
        <form action={unmarkNotOnLinkedIn} className="mb-4 flex items-center gap-2 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
          <input type="hidden" name="contact_id" value={c.id} />
          <span className="text-neutral-600">Flagged as not on LinkedIn — hidden from research queue.</span>
          <PendingButton className="ml-auto rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100" pendingLabel="…">
            Un-flag (return to queue)
          </PendingButton>
        </form>
      )}

      {c.skipped_at && (
        <form action={unskipContact} className="mb-4 flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
          <input type="hidden" name="contact_id" value={c.id} />
          <span className="text-amber-900">
            <strong>Skipped</strong> ({c.skip_reason ?? "no reason given"}) on {new Date(c.skipped_at).toLocaleDateString("en-GB")} — hidden from LinkedIn + sequences.
          </span>
          <PendingButton className="ml-auto rounded border border-amber-300 px-2 py-1 text-xs hover:bg-amber-100" pendingLabel="…">
            Unskip (return to queue)
          </PendingButton>
        </form>
      )}

      <form action={updateContact} className="grid grid-cols-2 gap-3">
        <input type="hidden" name="id" value={c.id} />
        <div><label className={lbl}>Name</label><input name="full_name" defaultValue={c.full_name ?? ""} className={field} /></div>
        <div><label className={lbl}>Job title</label><input name="job_title" defaultValue={c.job_title ?? ""} className={field} /></div>
        <div><label className={lbl}>Email</label><input name="email" defaultValue={c.email ?? ""} className={field} /></div>
        <div>
          <label className={lbl}>Email status</label>
          <select name="email_status" defaultValue={c.email_status} className={field}>
            {EMAIL_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div><label className={lbl}>Mobile</label><input name="mobile" defaultValue={c.mobile ?? ""} className={field} placeholder="+44…" /></div>
        <div className="col-span-2">
          <label className={lbl}>Company</label>
          <Combobox
            name="organisation_id"
            defaultValue={org?.id ?? ""}
            options={(orgs ?? []).map((o) => ({ id: o.id, label: o.name ?? "(unnamed)" }))}
            placeholder="Type to search companies…"
            createField="new_organisation_name"
            createLabel="Create company"
          />
        </div>
        <div className="col-span-2">
          <label className={lbl}>LinkedIn URL</label>
          <input name="linkedin_url" defaultValue={c.linkedin_url ?? ""} className={field} placeholder="https://linkedin.com/in/…" />
          {c.not_on_linkedin && (
            <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
              <span className="rounded bg-neutral-200 px-1.5 py-0.5 font-medium text-neutral-700">Flagged as not on LinkedIn</span>
              <span>— hidden from /linkedin research queue.</span>
            </div>
          )}
        </div>
        <div>
          <label className={lbl}>Label</label>
          <select name="label" defaultValue={c.label ?? ""} className={field}>
            <option value="">—</option>
            {[...new Set([...LABELS, ...(c.label ? [c.label] : [])])].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div><label className={lbl}>Snooze until (ISO)</label><input name="snooze_until" defaultValue={c.snooze_until ?? ""} className={field} placeholder="(blank = active)" /></div>
        <OwnerPicker value={c.owner_id ?? null} />
        <CustomFieldInputs entityType="contact" values={c.custom_fields as Record<string, unknown> | null} />
        <div className="col-span-2 flex flex-wrap gap-2">
          <PendingButton className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" pendingLabel="Saving…">Save</PendingButton>
          <ConfirmSubmit
            formAction={deleteContact}
            className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            message={`Delete contact ${c.full_name ?? "?"}? Their notes, sends and timeline go too.`}
          >
            Delete
          </ConfirmSubmit>
        </div>
      </form>

      <section className="mt-8 text-sm">
        <h2 className="mb-2 font-semibold">Notes ({notes?.length ?? 0})</h2>
        <form action={addNote} className="mb-3 flex gap-2">
          <input type="hidden" name="contact_id" value={c.id} />
          <input type="hidden" name="organisation_id" value={org?.id ?? ""} />
          <input name="content" placeholder="Add a note…" className={`${field} flex-1`} />
          <PendingButton className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700" pendingLabel="Adding…">Add</PendingButton>
        </form>
        <ul className="space-y-2 text-neutral-600">
          {(notes ?? []).map((n) => (
            <li key={n.id} className="border-l-2 border-neutral-200 pl-2">
              {n.noted_at && <div className="text-xs text-neutral-400">{new Date(n.noted_at).toLocaleDateString("en-GB")}</div>}
              <form action={updateNote} className="flex items-start gap-2">
                <input type="hidden" name="id" value={n.id} />
                <input type="hidden" name="back" value={`/contacts/${c.id}`} />
                <textarea name="content" defaultValue={String(n.content)} rows={2} className={`${field} flex-1`} />
                <div className="flex flex-col items-end gap-1">
                  <PendingButton className="rounded bg-neutral-200 px-2 py-1 text-xs hover:bg-neutral-300" pendingLabel="…">Save</PendingButton>
                  <RowIconAction kind="delete" formAction={deleteNote} confirmMessage="Delete this note?" />
                </div>
              </form>
            </li>
          ))}
        </ul>
      </section>

      {attendances.length > 0 && (
        <section className="mt-8 text-sm">
          <h2 className="mb-2 font-semibold">Events attended ({attendances.length})</h2>
          <ul className="space-y-1 text-neutral-600">
            {attendances.map((a) => a.conference && (
              <li key={a.conference.id}>
                <Link href={`/events/${a.conference.id}`} className="text-blue-700 hover:underline">{a.conference.name}</Link>
                {a.conference.start_date && <span className="ml-2 text-neutral-400">{new Date(a.conference.start_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
                {a.conference.location && <span className="ml-2 text-neutral-400">· {a.conference.location}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 text-sm">
        <h2 className="mb-2 font-semibold">Timeline</h2>
        {(() => {
          // Merge sends + events + conference attendances into a single
          // chronologically-sorted list. Each entry carries a render fn
          // so the row type only renders the JSX appropriate for it.
          type Row = { ts: number; key: string; render: () => React.ReactNode };
          const rows: Row[] = [];
          for (const [i, s] of (sends ?? []).entries()) {
            rows.push({
              ts: new Date(s.ts).getTime(),
              key: `s${i}`,
              render: () => <>✉️ {s.status} — {s.subject} {s.clicked ? "· clicked" : ""}{s.replied ? "· replied" : ""} <span className="text-neutral-400">{new Date(s.ts).toLocaleDateString("en-GB")}</span></>,
            });
          }
          for (const [i, e] of (events ?? []).entries()) {
            const msg = (e.payload as { message?: string } | null)?.message;
            rows.push({
              ts: new Date(e.ts).getTime(),
              key: `e${i}`,
              render: () => <>• {msg ?? e.type} <span className="text-neutral-400">{new Date(e.ts).toLocaleDateString("en-GB")}</span></>,
            });
          }
          for (const a of attendances) {
            if (!a.conference) continue;
            // Use start_date when present; falls back to "now" so undated
            // conferences still surface (rare but possible).
            const ts = a.conference.start_date ? new Date(a.conference.start_date).getTime() : Date.now();
            rows.push({
              ts,
              key: `c${a.conference.id}`,
              render: () => (
                <>
                  🎟 Attended <Link href={`/events/${a.conference!.id}`} className="text-blue-700 hover:underline">{a.conference!.name}</Link>
                  {a.conference!.location && <span className="ml-1 text-neutral-400">· {a.conference!.location}</span>}
                  {a.conference!.start_date && (
                    <span className="ml-2 text-neutral-400">{new Date(a.conference!.start_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                  )}
                </>
              ),
            });
          }
          for (const m of meetings) {
            rows.push({
              ts: new Date(m.start_at).getTime(),
              key: `m${m.id}`,
              render: () => (
                <>
                  📅 <Link href={`/meetings/${m.id}`} className="text-blue-700 hover:underline">{m.subject ?? "(no subject)"}</Link>
                  {m.status && <span className="ml-2 rounded bg-neutral-100 px-1 py-0.5 text-[10px] text-neutral-600">{m.status}</span>}
                  <span className="ml-2 text-neutral-400">{new Date(m.start_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                </>
              ),
            });
          }
          rows.sort((x, y) => y.ts - x.ts);
          if (rows.length === 0) {
            return <ul className="space-y-1 text-neutral-600"><li className="text-neutral-400">No activity yet.</li></ul>;
          }
          return (
            <ul className="space-y-1 text-neutral-600">
              {rows.map((r) => <li key={r.key}>{r.render()}</li>)}
            </ul>
          );
        })()}
      </section>

      {/* Merge: fold a duplicate contact into this one. */}
      <section className="mt-10 border-t border-neutral-200 pt-4 text-sm">
        <h2 className="mb-2 font-semibold text-neutral-600">Merge a duplicate into {c.full_name}</h2>
        <form className="mb-3 flex gap-2">
          <input name="merge_q" defaultValue={merge_q ?? ""} placeholder="Search the contact to fold in…" className={`${field} flex-1`} />
          <button className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50">Search</button>
        </form>
        {merge_q && (
          <ul className="space-y-1">
            {mergeCandidates.length === 0 && <li className="text-neutral-400">No matches.</li>}
            {mergeCandidates.map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded border border-neutral-200 px-2 py-1.5">
                <span>{m.full_name} <span className="text-neutral-400">{m.email}</span></span>
                <form action={mergeContact}>
                  <input type="hidden" name="source_id" value={m.id} />
                  <input type="hidden" name="target_id" value={c.id} />
                  <PendingButton className="rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700" pendingLabel="Merging…">
                    Merge into {c.full_name} →
                  </PendingButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-neutral-400">Re-points the other contact&apos;s deals, notes &amp; send history here, then deletes it. Not reversible.</p>
      </section>

      <CustomFieldsManager entityType="contact" />
    </main>
  );
}
