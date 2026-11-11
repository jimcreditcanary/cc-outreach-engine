// Public read-only view at /share/<token>/view?t=<accessToken>. Validates the
// one-time link (share active + grant not expired), logs the view, and renders
// the onboarding review in read-only mode (no staff actions). Token valid 7 days.

import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { validateAccess, recordShareView } from "@/lib/onboarding/shares";
import { logCaseEvent } from "@/lib/onboarding/cases";
import { OnboardingReviewPanel, standaloneNav } from "@/app/onboarding/[id]/CasePanel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="no-print bg-[#003566] px-4 py-4">
        <div className="mx-auto max-w-5xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cc-logo-white.svg" alt="Credit Canary" className="h-7 w-auto" />
        </div>
      </div>
      <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
    </main>
  );
}

export default async function ShareViewPage({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { token } = await params;
  const { t } = await searchParams;
  const accessToken = (t ?? "").trim();
  const db = serviceClient();

  const res = accessToken ? await validateAccess(db, token, accessToken) : { ok: false as const, reason: "invalid" as const };

  if (!res.ok && res.reason === "expired") {
    redirect(`/share/${encodeURIComponent(token)}?expired=1`);
  }
  if (!res.ok) {
    return (
      <Shell>
        <div className="rounded-lg border border-neutral-200 bg-white p-5">
          <h1 className="text-xl font-semibold text-[#003566]">Link not valid</h1>
          <p className="mt-2 text-sm text-neutral-600">This view link is not recognised or has been withdrawn. Open the original link you were sent to request a new one.</p>
        </div>
      </Shell>
    );
  }

  await recordShareView(db, res.grantId);
  await logCaseEvent(db, res.caseId, "share_viewed", { email: "external" }, { recipient: res.email }).catch(() => {});

  return (
    <Shell>
      <div className="rounded-lg border border-neutral-200 bg-white p-4 md:p-6">
        <OnboardingReviewPanel caseId={res.caseId} nav={standaloneNav(res.caseId)} share={{ token, accessToken }} />
      </div>
    </Shell>
  );
}
