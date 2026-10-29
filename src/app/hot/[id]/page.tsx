// Hot "work this deal" view. Pulls the deal's live context (fields + recent
// notes + contact/company), appraises it with MEDDICC, and shows a short
// "where it stands" read plus 3–5 targeted questions. The operator answers
// them; submitting drafts a re-engagement email into the workflow review queue.
//
// The MEDDICC appraisal runs on load (one Claude call, ~10s) — it's a
// deliberate drill-in, not a list view.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { hubspotEnabled } from "@/lib/hubspot/client";
import { hubspotRepo, getDeal, dealContactIds, dealRecentNotes } from "@/lib/hubspot/repo";
import { assessDealForWork, type DealContext } from "@/lib/mailer/dealWork";
import { fmtDate, fmtDateTime } from "@/lib/format/datetime";
import { PendingButton } from "@/components/PendingButton";
import { draftFromAnswersAction } from "../actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";

function money(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP", maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency ?? ""} ${amount.toLocaleString()}`.trim();
  }
}

export default async function WorkDealPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const { id } = await params;

  if (!hubspotEnabled()) {
    return (
      <main className="px-4 py-6 md:px-8">
        <Link href="/hot" className="text-sm text-blue-700 hover:underline">← Hot</Link>
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Deals read live from HubSpot. Set <code>HUBSPOT_TOKEN</code> to use this view.
        </p>
      </main>
    );
  }

  const deal = await getDeal(id);
  if (!deal) notFound();

  const contactIds = await dealContactIds(id);
  const [contact, notes] = await Promise.all([
    contactIds[0] ? hubspotRepo.getContact(contactIds[0]) : Promise.resolve(null),
    dealRecentNotes(id),
  ]);
  const company = contact?.company_id ? await hubspotRepo.getCompany(contact.company_id) : null;
  const ctx: DealContext = { deal, company, contact, notes };

  const assessment = await assessDealForWork(ctx);
  const noContact = !contact?.email || !!contact?.email_bounced;

  return (
    <main className="px-4 py-6 md:px-8">
      <Link href="/hot" className="text-sm text-blue-700 hover:underline">← Hot</Link>

      <header className="mb-4 mt-2 border-b border-neutral-200 pb-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h1 className="text-xl font-semibold">{deal.name || "(untitled deal)"}</h1>
          <a href={deal.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 hover:underline">open in HubSpot ↗</a>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          {deal.stage ?? "—"} · {money(deal.amount, deal.currency)}
          {" · "}last contacted {deal.last_contacted ? fmtDate(deal.last_contacted) : "never"}
          {contact && <> · {contact.full_name}{contact.job_title ? `, ${contact.job_title}` : ""}{company?.name ? ` (${company.name})` : ""}</>}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
        {/* LEFT: the update — where it stands + recent activity */}
        <section className="space-y-4">
          <div>
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Where it stands</h2>
            <p className="rounded-lg border border-neutral-200 bg-white p-3 text-sm text-neutral-700">{assessment.summary}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Biggest gap</div>
              <p className="mt-1 text-amber-900">{assessment.biggest_gap}</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Next best action</div>
              <p className="mt-1 text-emerald-900">{assessment.next_best_action}</p>
            </div>
          </div>
          <div>
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Recent activity</h2>
            {notes.length === 0 ? (
              <p className="text-sm text-neutral-400">No notes logged on the deal in HubSpot.</p>
            ) : (
              <ul className="space-y-2">
                {notes.map((n, i) => (
                  <li key={i} className="rounded border border-neutral-200 bg-white p-2 text-sm text-neutral-700">
                    {n.ts && <div className="text-xs text-neutral-400">{fmtDateTime(n.ts)}</div>}
                    <p className="mt-0.5 whitespace-pre-wrap">{n.body.length > 500 ? `${n.body.slice(0, 500)}…` : n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* RIGHT: answer the questions → draft */}
        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Answer, then draft</h2>
          <p className="mb-3 text-xs text-neutral-500">
            A few MEDDICC-style questions to sharpen the email. Answer what you can — blanks are fine, the draft uses the context too.
          </p>

          {noContact && (
            <p className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              No contact with a usable email is linked to this deal — link one in HubSpot to draft an email.
            </p>
          )}

          <form action={draftFromAnswersAction} className="space-y-3">
            <input type="hidden" name="deal_id" value={deal.id} />
            <input type="hidden" name="contact_id" value={contact?.id ?? ""} />
            <input type="hidden" name="a_summary" value={assessment.summary} />
            <input type="hidden" name="a_gap" value={assessment.biggest_gap} />
            <input type="hidden" name="a_nba" value={assessment.next_best_action} />
            <input type="hidden" name="q_count" value={assessment.questions.length} />

            {assessment.questions.map((q, i) => (
              <div key={q.id || i}>
                <input type="hidden" name={`q_text_${i}`} value={q.question} />
                <label className="mb-1 block text-sm font-medium text-neutral-700">{q.question}</label>
                <textarea name={`q_answer_${i}`} rows={2} className={field} placeholder="Your answer (optional)…" />
              </div>
            ))}

            <PendingButton
              className="rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
              pendingLabel="Drafting the email…"
              disabled={noContact}
            >
              ✨ Draft email → workflow
            </PendingButton>
            <p className="text-xs text-neutral-400">The draft lands in Outreach › Nurture for review — nothing sends automatically.</p>
          </form>
        </section>
      </div>
    </main>
  );
}
