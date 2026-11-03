// HubSpot-backed company detail (P3). Identity + the app's custom fields
// (tier / partner / ICP / current-client / onboarding / target-group) +
// associated contacts with their account-role tags. Isolated; the Supabase
// detail page is untouched and used when CRM_BACKEND=supabase. Deals, notes,
// events and conference panels are deferred with the operational-data decision.

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
import { merchantFormUrl } from "@/lib/onboarding/merchantForm";
import { CopyButton } from "@/components/CopyButton";

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

export async function HubspotCompanyDetail({ id }: { id: string }) {
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

  // Billing affordance: link to the account if one exists, else offer "Set up
  // billing" when the company has an onboarded case (normally auto-created on
  // approval). Scoped to this file — the Supabase detail page is unaffected.
  const bdb = serviceClient();
  const [{ data: billingAccts }, { data: caseRows }, customer] = await Promise.all([
    bdb.from("billing_accounts").select("id, status").eq("hubspot_company_id", id).order("created_at", { ascending: false }).limit(1),
    bdb.from("onboarding_cases").select("id, status, merchant_form_token").eq("hubspot_company_id", id).neq("status", "cancelled").order("updated_at", { ascending: false }).limit(1),
    isCustomer(bdb, id),
  ]);
  // Customer status = the local "Active Customer" flag (the button), NOT
  // HubSpot current_client. Clicking the button sets both; current_client on
  // its own does not make a company a customer here.
  const billingAcct = (billingAccts ?? [])[0] ?? null;
  const onboardingCase = (caseRows ?? [])[0] ?? null;
  const hasOnboardedCase = onboardingCase?.status === "onboarded";
  // Deal picker for "Start onboarding" uses these only when no case exists yet;
  // the full list is also shown in the Deals section below.
  const onboardDeals = onboardingCase ? [] : deals;

  // HubSpot option values can differ from labels — show the label.
  const onboardingText = co.onboarding_status ? (onboardingOpts.find((o) => o.value === co.onboarding_status)?.label ?? co.onboarding_status) : null;
  const targetText = co.target_group ? (targetOpts.find((o) => o.value === co.target_group)?.label ?? co.target_group) : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:px-8">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/companies" className="text-sm text-blue-700 hover:underline">← Companies</Link>
        <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700">HubSpot</span>
      </div>

      <header className="mb-5 border-b border-neutral-200 pb-3">
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

      {/* Onboarding + billing blocks — appear once the company is an Active Customer.
          The onboarding block carries the shareable customer link (salesperson sends
          it; no email ever goes to the customer). */}
      {customer && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-700">Onboarding</h2>
              {onboardingCase && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">{onboardingCase.status.replace(/_/g, " ")}</span>}
            </div>
            {onboardingCase ? (
              <div className="space-y-2">
                <Link href={`/onboarding/${onboardingCase.id}`} className="inline-block rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700">Open onboarding case →</Link>
                {onboardingCase.merchant_form_token && (
                  <div className="rounded border border-dashed border-neutral-300 bg-neutral-50 p-2">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Customer onboarding link</p>
                    <div className="flex items-start gap-2">
                      <a href={merchantFormUrl(onboardingCase.merchant_form_token)} target="_blank" rel="noopener noreferrer" className="break-all text-xs text-blue-700 hover:underline">{merchantFormUrl(onboardingCase.merchant_form_token)}</a>
                      <CopyButton text={merchantFormUrl(onboardingCase.merchant_form_token)} label="Copy" />
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-400">Send this to the customer to complete their onboarding form.</p>
                  </div>
                )}
              </div>
            ) : onboardDeals.length === 0 ? (
              <p className="text-sm text-neutral-500">No deal to onboard — link a deal in HubSpot to start.</p>
            ) : onboardDeals.length === 1 ? (
              <form action={startOnboardingAction}>
                <input type="hidden" name="deal_id" value={onboardDeals[0]!.id} />
                <PendingButton className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700" pendingLabel="Starting…">Start onboarding</PendingButton>
              </form>
            ) : (
              <form action={startOnboardingAction} className="flex flex-wrap items-center gap-2">
                <select name="deal_id" defaultValue={onboardDeals[0]!.id} className="rounded border border-neutral-300 px-2 py-1 text-xs">
                  {onboardDeals.map((d) => <option key={d.id} value={d.id}>{d.name ?? d.id}{d.stage ? ` · ${d.stage}` : ""}</option>)}
                </select>
                <PendingButton className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700" pendingLabel="Starting…">Start onboarding</PendingButton>
              </form>
            )}
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-700">Billing</h2>
              {billingAcct && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">{billingAcct.status.replace(/_/g, " ")}</span>}
            </div>
            {billingAcct ? (
              <Link href={`/billing/${billingAcct.id}`} className="inline-block rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">Open billing →</Link>
            ) : hasOnboardedCase ? (
              <form action={setUpBillingAction}>
                <input type="hidden" name="company_id" value={id} />
                <PendingButton className="rounded border border-indigo-300 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50" pendingLabel="Setting up…">Set up billing →</PendingButton>
              </form>
            ) : (
              <p className="text-sm text-neutral-500">Billing opens once onboarding is approved.</p>
            )}
          </section>
        </div>
      )}

      {/* Edit */}
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
          {/* Read-only — a result of the onboarding case, not a free-edit field.
              Change it by running the onboarding, not by picking here. */}
          <div className={`${field} flex items-center bg-neutral-100 text-neutral-600`}>
            {onboardingCase ? onboardingCase.status : onboardingText ?? "—"}
          </div>
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

      {/* Associated deals */}
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

      {/* Associated contacts */}
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
        Live HubSpot company. Deals, notes, events and the activity timeline live in HubSpot (↗) and move in with the operational-data step.
      </p>
    </main>
  );
}
