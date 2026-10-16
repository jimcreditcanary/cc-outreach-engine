// HubSpot-backed company detail (P3). Identity + the app's custom fields
// (tier / partner / ICP) + associated contacts. Isolated; the Supabase detail
// page is untouched and used when CRM_BACKEND=supabase. Deals, notes, events
// and conference panels are deferred with the operational-data decision.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrm } from "@/lib/crm";
import { PendingButton } from "@/components/PendingButton";
import { fmtDate } from "@/lib/format/datetime";
import { updateHubspotCompany } from "./hubspotActions";

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

export async function HubspotCompanyDetail({ id }: { id: string }) {
  const crm = getCrm();
  const [co, contacts] = await Promise.all([crm.getCompany(id), crm.listCompanyContacts(id, 100)]);
  if (!co) notFound();

  return (
    <main className="mx-auto max-w-3xl px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/companies" className="text-sm text-blue-700 hover:underline">← Companies</Link>
        <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700">HubSpot</span>
      </div>

      <header className="mb-5 border-b border-neutral-200 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{co.name || "Company"}</h1>
          {co.is_partner && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700">partner</span>}
          {co.icp && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">ICP</span>}
          {co.tier != null && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">Tier {co.tier}</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-neutral-500">
          {co.website && <a href={/^https?:\/\//.test(co.website) ? co.website : `https://${co.website}`} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">{co.website} ↗</a>}
          {co.industry && <span>{co.industry}</span>}
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
          <label className={lbl}>Industry</label>
          <input name="industry" defaultValue={co.industry ?? ""} className={field} />
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
