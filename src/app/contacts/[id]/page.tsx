import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { updateContact, deleteContact, mergeContact, addNote, updateNote, deleteNote, generateDraftForContact } from "../../actions";
import { setNewsletterSubscription } from "../../newsletter/actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { PendingButton } from "@/components/PendingButton";

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

  const [{ data: events }, { data: sends }, { data: orgs }, { data: notes }] = await Promise.all([
    db.from("events").select("type, ts, payload").eq("contact_id", id).order("ts", { ascending: false }).limit(20),
    db.from("sends").select("subject, status, ts, clicked, replied").eq("contact_id", id).order("ts", { ascending: false }).limit(10),
    db.from("organisations").select("id, name").order("name", { ascending: true }).limit(1000),
    db.from("notes").select("id, content, noted_at").eq("contact_id", id).order("noted_at", { ascending: false }).limit(20),
  ]);

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
          <button className="ml-auto rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100">Update</button>
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
        <div>
          <label className={lbl}>Company</label>
          <select name="organisation_id" defaultValue={org?.id ?? ""} className={field}>
            <option value="">— none —</option>
            {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div className="col-span-2"><label className={lbl}>…or new company (creates it)</label><input name="new_organisation_name" className={field} placeholder="Type a new company name to create + assign" /></div>
        <div className="col-span-2"><label className={lbl}>LinkedIn URL</label><input name="linkedin_url" defaultValue={c.linkedin_url ?? ""} className={field} placeholder="https://linkedin.com/in/…" /></div>
        <div>
          <label className={lbl}>Label</label>
          <select name="label" defaultValue={c.label ?? ""} className={field}>
            <option value="">—</option>
            {[...new Set([...LABELS, ...(c.label ? [c.label] : [])])].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div><label className={lbl}>Snooze until (ISO)</label><input name="snooze_until" defaultValue={c.snooze_until ?? ""} className={field} placeholder="(blank = active)" /></div>
        <div className="col-span-2 flex gap-2">
          <button className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Save</button>
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
          <button className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Add</button>
        </form>
        <ul className="space-y-2 text-neutral-600">
          {(notes ?? []).map((n) => (
            <li key={n.id} className="border-l-2 border-neutral-200 pl-2">
              {n.noted_at && <div className="text-xs text-neutral-400">{new Date(n.noted_at).toLocaleDateString("en-GB")}</div>}
              <form action={updateNote} className="flex items-start gap-2">
                <input type="hidden" name="id" value={n.id} />
                <input type="hidden" name="back" value={`/contacts/${c.id}`} />
                <textarea name="content" defaultValue={String(n.content)} rows={2} className={`${field} flex-1`} />
                <div className="flex flex-col gap-1">
                  <button className="rounded bg-neutral-200 px-2 py-1 text-xs hover:bg-neutral-300">Save</button>
                  <ConfirmSubmit formAction={deleteNote} className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50" message="Delete this note?">Del</ConfirmSubmit>
                </div>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 text-sm">
        <h2 className="mb-2 font-semibold">Timeline</h2>
        <ul className="space-y-1 text-neutral-600">
          {(sends ?? []).map((s, i) => (
            <li key={`s${i}`}>✉️ {s.status} — {s.subject} {s.clicked ? "· clicked" : ""}{s.replied ? "· replied" : ""} <span className="text-neutral-400">{new Date(s.ts).toLocaleDateString("en-GB")}</span></li>
          ))}
          {(events ?? []).map((e, i) => {
            const msg = (e.payload as { message?: string } | null)?.message;
            return <li key={`e${i}`}>• {msg ?? e.type} <span className="text-neutral-400">{new Date(e.ts).toLocaleDateString("en-GB")}</span></li>;
          })}
          {(sends?.length ?? 0) === 0 && (events?.length ?? 0) === 0 && <li className="text-neutral-400">No activity yet.</li>}
        </ul>
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
                  <button className="rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700">
                    Merge into {c.full_name} →
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-neutral-400">Re-points the other contact&apos;s deals, notes &amp; send history here, then deletes it. Not reversible.</p>
      </section>
    </main>
  );
}
