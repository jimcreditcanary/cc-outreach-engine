import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { createDeal, deleteDeal } from "../actions";
import { OwnerFilter } from "@/components/OwnerFilter";
import { resolveOwnerFilter } from "@/lib/auth/owner";
import { RowIconAction } from "@/components/RowIconAction";

export const dynamic = "force-dynamic";

const STATUS = ["open", "won", "lost"];
const MEDDICC: { key: string; label: string }[] = [
  { key: "metrics", label: "Metrics" },
  { key: "economic_buyer", label: "Econ. buyer" },
  { key: "decision_criteria", label: "Criteria" },
  { key: "decision_process", label: "Process" },
  { key: "identified_pain", label: "Pain" },
  { key: "champion", label: "Champion" },
  { key: "competition", label: "Competition" },
];

interface DealRow {
  id: string;
  title: string | null;
  status: string;
  stage: string | null;
  value: number | null;
  proposal_exists: boolean;
  organisation: { id: string; name: string | null; tier: number | null } | null;
}

export default async function DealsPage({ searchParams }: { searchParams: Promise<{ tier?: string; status?: string; owner?: string }> }) {
  const { tier, status, owner } = await searchParams;
  const db = serviceClient();
  const ownerId = await resolveOwnerFilter(owner);

  const meddiccCols = MEDDICC.map((m) => `meddicc_${m.key}_filled`).join(", ");
  let query = db
    .from("deals")
    .select("id, title, status, stage, value, proposal_exists, organisation:organisations(id, name, tier)")
    .order("value", { ascending: false, nullsFirst: false })
    .limit(500);
  if (status) query = query.eq("status", status);
  if (ownerId) query = query.eq("owner_id", ownerId);
  let nudgeQuery = db
    .from("deals")
    .select(`id, title, value, next_best_action, ${meddiccCols}, organisation:organisations(name, sector)`)
    .eq("status", "open")
    .eq("proposal_exists", true)
    .order("value", { ascending: false, nullsFirst: false });
  if (ownerId) nudgeQuery = nudgeQuery.eq("owner_id", ownerId);
  const [{ data }, { data: nudgeData }, { data: orgData }] = await Promise.all([
    query,
    // "Needs action" feed (the old T1 view): live deals with a proposal,
    // each with its single next-best-action + MEDDICC gaps.
    nudgeQuery,
    db.from("organisations").select("id, name").order("name").limit(1000),
  ]);
  let deals = (data ?? []) as unknown as DealRow[];
  if (tier) deals = deals.filter((d) => String(d.organisation?.tier ?? "") === tier);
  const nudges = (nudgeData ?? []) as unknown as Array<Record<string, unknown> & { id: string; title: string | null; value: number | null; next_best_action: string | null; organisation: { name: string | null; sector: string | null } | null }>;
  const orgs = orgData ?? [];

  const tierTab = (t: string, label: string) => {
    const params = new URLSearchParams();
    if (t) params.set("tier", t);
    if (status) params.set("status", status);
    const active = (tier ?? "") === t;
    return (
      <Link
        key={t || "all"}
        href={`/deals${params.toString() ? `?${params}` : ""}`}
        className={`rounded px-2 py-1 text-xs font-medium ${active ? "bg-amber-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
      >
        {label}
      </Link>
    );
  };

  return (
    <main className="px-8 py-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Deals</h1>
        <OwnerFilter current={owner} pathname="/deals" extraParams={{ tier, status }} />
        <span className="text-sm text-neutral-500">{deals.length}</span>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs uppercase text-neutral-400">Tier</span>
        {tierTab("", "All")}
        {tierTab("1", "T1")}
        {tierTab("2", "T2")}
        {tierTab("3", "T3")}
        <span className="ml-3 text-xs uppercase text-neutral-400">Status</span>
        <Link href={`/deals${tier ? `?tier=${tier}` : ""}`} className={`rounded px-2 py-1 text-xs font-medium ${!status ? "bg-neutral-700 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>any</Link>
        {STATUS.map((s) => {
          const params = new URLSearchParams();
          if (tier) params.set("tier", tier);
          params.set("status", s);
          return <Link key={s} href={`/deals?${params}`} className={`rounded px-2 py-1 text-xs font-medium ${status === s ? "bg-neutral-700 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>{s}</Link>;
        })}
      </div>

      <form action={createDeal} className="mb-5 flex flex-wrap gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <input name="title" placeholder="New deal title…" className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm" required />
        <select name="organisation_id" className="rounded border border-neutral-300 px-2 py-1.5 text-sm" defaultValue="" required>
          <option value="" disabled>company…</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <input name="value" type="number" placeholder="£ value" className="w-28 rounded border border-neutral-300 px-2 py-1.5 text-sm" />
        <button className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">+ Add deal</button>
      </form>

      {/* Needs action — live deals (open + proposal) with their next-best-action. */}
      {nudges.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-700">Needs action — live deals ({nudges.length})</h2>
          <ul className="space-y-3">
            {nudges.map((d) => (
              <li key={d.id} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                <div className="flex flex-wrap items-center gap-x-2 text-sm">
                  <Link href={`/deals/${d.id}`} className="font-medium text-blue-700 hover:underline">{d.organisation?.name}</Link>
                  <span className="text-neutral-500">{d.title}</span>
                  {typeof d.value === "number" && <span className="text-neutral-400">£{d.value.toLocaleString()}</span>}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {MEDDICC.map((m) => {
                    const filled = d[`meddicc_${m.key}_filled`] as boolean;
                    return <span key={m.key} className={`rounded px-1.5 py-0.5 text-xs ${filled ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-400"}`}>{m.label}</span>;
                  })}
                </div>
                {d.next_best_action && (
                  <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-white/70 p-2 font-sans text-sm text-amber-900">{d.next_best_action}</pre>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-neutral-400">
          <tr><th className="py-1">Deal</th><th>Company</th><th>Tier</th><th>Stage</th><th>Status</th><th className="text-right">Value</th><th></th></tr>
        </thead>
        <tbody>
          {deals.map((d) => (
            <tr key={d.id} className="border-t border-neutral-100 hover:bg-neutral-50">
              <td className="py-1.5">
                <Link href={`/deals/${d.id}`} className="font-medium text-blue-700 hover:underline">{d.title ?? "(untitled)"}</Link>
                {d.proposal_exists && <span className="ml-1 rounded bg-emerald-100 px-1 text-xs text-emerald-700">proposal</span>}
              </td>
              <td className="text-neutral-600">{d.organisation?.name ?? "—"}</td>
              <td className="text-neutral-600">{d.organisation?.tier ? `T${d.organisation.tier}` : "—"}</td>
              <td className="text-neutral-600">{d.stage ?? "—"}</td>
              <td className="text-neutral-600">{d.status}</td>
              <td className="text-right text-neutral-600">{typeof d.value === "number" ? `£${d.value.toLocaleString()}` : "—"}</td>
              <td className="w-10 text-right">
                <form>
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="organisation_id" value={d.organisation?.id ?? ""} />
                  <RowIconAction
                    kind="delete"
                    formAction={deleteDeal}
                    confirmMessage={`Delete deal "${d.title ?? "(untitled)"}"? This cannot be undone.`}
                  />
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
