import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { createOrg, deleteOrg } from "../actions";
import { OwnerFilter } from "@/components/OwnerFilter";
import { resolveOwnerFilter } from "@/lib/auth/owner";
import { SectorBadge } from "@/components/SectorBadge";
import { RowIconAction } from "@/components/RowIconAction";
import { PendingButton } from "@/components/PendingButton";
import { SortableTh } from "@/components/SortableTh";
import { parseSort } from "@/lib/table/sort";

export const dynamic = "force-dynamic";

const SORT_COLS = ["name", "sector", "tier", "label"] as const;

const SECTORS = ["bank", "broker", "building_society", "credit_union", "direct_lender", "marketplace", "sme_lender", "utility"];

interface OrgRow {
  id: string;
  name: string | null;
  sector: string | null;
  tier: number | null;
  label: string | null;
  is_partner: boolean;
  icp: boolean | null;
}

const PAGE = 100;

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; owner?: string; sort?: string }> }) {
  const { q, page: pageStr, owner, sort: sortRaw } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? "1") || 1);
  const from = (page - 1) * PAGE;
  const db = serviceClient();
  const ownerId = await resolveOwnerFilter(owner);
  const sort = parseSort(sortRaw, SORT_COLS, { col: "name", dir: "asc" });
  let query = db
    .from("organisations")
    .select("id, name, sector, tier, label, is_partner, icp", { count: "exact" })
    .order(sort.col, { ascending: sort.dir === "asc", nullsFirst: false })
    .range(from, from + PAGE - 1);
  if (q) query = query.ilike("name", `%${q}%`);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, count } = await query;
  const orgs = (data ?? []) as OrgRow[];
  const total = count ?? orgs.length;
  const lastPage = Math.max(1, Math.ceil(total / PAGE));
  const qp = (p: number) => `/companies?${new URLSearchParams({ ...(q ? { q } : {}), ...(owner ? { owner } : {}), ...(sortRaw ? { sort: sortRaw } : {}), page: String(p) })}`;
  const hdrParams = { ...(q ? { q } : {}), ...(owner ? { owner } : {}) };

  return (
    <main className="px-8 py-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Companies</h1>
        <OwnerFilter current={owner} pathname="/companies" extraParams={{ q }} />
        <span className="text-sm text-neutral-500">{total}{q ? " matches" : ""} · showing {orgs.length === 0 ? 0 : from + 1}–{from + orgs.length}</span>
      </header>

      <form className="mb-3">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search companies…"
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
      </form>

      <form action={createOrg} className="mb-5 flex flex-wrap gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <input name="name" placeholder="New company name…" className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm" required />
        <select name="sector" className="rounded border border-neutral-300 px-2 py-1.5 text-sm" defaultValue="">
          <option value="">sector…</option>
          {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <PendingButton className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" pendingLabel="Adding…">+ Add company</PendingButton>
      </form>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-neutral-400">
          <tr>
            <SortableTh label="Name" col="name" sort={sort} basePath="/companies" params={hdrParams} className="py-1" />
            <SortableTh label="Sector" col="sector" sort={sort} basePath="/companies" params={hdrParams} />
            <SortableTh label="Tier" col="tier" sort={sort} basePath="/companies" params={hdrParams} />
            <SortableTh label="Label" col="label" sort={sort} basePath="/companies" params={hdrParams} />
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orgs.map((o) => (
            <tr key={o.id} className="border-t border-neutral-100 hover:bg-neutral-100">
              <td className="py-1.5">
                <Link href={`/companies/${o.id}`} className="font-medium text-blue-700 hover:underline">
                  {o.name}
                </Link>
                {o.is_partner && <span className="ml-2 rounded bg-purple-100 px-1.5 text-xs text-purple-700">partner</span>}
              </td>
              <td className="text-neutral-600">{o.sector ? <SectorBadge sector={o.sector} /> : "—"}</td>
              <td className="text-neutral-600">{o.tier ?? "—"}</td>
              <td className="text-neutral-600">{o.label ?? "—"}</td>
              <td className="w-10 text-right">
                <form>
                  <input type="hidden" name="id" value={o.id} />
                  <RowIconAction
                    kind="delete"
                    formAction={deleteOrg}
                    confirmMessage={`Delete ${o.name}? Its deals, contacts, notes and history go with it.`}
                  />
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {lastPage > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? <Link href={qp(page - 1)} className="text-blue-700 hover:underline">← Prev</Link> : <span className="text-neutral-300">← Prev</span>}
          <span className="text-neutral-500">Page {page} of {lastPage}</span>
          {page < lastPage ? <Link href={qp(page + 1)} className="text-blue-700 hover:underline">Next →</Link> : <span className="text-neutral-300">Next →</span>}
        </div>
      )}
    </main>
  );
}
