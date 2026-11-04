// Public UBO document-upload form at /u/<token>. No auth - the unguessable
// token is the credential. A beneficial owner whose ID&V / PEP check failed
// uploads a passport photo + a recent proof of address. Renders standalone
// (root layout drops the app nav when unauthed). The link is shared by ops -
// the customer is never emailed.

import type { ReactNode } from "react";
import { serviceClient } from "@/lib/db/client";
import { getUboRequestByToken } from "@/lib/onboarding/uboDocs";
import { loadEnrichment } from "@/lib/onboarding/enrich";
import { PendingButton } from "@/components/PendingButton";
import { uploadUboDocsAction } from "./actions";

export const dynamic = "force-dynamic";

const fileInput = "mt-1 block w-full text-sm text-neutral-700 file:mr-3 file:rounded file:border-0 file:bg-[#003566] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-[#002a52]";

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

export default async function UboDocPage({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const db = serviceClient();
  const req = await getUboRequestByToken(db, token);

  if (!req) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-[#003566]">Link not recognised</h1>
        <p className="mt-2 text-sm text-neutral-600">This link looks incomplete or has expired. Please contact the person who sent it to you.</p>
      </Shell>
    );
  }

  if (sp.done === "1") {
    return (
      <Shell>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-5">
          <h1 className="text-xl font-semibold text-[#003566]">Thank you - received ✓</h1>
          <p className="mt-2 text-sm text-neutral-700">We&apos;ve securely received your documents. Our team will review them. You can close this page.</p>
        </div>
      </Shell>
    );
  }

  const company = (await loadEnrichment(db, req.case_id)).snapshot?.company_name ?? "the business";
  const name = req.ubo_name ? req.ubo_name.split(/\s+/)[0] : "there";

  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-[#003566]">Verify your identity</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Hi {name}, as part of <strong>{company}</strong>&apos;s onboarding with Credit Canary we need to confirm your identity as a beneficial owner. Please upload the two documents below.
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500">
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="7.5" width="10" height="6" rx="1.3" /><path d="M5 7.5V5.2a3 3 0 0 1 6 0v2.3" />
        </svg>
        <span>Uploaded securely and used only for this identity check.</span>
      </p>

      {sp.error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {sp.error === "save" ? "Something went wrong uploading - please try again." : "We couldn't match this link."}
        </p>
      )}

      <form action={uploadUboDocsAction} className="mt-6 space-y-5">
        <input type="hidden" name="token" value={token} />
        <fieldset className="rounded-lg border border-neutral-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-[#003566]">Passport <span className="text-red-600">*</span></legend>
          <p className="mt-1 text-xs text-neutral-500">A clear photo or scan of the photo page.</p>
          <input name="passport" type="file" accept="image/*,.pdf" required className={fileInput} />
        </fieldset>
        <fieldset className="rounded-lg border border-neutral-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-[#003566]">Proof of address <span className="text-red-600">*</span></legend>
          <p className="mt-1 text-xs text-neutral-500">A utility bill or bank statement dated within the last 3 months.</p>
          <input name="poa" type="file" accept="image/*,.pdf" required className={fileInput} />
        </fieldset>
        <PendingButton className="rounded-md bg-[#003566] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#002a52]" pendingLabel="Uploading…">
          Upload securely
        </PendingButton>
        <p className="text-xs text-neutral-400">Your documents are sent securely and used only to verify your identity for this onboarding.</p>
      </form>
    </Shell>
  );
}
