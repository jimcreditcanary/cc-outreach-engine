// HubSpot-backed contact detail (P3b). Focused on identity + lead actions so a
// contact opens in-app with edit instead of linking out. The operational
// panels on the Supabase detail page (email sends, meetings, drafts,
// newsletter, custom fields, notes, merge) are deferred — they're keyed to
// Supabase contact ids and need the "how do operational tables relate to
// HubSpot contacts" decision before they move. The live timeline lives in
// HubSpot via the ↗ link for now.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrm } from "@/lib/crm";
import { serviceClient } from "@/lib/db/client";
import { propOptions } from "@/lib/hubspot/schema";
import { PendingButton } from "@/components/PendingButton";
import { recordUrl } from "@/lib/hubspot/client";
import { contactCompanyIdList, contactDeals } from "@/lib/hubspot/repo";
import { companyOpsStatus } from "@/lib/crm/companyStatus";
import { loadContactEventsByEmail, eventLabel } from "@/lib/crm/contactEvents";
import { updateHubspotContact, markHubspotActioned, confirmHubspotEmail } from "./hubspotActions";
import { fmtDate } from "@/lib/format/datetime";

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

function money(amount: number | null, currency: string | null): string {
  if (amount == null) return "";
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP", maximumFractionDigits: 0 }).format(amount); }
  catch { return `${currency ?? ""} ${amount.toLocaleString()}`.trim(); }
}

export async function HubspotContactDetail({ id }: { id: string }) {
  const crm = getCrm();
  const [c, typeOpts, companyIds, deals] = await Promise.all([
    crm.getContact(id),
    propOptions("contacts", "type"),
    contactCompanyIdList(id),
    contactDeals(id),
  ]);
  if (!c) notFound();
  const selected = new Set(c.contact_type);

  // Associated companies (a contact can belong to several) with their customer /
  // onboarding / billing status, plus the primary company's target group.
  const ids = companyIds.length ? companyIds : c.company_id ? [c.company_id] : [];
  const [companies, ops] = await Promise.all([
    Promise.all(ids.map((cid) => crm.getCompany(cid).catch(() => null))).then((cs) => cs.filter((x): x is NonNullable<typeof x> => x != null)),
    companyOpsStatus(ids),
  ]);
  const targetText = companies.find((co) => co.target_group)?.target_group ?? null;
  const events = await loadContactEventsByEmail(serviceClient(), c.email);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:px-8">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/contacts" className="text-sm text-blue-700 hover:underline">← Contacts</Link>
        <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700">HubSpot</span>
      </div>

      <header className="mb-5 border-b border-neutral-200 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{c.full_name || c.email || "Contact"}</h1>
          {c.is_new && <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">New</span>}
          {c.email_bounced && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">bounced</span>}
          {c.email_guessed && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">guessed</span>}
          {c.contact_type.map((t) => (
            <span key={t} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-700">{t}</span>
          ))}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-neutral-500">
          {c.company_name && c.company_id && (
            <span className="flex items-center gap-1">
              <Link href={`/companies/${c.company_id}`} className="text-blue-700 hover:underline">{c.company_name}</Link>
              <a href={recordUrl("companies", c.company_id)} target="_blank" rel="noopener noreferrer" className="text-neutral-400 hover:text-orange-600" title="Company in HubSpot">↗</a>
            </span>
          )}
          {targetText && <span>{targetText}</span>}
          {c.lead_status && <span>Status: {c.is_new ? "New" : c.lead_status}</span>}
          {c.lead_source && <span>Source: {c.lead_source}</span>}
          {c.owner_name && <span>Owner: <span className="text-neutral-600">{c.owner_name}</span></span>}
          {c.created_at && <span>Added {fmtDate(c.created_at)}</span>}
          <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">Open contact in HubSpot ↗</a>
        </div>
      </header>

      {/* Lead actions */}
      {(c.is_new || c.email_guessed) && (
        <div className="mb-5 flex flex-wrap gap-2">
          {c.is_new && (
            <form action={markHubspotActioned}>
              <input type="hidden" name="id" value={c.id} />
              <PendingButton className="rounded border border-emerald-300 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50" pendingLabel="…">✓ Mark actioned</PendingButton>
            </form>
          )}
          {c.email_guessed && (
            <form action={confirmHubspotEmail}>
              <input type="hidden" name="id" value={c.id} />
              <PendingButton className="rounded border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50" pendingLabel="…" title="Confirm the guessed email is correct (email_status → Verified)">✓ Confirm email</PendingButton>
            </form>
          )}
        </div>
      )}

      {/* Edit identity */}
      <form action={updateHubspotContact} className="grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-2">
        <input type="hidden" name="id" value={c.id} />
        <div>
          <label className={lbl}>First name</label>
          <input name="first_name" defaultValue={c.first_name ?? ""} className={field} />
        </div>
        <div>
          <label className={lbl}>Last name</label>
          <input name="last_name" defaultValue={c.last_name ?? ""} className={field} />
        </div>
        <div>
          <label className={lbl}>Email</label>
          <input name="email" type="email" defaultValue={c.email ?? ""} className={field} />
        </div>
        <div>
          <label className={lbl}>Job title</label>
          <input name="job_title" defaultValue={c.job_title ?? ""} className={field} />
        </div>
        <div>
          <label className={lbl}>Mobile</label>
          <input name="mobile" defaultValue={c.mobile ?? ""} className={field} />
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>Type <span className="normal-case text-neutral-400">(account roles)</span></label>
          {typeOpts.length > 0 ? (
            <>
              <input type="hidden" name="contact_type_present" value="1" />
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {typeOpts.map((o) => (
                  <label key={o.value} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="contact_type" value={o.value} defaultChecked={selected.has(o.value)} className="accent-indigo-600" />
                    {o.label}
                  </label>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-amber-700">Add the <code>type</code> contact property (Multiple checkboxes) in HubSpot with Technical / Decision Maker&nbsp;/&nbsp;Signatory / Compliance / Procurement / Billing Contact to tag roles here.</p>
          )}
        </div>
        <div className="sm:col-span-2">
          <PendingButton className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" pendingLabel="Saving…">Save</PendingButton>
        </div>
      </form>

      {/* Associated companies (with customer / onboarding / billing status) */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Companies <span className="text-neutral-400">({companies.length})</span></h2>
        {companies.length === 0 ? (
          <p className="text-sm text-neutral-500">No companies linked in HubSpot.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
            {companies.map((co) => {
              const o = ops.get(co.id);
              return (
                <li key={co.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
                  <Link href={`/companies/${co.id}`} className="font-medium text-blue-700 hover:underline">{co.name || "—"}</Link>
                  {co.current_client && <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Customer</span>}
                  {o?.onboarding && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">onb: {o.onboarding}</span>}
                  {o?.billing && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] text-indigo-700">bill: {o.billing}</span>}
                  <a href={recordUrl("companies", co.id)} target="_blank" rel="noopener noreferrer" className="ml-auto text-neutral-400 hover:text-orange-600" title="Open in HubSpot">↗</a>
                </li>
              );
            })}
          </ul>
        )}
      </section>

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
                {d.amount != null && <span className="text-neutral-500">{money(d.amount, d.currency)}</span>}
                {d.owner_name && <span className="text-neutral-400">· {d.owner_name}</span>}
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-neutral-400 hover:text-orange-600" title="Open in HubSpot">↗</a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Activity / events (item 11) — recorded against this contact (bridged by email). */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Activity <span className="text-neutral-400">({events.length})</span></h2>
        {events.length === 0 ? (
          <p className="text-sm text-neutral-500">No recorded activity for this contact. The full HubSpot timeline is available via the ↗ link above.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
            {events.map((e, i) => (
              <li key={i} className="flex items-baseline gap-2 px-3 py-1.5 text-sm">
                <span className="w-28 shrink-0 text-xs text-neutral-400">{fmtDate(e.ts)}</span>
                <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600">{eventLabel(e.type)}</span>
                {e.message && <span className="text-neutral-700">{e.message}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-xs text-neutral-400">
        Live HubSpot contact. Meetings aren&apos;t shown here yet — they&apos;re keyed to the Supabase contact and move in with the operational-data re-keying. The full HubSpot activity timeline is available via the ↗ link.
      </p>
    </main>
  );
}
