import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { updateContact, deleteContact } from "../../actions";

export const dynamic = "force-dynamic";

const EMAIL_STATUS = ["unverified", "valid", "bounced"];
const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

export default async function ContactDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = serviceClient();
  const { data: c } = await db
    .from("contacts")
    .select("*, organisation:organisations(id, name)")
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();
  const org = c.organisation as { id: string; name: string | null } | null;

  const [{ data: events }, { data: sends }] = await Promise.all([
    db.from("events").select("type, ts, payload").eq("contact_id", id).order("ts", { ascending: false }).limit(20),
    db.from("sends").select("subject, status, ts, clicked, replied").eq("contact_id", id).order("ts", { ascending: false }).limit(10),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/contacts" className="text-sm text-blue-700 hover:underline">← Contacts</Link>
      <h1 className="mt-2 text-xl font-semibold">{c.full_name}</h1>
      {org && (
        <p className="mb-4 text-sm text-neutral-500">
          <Link href={`/companies/${org.id}`} className="text-blue-700 hover:underline">{org.name}</Link>
        </p>
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
        <div className="col-span-2"><label className={lbl}>LinkedIn URL</label><input name="linkedin_url" defaultValue={c.linkedin_url ?? ""} className={field} placeholder="https://linkedin.com/in/…" /></div>
        <div><label className={lbl}>Label</label><input name="label" defaultValue={c.label ?? ""} className={field} /></div>
        <div><label className={lbl}>Snooze until (ISO)</label><input name="snooze_until" defaultValue={c.snooze_until ?? ""} className={field} placeholder="(blank = active)" /></div>
        <div className="col-span-2 flex items-center gap-2"><input type="checkbox" name="is_deal_stakeholder" defaultChecked={c.is_deal_stakeholder} id="ds" /><label htmlFor="ds" className="text-sm">Deal stakeholder</label></div>
        <div className="col-span-2 flex gap-2">
          <button className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Save</button>
          <button formAction={deleteContact} className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50">Delete</button>
        </div>
      </form>

      <section className="mt-8 text-sm">
        <h2 className="mb-2 font-semibold">Timeline</h2>
        <ul className="space-y-1 text-neutral-600">
          {(sends ?? []).map((s, i) => (
            <li key={`s${i}`}>✉️ {s.status} — {s.subject} {s.clicked ? "· clicked" : ""}{s.replied ? "· replied" : ""} <span className="text-neutral-400">{new Date(s.ts).toLocaleDateString("en-GB")}</span></li>
          ))}
          {(events ?? []).map((e, i) => (
            <li key={`e${i}`}>• {e.type} <span className="text-neutral-400">{new Date(e.ts).toLocaleDateString("en-GB")}</span></li>
          ))}
          {(sends?.length ?? 0) === 0 && (events?.length ?? 0) === 0 && <li className="text-neutral-400">No activity yet.</li>}
        </ul>
      </section>
    </main>
  );
}
