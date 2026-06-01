import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { createConferenceAction } from "./actions";
import { OwnerFilter } from "@/components/OwnerFilter";
import { resolveOwnerFilter } from "@/lib/auth/owner";

export const dynamic = "force-dynamic";

interface ConferenceRow {
  id: string;
  name: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const { owner } = await searchParams;
  const db = serviceClient();
  const ownerId = await resolveOwnerFilter(owner);

  let q = db
    .from("conferences")
    .select("id, name, location, start_date, end_date")
    .order("start_date", { ascending: false, nullsFirst: false })
    .limit(200);
  if (ownerId) q = q.eq("owner_id", ownerId);
  const { data } = await q;
  const rows = (data ?? []) as ConferenceRow[];

  // Per-conference attendee counts in one round-trip.
  const counts = new Map<string, number>();
  if (rows.length) {
    const { data: att } = await db
      .from("conference_attendances")
      .select("conference_id")
      .in("conference_id", rows.map((r) => r.id));
    for (const a of att ?? []) {
      const id = a.conference_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  return (
    <main className="px-8 py-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <div>
          <h1 className="text-xl font-semibold">Events</h1>
          <p className="text-sm text-neutral-500">Conferences + attendee lists. Upload a CSV — the CRM finds existing contacts or creates them.</p>
        </div>
        <OwnerFilter current={owner} pathname="/events" />
        <span className="text-sm text-neutral-500">{rows.length} event{rows.length === 1 ? "" : "s"}</span>
      </header>

      <form action={createConferenceAction} className="mb-6 grid grid-cols-1 gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <input name="name" placeholder="Event name (e.g. Money 2020 Vegas)" required className="rounded border border-neutral-300 px-2 py-1.5 text-sm" />
        <input name="location" placeholder="Location" className="rounded border border-neutral-300 px-2 py-1.5 text-sm" />
        <input name="start_date" type="date" className="rounded border border-neutral-300 px-2 py-1.5 text-sm" />
        <input name="end_date" type="date" className="rounded border border-neutral-300 px-2 py-1.5 text-sm" />
        <button className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">+ Add event</button>
      </form>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-neutral-400">
          <tr><th className="py-1">Event</th><th>When</th><th>Location</th><th className="text-right">Attendees</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-neutral-100 hover:bg-neutral-50">
              <td className="py-1.5"><Link href={`/events/${r.id}`} className="font-medium text-blue-700 hover:underline">{r.name}</Link></td>
              <td className="text-neutral-600">
                {r.start_date ? new Date(r.start_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                {r.end_date && r.end_date !== r.start_date && ` → ${new Date(r.end_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
              </td>
              <td className="text-neutral-600">{r.location ?? "—"}</td>
              <td className="text-right text-neutral-700">{counts.get(r.id) ?? 0}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={4} className="py-6 text-center text-neutral-400">No events yet — add one above.</td></tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
