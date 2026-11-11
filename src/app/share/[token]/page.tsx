// Public share landing page at /share/<token>. A third party opens the link they
// were sent and enters their email to receive a one-time, 7-day read-only view
// link via Postmark. No auth — the token is the credential. Renders standalone
// (root layout drops the app nav when unauthed); served on the branded host.

import type { ReactNode } from "react";
import { serviceClient } from "@/lib/db/client";
import { getActiveShareByToken } from "@/lib/onboarding/shares";
import { PendingButton } from "@/components/PendingButton";
import { requestShareAccessAction } from "./actions";

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

export default async function SharePage({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ sent?: string; error?: string; expired?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const db = serviceClient();
  const share = await getActiveShareByToken(db, token);

  if (!share) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-[#003566]">Link not available</h1>
        <p className="mt-2 text-sm text-neutral-600">This link is not recognised or has been withdrawn. Please contact the person who sent it to you.</p>
      </Shell>
    );
  }

  let companyName = "a business";
  try {
    const { data } = await db.from("onboarding_company_snapshot").select("company_name").eq("case_id", share.case_id).maybeSingle();
    companyName = (data as { company_name: string | null } | null)?.company_name || companyName;
  } catch { /* best-effort */ }

  if (sp.sent === "1") {
    return (
      <Shell>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-5">
          <h1 className="text-xl font-semibold text-[#003566]">Check your email</h1>
          <p className="mt-2 text-sm text-neutral-700">We&apos;ve sent a secure link to view the summary for <strong>{companyName}</strong>. It&apos;s valid for 7 days. If it doesn&apos;t arrive within a few minutes, check your spam folder.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-[#003566]">Secure onboarding summary</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Credit Canary has shared a read-only onboarding summary for <strong>{companyName}</strong> with you. Enter your email and we&apos;ll send you a secure link to view it.
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500">
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="7.5" width="10" height="6" rx="1.3" /><path d="M5 7.5V5.2a3 3 0 0 1 6 0v2.3" />
        </svg>
        <span>Your access is logged. The view link is valid for 7 days.</span>
      </p>

      {sp.expired === "1" && (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">Your previous link has expired. Enter your email below for a new one.</p>
      )}
      {sp.error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {sp.error === "email" ? "Please enter a valid email address." : sp.error === "send" ? "We couldn't send the link — please try again." : "We couldn't match this link."}
        </p>
      )}

      <form action={requestShareAccessAction} className="mt-6 space-y-4">
        <input type="hidden" name="token" value={token} />
        <div>
          <label htmlFor="share-email" className="block text-sm font-medium text-neutral-800 mb-1">Your email</label>
          <input id="share-email" name="email" type="email" required inputMode="email" placeholder="you@company.com"
            className="w-full max-w-sm rounded-md border border-neutral-300 px-3 py-2.5 text-sm focus:border-[#003566] focus:outline-none focus:ring-1 focus:ring-[#003566]" />
        </div>
        <PendingButton className="rounded-md bg-[#003566] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#002a52]" pendingLabel="Sending…">
          Send me the link
        </PendingButton>
      </form>
    </Shell>
  );
}
