// Onboarding project tracker — every case with its stage progress, filterable
// by active / onboarded / all. Cases are started from a deal's Hot work-deal
// page; each row links into the wizard (or the review view once submitted).

import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { fmtDate } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  company_number: string | null;
  status: string;
  product_groups: string[];
  updated_at: string;
}

// Five headline stages for the progress bar.
const STAGES = ["Internal", "Merchant", "Checks", "Docs", "Onboarded"];
const COMPLETED_BY_STATUS: Record<string, number> = {
  started: 0, internal_complete: 1, merchant_invited: 1, merchant_in_progress: 1,
  merchant_submitted: 2, ubo_checks: 3, docs_generated: 4, awaiting_approval: 4, onboarded: 5, cancelled: 0,
};

function StatusBadge({ status }: { status: string }) {
  const cls = status === "onboarded" ? "bg-emerald-100 text-emerald-800"
    : status === "cancelled" ? "bg-neutral-200 text-neutral-600"
    : status === "started" ? "bg-amber-100 text-amber-800"
    : "bg-blue-100 text-blue-800";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{status.replace(/_/g, " ")}</span>;
}

function StageBar({ status }: { status: string }) {
  const done = COMPLETED_BY_STATUS[status] ?? 0;
  return (
    <div className="flex items-center gap-1" title={`${STAGES[Math.min(done, STAGES.length - 1)]}`}>
      {STAGES.map((label, i) => (
        <span key={label} className={`h-1.5 w-6 rounded-full ${i < done ? "bg-emerald-500" : "bg-neutral-200"}`} aria-label={label} />
      ))}
    </div>
  );
}

export default async function OnboardingTrackerPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const filter = (await searchParams).filter === "onboarded" ? "onboarded" : (await searchParams).filter === "all" ? "all" : "active";

  const db = serviceClient();
  let q = db.from("onboarding_cases").select("id, company_number, status, product_groups, updated_at").order("updated_at", { ascending: false }).limit(200);
  if (filter === "active") q = q.neq("status", "cancelled").neq("status", "onboarded");
  else if (filter === "onboarded") q = q.eq("status", "onboarded");
  const { data } = await q;
  const rows = (data ?? []) as Row[];

  const tab = (key: string, label: string) => (
    <Link href={`/onboarding${key === "active" ? "" : `?filter=${key}`}`}
      className={`rounded px-2.5 py-1 text-xs font-medium ${filter === key ? "bg-amber-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>
      {label}
    </Link>
  );

  return (
    <main className="px-4 py-6 md:px-8">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Onboarding</h1>
        <span className="text-sm text-neutral-500">{rows.length}</span>
      </header>

      <div className="mb-4 flex items-center gap-2">
        {tab("active", "Active")}
        {tab("onboarded", "Onboarded")}
        {tab("all", "All")}
      </div>

      <p className="mb-5 text-sm text-neutral-500">
        Start a case from a deal&apos;s <Link href="/hot" className="text-blue-700 hover:underline">Hot work-deal page</Link>. Stages: internal wizard → merchant form → UBO checks → documents → onboarded.
      </p>

      {rows.length === 0 ? (
        <p className="text-neutral-500">No onboarding cases{filter === "active" ? " in progress" : ""}.</p>
      ) : (
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs uppercase text-neutral-400">
            <tr>
              <th className="py-1">Company</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Products</th>
              <th className="text-right">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              // Once the merchant has submitted, the review view is the useful landing.
              const submitted = (COMPLETED_BY_STATUS[r.status] ?? 0) >= 2;
              const href = submitted ? `/onboarding/${r.id}/review` : `/onboarding/${r.id}`;
              return (
                <tr key={r.id} className="border-t border-neutral-100 hover:bg-neutral-100">
                  <td className="py-1.5">
                    <Link href={href} className="font-medium text-blue-700 hover:underline">
                      {r.company_number ? `Company ${r.company_number}` : "(company not set)"}
                    </Link>
                  </td>
                  <td><StatusBadge status={r.status} /></td>
                  <td><StageBar status={r.status} /></td>
                  <td className="text-neutral-600">{r.product_groups.length}</td>
                  <td className="text-right text-neutral-500">{fmtDate(r.updated_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
    </main>
  );
}
