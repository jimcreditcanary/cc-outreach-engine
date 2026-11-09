// Dashboards tab — in-app dashboards built from the HubSpot deal mirror and the
// billing ledger. Deal Pipeline + Deal Activity (the Revenue tab is hidden for
// now). Filterable by deal owner and pipeline; Refresh re-reads the data.

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { loadDeals } from "@/lib/dashboards/deals";
import { DashShell } from "./DashShell";
import { PipelineView } from "./PipelineView";
import { ActivityView } from "./ActivityView";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // headroom for the Refresh deals re-sync

export default async function DashboardsPage({ searchParams }: { searchParams: Promise<{ owner?: string; pipeline?: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const { owner, pipeline } = await searchParams;

  const { deals, owners, pipelines } = await loadDeals();
  // No "All" pipeline — default to Enterprise Sales (or the busiest pipeline if
  // that name isn't present). A ?pipeline param still overrides.
  const defaultPipeline = pipelines.find((p) => /enterprise/i.test(p.label))?.id ?? pipelines[0]?.id ?? null;
  const activePipeline = pipeline ?? defaultPipeline;
  const scoped = deals.filter((d) => (owner ? d.ownerId === owner : true) && (activePipeline ? d.pipelineId === activePipeline : true));

  return (
    <main className="px-4 py-6 md:px-8">
      <h1 className="mb-1 text-xl font-semibold">Dashboards</h1>
      <p className="mb-4 text-sm text-neutral-500">Pipeline and deal activity — from the live HubSpot mirror. Filter by owner or pipeline; Refresh re-reads the latest data.</p>

      {deals.length === 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No deals in the local mirror yet. The hubspot-mirror cron populates it — once it runs, the dashboards fill in.
        </p>
      ) : (
        <DashShell
          owners={owners}
          activeOwner={owner ?? null}
          pipelines={pipelines}
          activePipeline={pipeline ?? null}
          tabs={[
            { id: "pipeline", label: "Deal Pipeline", content: <PipelineView deals={scoped} /> },
            { id: "activity", label: "Deal Activity", content: <ActivityView deals={scoped} /> },
          ]}
        />
      )}
    </main>
  );
}
