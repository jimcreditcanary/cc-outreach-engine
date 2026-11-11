// The merchant-submission review/approve view now lives in the Onboarding tab
// on the company page (feedback items 2-4). This route redirects there; a case
// with no linked company renders standalone as a fallback.

import { redirect, notFound } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { getCase } from "@/lib/onboarding/cases";
import { OnboardingReviewPanel, standaloneNav } from "../CasePanel";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const { id } = await params;

  const db = serviceClient();
  const c = await getCase(db, id);
  if (!c) notFound();

  if (c.hubspot_company_id) redirect(`/companies/${c.hubspot_company_id}?tab=onboarding&ob=review`);

  return (
    <main className="px-4 py-6 md:px-8">
      <OnboardingReviewPanel caseId={id} nav={standaloneNav(id)} />
    </main>
  );
}
