// PUBLIC inbound-lead landing page — /enquire is middleware-exempt, so
// this renders for the open internet: brand shell + form only, no CRM
// data. Share it anywhere (email footers, LinkedIn, the marketing site's
// CTAs); tag the source with ?src=… (e.g. /enquire?src=linkedin) and it's
// carried through to the alert + timeline event.

import type { Metadata } from "next";
import { submitEnquiryAction } from "./actions";
import { PendingButton } from "@/components/PendingButton";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Talk to Credit Canary",
  description: "Tell us a little about you and we'll come back within one working day.",
  robots: { index: false, follow: false },
};

const field = "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm";
const lbl = "mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500";

export default async function EnquirePage({ searchParams }: { searchParams: Promise<{ sent?: string; book?: string; error?: string; src?: string }> }) {
  const sp = await searchParams;

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 py-10">
      <header className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold text-white">CC</div>
        <h1 className="text-xl font-semibold text-neutral-900">Talk to Credit Canary</h1>
        <p className="text-sm text-neutral-500">Tell us a little about you and we&apos;ll come back within one working day.</p>
      </header>

      {sp.sent ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <div className="mb-2 text-3xl">✅</div>
          <h2 className="mb-1 text-lg font-semibold text-emerald-900">Thanks — we&apos;ve got it</h2>
          <p className="text-sm text-emerald-800">We&apos;ll be in touch within one working day.</p>
          {sp.book && (
            <>
              <p className="mt-4 text-sm text-emerald-800">Want to skip the back-and-forth?</p>
              <a
                href={`/book/${encodeURIComponent(sp.book)}`}
                className="mt-2 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Book a call directly →
              </a>
            </>
          )}
        </div>
      ) : (
        <>
          {sp.error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{sp.error}</div>
          )}
          <form action={submitEnquiryAction} className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            {sp.src && <input type="hidden" name="src" value={sp.src.slice(0, 60)} />}
            {/* Honeypot — hidden from humans */}
            <div className="hidden" aria-hidden="true">
              <label>Website<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={lbl}>Your name *</label>
                <input name="name" required maxLength={120} className={field} placeholder="Jane Smith" />
              </div>
              <div>
                <label className={lbl}>Work email *</label>
                <input name="email" type="email" required className={field} placeholder="jane@company.co.uk" />
              </div>
              <div className="sm:col-span-2">
                <label className={lbl}>Company</label>
                <input name="company" maxLength={120} className={field} placeholder="Company name (optional)" />
              </div>
              <div className="sm:col-span-2">
                <label className={lbl}>What can we help with?</label>
                <textarea
                  name="message"
                  rows={4}
                  maxLength={2000}
                  className={field}
                  placeholder="A line or two on what you're exploring (optional, but it helps us come back with something useful)"
                />
              </div>
            </div>
            <PendingButton
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
              pendingLabel="Sending…"
            >
              Send enquiry
            </PendingButton>
            <p className="text-center text-[11px] text-neutral-400">
              We only use your details to reply — no mailing lists, no sharing.
            </p>
          </form>
        </>
      )}

      <footer className="mt-8 text-center text-xs text-neutral-400">
        Credit Canary · creditcanary.co.uk
      </footer>
    </main>
  );
}
