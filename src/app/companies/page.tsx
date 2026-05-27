import Link from "next/link";
import { serviceClient } from "@/lib/db/client";

export const dynamic = "force-dynamic";

interface OrgRow {
  id: string;
  name: string | null;
  sector: string | null;
  tier: number | null;
  label: string | null;
  is_partner: boolean;
  icp: boolean | null;
}

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string; all?: string }> }) {
  const { q, all } = await searchParams;
  const showAll = all === "1";
  const db = serviceClient();
  let query = db
    .from("organisations")
    .select("id, name, sector, tier, label, is_partner, icp")
    .order("name", { ascending: true })
    .limit(400);
  // Default to your real (buyer) companies; external/investor orgs are
  // auto-created from contact/note references and hidden unless ?all=1.
  if (!showAll) query = query.eq("icp", true);
  if (q) query = query.ilike("name", `%${q}%`);
  const { data } = await query;
  const orgs = (data ?? []) as OrgRow[];

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-2 flex items-baseline justify-between border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Companies</h1>
        <span className="text-sm text-neutral-500">{orgs.length}{q ? " matches" : showAll ? " (incl. external)" : ""}</span>
      </header>
      <p className="mb-4 text-xs text-neutral-400">
        {showAll ? (
          <>Showing all orgs incl. external/investor. <Link href="/companies" className="text-blue-700 hover:underline">Show buyers only</Link></>
        ) : (
          <>Your buyer companies. <Link href="/companies?all=1" className="text-blue-700 hover:underline">Show external/investor orgs too</Link></>
        )}
      </p>

      <form className="mb-4">
        {showAll && <input type="hidden" name="all" value="1" />}
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search companies…"
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
      </form>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-neutral-400">
          <tr>
            <th className="py-1">Name</th>
            <th>Sector</th>
            <th>Tier</th>
            <th>Label</th>
          </tr>
        </thead>
        <tbody>
          {orgs.map((o) => (
            <tr key={o.id} className="border-t border-neutral-100 hover:bg-neutral-50">
              <td className="py-1.5">
                <Link href={`/companies/${o.id}`} className="font-medium text-blue-700 hover:underline">
                  {o.name}
                </Link>
                {o.is_partner && <span className="ml-2 rounded bg-purple-100 px-1.5 text-xs text-purple-700">partner</span>}
              </td>
              <td className="text-neutral-600">{o.sector ?? "—"}</td>
              <td className="text-neutral-600">{o.tier ?? "—"}</td>
              <td className="text-neutral-600">{o.label ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
