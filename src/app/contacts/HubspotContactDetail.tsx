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
import { propOptions } from "@/lib/hubspot/schema";
import { PendingButton } from "@/components/PendingButton";
import { recordUrl } from "@/lib/hubspot/client";
import { updateHubspotContact, markHubspotActioned, confirmHubspotEmail } from "./hubspotActions";
import { fmtDate } from "@/lib/format/datetime";

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

export async function HubspotContactDetail({ id }: { id: string }) {
  const [c, typeOpts] = await Promise.all([getCrm().getContact(id), propOptions("contacts", "type")]);
  if (!c) notFound();
  const selected = new Set(c.contact_type);

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
          {c.company_name && (
            <a href={c.company_id ? recordUrl("companies", c.company_id) : "#"} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">
              {c.company_name} ↗
            </a>
          )}
          {c.lead_status && <span>Status: {c.is_new ? "New" : c.lead_status}</span>}
          {c.lead_source && <span>Source: {c.lead_source}</span>}
          {c.created_at && <span>Added {fmtDate(c.created_at)}</span>}
          <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">Open in HubSpot ↗</a>
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
          <label className={lbl}>Name</label>
          <input name="full_name" defaultValue={c.full_name} className={field} />
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

      <p className="mt-6 text-xs text-neutral-400">
        Live HubSpot contact. The full activity timeline (emails, meetings, notes) lives in HubSpot — open it with the ↗ link. Email sends, sequences, drafts and meeting panels move in once operational data is re-keyed to HubSpot contacts.
      </p>
    </main>
  );
}
