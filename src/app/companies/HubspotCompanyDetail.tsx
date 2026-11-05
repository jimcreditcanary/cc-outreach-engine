// HubSpot-backed company detail (P3), now organised into three tabs
// (feedback items 2-4): Detail (identity + custom fields + deals + contacts),
// Onboarding (the full onboarding case + review/approve, moved here from
// /onboarding/[id]), and Billing (account summary). The persistent header keeps
// the name, badges and the Active-Customer toggle visible on every tab.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrm } from "@/lib/crm";
import { propOptions } from "@/lib/hubspot/schema";
import { PendingButton } from "@/components/PendingButton";
import { OnboardingBadge } from "@/components/OnboardingBadge";
import { fmtDate } from "@/lib/format/datetime";
import { updateHubspotCompany, toggleCustomerAction } from "./hubspotActions";
import { serviceClient } from "@/lib/db/client";
import { isCustomer } from "@/lib/crm/customer";
import { companyDeals } from "@/lib/hubspot/repo";
import { listOwners, ownerOptions } from "@/lib/hubspot/owners";
import { startOnboardingAction } from "@/app/onboarding/actions";
import { setUpBillingAction } from "../billing/actions";
import { OnboardingCasePanel, OnboardingReviewPanel, companyTabNav } from "@/app/onboarding/[id]/CasePanel";

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

type Tab = "detail" | "onboarding" | "billing";
const gbp = (pence: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);

export async function HubspotCompanyDetail({ id, tab, ob, step, q, from }: {
  id: string; tab?: string; ob?: string; step?: string; q?: string; from?: string;
}) {
  // Back link follows where you came from (Customers vs Companies — item 6).
  const back = from === "customers" ? { href: "/customers", label: "← Customers" } : { href: "/companies", label: "← Companies" };
  const active: Tab = tab === "onboarding" ? "onboarding" : tab === "billing" ? "billing" : "detail";
  const crm = getCrm();
  const [co, contacts, onboardingOpts, targetOpts, deals, owners] = await Promise.all([
    crm.getCompany(id),
    crm.listCompanyContacts(id, 100),
    propOptions("companies", "onboarding_status"),
    propOptions("companies", "target_group"),
    companyDeals(id),
    listOwners(),
  ]);
  if (!co) notFound();
  const ownerList = ownerOptions(owners);

  const bdb = serviceClient();
  const [{ data: billingAccts }, { data: caseRows }, customer] = await Promise.all([
    bdb.from("billing_accounts").select("id, status, contract_start_date, billing_frequency").eq("hubspot_company_id", id).order("created_at", { ascending: false }).limit(1),
    bdb.from("onboarding_cases").select("id, status, merchant_form_token, drive_folder_id").eq("hubspot_company_id", id).neq("status", "cancelled").order("updated_at", { ascending: false }).limit(1),
    isCustomer(bdb, id),
  ]);
  const billingAcct = (billingAccts ?? [])[0] ?? null;
  const onboardingCase = (caseRows ?? [])[0] ?? null;
  const hasOnboardedCase = onboardingCase?.status === "onboarded";

  const onboardingText = co.onboarding_status ? (onboardingOpts.find((o) => o.value === co.onboarding_status)?.label ?? co.onboarding_status) : null;
  const targetText = co.target_group ? (targetOpts.find((o) => o.value === co.target_group)?.label ?? co.target_group) : null;

  const tabHref = (t: Tab) => {
    const qs = new URLSearchParams();
    if (t !== "detail") qs.set("tab", t);
    if (from) qs.set("from", from);
    const s = qs.toString();
    return `/companies/${id}${s ? `?${s}` : ""}`;
  };
  const tabCls = (t: Tab) => `rounded-t-md border-b-2 px-4 py-2 text-sm font-medium ${active === t ? "border-[#003566] text-[#003566]" : "border-transparent text-neutral-500 hover:text-neutral-800"}`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:px-8">
      <div className="mb-4 flex items-center justify-between">
        <Link href={back.href} className="text-sm text-blue-700 hover:underline">{back.label}</Link>
        <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700">HubSpot</span>
      </div>

      {/* Persistent header */}
      <header className="mb-4 border-b border-neutral-200 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{co.name || "Company"}</h1>
          {customer && <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Customer</span>}
          {onboardingText && <OnboardingBadge status={onboardingText} />}
          {co.is_partner && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700">partner</span>}
          {co.icp && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">ICP</span>}
          <form action={toggleCustomerAction} className="ml-auto">
            <input type="hidden" name="company_id" value={id} />
            <input type="hidden" name="on" value={customer ? "false" : "true"} />
            <PendingButton
              className={`rounded border px-1.5 py-0.5 text-xs ${customer ? "border-neutral-300 text-neutral-500 hover:bg-neutral-100" : "border-teal-400 text-teal-700 hover:bg-teal-50"}`}
              pendingLabel="…"
            >
              {customer ? "Unmark active customer" : "Mark as Active Customer"}
            </PendingButton>
          </form>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-neutral-500">
          {co.website && <a href={/^https?:\/\//.test(co.website) ? co.website : `https://${co.website}`} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">{co.website} ↗</a>}
          {targetText && <span>{targetText}</span>}
          {co.owner_name && <span>Owner: <span className="text-neutral-600">{co.owner_name}</span></span>}
          {co.company_number && <span>Co. no. <span className="font-mono text-neutral-600">{co.company_number}</span></span>}
          {co.created_at && <span>Added {fmtDate(co.created_at)}</span>}
          <a href={co.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">Open in HubSpot ↗</a>
        </div>
      </header>

      {/* Tabs */}
      <nav className="mb-6 flex gap-1 border-b border-neutral-200">
        <Link href={tabHref("detail")} className={tabCls("detail")}>Detail</Link>
        <Link href={tabHref("onboarding")} className={tabCls("onboarding")}>Onboarding{onboardingCase && <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-800">{onboardingCase.status.replace(/_/g, " ")}</span>}</Link>
        <Link href={tabHref("billing")} className={tabCls("billing")}>Billing{billingAcct && <span className="ml-1 rounded bg-indigo-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-indigo-700">{billingAcct.status.replace(/_/g, " ")}</span>}</Link>
      </nav>

      {active === "detail" && (
        <DetailTab id={id} co={co} targetOpts={targetOpts} ownerList={ownerList} deals={deals} contacts={contacts} onboardingDisplay={onboardingCase ? onboardingCase.status : onboardingText ?? "—"} />
      )}

      {active === "onboarding" && (
        onboardingCase ? (
          ob === "review"
            ? <OnboardingReviewPanel caseId={onboardingCase.id} nav={companyTabNav(id, onboardingCase.id)} />
            : <OnboardingCasePanel caseId={onboardingCase.id} nav={companyTabNav(id, onboardingCase.id)} step={step} q={q} companyName={co.name ?? undefined} />
        ) : (
          <StartOnboarding id={id} customer={customer} deals={deals} />
        )
      )}

      {active === "billing" && (
        <BillingTab id={id} billingAcct={billingAcct} hasOnboardedCase={hasOnboardedCase} customer={customer} />
      )}
    </main>
  );
}

// ─── Detail tab ──────────────────────────────────────────────────────────────

function DetailTab({ id, co, targetOpts, ownerList, deals, contacts, onboardingDisplay }: {
  id: string;
  co: Awaited<ReturnType<ReturnType<typeof getCrm>["getCompany"]>>;
  targetOpts: { value: string; label: string }[];
  ownerList: { id: string; name: string }[];
  deals: Awaited<ReturnType<typeof companyDeals>>;
  contacts: Awaited<ReturnType<ReturnType<typeof getCrm>["listCompanyContacts"]>>;
  onboardingDisplay: string;
}) {
  if (!co) return null;
  return (
    <>
      <form action={updateHubspotCompany} className="grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-2">
        <input type="hidden" name="id" value={co.id} />
        <div>
          <label className={lbl}>Name</label>
          <input name="name" defaultValue={co.name ?? ""} className={field} />
        </div>
        <div>
          <label className={lbl}>Website</label>
          <input name="website" defaultValue={co.website ?? ""} className={field} />
        </div>
        <div>
          <label className={lbl}>Onboarding status</label>
          <div className={`${field} flex items-center bg-neutral-100 text-neutral-600`}>{onboardingDisplay}</div>
        </div>
        <div>
          <label className={lbl}>Target group</label>
          <select name="target_group" defaultValue={co.target_group ?? ""} className={field}>
            <option value="">—</option>
            {targetOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Owner</label>
          <select name="owner_id" defaultValue={co.owner_id ?? ""} className={field}>
            <option value="">— unassigned —</option>
            {ownerList.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-4 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_partner" value="true" defaultChecked={co.is_partner} /> Partner</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="icp" value="true" defaultChecked={co.icp} /> ICP</label>
        </div>
        <div className="sm:col-span-2">
          <PendingButton className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" pendingLabel="Saving…">Save</PendingButton>
        </div>
      </form>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Deals <span className="text-neutral-400">({deals.length})</span></h2>
        {deals.length === 0 ? (
          <p className="text-sm text-neutral-500">No deals linked in HubSpot.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
            {deals.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
                <Link href={`/hot/${d.id}`} className="font-medium text-blue-700 hover:underline">{d.name || "(untitled deal)"}</Link>
                {d.stage && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">{d.stage}</span>}
                {d.amount != null && <span className="text-neutral-500">{new Intl.NumberFormat("en-GB", { style: "currency", currency: d.currency || "GBP", maximumFractionDigits: 0 }).format(d.amount)}</span>}
                {d.owner_name && <span className="text-neutral-400">· {d.owner_name}</span>}
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-neutral-400 hover:text-orange-600" title="Open in HubSpot">↗</a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Contacts <span className="text-neutral-400">({contacts.length})</span></h2>
        {contacts.length === 0 ? (
          <p className="text-sm text-neutral-500">No contacts linked in HubSpot.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
            {contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
                <Link href={`/contacts/${c.id}`} className="font-medium text-blue-700 hover:underline">{c.full_name || c.email || "—"}</Link>
                {c.job_title && <span className="text-neutral-500">{c.job_title}</span>}
                {c.contact_type.map((t) => (
                  <span key={t} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-700">{t}</span>
                ))}
                <span className="ml-auto text-neutral-400">{c.email ?? ""}</span>
                {c.is_new && <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">New</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-xs text-neutral-400">
        Live HubSpot company. Notes and the activity timeline live in HubSpot (↗) and move in with the operational-data step.
      </p>
    </>
  );
}

// ─── Onboarding tab: no-case start affordance ────────────────────────────────

function StartOnboarding({ id, customer, deals }: { id: string; customer: boolean; deals: Awaited<ReturnType<typeof companyDeals>> }) {
  if (!customer) {
    return <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-500">Mark this company as an <strong>Active Customer</strong> (button above) to begin onboarding.</p>;
  }
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-neutral-700">Start onboarding</h2>
      {deals.length === 0 ? (
        <p className="text-sm text-neutral-500">No deal to onboard — link a deal in HubSpot to start.</p>
      ) : deals.length === 1 ? (
        <form action={startOnboardingAction}>
          <input type="hidden" name="deal_id" value={deals[0]!.id} />
          <PendingButton className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700" pendingLabel="Starting…">Start onboarding</PendingButton>
        </form>
      ) : (
        <form action={startOnboardingAction} className="flex flex-wrap items-center gap-2">
          <select name="deal_id" defaultValue={deals[0]!.id} className="rounded border border-neutral-300 px-2 py-1 text-xs">
            {deals.map((d) => <option key={d.id} value={d.id}>{d.name ?? d.id}{d.stage ? ` · ${d.stage}` : ""}</option>)}
          </select>
          <PendingButton className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700" pendingLabel="Starting…">Start onboarding</PendingButton>
        </form>
      )}
    </section>
  );
}

// ─── Billing tab (item 3) ────────────────────────────────────────────────────

async function BillingTab({ id, billingAcct, hasOnboardedCase, customer }: {
  id: string; billingAcct: { id: string; status: string; contract_start_date: string | null; billing_frequency: string | null } | null; hasOnboardedCase: boolean; customer: boolean;
}) {
  if (!billingAcct) {
    return (
      <section className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
        {!customer ? (
          <p className="text-neutral-500">Mark this company as an <strong>Active Customer</strong> to set up billing.</p>
        ) : hasOnboardedCase ? (
          <form action={setUpBillingAction}>
            <input type="hidden" name="company_id" value={id} />
            <PendingButton className="rounded border border-indigo-300 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50" pendingLabel="Setting up…">Set up billing →</PendingButton>
          </form>
        ) : (
          <p className="text-neutral-500">Billing opens once onboarding is approved.</p>
        )}
      </section>
    );
  }

  // Invoices for this account — most recent first for "last invoice" + outstanding.
  const bdb = serviceClient();
  const { data: invRows } = await bdb
    .from("billing_invoices")
    .select("total_pence, period_month, due_date, paid_at")
    .eq("account_id", billingAcct.id)
    .order("period_month", { ascending: false });
  const invs = (invRows ?? []) as { total_pence: number; period_month: string; due_date: string | null; paid_at: string | null }[];
  const last = invs[0] ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = invs.filter((i) => !i.paid_at && i.due_date && i.due_date < today);
  const overdueTotal = overdue.reduce((s, i) => s + (i.total_pence ?? 0), 0);
  // "Next payment due" = soonest unpaid invoice due date.
  const nextDue = invs.filter((i) => !i.paid_at && i.due_date).map((i) => i.due_date!).sort()[0] ?? null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-neutral-700">Billing</h2>
        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">{billingAcct.status.replace(/_/g, " ")}</span>
        <Link href={`/billing/${billingAcct.id}`} className="ml-auto rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">Open billing account →</Link>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat label="Status">{billingAcct.status.replace(/_/g, " ")}</Stat>
        <Stat label="Billing frequency">{billingAcct.billing_frequency ?? "—"}</Stat>
        <Stat label="Last invoice">{last ? `${gbp(last.total_pence)} · ${last.period_month.slice(0, 7)}` : "—"}</Stat>
        <Stat label="Next payment due">{nextDue ? fmtDate(nextDue) : <span className="text-neutral-400">—</span>}</Stat>
        <Stat label="Invoices to date">{invs.length}</Stat>
        <Stat label="Overdue">{overdueTotal > 0 ? <span className="text-red-700">{gbp(overdueTotal)} ({overdue.length})</span> : <span className="text-emerald-700">none</span>}</Stat>
      </dl>
      <p className="text-xs text-neutral-400">Invoices are generated automatically each billing run. Open the billing account for the full schedule, line items and dunning.</p>
    </section>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-neutral-800">{children}</dd>
    </div>
  );
}
