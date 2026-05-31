import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { saveLinkedInEdits, markLinkedInDone } from "../actions";

export const dynamic = "force-dynamic";

const DAILY_CAP = 15;
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
  organisation: { id: string; name: string | null; sector: string | null; is_partner: boolean } | null;
}

const fld = "rounded border border-neutral-300 px-2 py-1 text-sm";

export default async function LinkedInPage() {
  const db = serviceClient();
  const dayStart = linkedinDayStartUtc(new Date());
  const [{ data }, { data: orgs }, { count: doneToday }] = await Promise.all([
    db
      .from("contacts")
      .select("id, full_name, job_title, email, mobile, linkedin_url, label, linkedin_connected, organisation:organisations(id, name, sector, is_partner)")
      .eq("linkedin_connected", false)
      .limit(4000),
    db.from("organisations").select("id, name").order("name").limit(1000),
    db.from("events").select("*", { count: "exact", head: true }).eq("type", "linkedin_note").gte("ts", dayStart),
  ]);

  // ICP buyer contacts only (sector set, not partner). We still show contacts
  // with no sector — they're the ones you can now fix inline.
  const icp = ((data ?? []) as unknown as Row[]).filter(
    (r) => r.organisation && !r.organisation.is_partner,
  );
  icp.sort((a, b) => (b.label === "Prospect" ? 1 : 0) - (a.label === "Prospect" ? 1 : 0));

  const done = doneToday ?? 0;
  const remaining = Math.max(0, DAILY_CAP - done);
  const capHit = remaining === 0;
  const withUrl = icp.filter((r) => r.linkedin_url).slice(0, remaining);
  const needsResearch = icp.filter((r) => !r.linkedin_url).slice(0, 15);

  return (
    <main className="px-8 py-6">
      <header className="mb-6 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">LinkedIn — today</h1>
        <p className="text-sm text-neutral-500">
          Edit inline, open the profile, send the connection, drop a hook, Done.{" "}
          <span className={capHit ? "font-medium text-emerald-700" : "font-medium text-neutral-700"}>
            {done}/{DAILY_CAP} sent today
          </span>
          {!capHit && ` · ${remaining} left in cap`}
          {capHit && " — back at 8am tomorrow"}
        </p>
      </header>

      {capHit ? (
        <section className="mb-8 rounded-lg border border-emerald-200 bg-emerald-50/50 p-6 text-center">
          <h2 className="mb-1 text-lg font-semibold text-emerald-900">Done for today ✓</h2>
          <p className="text-sm text-emerald-800">
            You&apos;ve sent the {DAILY_CAP} LinkedIn touches for today. Pacing protects deliverability and your sanity.
            Fresh batch unlocks at 8am tomorrow.
          </p>
        </section>
      ) : (
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Has profile ({withUrl.length})</h2>
        <ul className="space-y-3">
          {withUrl.map((r) => (
            <li key={r.id} className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
              <form action={saveLinkedInEdits} className="space-y-2">
                <input type="hidden" name="contact_id" value={r.id} />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <input name="full_name" defaultValue={r.full_name ?? ""} className={`${fld} w-48 font-medium`} />
                  <input name="job_title" defaultValue={r.job_title ?? ""} className={`${fld} w-56`} placeholder="job title" />
                  {r.label === "Prospect" && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Prospect</span>}
                  <a href={r.linkedin_url!} target="_blank" rel="noreferrer" className="ml-auto text-blue-600 hover:underline">profile ↗</a>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <input name="email" type="email" defaultValue={r.email ?? ""} placeholder="email" className={`${fld} w-64`} />
                  <input name="mobile" defaultValue={r.mobile ?? ""} placeholder="mobile" className={`${fld} w-44`} />
                  <input name="linkedin_url" defaultValue={r.linkedin_url ?? ""} placeholder="LinkedIn URL" className={`${fld} flex-1 min-w-[12rem]`} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <select name="organisation_id" defaultValue={r.organisation?.id ?? ""} className={`${fld} w-56`}>
                    <option value="">— no company —</option>
                    {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <input name="new_organisation_name" placeholder="…or new company name" className={`${fld} w-56`} />
                  <select name="org_sector" defaultValue={r.organisation?.sector ?? ""} className={`${fld} w-44`}>
                    <option value="">sector…</option>
                    {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input name="hook" placeholder="One-line hook / note…" className={`${fld} flex-1`} />
                  <button className="rounded border border-neutral-300 px-3 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-100">Save edits</button>
                  <button formAction={markLinkedInDone} className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700">Done — connected</button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      </section>
      )}

      {needsResearch.length > 0 && !capHit && (
        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Needs research ({needsResearch.length})</h2>
          <p className="mb-3 text-xs text-neutral-400">No LinkedIn URL on file — click a name to look them up and paste their profile URL.</p>
          <ul className="space-y-1 text-sm text-neutral-600">
            {needsResearch.map((r) => (
              <li key={r.id}>
                <Link href={`/contacts/${r.id}`} className="text-blue-700 hover:underline">{r.full_name}</Link>
                {" — "}{r.job_title} — {r.organisation?.name} ({r.organisation?.sector ?? "no sector"})
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
