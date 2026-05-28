import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { saveLinkedInEdits, markLinkedInDone } from "../actions";

export const dynamic = "force-dynamic";

const DAILY = 30;

interface Row {
  id: string;
  full_name: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  label: string | null;
  linkedin_connected: boolean;
  organisation: { id: string; name: string | null; sector: string | null; is_partner: boolean } | null;
}

const fld = "rounded border border-neutral-300 px-2 py-1 text-sm";

export default async function LinkedInPage() {
  const db = serviceClient();
  const [{ data }, { data: orgs }] = await Promise.all([
    db
      .from("contacts")
      .select("id, full_name, job_title, linkedin_url, label, linkedin_connected, organisation:organisations(id, name, sector, is_partner)")
      .eq("linkedin_connected", false)
      .limit(4000),
    db.from("organisations").select("id, name").order("name").limit(1000),
  ]);

  // ICP buyer contacts only (sector set, not partner).
  const icp = ((data ?? []) as unknown as Row[]).filter(
    (r) => r.organisation && !r.organisation.is_partner && r.organisation.sector,
  );
  icp.sort((a, b) => (b.label === "Prospect" ? 1 : 0) - (a.label === "Prospect" ? 1 : 0));

  const withUrl = icp.filter((r) => r.linkedin_url).slice(0, DAILY);
  const needsResearch = icp.filter((r) => !r.linkedin_url).slice(0, 15);

  return (
    <main className="w-full px-[50px] py-8">
      <header className="mb-6 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">LinkedIn — today</h1>
        <p className="text-sm text-neutral-500">
          Edit details inline, open the profile, send the connection request, drop a one-line hook, hit Done. {icp.filter((r) => r.linkedin_url).length} with a
          profile · {needsResearch.length}+ need research.
        </p>
      </header>

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
                  <select name="organisation_id" defaultValue={r.organisation?.id ?? ""} className={`${fld} w-56`}>
                    <option value="">— no company —</option>
                    {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  {r.label === "Prospect" && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Prospect</span>}
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600">{r.organisation?.sector}</span>
                  <a href={r.linkedin_url!} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">profile ↗</a>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input name="linkedin_url" defaultValue={r.linkedin_url ?? ""} placeholder="LinkedIn URL" className={`${fld} w-80`} />
                  <input name="hook" placeholder="One-line hook / note…" className={`${fld} flex-1`} />
                  <button className="rounded border border-neutral-300 px-3 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-100">Save edits</button>
                  <button formAction={markLinkedInDone} className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700">Done — connected</button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      </section>

      {needsResearch.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Needs research ({needsResearch.length})</h2>
          <p className="mb-3 text-xs text-neutral-400">No LinkedIn URL on file — click a name to look them up and paste their profile URL.</p>
          <ul className="space-y-1 text-sm text-neutral-600">
            {needsResearch.map((r) => (
              <li key={r.id}>
                <Link href={`/contacts/${r.id}`} className="text-blue-700 hover:underline">{r.full_name}</Link>
                {" — "}{r.job_title} — {r.organisation?.name} ({r.organisation?.sector})
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
