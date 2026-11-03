// Hot "work this deal" view. Pulls the deal's live context (fields + recent
// notes + contact/company), appraises it with MEDDICC, and shows a short
// "where it stands" read plus 3–5 targeted questions. The operator answers
// them; submitting drafts a re-engagement email into the workflow review queue.
//
// The MEDDICC appraisal runs on load (one Claude call, ~10s) — it's a
// deliberate drill-in, not a list view.

import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { hubspotEnabled } from "@/lib/hubspot/client";
import { hubspotRepo, getDeal, dealContactIds, dealRecentNotes, dealCompanyId, getDealLineItems, dealMeetings, dealPipelines, companyDeals } from "@/lib/hubspot/repo";
import { listOwners, ownerOptions } from "@/lib/hubspot/owners";
import { companyOpsStatus } from "@/lib/crm/companyStatus";
import { assessDealForWork, type DealContext } from "@/lib/mailer/dealWork";
import { liveCaseForDeal } from "@/lib/onboarding/cases";
import { fmtDate, fmtDateTime } from "@/lib/format/datetime";
import { PendingButton } from "@/components/PendingButton";
import { draftFromAnswersAction } from "../actions";
import { changeDealStageAction, changeDealOwnerAction } from "../dealActions";
import { startOnboardingAction } from "@/app/onboarding/actions";
import { setUpBillingAction } from "@/app/billing/actions";

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
        <Link href="/deals" className="text-sm text-blue-700 hover:underline">← Deals</Link>
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Deals read live from HubSpot. Set <code>HUBSPOT_TOKEN</code> to use this view.
        </p>
      </main>
    );
  }

  const deal = await getDeal(id);
  if (!deal) notFound();

  const db = serviceClient();
  const [existingCase, contactIds, companyId, lineItems, notes, pipelines, owners, meetings] = await Promise.all([
    liveCaseForDeal(db, id),
    dealContactIds(id),
    dealCompanyId(id),
    getDealLineItems(id),
    dealRecentNotes(id),
    dealPipelines(),
    listOwners(),
    dealMeetings(id),
  ]);
  const [contacts, company] = await Promise.all([
    Promise.all(contactIds.slice(0, 25).map((cid) => hubspotRepo.getContact(cid).catch(() => null))).then((xs) => xs.filter((x): x is NonNullable<typeof x> => x != null)),
    companyId ? hubspotRepo.getCompany(companyId).catch(() => null) : Promise.resolve(null),
  ]);
  const [ops, otherDeals] = await Promise.all([
    company ? companyOpsStatus([company.id]).then((m) => m.get(company.id) ?? null) : Promise.resolve(null),
    company ? companyDeals(company.id).then((ds) => ds.filter((d) => d.id !== deal.id)) : Promise.resolve([]),
  ]);
  const contact = contacts[0] ?? null;
  const ctx: DealContext = { deal, company, contact, notes };
  const noContact = !contact?.email || !!contact?.email_bounced;
  const ownerList = ownerOptions(owners);
  const pipe = pipelines.find((p) => p.stages.some((s) => s.id === deal.stage_id)) ?? null;
  const stageOptions = pipe?.stages ?? [];

  return (
    <main className="px-4 py-6 md:px-8">
      <Link href="/deals" className="text-sm text-blue-700 hover:underline">← Deals</Link>

      <header className="mb-4 mt-2 border-b border-neutral-200 pb-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h1 className="text-xl font-semibold">{deal.name || "(untitled deal)"}</h1>
          <a href={deal.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 hover:underline">open in HubSpot ↗</a>
        </div>

        {/* Revenue + facts straight off the HubSpot record */}
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Fact label="Amount" value={money(deal.amount, deal.currency)} />
          <Fact label="Close date" value={deal.close_date ? fmtDate(deal.close_date) : "—"} />
          <Fact label="Pipeline" value={deal.pipeline ?? "—"} />
          <Fact label="Last contacted" value={deal.last_contacted ? fmtDate(deal.last_contacted) : "never"} />
          {deal.next_step && <Fact label="Next step" value={deal.next_step} />}
        </dl>

        {/* Stage + owner — editable inline, written straight to HubSpot */}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <form action={changeDealStageAction} className="flex items-center gap-1">
            <input type="hidden" name="deal_id" value={deal.id} />
            <span className="text-xs uppercase tracking-wide text-neutral-400">Stage</span>
            {stageOptions.length > 0 ? (
              <select name="stage_id" defaultValue={deal.stage_id ?? ""} className="rounded border border-neutral-300 px-2 py-1 text-xs">
                {stageOptions.map((s) => <option key={s.id} value={s.id}>{s.label}{s.isClosed ? " (closed)" : ""}</option>)}
              </select>
            ) : <span className="text-sm text-neutral-600">{deal.stage ?? "—"}</span>}
            {stageOptions.length > 0 && <PendingButton className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100" pendingLabel="…">Set</PendingButton>}
          </form>
          <form action={changeDealOwnerAction} className="flex items-center gap-1">
            <input type="hidden" name="deal_id" value={deal.id} />
            <span className="text-xs uppercase tracking-wide text-neutral-400">Owner</span>
            <select name="owner_id" defaultValue={deal.owner_id ?? ""} className="rounded border border-neutral-300 px-2 py-1 text-xs">
              <option value="">— unassigned —</option>
              {ownerList.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <PendingButton className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100" pendingLabel="…">Set</PendingButton>
          </form>
        </div>

        {/* Onboarding + billing affordances */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {existingCase ? (
            <Link href={`/onboarding/${existingCase.id}`} className="inline-flex rounded border border-amber-300 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50">
              Continue onboarding →
            </Link>
          ) : (
            <form action={startOnboardingAction}>
              <input type="hidden" name="deal_id" value={deal.id} />
              <PendingButton className="rounded border border-amber-300 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50" pendingLabel="Starting…">
                Start onboarding →
              </PendingButton>
            </form>
          )}
          {company && ops?.billingAccountId ? (
            <Link href={`/billing/${ops.billingAccountId}`} className="inline-flex rounded border border-indigo-300 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50">Billing: {ops.billing} →</Link>
          ) : company ? (
            <form action={setUpBillingAction}>
              <input type="hidden" name="company_id" value={company.id} />
              <PendingButton className="rounded border border-indigo-300 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50" pendingLabel="…">Set up billing →</PendingButton>
            </form>
          ) : null}
        </div>
      </header>

      {/* Line items off the HubSpot deal */}
      {lineItems.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Line items</h2>
          <div className="overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-neutral-400">
                <tr><th className="px-3 py-1.5">Item</th><th className="px-3 py-1.5">Qty</th><th className="px-3 py-1.5">Price</th><th className="px-3 py-1.5">Term</th><th className="px-3 py-1.5 text-right">Amount</th></tr>
              </thead>
              <tbody>
                {lineItems.map((li) => (
                  <tr key={li.id} className="border-t border-neutral-100">
                    <td className="px-3 py-1.5">{li.name || li.sku || "—"}</td>
                    <td className="px-3 py-1.5 text-neutral-600">{li.quantity ?? "—"}</td>
                    <td className="px-3 py-1.5 text-neutral-600">{li.price != null ? money(li.price, deal.currency) : "—"}</td>
                    <td className="px-3 py-1.5 text-neutral-600">{li.term ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right text-neutral-700">{li.amount != null ? money(li.amount, deal.currency) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Associated records: company (w/ status), contacts, other deals, meetings */}
      <section className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Company &amp; contacts</h2>
          <div className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
            {company ? (
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/companies/${company.id}`} className="font-medium text-blue-700 hover:underline">{company.name || "—"}</Link>
                {company.current_client && <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Customer</span>}
                {ops?.onboarding && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">onb: {ops.onboarding}</span>}
                {ops?.billing && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] text-indigo-700">bill: {ops.billing}</span>}
              </div>
            ) : <p className="text-neutral-400">No company linked.</p>}
            {contacts.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-neutral-100 pt-2">
                {contacts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/contacts/${c.id}`} className="text-blue-700 hover:underline">{c.full_name || c.email || "—"}</Link>
                    {c.job_title && <span className="text-neutral-500">{c.job_title}</span>}
                    {c.contact_type.map((t) => <span key={t} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-700">{t}</span>)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Other deals &amp; meetings</h2>
          <div className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
            {otherDeals.length === 0 && meetings.length === 0 && <p className="text-neutral-400">No other deals or meetings.</p>}
            {otherDeals.length > 0 && (
              <ul className="space-y-1">
                {otherDeals.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/hot/${d.id}`} className="text-blue-700 hover:underline">{d.name || "(untitled)"}</Link>
                    {d.stage && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">{d.stage}</span>}
                    {d.amount != null && <span className="text-neutral-500">{money(d.amount, d.currency)}</span>}
                  </li>
                ))}
              </ul>
            )}
            {meetings.length > 0 && (
              <ul className={`space-y-1 ${otherDeals.length > 0 ? "mt-2 border-t border-neutral-100 pt-2" : ""}`}>
                {meetings.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 text-neutral-600">
                    <span>📅 {m.title || "Meeting"}</span>
                    {m.start && <span className="text-neutral-400">{fmtDate(m.start)}</span>}
                    {m.outcome && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px]">{m.outcome}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* The MEDDICC appraisal is a ~10s Claude call — stream it so everything
          above paints instantly and the body fills in behind a skeleton. */}
      <Suspense fallback={<BodySkeleton />}>
        <DealBody ctx={ctx} noContact={noContact} />
      </Suspense>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className="text-neutral-700">{value}</dd>
    </div>
  );
}

function BodySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
      <section className="space-y-4">
        <div>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Where it stands</h2>
          <div className="animate-pulse space-y-2 rounded-lg border border-neutral-200 bg-white p-3">
            <div className="h-3 w-full rounded bg-neutral-100" />
            <div className="h-3 w-5/6 rounded bg-neutral-100" />
            <div className="h-3 w-2/3 rounded bg-neutral-100" />
          </div>
          <p className="mt-2 text-xs text-neutral-400">Appraising the deal with MEDDICC…</p>
        </div>
      </section>
      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Answer, then draft</h2>
        <div className="animate-pulse space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-lg border border-neutral-200 bg-neutral-50" />)}
        </div>
      </section>
    </div>
  );
}

async function DealBody({ ctx, noContact }: { ctx: DealContext; noContact: boolean }) {
  const assessment = await assessDealForWork(ctx);
  const { deal, contact, notes } = ctx;
  return (
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
  );
}
