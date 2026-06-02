import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import {
  saveLinkedInEdits,
  markLinkedInRequestSent,
  markLinkedInAlreadyConnected,
  markLinkedInHookSent,
  markNotOnLinkedIn,
} from "../actions";
import { currentUserId } from "@/lib/auth/owner";
import { PendingButton } from "@/components/PendingButton";
import { Combobox } from "@/components/Combobox";

export const dynamic = "force-dynamic";

// Two distinct counters:
//   DAILY_CAP_REQUESTS — LinkedIn's anti-spam threshold; the hard limit on
//     how many new connection requests you can send per day without getting
//     throttled or warned.
//   DAILY_TARGET_TOUCHES — aspirational productivity target. Every research
//     touch (request, marked-as-already-connected, hook to a 1st-degree)
//     counts. Soft target, not enforced.
const DAILY_CAP_REQUESTS = 15;
const DAILY_TARGET_TOUCHES = 30;

const SECTORS = ["bank", "broker", "building_society", "credit_union", "direct_lender", "marketplace", "sme_lender", "utility"];

/** Most recent 08:00 UK time, expressed as a UTC ISO string. Used to count
 *  today's LinkedIn touches against the daily cap. Approximation: uses
 *  08:00 UTC, which is 08:00 UK in winter (GMT) and 09:00 UK in summer
 *  (BST). Close enough for a daily-rhythm reset. */
function linkedinDayStartUtc(now: Date): string {
  const ukToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const candidate = new Date(`${ukToday}T08:00:00Z`);
  if (now < candidate) candidate.setDate(candidate.getDate() - 1);
  return candidate.toISOString();
}

interface Row {
  id: string;
  full_name: string | null;
  job_title: string | null;
  email: string | null;
  mobile: string | null;
  linkedin_url: string | null;
  label: string | null;
  linkedin_connected: boolean;
  linkedin_request_sent_at: string | null;
  organisation: { id: string; name: string | null; sector: string | null; is_partner: boolean } | null;
}

const fld = "rounded border border-neutral-300 px-2 py-1 text-sm";

export default async function LinkedInPage() {
  const db = serviceClient();
  const dayStart = linkedinDayStartUtc(new Date());
  const me = await currentUserId();

  // Per-user scoping: each operator works their own queue + counts only
  // their own touches.
  let contactQ = db
    .from("contacts")
    .select("id, full_name, job_title, email, mobile, linkedin_url, label, linkedin_connected, linkedin_request_sent_at, organisation:organisations(id, name, sector, is_partner)")
    .eq("not_on_linkedin", false)
    .limit(4000);
  if (me) contactQ = contactQ.eq("owner_id", me);

  // Today's LinkedIn touch events for THIS operator. Single round-trip,
  // we split into request-vs-other locally.
  let ownedContactIds: string[] = [];
  if (me) {
    const { data: owned } = await db.from("contacts").select("id").eq("owner_id", me).limit(50000);
    ownedContactIds = (owned ?? []).map((r) => r.id as string);
  }
  let touchesQ = db
    .from("events")
    .select("contact_id, payload")
    .eq("type", "linkedin_note")
    .gte("ts", dayStart);
  if (me) touchesQ = touchesQ.in("contact_id", ownedContactIds.length ? ownedContactIds : ["__none__"]);

  const [{ data }, { data: orgs }, { data: touchEvents }] = await Promise.all([
    contactQ,
    db.from("organisations").select("id, name").order("name").limit(1000),
    touchesQ,
  ]);

  const touches = (touchEvents ?? []) as { contact_id: string; payload: { kind?: string } | null }[];
  const requestsToday = touches.filter((t) => t.payload?.kind === "request").length;
  const touchedToday = new Set(touches.map((t) => t.contact_id)).size;
  const requestsRemaining = Math.max(0, DAILY_CAP_REQUESTS - requestsToday);
  const requestsCapHit = requestsRemaining === 0;

  // ICP buyer contacts only (sector set, not partner). We still show
  // contacts with no sector — they're the ones you can now fix inline.
  const icp = ((data ?? []) as unknown as Row[]).filter(
    (r) => r.organisation && !r.organisation.is_partner,
  );
  icp.sort((a, b) => (b.label === "Prospect" ? 1 : 0) - (a.label === "Prospect" ? 1 : 0));

  // Three buckets:
  //   sendable  — not connected, no request sent yet, has a URL → primary work
  //   awaiting  — request sent, not yet a connection → waiting on their accept
  //   reEngage  — already 1st-degree → drop a fresh hook
  const sendable  = icp.filter((r) => !r.linkedin_connected && !r.linkedin_request_sent_at && r.linkedin_url);
  const awaiting  = icp.filter((r) => !r.linkedin_connected && r.linkedin_request_sent_at && r.linkedin_url);
  const reEngage  = icp.filter((r) =>  r.linkedin_connected && r.linkedin_url);
  const needsResearch = icp.filter((r) => !r.linkedin_url && !r.linkedin_connected && !r.linkedin_request_sent_at).slice(0, 30);

  const touchProgress = Math.min(100, Math.round((touchedToday / DAILY_TARGET_TOUCHES) * 100));
  const reqProgress   = Math.min(100, Math.round((requestsToday / DAILY_CAP_REQUESTS) * 100));

  return (
    <main className="px-8 py-6">
      <header className="mb-4 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">LinkedIn — today</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Edit inline, open the profile, send the connection or drop a hook. Daily limits below.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <CounterCard
            label="Connection requests"
            value={`${requestsToday}/${DAILY_CAP_REQUESTS}`}
            sub={requestsCapHit ? "Cap hit — back at 8am tomorrow" : `${requestsRemaining} left in cap`}
            pct={reqProgress}
            color={requestsCapHit ? "emerald" : "amber"}
          />
          <CounterCard
            label="Research touches"
            value={`${touchedToday}/${DAILY_TARGET_TOUCHES}`}
            sub={touchedToday >= DAILY_TARGET_TOUCHES ? "Daily target hit ✓" : `${DAILY_TARGET_TOUCHES - touchedToday} to target`}
            pct={touchProgress}
            color={touchedToday >= DAILY_TARGET_TOUCHES ? "emerald" : "blue"}
          />
        </div>
      </header>

      {/* SEND CONNECTION REQUESTS */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Send connection requests ({sendable.length})
        </h2>
        {requestsCapHit && sendable.length > 0 && (
          <div className="mb-3 rounded border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-sm text-emerald-800">
            ✓ {DAILY_CAP_REQUESTS}/{DAILY_CAP_REQUESTS} connection requests sent today — back at 8am tomorrow.
            You can still mark people as &ldquo;already connected&rdquo; below, and the re-engage section stays open.
          </div>
        )}
        {sendable.length === 0 ? (
          <p className="text-sm text-neutral-400">Nothing to send. Add LinkedIn URLs to contacts to populate this list.</p>
        ) : (
          <ul className="space-y-3">
            {sendable.map((r) => (
              <ContactCard
                key={r.id}
                r={r}
                orgs={orgs ?? []}
                primaryAction={
                  <PendingButton
                    formAction={markLinkedInRequestSent}
                    className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
                    pendingLabel="Sending…"
                    disabled={requestsCapHit}
                    title={requestsCapHit ? "Daily 15-request cap hit" : "Counts toward today's 15/day cap"}
                  >
                    Connection request sent
                  </PendingButton>
                }
                secondaryAction={
                  <PendingButton
                    formAction={markLinkedInAlreadyConnected}
                    className="rounded border border-emerald-300 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                    pendingLabel="Marking…"
                    title="They're already a 1st-degree — moves to re-engage queue, doesn't count toward cap"
                  >
                    Already connected
                  </PendingButton>
                }
              />
            ))}
          </ul>
        )}
      </section>

      {/* RE-ENGAGE 1ST-DEGREES */}
      {reEngage.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Re-engage 1st-degree connections ({reEngage.length})
          </h2>
          <p className="mb-3 text-xs text-neutral-400">
            Already-connected contacts. Drop a fresh hook — counts toward today&apos;s research target, not the request cap.
          </p>
          <ul className="space-y-3">
            {reEngage.slice(0, 30).map((r) => (
              <ContactCard
                key={r.id}
                r={r}
                orgs={orgs ?? []}
                hookOnly
                primaryAction={
                  <PendingButton
                    formAction={markLinkedInHookSent}
                    className="rounded bg-neutral-700 px-3 py-1 text-sm font-medium text-white hover:bg-neutral-800"
                    pendingLabel="Logging…"
                  >
                    Hook sent
                  </PendingButton>
                }
              />
            ))}
          </ul>
        </section>
      )}

      {/* AWAITING (request sent, no accept yet) */}
      {awaiting.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Awaiting accept ({awaiting.length})
          </h2>
          <p className="mb-3 text-xs text-neutral-400">
            Connection request sent — waiting on accept. Once they accept, mark them &ldquo;already connected&rdquo; on the contact page to move them into re-engage.
          </p>
          <ul className="space-y-1 text-sm text-neutral-600">
            {awaiting.slice(0, 30).map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded border border-neutral-100 px-2 py-1.5">
                <Link href={`/contacts/${r.id}`} className="font-medium text-blue-700 hover:underline">{r.full_name}</Link>
                <span className="text-neutral-500">— {r.job_title} — {r.organisation?.name}</span>
                <span className="ml-auto text-xs text-neutral-400">sent {new Date(r.linkedin_request_sent_at!).toLocaleDateString("en-GB")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* NEEDS RESEARCH (no URL yet) */}
      {needsResearch.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Needs research ({needsResearch.length})</h2>
          <p className="mb-3 text-xs text-neutral-400">
            No LinkedIn URL on file — click a name to look them up and paste their profile URL,
            or hit <em>Not on LinkedIn</em> if they genuinely don&apos;t have one.
          </p>
          <ul className="space-y-1 text-sm">
            {needsResearch.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded border border-neutral-100 px-2 py-1.5 text-neutral-600 hover:bg-neutral-50">
                <Link href={`/contacts/${r.id}`} className="font-medium text-blue-700 hover:underline">{r.full_name}</Link>
                <span className="text-neutral-500">— {r.job_title} — {r.organisation?.name} ({r.organisation?.sector ?? "no sector"})</span>
                <form action={markNotOnLinkedIn} className="ml-auto">
                  <input type="hidden" name="contact_id" value={r.id} />
                  <PendingButton
                    className="rounded border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:border-neutral-400 hover:bg-neutral-100"
                    pendingLabel="Saving…"
                    title="They're genuinely not on LinkedIn — remove from research queue"
                  >
                    Not on LinkedIn
                  </PendingButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/** Per-contact card. Two-action variant (send) renders the primary +
 *  secondary buttons side-by-side. hookOnly variant (re-engage) shows only
 *  the primary "Hook sent" button. */
function ContactCard({
  r,
  orgs,
  primaryAction,
  secondaryAction,
  hookOnly,
}: {
  r: Row;
  orgs: { id: string; name: string | null }[];
  primaryAction: React.ReactNode;
  secondaryAction?: React.ReactNode;
  hookOnly?: boolean;
}) {
  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
      <form action={saveLinkedInEdits} className="space-y-2">
        <input type="hidden" name="contact_id" value={r.id} />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input name="full_name" defaultValue={r.full_name ?? ""} className={`${fld} w-48 font-medium`} />
          <input name="job_title" defaultValue={r.job_title ?? ""} className={`${fld} w-56`} placeholder="job title" />
          {r.label === "Prospect" && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Prospect</span>}
          {r.linkedin_url && (
            <a href={r.linkedin_url} target="_blank" rel="noreferrer" className="ml-auto text-blue-600 hover:underline">
              profile ↗
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input name="email" type="email" defaultValue={r.email ?? ""} placeholder="email" className={`${fld} w-64`} />
          <input name="mobile" defaultValue={r.mobile ?? ""} placeholder="mobile" className={`${fld} w-44`} />
          <input name="linkedin_url" defaultValue={r.linkedin_url ?? ""} placeholder="LinkedIn URL" className={`${fld} flex-1 min-w-[12rem]`} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="w-72">
            <Combobox
              name="organisation_id"
              defaultValue={r.organisation?.id ?? ""}
              options={orgs.map((o) => ({ id: o.id, label: o.name ?? "(unnamed)" }))}
              placeholder="Type to search companies…"
              createField="new_organisation_name"
              createLabel="Create company"
            />
          </div>
          <select name="org_sector" defaultValue={r.organisation?.sector ?? ""} className={`${fld} w-44`}>
            <option value="">sector…</option>
            {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input name="hook" placeholder={hookOnly ? "Fresh hook for this 1st-degree…" : "Opening message hook…"} className={`${fld} flex-1`} />
          <PendingButton className="rounded border border-neutral-300 px-3 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-100" pendingLabel="Saving…">
            Save edits
          </PendingButton>
          {primaryAction}
          {secondaryAction}
        </div>
      </form>
    </li>
  );
}

function CounterCard({
  label,
  value,
  sub,
  pct,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  pct: number;
  color: "amber" | "blue" | "emerald";
}) {
  const bar = color === "emerald" ? "bg-emerald-500" : color === "blue" ? "bg-blue-500" : "bg-amber-500";
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-neutral-500">{label}</span>
        <span className="text-lg font-semibold text-neutral-900">{value}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div className={`h-full ${bar} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-neutral-500">{sub}</div>
    </div>
  );
}
