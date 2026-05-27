import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { updateOrg, deleteOrg } from "../../actions";

export const dynamic = "force-dynamic";

const SECTORS = ["bank", "broker", "building_society", "credit_union", "direct_lender", "marketplace", "sme_lender", "utility"];

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

export default async function CompanyDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = serviceClient();
  const { data: org } = await db.from("organisations").select("*").eq("id", id).maybeSingle();
  if (!org) notFound();

  const [{ data: contacts }, { data: deals }, { data: notes }] = await Promise.all([
    db.from("contacts").select("id, full_name, job_title, email").eq("organisation_id", id).limit(100),
    db.from("deals").select("id, title, status, value").eq("organisation_id", id),
    db.from("notes").select("id, content, noted_at").eq("organisation_id", id).order("noted_at", { ascending: false }).limit(20),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/companies" className="text-sm text-blue-700 hover:underline">← Companies</Link>
      <h1 className="mt-2 mb-4 text-xl font-semibold">{org.name}</h1>

      <form action={updateOrg} className="grid grid-cols-2 gap-3">
        <input type="hidden" name="id" value={org.id} />
        <div className="col-span-2"><label className={lbl}>Name</label><input name="name" defaultValue={org.name ?? ""} className={field} /></div>
        <div>
          <label className={lbl}>Sector</label>
          <select name="sector" defaultValue={org.sector ?? ""} className={field}>
            <option value="">—</option>
            {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div><label className={lbl}>Label</label><input name="label" defaultValue={org.label ?? ""} className={field} /></div>
        <div><label className={lbl}>Website</label><input name="website" defaultValue={org.website ?? ""} className={field} /></div>
        <div><label className={lbl}>Location</label><input name="location" defaultValue={org.location ?? ""} className={field} /></div>
        <div><label className={lbl}>Customer category</label><input name="customer_category" defaultValue={org.customer_category ?? ""} className={field} /></div>
        <div><label className={lbl}>Sub-category</label><input name="customer_sub_category" defaultValue={org.customer_sub_category ?? ""} className={field} /></div>
        <div><label className={lbl}>Industry (raw)</label><input name="industry" defaultValue={org.industry ?? ""} className={field} /></div>
        <div className="flex items-end gap-2"><input type="checkbox" name="is_partner" defaultChecked={org.is_partner} id="ip" /><label htmlFor="ip" className="text-sm">Partner (excluded from outreach)</label></div>
        <div className="col-span-2"><label className={lbl}>Notes</label><textarea name="top_line_notes" defaultValue={org.top_line_notes ?? ""} rows={3} className={field} /></div>
        <div className="col-span-2 flex gap-2">
          <button className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Save</button>
          <button formAction={deleteOrg} className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50">Delete</button>
        </div>
      </form>

      <section className="mt-8 grid grid-cols-1 gap-6 text-sm">
        <div>
          <h2 className="mb-2 font-semibold">Contacts ({contacts?.length ?? 0})</h2>
          <ul className="space-y-1">
            {(contacts ?? []).map((c) => (
              <li key={c.id}>
                <Link href={`/contacts/${c.id}`} className="text-blue-700 hover:underline">{c.full_name}</Link>
                <span className="text-neutral-500"> — {c.job_title ?? ""} {c.email ? `· ${c.email}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">Deals ({deals?.length ?? 0})</h2>
          <ul className="space-y-1 text-neutral-600">
            {(deals ?? []).map((d) => <li key={d.id}>{d.title} — {d.status}{typeof d.value === "number" ? ` · £${d.value.toLocaleString()}` : ""}</li>)}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">Notes ({notes?.length ?? 0})</h2>
          <ul className="space-y-2 text-neutral-600">
            {(notes ?? []).map((n) => <li key={n.id} className="border-l-2 border-neutral-200 pl-2">{String(n.content).slice(0, 300)}</li>)}
          </ul>
        </div>
      </section>
    </main>
  );
}
