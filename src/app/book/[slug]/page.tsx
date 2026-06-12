// PUBLIC booking page — /book/<slug> is in the middleware's public list,
// so everything rendered here is visible to the open internet: operator
// display name and free slots only. No CRM data, no emails, no secrets.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { availableSlots, loadBookingPage } from "@/lib/booking/book";
import { BookingForm, LocalTime } from "./BookingForm";

export const dynamic = "force-dynamic";
// Availability fans out to Graph + the Google ICS feed.
export const maxDuration = 60;

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ booked?: string; join?: string; error?: string; embed?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await loadBookingPage(serviceClient(), slug);
  return {
    title: page ? `Book a call with ${page.operator_name} — Credit Canary` : "Book a call — Credit Canary",
    robots: { index: false, follow: false },
  };
}

export default async function PublicBookingPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  // ?embed=1 — chromeless for <iframe> use; the host page brings the branding.
  const embed = sp.embed === "1";
  const db = serviceClient();
  const page = await loadBookingPage(db, slug);
  if (!page) notFound();

  // ── Confirmation state (post-booking redirect) ────────────────────
  if (sp.booked) {
    return (
      <Shell operatorName={page.operator_name} embed={embed}>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <div className="mb-2 text-3xl">✅</div>
          <h2 className="mb-1 text-lg font-semibold text-emerald-900">You&apos;re booked in</h2>
          <p className="text-sm text-emerald-800">
            <LocalTime iso={sp.booked} /> with {page.operator_name} ({page.config.durationMins} min).
          </p>
          <p className="mt-2 text-xs text-emerald-700">
            A calendar invite is on its way to your inbox{sp.join ? "" : " — accept it and you're set"}.
          </p>
          {sp.join && (
            <a
              href={sp.join}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Join link for the call
            </a>
          )}
        </div>
      </Shell>
    );
  }

  // ── Live availability ─────────────────────────────────────────────
  let slots: string[] = [];
  let loadFailed = false;
  try {
    slots = (await availableSlots(db, page)).map((d) => d.toISOString());
  } catch {
    // A connected calendar source errored — better to show nothing than
    // risk double-booking off incomplete availability.
    loadFailed = true;
  }

  return (
    <Shell operatorName={page.operator_name} embed={embed}>
      {sp.error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {sp.error}
        </div>
      )}
      {loadFailed ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Availability is temporarily unavailable — please try again in a few minutes.
        </p>
      ) : slots.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
          No open slots in the next three weeks — please check back soon.
        </p>
      ) : (
        <BookingForm slug={slug} slots={slots} durationMins={page.config.durationMins} embed={embed} />
      )}
    </Shell>
  );
}

function Shell({ operatorName, embed, children }: { operatorName: string; embed?: boolean; children: React.ReactNode }) {
  return (
    <main className={embed ? "mx-auto max-w-xl p-2" : "mx-auto min-h-screen max-w-xl px-4 py-10"}>
      {!embed && (
        <header className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold text-white">
            {operatorName.split(" ").map((w) => w[0]).slice(0, 2).join("")}
          </div>
          <h1 className="text-xl font-semibold text-neutral-900">Book a call with {operatorName}</h1>
          <p className="text-sm text-neutral-500">Credit Canary</p>
        </header>
      )}
      {children}
      {!embed && (
        <footer className="mt-8 text-center text-xs text-neutral-400">
          Powered by Credit Canary · creditcanary.co.uk
        </footer>
      )}
    </main>
  );
}
