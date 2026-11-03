// Public merchant onboarding form at /m/<token>. No auth — the unguessable
// merchant_form_token is the credential. Renders standalone (the root layout
// drops the app nav when the viewer isn't signed in). Routes to either the
// proven single-page form (default) or the multi-page wizard when
// ONBOARDING_FORM_V2 is on (or ?v2=1 for testing).

import type { ReactNode } from "react";
import { serviceClient } from "@/lib/db/client";
import { getCaseByToken, markFormOpened } from "@/lib/onboarding/merchantForm";
import { getFormEditor } from "@/lib/onboarding/formEditor";
import { LegacyMerchantForm } from "./legacy";
import { SelfIdentify, Wizard } from "./wizard";

export const dynamic = "force-dynamic";

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="bg-[#003566] px-4 py-4">
        <div className="mx-auto max-w-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cc-logo-white.svg" alt="Credit Canary" className="h-7 w-auto" />
        </div>
      </div>
      <div className="mx-auto max-w-2xl px-4 py-8">{children}</div>
    </main>
  );
}

export default async function MerchantFormPage({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; error?: string; page?: string; v2?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const db = serviceClient();
  const c = await getCaseByToken(db, token);

  if (!c) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-[#003566]">Link not recognised</h1>
        <p className="mt-2 text-sm text-neutral-600">This onboarding link looks incomplete or has expired. Please contact us and we&apos;ll sort it out.</p>
      </Shell>
    );
  }

  if (sp.done === "1" || c.status === "merchant_submitted") {
    return (
      <Shell>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-5">
          <h1 className="text-xl font-semibold text-[#003566]">Thank you — that&apos;s submitted ✓</h1>
          <p className="mt-2 text-sm text-neutral-700">We&apos;ve received your onboarding details. Our team will review and be in touch with the next steps. You can close this page.</p>
        </div>
      </Shell>
    );
  }

  await markFormOpened(db, c.id, c.status);

  const v2 = process.env.ONBOARDING_FORM_V2 === "1" || sp.v2 === "1";
  if (!v2) {
    return <Shell><LegacyMerchantForm token={token} c={c} error={sp.error} /></Shell>;
  }

  const editor = await getFormEditor(c.id);
  if (!editor) {
    return <Shell><SelfIdentify token={token} caseId={c.id} v2={sp.v2} /></Shell>;
  }
  return <Shell><Wizard token={token} c={c} editor={editor} page={sp.page} v2={sp.v2} error={sp.error} /></Shell>;
}
