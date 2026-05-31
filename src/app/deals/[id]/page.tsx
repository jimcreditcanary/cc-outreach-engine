import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { updateDeal, deleteDeal, uploadProposal, addDealContact, removeDealContact, reseedDealMeddicc } from "../../actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { PendingButton } from "@/components/PendingButton";

export const dynamic = "force-dynamic";
// Proposal upload + AI markdown conversion + MEDDICC auto-seed can run 20s+.
// Vercel Pro tier honours this; Hobby caps at 10s regardless.
export const maxDuration = 60;

const STATUS = ["open", "won", "lost"];
// Pipeline stages (from the Pipedrive export) + closed-lost for completeness.
const DEAL_STAGES = ["Identify", "Qualify / Discovery", "Develop", "Commit", "Nurture", "Closed Won", "Closed Lost"];
// MEDDICC stakeholder roles.
const DEAL_ROLES = ["Economic Buyer", "Champion", "Decision Maker", "Influencer", "Technical Evaluator", "End User", "Coach", "Blocker"];
const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

const MEDDICC: { key: string; label: string }[] = [
  { key: "metrics", label: "Metrics" },
  { key: "economic_buyer", label: "Econ. buyer" },
  { key: "decision_criteria", label: "Criteria" },
  { key: "decision_process", label: "Process" },
  { key: "identified_pain", label: "Pain" },
  { key: "champion", label: "Champion" },
  { key: "competition", label: "Competition" },
];

export default async function DealDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ uploaded?: string }>;
}) {
  const { id } = await params;
  const { uploaded } = await searchParams;
  const db = serviceClient();
  const { data: deal } = await db.from("deals").select("*, organisation:organisations(id, name, tier)").eq("id", id).maybeSingle();
  if (!deal) notFound();
  const org = deal.organisation as { id: string; name: string | null; tier: number | null } | null;

  const [{ data: orgContacts }, { data: links }, { data: orgs }, { data: events }] = await Promise.all([
    org ? db.from("contacts").select("id, full_name, job_title").eq("organisation_id", org.id).order("full_name") : Promise.resolve({ data: [] }),
    db.from("deal_contacts").select("contact_id, role, contact:contacts(id, full_name, job_title)").eq("deal_id", id),
    db.from("organisations").select("id, name").order("name").limit(1000),
    db.from("events").select("type, ts, payload").eq("deal_id", id).order("ts", { ascending: false }).limit(30),
  ]);
  const stakeholders = (links ?? []) as unknown as { contact_id: string; role: string | null; contact: { id: string; full_name: string | null; job_title: string | null } | null }[];
  const linkedIds = new Set(stakeholders.map((s) => s.contact_id));
  // Primary/stakeholder pickers normally scope to the deal's company. If the
  // company has no contacts on file, fall back to all contacts so a primary
  // can still be set (and so a freshly-changed company isn't a dead end).
  let pickContacts = orgContacts ?? [];
  if (pickContacts.length === 0) {
    const { data: all } = await db.from("contacts").select("id, full_name, job_title").order("full_name").limit(1000);
    pickContacts = all ?? [];
  }
  const addable = pickContacts.filter((c) => !linkedIds.has(c.id) && c.id !== deal.primary_contact_id);
  const timeline = (events ?? []) as unknown as { type: string; ts: string; payload: { message?: string } | null }[];

  return (
    <main className="w-full px-[50px] py-8">
      <Link href="/deals" className="text-sm text-blue-700 hover:underline">← Deals</Link>
      <h1 className="mt-2 text-xl font-semibold">{deal.title ?? "(untitled deal)"}</h1>
      <p className="mb-4 text-sm text-neutral-500">
        {org && <Link href={`/companies/${org.id}`} className="text-blue-700 hover:underline">{org.name}</Link>}
        {org?.tier ? <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">T{org.tier}</span> : null}
      </p>

      <form action={updateDeal} className="grid grid-cols-2 gap-3">
        <input type="hidden" name="id" value={deal.id} />
        <input type="hidden" name="prev_organisation_id" value={org?.id ?? ""} />
        <div className="col-span-2"><label className={lbl}>Title</label><input name="title" defaultValue={deal.title ?? ""} className={field} /></div>
        <div>
          <label className={lbl}>Company</label>
          <select name="organisation_id" defaultValue={org?.id ?? ""} className={field}>
            <option value="">— none —</option>
            {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Status</label>
          <select name="status" defaultValue={deal.status} className={field}>
            {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Stage</label>
          <select name="stage" defaultValue={deal.stage ?? ""} className={field}>
            <option value="">—</option>
            {[...new Set([...DEAL_STAGES, ...(deal.stage ? [deal.stage] : [])])].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div><label className={lbl}>TCV — total contract value (£)</label><input name="tcv" type="number" defaultValue={deal.tcv ?? deal.value ?? ""} className={field} /></div>
        <div><label className={lbl}>ARR — annual recurring revenue (£)</label><input name="arr" type="number" defaultValue={deal.arr ?? ""} className={field} /></div>
        <div className="col-span-2">
          <label className={lbl}>Primary contact{(orgContacts ?? []).length === 0 ? " (company has none on file — pick from all)" : ""}</label>
          <select name="primary_contact_id" defaultValue={deal.primary_contact_id ?? ""} className={field}>
            <option value="">— none —</option>
            {pickContacts.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.job_title ? ` — ${c.job_title}` : ""}</option>)}
          </select>
        </div>
        <div className="col-span-2 flex gap-2">
          <button className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Save</button>
          <ConfirmSubmit
            formAction={deleteDeal}
            className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            message={`Delete deal "${deal.title ?? "(untitled)"}"? Its stakeholders, proposal and MEDDICC go too.`}
          >
            Delete
          </ConfirmSubmit>
        </div>
      </form>

      {/* Stakeholders */}
      <section className="mt-8 text-sm">
        <h2 className="mb-2 font-semibold">Stakeholders ({stakeholders.length})</h2>
        <ul className="mb-3 space-y-1">
          {stakeholders.map((s) => (
            <li key={s.contact_id} className="flex items-center justify-between rounded border border-neutral-200 px-2 py-1.5">
              <span>
                <Link href={`/contacts/${s.contact_id}`} className="text-blue-700 hover:underline">{s.contact?.full_name}</Link>
                <span className="text-neutral-500"> {s.role ? `· ${s.role}` : s.contact?.job_title ? `· ${s.contact.job_title}` : ""}</span>
              </span>
              <form action={removeDealContact}>
                <input type="hidden" name="deal_id" value={deal.id} />
                <input type="hidden" name="contact_id" value={s.contact_id} />
                <button className="text-xs text-red-600 hover:underline">remove</button>
              </form>
            </li>
          ))}
          {stakeholders.length === 0 && <li className="text-neutral-400">None yet.</li>}
        </ul>
        <form action={addDealContact} className="flex gap-2">
          <input type="hidden" name="deal_id" value={deal.id} />
          <select name="contact_id" className={`${field} flex-1`} defaultValue="" required>
            <option value="" disabled>add a contact…</option>
            {addable.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.job_title ? ` — ${c.job_title}` : ""}</option>)}
          </select>
          <select name="role" className="w-44 rounded border border-neutral-300 px-2 py-1.5 text-sm" defaultValue="">
            <option value="">role…</option>
            {DEAL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Add</button>
        </form>
      </section>

      {/* Proposal */}
      <section className="mt-8 text-sm">
        <h2 className="mb-2 font-semibold">Proposal {deal.proposal_exists ? <span className="rounded bg-emerald-100 px-1.5 text-xs text-emerald-700">attached</span> : <span className="text-neutral-400">— none</span>}</h2>
        {uploaded && (
          <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            ✓ Proposal uploaded, converted to markdown, MEDDICC seeded. View the new biggest gap on <a href="/hot" className="underline">/hot</a>.
          </div>
        )}
        <form action={uploadProposal} className="mb-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="deal_id" value={deal.id} />
          <input type="file" name="file" accept=".pdf,.docx,.txt,.md" className="text-sm" required />
          <PendingButton
            className="rounded bg-neutral-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
            pendingLabel="Uploading + extracting + seeding MEDDICC…"
          >
            Upload → convert to markdown
          </PendingButton>
        </form>
        <p className="mb-2 text-xs text-neutral-400">PDF / DOCX / TXT / MD. Converted to clean markdown by AI (typically 20-40s for a PDF), then it flips the deal into T1/T2 and feeds MEDDICC.</p>
        {deal.proposal_text && (
          <details className="rounded border border-neutral-200 bg-white p-3">
            <summary className="cursor-pointer text-neutral-600">View proposal markdown ({deal.proposal_text.length} chars)</summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-xs text-neutral-700">{deal.proposal_text}</pre>
          </details>
        )}
      </section>

      {/* MEDDICC */}
      <section className="mt-8 text-sm">
        <div className="mb-2 flex items-center gap-3">
          <h2 className="font-semibold">MEDDICC</h2>
          {deal.proposal_exists && (
            <form action={reseedDealMeddicc}>
              <input type="hidden" name="deal_id" value={deal.id} />
              <PendingButton
                className="rounded border border-neutral-300 px-2 py-0.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
                pendingLabel="Re-seeding…"
              >
                Re-seed
              </PendingButton>
            </form>
          )}
        </div>
        <p className="mb-2 text-xs text-neutral-400">Auto-seeded on proposal upload and whenever a new note is added on this company.</p>
        <div className="mb-3 flex flex-wrap gap-1">
          {MEDDICC.map((m) => {
            const filled = deal[`meddicc_${m.key}_filled`] as boolean;
            return <span key={m.key} className={`rounded px-1.5 py-0.5 text-xs ${filled ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-400"}`}>{m.label}</span>;
          })}
        </div>
        <dl className="space-y-1 text-neutral-700">
          {MEDDICC.map((m) => {
            const v = deal[`meddicc_${m.key}`] as string | null;
            if (!v) return null;
            return <div key={m.key}><dt className="text-xs font-medium uppercase text-neutral-400">{m.label}</dt><dd>{v}</dd></div>;
          })}
        </dl>
        {deal.next_best_action && (
          <pre className="mt-3 whitespace-pre-wrap break-words rounded bg-amber-50 p-3 font-sans text-sm text-amber-900">{deal.next_best_action}</pre>
        )}
      </section>

      {/* Activity timeline */}
      <section className="mt-8 text-sm">
        <h2 className="mb-2 font-semibold">Activity</h2>
        <ul className="space-y-1 text-neutral-600">
          {timeline.map((e, i) => (
            <li key={i}>• {e.payload?.message ?? e.type} <span className="text-neutral-400">{new Date(e.ts).toLocaleString("en-GB")}</span></li>
          ))}
          {timeline.length === 0 && <li className="text-neutral-400">No activity yet.</li>}
        </ul>
      </section>
    </main>
  );
}
