import Link from "next/link";
import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { currentUser } from "@/lib/auth/server";
import { isConnected } from "@/lib/microsoft/oauth";
import { canSeeMeeting, emailAliases } from "@/lib/meetings/visibility";
import {
  syncCalendarAction,
  setSalesRelevantAction,
  disconnectMicrosoftAction,
  backfillMeetingLinksAction,
  connectGoogleCalendarAction,
  disconnectGoogleCalendarAction,
} from "./actions";
import { PendingButton } from "@/components/PendingButton";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

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
  owner_id: string | null;
  attendees: unknown;
  organisation: { id: string; name: string | null } | null;
  primary_contact: { id: string; full_name: string | null } | null;
}

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ show?: string; ms_connected?: string; ms_error?: string }> }) {
  const sp = await searchParams;
  const showAll = sp.show === "all";
  const db = serviceClient();
  const me = await currentUser();
  if (!me) redirect("/login");

  // Connection state + my email aliases in one settings read. The ICS URL
  // is a secret — only its presence reaches the page, never the value.
  const [msConnected, { data: mySettings }] = await Promise.all([
    isConnected(db, me.id),
    db.from("user_settings").select("reply_to_email, from_email, google_ics_url").eq("user_id", me.id).maybeSingle(),
  ]);
  const googleConnected = !!mySettings?.google_ics_url;
  const myEmails = emailAliases(me.email, mySettings);
  const anyConnected = msConnected || googleConnected;

  let query = db
    .from("meetings")
    .select("id, subject, start_at, end_at, status, sales_relevant, online_url, brief, owner_id, attendees, organisation:organisations(id, name), primary_contact:contacts(id, full_name)")
    .order("start_at", { ascending: true })
    .gte("start_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
  if (!showAll) query = query.eq("sales_relevant", true);
  const { data } = await query;

  // Hard per-user scope: your own calendars' meetings, plus anything you're
  // invited to by email. There's deliberately no "all users" switch here —
  // calendars are private, unlike the shared CRM lists.
  const visible = ((data ?? []) as unknown as Row[]).filter((r) => canSeeMeeting(r, me.id, myEmails));

  // Collapse cross-calendar copies: when you AND a teammate both sync the
  // same event (each calendar produces its own row), prefer your own row —
  // that's the one carrying your brief / notes / Join link.
  const byKey = new Map<string, Row>();
  for (const r of visible) {
    const key = `${r.start_at}|${(r.subject ?? "").trim().toLowerCase()}`;
    const cur = byKey.get(key);
    if (!cur || (cur.owner_id !== me.id && r.owner_id === me.id)) byKey.set(key, r);
  }
  const rows = [...byKey.values()];

  const now = Date.now();
  // Query orders ascending so Upcoming reads soonest-first (Today before
  // Friday). Recent flips to newest-first — most-recent meeting at the
  // top is what an operator actually wants when scanning what just happened.
  const upcoming = rows.filter((r) => new Date(r.start_at).getTime() >= now);
  const past = rows
    .filter((r) => new Date(r.start_at).getTime() < now)
    .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime());

  return (
    <main className="px-8 py-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 pb-3">
        <div>
          <h1 className="text-xl font-semibold">Meetings</h1>
          <p className="text-sm text-neutral-500">
            {anyConnected
              ? `${upcoming.length} upcoming · ${past.length} recent — your meetings only (owner or invited by email).`
              : "Connect Outlook or Google Calendar to pull your meetings in."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!msConnected ? (
            <a href="/api/auth/microsoft/start" className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
              Connect Outlook
            </a>
          ) : (
            <form action={disconnectMicrosoftAction}>
              <ConfirmSubmit
                className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
                message="Disconnect Outlook? Existing meetings stay; sync stops until you reconnect."
              >
                Outlook ✓ — disconnect
              </ConfirmSubmit>
            </form>
          )}

          {!googleConnected ? (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 [&::-webkit-details-marker]:hidden">
                Connect Google Calendar
              </summary>
              <div className="absolute right-0 z-10 mt-2 w-[26rem] rounded-lg border border-neutral-200 bg-white p-4 text-sm shadow-lg">
                <p className="font-medium text-neutral-800">Paste your secret iCal address</p>
                <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-neutral-600">
                  <li>Open <a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">Google Calendar settings</a></li>
                  <li>Under <strong>Settings for my calendars</strong>, pick your calendar</li>
                  <li>Scroll to <strong>Integrate calendar</strong></li>
                  <li>Copy the <strong>Secret address in iCal format</strong> (ends in .ics)</li>
                </ol>
                <form action={connectGoogleCalendarAction} className="mt-3 flex gap-2">
                  <input
                    name="ics_url"
                    placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                    className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-xs"
                    required
                  />
                  <PendingButton className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700" pendingLabel="Connecting…">
                    Connect
                  </PendingButton>
                </form>
                <p className="mt-2 text-[11px] text-neutral-400">
                  The address is private to you — it&apos;s stored server-side only and syncs hourly, exactly like the Granola token.
                </p>
              </div>
            </details>
          ) : (
            <form action={disconnectGoogleCalendarAction}>
              <ConfirmSubmit
                className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
                message="Disconnect Google Calendar? Existing meetings stay; sync stops. To fully revoke, also reset the secret address in Google Calendar settings."
              >
                Google ✓ — disconnect
              </ConfirmSubmit>
            </form>
          )}

          {anyConnected && (
            <>
              <form action={syncCalendarAction}>
                <PendingButton className="rounded bg-neutral-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800" pendingLabel="Syncing…">
                  ↻ Sync now
                </PendingButton>
              </form>
              <form action={backfillMeetingLinksAction}>
                <PendingButton
                  className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
                  pendingLabel="Re-linking…"
                  title="Re-run the company / contact / deal inference over meetings that still aren't linked. Doesn't touch manually-picked links."
                >
                  ⛓ Re-link
                </PendingButton>
              </form>
            </>
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
      <Section title={`Upcoming (${upcoming.length})`} rows={upcoming} emptyMsg="Nothing scheduled. Sync to pull from your calendar." />
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
              <li
                key={m.id}
                className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm shadow-sm ${
                  m.sales_relevant ? "border-neutral-200 bg-white" : "border-dashed border-neutral-300 bg-neutral-50/60 opacity-70"
                }`}
              >
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
                {!m.sales_relevant && (
                  <span className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs font-medium text-neutral-600">
                    Non-sales
                  </span>
                )}
                {m.brief && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">brief ✓</span>}
                {m.online_url && (
                  <a
                    href={m.online_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700"
                  >
                    Join
                  </a>
                )}
                <form action={setSalesRelevantAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="relevant" value={m.sales_relevant ? "false" : "true"} />
                  <PendingButton
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                      m.sales_relevant
                        ? "border-neutral-300 text-neutral-700 hover:bg-neutral-100"
                        : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                    }`}
                    title={m.sales_relevant ? "Mark as non-sales (hides from this list)" : "Mark as sales-relevant"}
                    pendingLabel="…"
                  >
                    {m.sales_relevant ? "Hide" : "Include"}
                  </PendingButton>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
