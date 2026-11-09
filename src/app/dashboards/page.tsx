// Dashboards tab — three in-app dashboards built from the HubSpot deal mirror
// and the billing ledger: Revenue (Closed Won/Lost + billing), Deal Pipeline,
// and Deal Activity (the tiles our current-state data supports).

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { loadDeals } from "@/lib/dashboards/deals";
import { loadBillingRevenue } from "@/lib/dashboards/billing";
import { DashShell } from "./DashShell";
import { RevenueView } from "./RevenueView";
import { PipelineView } from "./PipelineView";
import { ActivityView } from "./ActivityView";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function DashboardsPage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const { owner } = await searchParams;

  const [{ deals, owners }, billing] = await Promise.all([loadDeals(), loadBillingRevenue()]);
  const scoped = owner ? deals.filter((d) => d.ownerId === owner) : deals;

  return (
    <main className="px-4 py-6 md:px-8">
      <h1 className="mb-1 text-xl font-semibold">Dashboards</h1>
      <p className="mb-4 text-sm text-neutral-500">Revenue, pipeline and deal activity — from the live HubSpot mirror and the billing ledger. Billing figures are portfolio-wide (not owner-filtered).</p>

      {deals.length === 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No deals in the local mirror yet. The hubspot-mirror cron populates it — once it runs, the dashboards fill in.
        </p>
      ) : (
        <DashShell
          owners={owners}
          activeOwner={owner ?? null}
          tabs={[
            { id: "revenue", label: "Revenue", content: <RevenueView deals={scoped} billing={billing} /> },
            { id: "pipeline", label: "Deal Pipeline", content: <PipelineView deals={scoped} /> },
            { id: "activity", label: "Deal Activity", content: <ActivityView deals={scoped} /> },
          ]}
        />
      )}
    </main>
  );
}
