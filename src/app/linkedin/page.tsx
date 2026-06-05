import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import {
  saveLinkedInEdits,
  markLinkedInRequestSent,
  markLinkedInAlreadyConnected,
  markLinkedInHookSent,
  markNotOnLinkedIn,
  skipContact,
  SKIP_REASONS,
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

// Days a contact stays out of the queue after any LinkedIn touch (request,
// already-connected, or re-engage hook). Stops the queue from re-suggesting
// people you spoke to yesterday.
const COOLDOWN_DAYS = 30;

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
  linkedin_last_touched_at: string | null;
  organisation: { id: string; name: string | null; sector: string | null; is_partner: boolean } | null;
}

const fld = "rounded border border-neutral-300 px-2 py-1 text-sm";

// Show 50 rows per page. Two-tab nav: Send (actionable lists) + Research
// (needs-URL lookup). The `tab` + `page` URL params are the source of
// truth so a refresh / shared link keeps you where you were.
const PAGE = 50;

export default async function LinkedInPage({ searchParams }: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const tab = (sp.tab === "research" ? "research" : "send") as "send" | "research";
  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);

  const db = serviceClient();
  const dayStart = linkedinDayStartUtc(new Date());
  const me = await currentUserId();

  // Every DB call wrapped in try/catch so a single missing column or
  // permissions issue degrades to a readable error banner instead of
  // a 500 page. Each failure captures both the error and an empty result
  // so the rest of the render can keep working.
  //
  // Errors live on an object (not bare `let`s) — TS's control-flow
  // analysis won't narrow object properties through async closures, which
  // means `errs.contact && errs.contact.message` correctly types as
  // SafeError instead of getting reduced to never.
  type SafeError = { code?: string; message?: string };
  const errs: { contact: SafeError | null; touch: SafeError | null; orgs: SafeError | null } = {
    contact: null, touch: null, orgs: null,
  };

  // Per-user scoping for the main queue.
  let contactQ = db
    .from("contacts")
    .select("id, full_name, job_title, email, mobile, linkedin_url, label, linkedin_connected, linkedin_request_sent_at, linkedin_last_touched_at, organisation:organisations(id, name, sector, is_partner)")
    .eq("not_on_linkedin", false)
    .is("skipped_at", null)
    .limit(4000);
  if (me) contactQ = contactQ.eq("owner_id", me);

  // Today's LinkedIn touch events for THIS operator. Use an embedded
  // INNER JOIN to filter by owner — previously we pre-fetched ownedContactIds
  // and then .in()-d them, but the IN-list URL hits Supabase's ~8KB limit
  // past a few hundred contacts and returns 400 Bad Request.
  let touchesQ = me
    ? db
        .from("events")
        .select("contact_id, payload, contacts!inner(owner_id)")
        .eq("type", "linkedin_note")
        .gte("ts", dayStart)
        .eq("contacts.owner_id", me)
    : db
        .from("events")
        .select("contact_id, payload")
        .eq("type", "linkedin_note")
        .gte("ts", dayStart);

  // Run all three in parallel, but treat each as best-effort. Supabase's
  // PostgrestBuilder.then() returns the response object even on PG errors
  // (the error lives in `.error`), so a try/catch only fires on hard fetch
  // failures — both paths feed the same null-data + SafeError pattern.
  const fetchState: {
    data: unknown[] | null;
    orgs: { id: string; name: string | null }[];
    touchEvents: { contact_id: string; payload: { kind?: string } | null }[] | null;
  } = { data: null, orgs: [], touchEvents: null };

  await Promise.all([
    (async () => {
      try {
        const res = await contactQ;
        fetchState.data = res.data as unknown[] | null;
        errs.contact = (res.error as SafeError | null) ?? null;
      } catch (e) { errs.contact = { message: (e as Error).message }; }
    })(),
    (async () => {
      try {
        const res = await db.from("organisations").select("id, name").order("name").limit(1000);
        fetchState.orgs = (res.data ?? []) as { id: string; name: string | null }[];
        errs.orgs = (res.error as SafeError | null) ?? null;
      } catch (e) { errs.orgs = { message: (e as Error).message }; }
    })(),
    (async () => {
      try {
        const res = await touchesQ;
        fetchState.touchEvents = (res.data ?? []) as { contact_id: string; payload: { kind?: string } | null }[];
        errs.touch = (res.error as SafeError | null) ?? null;
      } catch (e) { errs.touch = { message: (e as Error).message }; }
    })(),
  ]);
  const data = fetchState.data;
  const orgs = fetchState.orgs;
  const touchEvents = fetchState.touchEvents;

  const touches = (touchEvents ?? []) as { contact_id: string; payload: { kind?: string } | null }[];
  const requestsToday = touches.filter((t) => t.payload?.kind === "request").length;
  const touchedToday = new Set(touches.map((t) => t.contact_id)).size;
  const requestsRemaining = Math.max(0, DAILY_CAP_REQUESTS - requestsToday);
  const requestsCapHit = requestsRemaining === 0;

  // ICP buyer contacts only (sector set, not partner). We still show
  // contacts with no sector — they're the ones you can now fix inline.
  // Guard against malformed organisation joins (sometimes returns an array).
  const icp = ((data ?? []) as unknown as Row[]).filter((r) => {
    const org = r.organisation as unknown;
    if (!org) return false;
    // Supabase can return embedded relations as either an object or a
    // single-element array depending on the relation cardinality. Handle both.
    const obj = Array.isArray(org) ? org[0] : (org as Row["organisation"]);
    return !!obj && !obj.is_partner;
  });
  icp.sort((a, b) => (b.label === "Prospect" ? 1 : 0) - (a.label === "Prospect" ? 1 : 0));

  // 30-day cooldown — any contact touched in the last N days drops out of
  // every queue (research, send, re-engage) until the cooldown lapses.
  const cooldownCutoff = Date.now() - COOLDOWN_DAYS * 86_400_000;
  const cooled = (r: Row) =>
    !r.linkedin_last_touched_at || new Date(r.linkedin_last_touched_at).getTime() < cooldownCutoff;

  // Two buckets:
  //   sendable  — not connected, no request sent yet, has a URL → primary work
  //   reEngage  — already 1st-degree → drop a fresh hook (with cooldown)
  // (Contacts with linkedin_request_sent_at fall out of "sendable" and
  // silently disappear from the queue. We used to surface them as
  // "Awaiting accept" but Jim doesn't track who accepts/doesn't.)
  const sendableAll = icp.filter((r) => !r.linkedin_connected && !r.linkedin_request_sent_at && r.linkedin_url && cooled(r));
  const reEngageAll = icp.filter((r) =>  r.linkedin_connected && r.linkedin_url && cooled(r));
  const needsResearchAll = icp.filter((r) => !r.linkedin_url && !r.linkedin_connected && !r.linkedin_request_sent_at && cooled(r));

  // Paginate the main list for the active tab; the re-engage section
  // stays capped without per-page pagination.
  const mainList = tab === "send" ? sendableAll : needsResearchAll;
  const totalPages = Math.max(1, Math.ceil(mainList.length / PAGE));
  const safePage = Math.min(page, totalPages);
  const from = (safePage - 1) * PAGE;
  const sendable = tab === "send" ? sendableAll.slice(from, from + PAGE) : sendableAll;
  const needsResearch = tab === "research" ? needsResearchAll.slice(from, from + PAGE) : needsResearchAll.slice(0, PAGE);
  const reEngage = reEngageAll.slice(0, 30);

  const touchProgress = Math.min(100, Math.round((touchedToday / DAILY_TARGET_TOUCHES) * 100));
  const reqProgress   = Math.min(100, Math.round((requestsToday / DAILY_CAP_REQUESTS) * 100));

  return (
    <main className="px-8 py-6">
      <header className="mb-4 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">LinkedIn — today</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Edit inline, open the profile, send the connection or drop a hook. Both counters reset at 8am UK.
          Contacts touched in the last {COOLDOWN_DAYS} days stay out of the queue.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <CounterCard
            label="Today's connection requests"
            value={`${requestsToday}/${DAILY_CAP_REQUESTS}`}
            sub={requestsCapHit ? "Daily cap hit — resets 8am" : `${requestsRemaining} left in today's 15-request cap`}
            pct={reqProgress}
            color={requestsCapHit ? "emerald" : "amber"}
          />
          <CounterCard
            label="Today's research touches"
            value={`${touchedToday}/${DAILY_TARGET_TOUCHES}`}
            sub={touchedToday >= DAILY_TARGET_TOUCHES ? "Daily target hit ✓ — resets 8am" : `${DAILY_TARGET_TOUCHES - touchedToday} to today's 30-touch target`}
            pct={touchProgress}
            color={touchedToday >= DAILY_TARGET_TOUCHES ? "emerald" : "blue"}
          />
        </div>
      </header>

      {/* Tabs — Send (sendable + awaiting + re-engage) vs Research (no URL yet). */}
      <div className="mb-4 flex items-center gap-2 text-sm">
        <TabLink href={`/linkedin?tab=send`} active={tab === "send"} label="Send requests" count={sendableAll.length} />
        <TabLink href={`/linkedin?tab=research`} active={tab === "research"} label="Research" count={needsResearchAll.length} />
        <span className="ml-3 text-xs text-neutral-400">Page {safePage} of {totalPages} · showing {mainList.length === 0 ? 0 : from + 1}–{Math.min(from + PAGE, mainList.length)} of {mainList.length}</span>
      </div>

      {/* Roll every captured error into a single banner block so a missing
          column / permissions issue / etc never crashes the page. Snapshot
          to const so TS narrows inside the JSX nodes. */}
      {(() => {
        const ce = errs.contact; const te = errs.touch; const ge = errs.orgs;
        if (!ce && !te && !ge) return null;
        return (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {ce && <div><strong>Queue load failed:</strong> {ce.message}</div>}
          {te && <div><strong>Today&apos;s touches load failed:</strong> {te.message}</div>}
          {ge && <div><strong>Companies load failed:</strong> {ge.message}</div>}
          {ce?.code === "42703" && (() => {
            // Parse the missing column out of the Postgres message
            // ("column contacts.X does not exist") so the hint actually
            // points at the right migration.
            const colMatch = /column\s+\S*?\.?(\w+)\s+does not exist/i.exec(ce.message ?? "");
            const col = colMatch?.[1];
            const MIG_FOR_COLUMN: Record<string, string> = {
              not_on_linkedin: "023 (alter table public.contacts add column not_on_linkedin boolean not null default false)",
              linkedin_request_sent_at: "024 (alter table public.contacts add column linkedin_request_sent_at timestamptz)",
              linkedin_last_touched_at: "025 (alter table public.contacts add column linkedin_last_touched_at timestamptz)",
              owner_id: "018 (alter table public.contacts add column owner_id uuid references auth.users(id))",
              needs_research: "021 (alter table public.contacts add column needs_research boolean not null default false)",
            };
            const hint = col && MIG_FOR_COLUMN[col];
            return (
              <p className="mt-1 text-xs">
                Missing column: <code className="rounded bg-red-100 px-1">{col ?? "(unknown)"}</code>.
                {hint && <> Run migration {hint} in Supabase SQL Editor.</>}
              </p>
            );
          })()}
        </div>
        );
      })()}

      {tab === "send" && <>
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

      <Paginator tab="send" page={safePage} totalPages={totalPages} />
      {/* "Awaiting accept" section was here — removed. Tracking who
          accepts a LinkedIn request and who doesn't isn't worth the
          maintenance overhead. Once you click "Connection request sent"
          the contact disappears from the send queue and that's enough.
          The data (linkedin_request_sent_at) is still captured so we
          can revive this view later if needed. */}
      </>}

      {tab === "research" && <>
      {/* NEEDS RESEARCH (no URL yet) */}
      {needsResearchAll.length === 0 ? (
        <p className="text-sm text-neutral-400">
          Nothing needs research — every owned contact either has a LinkedIn URL or is flagged as not-on-LinkedIn.
        </p>
      ) : needsResearch.length > 0 && (
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
      <Paginator tab="research" page={safePage} totalPages={totalPages} />
      </>}
    </main>
  );
}

function TabLink({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      className={`rounded-md border px-3 py-1.5 font-medium transition-colors ${
        active
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
      }`}
    >
      {label} <span className={`ml-1 rounded px-1.5 text-xs ${active ? "bg-amber-200 text-amber-900" : "bg-neutral-100 text-neutral-500"}`}>{count}</span>
    </Link>
  );
}

function Paginator({ tab, page, totalPages }: { tab: "send" | "research"; page: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  const href = (p: number) => `/linkedin?tab=${tab}&page=${p}`;
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      {page > 1
        ? <Link href={href(page - 1)} className="text-blue-700 hover:underline">← Prev</Link>
        : <span className="text-neutral-300">← Prev</span>}
      <span className="text-neutral-500">Page {page} of {totalPages}</span>
      {page < totalPages
        ? <Link href={href(page + 1)} className="text-blue-700 hover:underline">Next →</Link>
        : <span className="text-neutral-300">Next →</span>}
    </div>
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

      {/* Skip with reason — separate form so it doesn't submit the edits.
          Stored on contacts.skip_reason + skipped_at; removes the contact
          from the LinkedIn queue + sequence picker until manually unskipped
          from the contact page. */}
      <form action={skipContact} className="mt-2 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-2 text-xs">
        <input type="hidden" name="contact_id" value={r.id} />
        <span className="uppercase tracking-wide text-neutral-400">Skip:</span>
        <select name="skip_reason" defaultValue={SKIP_REASONS[0]} className={`${fld} w-52 !text-xs`}>
          {SKIP_REASONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          name="skip_note"
          placeholder="extra context (only used if 'Other')"
          className={`${fld} flex-1 min-w-[8rem] !text-xs`}
        />
        <PendingButton
          className="rounded border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
          pendingLabel="Skipping…"
          title="Soft-suppress from LinkedIn + sequences. Reversible from the contact page."
        >
          Skip + reason
        </PendingButton>
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
