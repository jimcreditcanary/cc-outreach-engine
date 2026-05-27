import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { saveLinkedInHook } from "../actions";

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

export default async function LinkedInPage() {
  const db = serviceClient();
  const { data } = await db
    .from("contacts")
    .select("id, full_name, job_title, linkedin_url, label, linkedin_connected, organisation:organisations(id, name, sector, is_partner)")
    .eq("linkedin_connected", false)
    .limit(4000);

  // ICP buyer contacts only (sector set, not partner).
  const icp = ((data ?? []) as unknown as Row[]).filter(
    (r) => r.organisation && !r.organisation.is_partner && r.organisation.sector,
  );
  icp.sort((a, b) => (b.label === "Prospect" ? 1 : 0) - (a.label === "Prospect" ? 1 : 0));

  const withUrl = icp.filter((r) => r.linkedin_url).slice(0, DAILY);
  const needsResearch = icp.filter((r) => !r.linkedin_url).slice(0, 15);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">LinkedIn — today</h1>
        <p className="text-sm text-neutral-500">
          Open the profile, send a connection request, drop a one-line hook. {icp.filter((r) => r.linkedin_url).length} with a
          profile · {needsResearch.length}+ need research.
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Has profile ({withUrl.length})</h2>
        <ul className="space-y-3">
          {withUrl.map((r) => (
            <li key={r.id} className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-center gap-x-2 text-sm">
                <span className="font-medium">{r.full_name}</span>
                <span className="text-neutral-500">{r.job_title}</span>
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600">
                  {r.organisation?.name} · {r.organisation?.sector}
                </span>
                {r.label === "Prospect" && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Prospect</span>}
                <a href={r.linkedin_url!} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                  profile ↗
                </a>
              </div>
              <form action={saveLinkedInHook} className="mt-2 flex gap-2">
                <input type="hidden" name="contact_id" value={r.id} />
                <input type="hidden" name="organisation_id" value={r.organisation?.id ?? ""} />
                <input
                  name="hook"
                  placeholder="One-line hook / note…"
                  className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
                />
                <button className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700">Done</button>
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
