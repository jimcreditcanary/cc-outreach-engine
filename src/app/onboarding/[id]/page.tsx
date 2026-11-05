// Onboarding now lives in the Onboarding tab on the company page (feedback
// items 2-4). This route resolves the case's company and redirects there,
// preserving ?step / ?q. A case with no linked company renders standalone
// (same panel) as a fallback so deep links never dead-end.

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { getCase } from "@/lib/onboarding/cases";
import { OnboardingCasePanel, standaloneNav } from "./CasePanel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function CaseWizardPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string; q?: string }>;
}) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const { id } = await params;
  const sp = await searchParams;

  const db = serviceClient();
  const c = await getCase(db, id);
  if (!c) notFound();

  if (c.hubspot_company_id) {
    const qs = new URLSearchParams({ tab: "onboarding" });
    if (sp.step) qs.set("step", sp.step);
    if (sp.q) qs.set("q", sp.q);
    redirect(`/companies/${c.hubspot_company_id}?${qs.toString()}`);
  }

  return (
    <main className="px-4 py-6 md:px-8">
      <Link href="/customers" className="text-sm text-blue-700 hover:underline">← Customers</Link>
      <div className="mt-3">
        <OnboardingCasePanel caseId={id} nav={standaloneNav(id)} step={sp.step} q={sp.q} />
      </div>
    </main>
  );
}
