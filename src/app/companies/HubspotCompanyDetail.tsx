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
import { updateHubspotCompany } from "./hubspotActions";
import { serviceClient } from "@/lib/db/client";
import { setUpBillingAction } from "../billing/actions";

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

export async function HubspotCompanyDetail({ id }: { id: string }) {
  const crm = getCrm();
  const [co, contacts, onboardingOpts, targetOpts] = await Promise.all([
    crm.getCompany(id),
    crm.listCompanyContacts(id, 100),
    propOptions("companies", "onboarding_status"),
    propOptions("companies", "target_group"),
  ]);
  if (!co) notFound();

  // Billing affordance: link to the account if one exists, else offer "Set up
  // billing" when the company has an onboarded case (normally auto-created on
  // approval). Scoped to this file — the Supabase detail page is unaffected.
  const bdb = serviceClient();
  const [{ data: billingAccts }, { data: onboardedCases }] = await Promise.all([
    bdb.from("billing_accounts").select("id, status").eq("hubspot_company_id", id).order("created_at", { ascending: false }).limit(1),
    bdb.from("onboarding_cases").select("id").eq("hubspot_company_id", id).eq("status", "onboarded").limit(1),
  ]);
  const billingAcct = (billingAccts ?? [])[0] ?? null;
  const hasOnboardedCase = (onboardedCases?.length ?? 0) > 0;

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
          {co.current_client && <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Client</span>}
          {onboardingText && <OnboardingBadge status={onboardingText} />}
          {co.is_partner && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700">partner</span>}
          {co.icp && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">ICP</span>}
          {co.tier != null && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">Tier {co.tier}</span>}
          {billingAcct ? (
            <Link href={`/billing/${billingAcct.id}`} className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-700 hover:underline">Billing: {billingAcct.status} →</Link>
          ) : hasOnboardedCase ? (
            <form action={setUpBillingAction}>
              <input type="hidden" name="company_id" value={id} />
              <button type="submit" className="rounded border border-indigo-300 px-1.5 py-0.5 text-xs text-indigo-700 hover:bg-indigo-50">Set up billing</button>
            </form>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-neutral-500">
          {co.website && <a href={/^https?:\/\//.test(co.website) ? co.website : `https://${co.website}`} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">{co.website} ↗</a>}
          {targetText && <span>{targetText}</span>}
          {co.company_number && <span>Co. no. <span className="font-mono text-neutral-600">{co.company_number}</span></span>}
          {co.created_at && <span>Added {fmtDate(co.created_at)}</span>}
          <a href={co.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">Open in HubSpot ↗</a>
        </div>
      </header>

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
          <label className={lbl}>Current client</label>
          <select name="current_client" defaultValue={co.current_client == null ? "" : co.current_client ? "true" : "false"} className={field}>
            <option value="">—</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div>
          <label className={lbl}>Onboarding status</label>
          {onboardingOpts.length > 0 ? (
            <select name="onboarding_status" defaultValue={co.onboarding_status ?? ""} className={field}>
              <option value="">—</option>
              {onboardingOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input name="onboarding_status" defaultValue={co.onboarding_status ?? ""} placeholder="Add the onboarding_status property in HubSpot" className={field} disabled />
          )}
        </div>
        <div>
          <label className={lbl}>Target group</label>
          <select name="target_group" defaultValue={co.target_group ?? ""} className={field}>
            <option value="">—</option>
            {targetOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Tier</label>
          <input name="tier" type="number" min="1" defaultValue={co.tier ?? ""} className={field} />
        </div>
        <div className="flex items-center gap-4 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_partner" value="true" defaultChecked={co.is_partner} /> Partner</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="icp" value="true" defaultChecked={co.icp} /> ICP</label>
        </div>
        <div className="sm:col-span-2">
          <PendingButton className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" pendingLabel="Saving…">Save</PendingButton>
        </div>
      </form>

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
