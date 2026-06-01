import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import {
  updateConferenceAction,
  deleteConferenceAction,
  uploadAttendeesAction,
  removeAttendeeAction,
} from "../actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { PendingButton } from "@/components/PendingButton";
import { RowIconAction } from "@/components/RowIconAction";

export const dynamic = "force-dynamic";
// CSV parse + per-row contact resolution can take 30s+ on big lists.
export const maxDuration = 60;

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

const matchBadge: Record<string, string> = {
  email: "bg-emerald-100 text-emerald-800",
  name_company: "bg-blue-100 text-blue-800",
  created: "bg-amber-100 text-amber-800",
  needs_research: "bg-red-100 text-red-700",
  manual: "bg-neutral-100 text-neutral-700",
};

interface AttendeeRow {
  contact_id: string;
  matched_via: string;
  contact: {
    id: string;
    full_name: string | null;
    email: string | null;
    job_title: string | null;
    needs_research: boolean;
    organisation: { id: string; name: string | null } | null;
  } | null;
}

export default async function EventDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = serviceClient();
  const { data: ev } = await db.from("conferences").select("*").eq("id", id).maybeSingle();
  if (!ev) notFound();

  const { data: attendanceData } = await db
    .from("conference_attendances")
    .select(`
      contact_id, matched_via,
      contact:contacts(id, full_name, email, job_title, needs_research, organisation:organisations(id, name))
    `)
    .eq("conference_id", id)
    .order("matched_via");
  const attendees = (attendanceData ?? []) as unknown as AttendeeRow[];

  const byMatch: Record<string, number> = {};
  for (const a of attendees) byMatch[a.matched_via] = (byMatch[a.matched_via] ?? 0) + 1;

  return (
    <main className="px-8 py-6">
      <Link href="/events" className="text-sm text-blue-700 hover:underline">← Events</Link>
      <h1 className="mt-2 mb-4 text-xl font-semibold">{ev.name}</h1>

      <form action={updateConferenceAction} className="grid grid-cols-2 gap-3">
        <input type="hidden" name="id" value={ev.id} />
        <div className="col-span-2"><label className={lbl}>Name</label><input name="name" defaultValue={ev.name} className={field} /></div>
        <div><label className={lbl}>Location</label><input name="location" defaultValue={ev.location ?? ""} className={field} /></div>
        <div></div>
        <div><label className={lbl}>Start date</label><input type="date" name="start_date" defaultValue={ev.start_date ?? ""} className={field} /></div>
        <div><label className={lbl}>End date</label><input type="date" name="end_date" defaultValue={ev.end_date ?? ""} className={field} /></div>
        <div className="col-span-2"><label className={lbl}>Notes</label><textarea name="notes" defaultValue={ev.notes ?? ""} rows={3} className={field} /></div>
        <div className="col-span-2 flex gap-2">
          <button className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Save</button>
          <ConfirmSubmit
            formAction={deleteConferenceAction}
            className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            message={`Delete event "${ev.name}"? Attendance records go with it (contacts stay).`}
          >
            Delete
          </ConfirmSubmit>
        </div>
      </form>

      {/* Upload attendees */}
      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold">Upload attendee list</h2>
        <p className="mb-2 text-xs text-neutral-500">
          CSV or xlsx. Recognised columns: <code>email</code>, <code>full_name</code> (or first/last), <code>job_title</code>, <code>company</code>.
          Each row is matched to an existing contact by email, then by name+company, otherwise created.
          Rows with only job title + company become placeholder contacts tagged <em>needs research</em>.
        </p>
        <form action={uploadAttendeesAction} className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <input type="hidden" name="conference_id" value={ev.id} />
          <input type="file" name="file" accept=".csv,.xlsx,.xls" required className="text-sm" />
          <PendingButton
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            pendingLabel="Matching + importing…"
          >
            Upload + match
          </PendingButton>
        </form>
      </section>

      {/* Attendees */}
      <section className="mt-8">
        <div className="mb-2 flex flex-wrap items-baseline gap-3">
          <h2 className="text-sm font-semibold">Attendees ({attendees.length})</h2>
          <span className="text-xs text-neutral-500">
            {Object.entries(byMatch).map(([k, n]) => (
              <span key={k} className={`mr-1 rounded px-1.5 py-0.5 ${matchBadge[k] ?? "bg-neutral-100"}`}>{n} {k}</span>
            ))}
          </span>
        </div>
        {attendees.length === 0 ? (
          <p className="text-sm text-neutral-400">No attendees yet — upload a list above.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-neutral-400">
              <tr><th className="py-1">Contact</th><th>Title</th><th>Company</th><th>Email</th><th>Match</th><th></th></tr>
            </thead>
            <tbody>
              {attendees.map((a) => {
                const c = a.contact;
                return (
                  <tr key={a.contact_id} className="border-t border-neutral-100 hover:bg-neutral-50">
                    <td className="py-1.5">
                      {c ? (
                        <Link href={`/contacts/${c.id}`} className="font-medium text-blue-700 hover:underline">
                          {c.full_name ?? "(unnamed)"}
                        </Link>
                      ) : "—"}
                      {c?.needs_research && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">needs research</span>}
                    </td>
                    <td className="text-neutral-600">{c?.job_title ?? "—"}</td>
                    <td className="text-neutral-600">
                      {c?.organisation ? <Link href={`/companies/${c.organisation.id}`} className="text-blue-700 hover:underline">{c.organisation.name}</Link> : "—"}
                    </td>
                    <td className="text-neutral-600">{c?.email ?? "—"}</td>
                    <td><span className={`rounded px-1.5 py-0.5 text-xs ${matchBadge[a.matched_via] ?? "bg-neutral-100 text-neutral-700"}`}>{a.matched_via}</span></td>
                    <td className="w-10 text-right">
                      <form action={removeAttendeeAction}>
                        <input type="hidden" name="conference_id" value={ev.id} />
                        <input type="hidden" name="contact_id" value={a.contact_id} />
                        <RowIconAction kind="remove" title="Remove from event" />
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
