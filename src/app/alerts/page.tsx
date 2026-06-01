import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { dismissAlertAction, undismissAlertAction } from "./actions";
import { OwnerFilter } from "@/components/OwnerFilter";
import { resolveOwnerFilter } from "@/lib/auth/owner";
import { RowIconAction } from "@/components/RowIconAction";
import { decodeHtmlEntities } from "@/lib/text/decode";

export const dynamic = "force-dynamic";

interface Alert {
  id: string;
  organisation_id: string | null;
  contact_id: string | null;
  kind: string;
  title: string;
  link: string | null;
  summary: string | null;
  source: string | null;
  ts: string;
  dismissed_at: string | null;
  organisation: { id: string; name: string | null; sector: string | null } | null;
}

const kindBadge: Record<string, string> = {
  press: "bg-amber-100 text-amber-800",
  post: "bg-blue-100 text-blue-800",
  hiring: "bg-purple-100 text-purple-800",
};

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ owner?: string; show?: string }> }) {
  const { owner, show } = await searchParams;
  const showDismissed = show === "dismissed";
  const db = serviceClient();
  const ownerId = await resolveOwnerFilter(owner);

  let q = db
    .from("alerts")
    .select("id, organisation_id, contact_id, kind, title, link, summary, source, ts, dismissed_at, organisation:organisations(id, name, sector)")
    .order("ts", { ascending: false })
    .limit(200);
  if (ownerId) q = q.eq("owner_id", ownerId);
  if (showDismissed) q = q.not("dismissed_at", "is", null);
  else q = q.is("dismissed_at", null);
  const { data } = await q;
  const alerts = (data ?? []) as unknown as Alert[];

  return (
    <main className="px-8 py-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <div>
          <h1 className="text-xl font-semibold">Alerts</h1>
          <p className="text-sm text-neutral-500">
            Companies in your CRM mentioned in regulatory press + freshly-published company posts.
            A reason to reach out.
          </p>
        </div>
        <OwnerFilter current={owner} pathname="/alerts" extraParams={{ show }} />
      </header>

      <div className="mb-4 flex items-center gap-2 text-xs">
        <Link href={`/alerts${owner ? `?owner=${owner}` : ""}`} className={`rounded px-2 py-1 ${!showDismissed ? "bg-amber-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>
          Active ({alerts.length})
        </Link>
        <Link href={`/alerts?show=dismissed${owner ? `&owner=${owner}` : ""}`} className={`rounded px-2 py-1 ${showDismissed ? "bg-neutral-700 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>
          Dismissed
        </Link>
      </div>

      {alerts.length === 0 ? (
        <p className="text-sm text-neutral-400">
          {showDismissed ? "No dismissed alerts." : "No alerts. Run the daily cron or enrich a company to populate."}
        </p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.id} className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <span className={`rounded px-1.5 py-0.5 font-medium uppercase ${kindBadge[a.kind] ?? "bg-neutral-100 text-neutral-700"}`}>{a.kind}</span>
                {a.organisation && (
                  <Link href={`/companies/${a.organisation.id}`} className="font-medium text-blue-700 hover:underline">
                    {a.organisation.name}
                  </Link>
                )}
                {a.organisation?.sector && <span>· {a.organisation.sector}</span>}
                <span className="ml-auto text-neutral-400">{new Date(a.ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              </div>
              {a.link ? (
                <a href={a.link} target="_blank" rel="noreferrer" className="font-medium text-neutral-900 hover:underline">
                  {decodeHtmlEntities(a.title)}
                </a>
              ) : (
                <span className="font-medium text-neutral-900">{decodeHtmlEntities(a.title)}</span>
              )}
              {a.summary && <p className="mt-1 text-sm text-neutral-600">{decodeHtmlEntities(a.summary)}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {a.source && <span className="text-xs text-neutral-400">via {a.source}</span>}
                <form action={a.dismissed_at ? undismissAlertAction : dismissAlertAction} className="ml-auto">
                  <input type="hidden" name="id" value={a.id} />
                  <RowIconAction kind={a.dismissed_at ? "restore" : "dismiss"} />
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
