import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { currentUser } from "@/lib/auth/server";
import { isConnected } from "@/lib/microsoft/oauth";
import { syncCalendarAction, setSalesRelevantAction } from "./actions";
import { PendingButton } from "@/components/PendingButton";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Row {
  id: string;
  subject: string | null;
  start_at: string;
  end_at: string | null;
  status: string;
  sales_relevant: boolean;
  online_url: string | null;
  brief: string | null;
  organisation: { id: string; name: string | null } | null;
  primary_contact: { id: string; full_name: string | null } | null;
}

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ show?: string; ms_connected?: string; ms_error?: string }> }) {
  const sp = await searchParams;
  const showAll = sp.show === "all";
  const db = serviceClient();
  const me = await currentUser();
  const connected = me ? await isConnected(db, me.id) : false;

  let query = db
    .from("meetings")
    .select("id, subject, start_at, end_at, status, sales_relevant, online_url, brief, organisation:organisations(id, name), primary_contact:contacts(id, full_name)")
    .order("start_at", { ascending: true })
    .gte("start_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
  if (!showAll) query = query.eq("sales_relevant", true);
  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  const now = Date.now();
  const upcoming = rows.filter((r) => new Date(r.start_at).getTime() >= now);
  const past = rows.filter((r) => new Date(r.start_at).getTime() < now);

  return (
    <main className="px-8 py-6">
      <header className="mb-4 flex items-baseline justify-between border-b border-neutral-200 pb-3">
        <div>
          <h1 className="text-xl font-semibold">Meetings</h1>
          <p className="text-sm text-neutral-500">
            Synced from Outlook. {connected ? `${upcoming.length} upcoming · ${past.length} recent` : "Microsoft account not connected yet."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!connected ? (
            <a href="/api/auth/microsoft/start" className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
              Connect Outlook
            </a>
          ) : (
            <form action={syncCalendarAction}>
              <PendingButton className="rounded bg-neutral-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800" pendingLabel="Syncing…">
                ↻ Sync now
              </PendingButton>
            </form>
          )}
        </div>
      </header>

      {sp.ms_connected && (
        <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          ✓ Outlook connected. Hit Sync now to pull your calendar.
        </div>
      )}
      {sp.ms_error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Microsoft auth error: {sp.ms_error}
        </div>
      )}

      <div className="mb-4 flex items-center gap-2 text-xs">
        <Link href="/meetings" className={`rounded px-2 py-1 ${!showAll ? "bg-amber-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>Sales only</Link>
        <Link href="/meetings?show=all" className={`rounded px-2 py-1 ${showAll ? "bg-amber-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>Show all (incl. non-sales)</Link>
      </div>

      {/* Upcoming */}
      <Section title={`Upcoming (${upcoming.length})`} rows={upcoming} emptyMsg="Nothing scheduled. Sync to pull from Outlook." />
      <Section title={`Recent (${past.length})`} rows={past} emptyMsg="No recent meetings in the last 7 days." />
    </main>
  );
}

function Section({ title, rows, emptyMsg }: { title: string; rows: Row[]; emptyMsg: string }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-400">{emptyMsg}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((m) => {
            const when = new Date(m.start_at);
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-sm">
                <div className="min-w-28 text-neutral-700">
                  <div className="font-medium">{when.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>
                  <div className="text-xs text-neutral-500">{when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
                </div>
                <div className="flex-1">
                  <Link href={`/meetings/${m.id}`} className="font-medium text-blue-700 hover:underline">{m.subject ?? "(no subject)"}</Link>
                  <div className="text-xs text-neutral-500">
                    {m.organisation && <Link href={`/companies/${m.organisation.id}`} className="hover:underline">{m.organisation.name}</Link>}
                    {m.organisation && m.primary_contact && " · "}
                    {m.primary_contact && <Link href={`/contacts/${m.primary_contact.id}`} className="hover:underline">{m.primary_contact.full_name}</Link>}
                    {!m.organisation && !m.primary_contact && <span className="text-neutral-400">No CRM match — open to link</span>}
                  </div>
                </div>
                {m.brief && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">brief ✓</span>}
                {m.online_url && <a href={m.online_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">join</a>}
                <form action={setSalesRelevantAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="relevant" value={m.sales_relevant ? "false" : "true"} />
                  <button className="text-xs text-neutral-400 hover:text-neutral-700" title={m.sales_relevant ? "Mark as non-sales (hide)" : "Mark as sales-relevant"}>
                    {m.sales_relevant ? "hide" : "include"}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
