// Onboarding case list — the entry point for the Phase 1 internal wizard.
// Cases are started from a deal (the "Start onboarding" button on a deal's
// Hot work-deal page); each row links into the wizard.

import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { fmtDate } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  hubspot_deal_id: string | null;
  company_number: string | null;
  status: string;
  product_groups: string[];
  updated_at: string;
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "onboarded" ? "bg-emerald-100 text-emerald-800"
    : status === "cancelled" ? "bg-neutral-200 text-neutral-600"
    : status === "started" ? "bg-amber-100 text-amber-800"
    : "bg-blue-100 text-blue-800";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{status.replace(/_/g, " ")}</span>;
}

export default async function OnboardingIndexPage() {
  const me = await currentUser();
  if (!me) redirect("/login");

  const db = serviceClient();
  const { data } = await db
    .from("onboarding_cases")
    .select("id, hubspot_deal_id, company_number, status, product_groups, updated_at")
    .neq("status", "cancelled")
    .order("updated_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as Row[];

  return (
    <main className="px-4 py-6 md:px-8">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Onboarding</h1>
        <span className="text-sm text-neutral-500">{rows.length} active</span>
      </header>

      <p className="mb-5 text-sm text-neutral-500">
        Merchant onboarding cases. Start one from a deal&apos;s <Link href="/hot" className="text-blue-700 hover:underline">Hot work-deal page</Link> — then work the wizard (company → products → stakeholders → finish).
      </p>

      {rows.length === 0 ? (
        <p className="text-neutral-500">No onboarding cases yet.</p>
      ) : (
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs uppercase text-neutral-400">
            <tr>
              <th className="py-1">Company</th>
              <th>Status</th>
              <th>Products</th>
              <th className="text-right">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-neutral-100 hover:bg-neutral-100">
                <td className="py-1.5">
                  <Link href={`/onboarding/${r.id}`} className="font-medium text-blue-700 hover:underline">
                    {r.company_number ? `Company ${r.company_number}` : "(company not set)"}
                  </Link>
                </td>
                <td><StatusBadge status={r.status} /></td>
                <td className="text-neutral-600">{r.product_groups.length}</td>
                <td className="text-right text-neutral-500">{fmtDate(r.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </main>
  );
}
