import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { updateOrg, deleteOrg, mergeOrg, addNote, updateNote, deleteNote, createDeal, setDealStatus, deleteDeal, enrichCompanyAction } from "../../actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { PendingButton } from "@/components/PendingButton";
import { CustomFieldInputs, CustomFieldsManager } from "@/components/CustomFieldsSection";
import { OwnerPicker } from "@/components/OwnerPicker";
import { RowIconAction } from "@/components/RowIconAction";
import { decodeHtmlEntities } from "@/lib/text/decode";
import { fmtDate, fmtDateTime } from "@/lib/format/datetime";
import { DemoWizard } from "@/components/DemoWizard";

// Enrichment takes 15-30s (homepage scrape + AI summary + feed discovery).
export const maxDuration = 60;

export const dynamic = "force-dynamic";

const SECTORS = ["bank", "broker", "building_society", "credit_union", "direct_lender", "marketplace", "sme_lender", "utility"];
const ORG_LABELS = ["Prospect", "Customer", "Partner", "Potential introducer", "Investor", "Lapsed"];
const DEAL_STATUS = ["open", "won", "lost"];

const field = "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm";
const lbl = "block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1";

export default async function CompanyDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ merge_q?: string }>;
}) {
  const { id } = await params;
  const { merge_q } = await searchParams;
  const db = serviceClient();
  const { data: org } = await db.from("organisations").select("*").eq("id", id).maybeSingle();
  if (!org) notFound();

  const [{ data: contacts }, { data: deals }, { data: notes }, { data: events }, { data: orgAlerts }, { data: attendedRows }, { data: orgMeetings }] = await Promise.all([
    db.from("contacts").select("id, full_name, job_title, email").eq("organisation_id", id).limit(100),
    db.from("deals").select("id, title, status, value").eq("organisation_id", id),
    db.from("notes").select("id, content, noted_at").eq("organisation_id", id).order("noted_at", { ascending: false }).limit(20),
    db.from("events").select("type, ts, payload").eq("organisation_id", id).order("ts", { ascending: false }).limit(30),
    db.from("alerts").select("id, kind, title, link, summary, source, ts").eq("organisation_id", id).is("dismissed_at", null).order("ts", { ascending: false }).limit(10),
    // Conferences attended by ANY contact under this company. Embedded
    // INNER JOIN filters server-side; we de-dupe by conference id below
    // so a 5-attendee conference shows up once on the company timeline,
    // not five times.
    db.from("conference_attendances")
      .select("contact:contacts!inner(id, full_name, organisation_id), conference:conferences(id, name, start_date, location)")
      .eq("contact.organisation_id", id)
      .limit(500),
    // Outlook meetings linked to this company.
    db.from("meetings")
      .select("id, subject, start_at, status, primary_contact:contacts(id, full_name)")
      .eq("organisation_id", id)
      .order("start_at", { ascending: false })
      .limit(50),
  ]);
  type OrgMeeting = { id: string; subject: string | null; start_at: string; status: string | null; primary_contact: { id: string; full_name: string | null } | { id: string; full_name: string | null }[] | null };
  const companyMeetings = (orgMeetings ?? []) as unknown as OrgMeeting[];
  const timeline = (events ?? []) as unknown as { type: string; ts: string; payload: { message?: string } | null }[];
  const alerts = (orgAlerts ?? []) as { id: string; kind: string; title: string; link: string | null; summary: string | null; source: string | null; ts: string }[];
  type AttendanceRow = {
    contact: { id: string; full_name: string | null; organisation_id: string | null } | { id: string; full_name: string | null; organisation_id: string | null }[] | null;
    conference: { id: string; name: string; start_date: string | null; location: string | null } | { id: string; name: string; start_date: string | null; location: string | null }[] | null;
  };
  // Group attendees by conference so each event shows once with all the
  // company's contacts that went.
  const attendedByConfId = new Map<string, { conference: { id: string; name: string; start_date: string | null; location: string | null }; attendees: { id: string; full_name: string | null }[] }>();
  for (const row of (attendedRows ?? []) as AttendanceRow[]) {
    const conf = Array.isArray(row.conference) ? row.conference[0] : row.conference;
    const ct = Array.isArray(row.contact) ? row.contact[0] : row.contact;
    if (!conf || !ct) continue;
    const existing = attendedByConfId.get(conf.id);
    if (existing) {
      if (!existing.attendees.some((a) => a.id === ct.id)) existing.attendees.push({ id: ct.id, full_name: ct.full_name });
    } else {
      attendedByConfId.set(conf.id, { conference: conf, attendees: [{ id: ct.id, full_name: ct.full_name }] });
    }
  }
  const conferencesAttended = Array.from(attendedByConfId.values());

  // Merge: search other companies to fold into this one.
  let mergeCandidates: { id: string; name: string | null }[] = [];
  if (merge_q) {
    const { data } = await db
      .from("organisations")
      .select("id, name")
      .ilike("name", `%${merge_q}%`)
      .neq("id", id)
      .limit(8);
    mergeCandidates = data ?? [];
  }

  return (
    <main className="px-8 py-6">
      <Link href="/companies" className="text-sm text-blue-700 hover:underline">← Companies</Link>
      <div className="mt-2 mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{org.name}</h1>
        <DemoWizard initialUrl={org.website ?? ""} initialName={org.name ?? ""} organisationId={org.id} />
      </div>

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
        <div>
          <label className={lbl}>Label</label>
          <select name="label" defaultValue={org.label ?? ""} className={field}>
            <option value="">—</option>
            {[...new Set([...ORG_LABELS, ...(org.label ? [org.label] : [])])].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div><label className={lbl}>Website</label><input name="website" defaultValue={org.website ?? ""} className={field} /></div>
        <div><label className={lbl}>Location</label><input name="location" defaultValue={org.location ?? ""} className={field} /></div>
        <div><label className={lbl}>Customer category</label><input name="customer_category" defaultValue={org.customer_category ?? ""} className={field} /></div>
        <div><label className={lbl}>Sub-category</label><input name="customer_sub_category" defaultValue={org.customer_sub_category ?? ""} className={field} /></div>
        <div><label className={lbl}>Industry (raw)</label><input name="industry" defaultValue={org.industry ?? ""} className={field} /></div>
        <div className="flex items-end gap-2"><input type="checkbox" name="is_partner" defaultChecked={org.is_partner} id="ip" /><label htmlFor="ip" className="text-sm">Partner (excluded from outreach)</label></div>
        <div className="col-span-2"><label className={lbl}>Notes (top-line)</label><textarea name="top_line_notes" defaultValue={org.top_line_notes ?? ""} rows={3} className={field} /></div>
        <OwnerPicker value={org.owner_id ?? null} />
        <CustomFieldInputs entityType="organisation" values={org.custom_fields as Record<string, unknown> | null} />
        <div className="col-span-2 flex gap-2">
          <PendingButton className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" pendingLabel="Saving…">Save</PendingButton>
          <ConfirmSubmit
            formAction={deleteOrg}
            className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            message={`Delete ${org.name}? Its deals, notes and activity history go with it. This cannot be undone.`}
          >
            Delete
          </ConfirmSubmit>
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
          <ul className="mb-3 space-y-1 text-neutral-600">
            {(deals ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 rounded border border-neutral-100 px-2 py-1.5">
                <Link href={`/deals/${d.id}`} className="flex-1 text-blue-700 hover:underline">{d.title ?? "(untitled)"}</Link>
                {typeof d.value === "number" && <span className="text-xs text-neutral-400">£{d.value.toLocaleString()}</span>}
                <form action={setDealStatus} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={d.id} />
                  <select name="status" defaultValue={d.status} className="rounded border border-neutral-200 px-1 py-0.5 text-xs">
                    {DEAL_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <PendingButton className="rounded bg-neutral-100 px-2 py-0.5 text-xs hover:bg-neutral-200" pendingLabel="…">set</PendingButton>
                </form>
                <form action={deleteDeal}>
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="organisation_id" value={org.id} />
                  <RowIconAction
                    kind="delete"
                    confirmMessage={`Delete deal "${d.title ?? "(untitled)"}"? This cannot be undone.`}
                  />
                </form>
              </li>
            ))}
          </ul>
          <form action={createDeal} className="flex flex-wrap gap-2">
            <input type="hidden" name="organisation_id" value={org.id} />
            <input name="title" placeholder="New deal title…" className={`${field} flex-1`} required />
            <input name="value" type="number" placeholder="£" className="w-24 rounded border border-neutral-300 px-2 py-1.5 text-sm" />
            <PendingButton className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" pendingLabel="Adding…">+ Add deal</PendingButton>
          </form>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">Notes ({notes?.length ?? 0})</h2>
          <form action={addNote} className="mb-3 flex gap-2">
            <input type="hidden" name="organisation_id" value={org.id} />
            <input name="content" placeholder="Add a note…" className={`${field} flex-1`} />
            <PendingButton className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700" pendingLabel="Adding…">Add</PendingButton>
          </form>
          <ul className="space-y-2 text-neutral-600">
            {(notes ?? []).map((n) => (
              <li key={n.id} className="border-l-2 border-neutral-200 pl-2">
                {n.noted_at && <div className="text-xs text-neutral-400">{fmtDate(n.noted_at)}</div>}
                <form action={updateNote} className="flex items-start gap-2">
                  <input type="hidden" name="id" value={n.id} />
                  <input type="hidden" name="back" value={`/companies/${org.id}`} />
                  <textarea name="content" defaultValue={String(n.content)} rows={2} className={`${field} flex-1`} />
                  <div className="flex flex-col items-end gap-1">
                    <PendingButton className="rounded bg-neutral-200 px-2 py-1 text-xs hover:bg-neutral-300" pendingLabel="…">Save</PendingButton>
                    <RowIconAction kind="delete" formAction={deleteNote} confirmMessage="Delete this note?" />
                  </div>
                </form>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Alerts — press mentions + fresh posts for this org */}
      {alerts.length > 0 && (
        <section className="mt-8 text-sm">
          <h2 className="mb-2 font-semibold">Alerts ({alerts.length})</h2>
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li key={a.id} className="rounded border border-amber-200 bg-amber-50/40 p-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium uppercase text-amber-800">{a.kind}</span>
                  <span>{fmtDate(a.ts, { day: "numeric", month: "short" })}</span>
                  {a.source && <span>· {a.source}</span>}
                </div>
                {a.link ? (
                  <a href={a.link} target="_blank" rel="noreferrer" className="font-medium text-blue-700 hover:underline">{decodeHtmlEntities(a.title)}</a>
                ) : (
                  <span className="font-medium">{decodeHtmlEntities(a.title)}</span>
                )}
                {a.summary && <p className="mt-1 text-neutral-600">{decodeHtmlEntities(a.summary)}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Enrichment: AI summary + recent posts from their own site/feed. */}
      <section className="mt-8 text-sm">
        <div className="mb-2 flex items-baseline gap-3">
          <h2 className="font-semibold">From the web</h2>
          <span className="text-xs text-neutral-400">
            {org.enriched_at ? `Last refreshed ${fmtDate(org.enriched_at)}` : "Not enriched yet"}
          </span>
          <form action={enrichCompanyAction} className="ml-auto">
            <input type="hidden" name="id" value={org.id} />
            <PendingButton
              className="rounded border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
              pendingLabel="Crawling + summarising…"
              title={org.website ? `Scrape ${org.website} + auto-discover RSS` : "Add a website first"}
            >
              ✨ Enrich from web
            </PendingButton>
          </form>
        </div>
        {!org.website && (
          <p className="text-xs text-neutral-400">No website on file. Add one above and save, then enrich.</p>
        )}
        {org.company_summary && (
          <p className="mb-3 rounded border border-neutral-200 bg-neutral-50 p-2 text-neutral-700">
            {org.company_summary}
          </p>
        )}
        {Array.isArray(org.recent_posts) && org.recent_posts.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Recent posts</h3>
            <ul className="space-y-1 text-neutral-600">
              {(org.recent_posts as { title: string; url: string; published_at: string | null; summary: string }[]).map((p) => (
                <li key={p.url}>
                  <a href={p.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{p.title}</a>
                  {p.published_at && <span className="ml-1 text-xs text-neutral-400">· {fmtDate(p.published_at)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="mt-8 text-sm">
        <h2 className="mb-2 font-semibold">Activity</h2>
        {(() => {
          type Row = { ts: number; key: string; render: () => React.ReactNode };
          const rows: Row[] = [];
          for (const [i, e] of timeline.entries()) {
            rows.push({
              ts: new Date(e.ts).getTime(),
              key: `e${i}`,
              render: () => <>• {e.payload?.message ?? e.type} <span className="text-neutral-400">{fmtDateTime(e.ts)}</span></>,
            });
          }
          for (const c of conferencesAttended) {
            const ts = c.conference.start_date ? new Date(c.conference.start_date).getTime() : Date.now();
            const attendeeNames = c.attendees.map((a) => a.full_name ?? "(unnamed)").join(", ");
            rows.push({
              ts,
              key: `c${c.conference.id}`,
              render: () => (
                <>
                  🎟 <Link href={`/events/${c.conference.id}`} className="text-blue-700 hover:underline">{c.conference.name}</Link>
                  {" — "}
                  <span className="text-neutral-700">{attendeeNames}</span>
                  {c.conference.location && <span className="ml-1 text-neutral-400">· {c.conference.location}</span>}
                  {c.conference.start_date && (
                    <span className="ml-2 text-neutral-400">{fmtDate(c.conference.start_date, { day: "numeric", month: "short", year: "numeric" })}</span>
                  )}
                </>
              ),
            });
          }
          for (const m of companyMeetings) {
            const pc = Array.isArray(m.primary_contact) ? m.primary_contact[0] : m.primary_contact;
            rows.push({
              ts: new Date(m.start_at).getTime(),
              key: `m${m.id}`,
              render: () => (
                <>
                  📅 <Link href={`/meetings/${m.id}`} className="text-blue-700 hover:underline">{m.subject ?? "(no subject)"}</Link>
                  {pc?.full_name && <span className="ml-1 text-neutral-700">— {pc.full_name}</span>}
                  {m.status && <span className="ml-2 rounded bg-neutral-100 px-1 py-0.5 text-[10px] text-neutral-600">{m.status}</span>}
                  <span className="ml-2 text-neutral-400">{fmtDateTime(m.start_at, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                </>
              ),
            });
          }
          rows.sort((x, y) => y.ts - x.ts);
          if (rows.length === 0) {
            return <ul className="space-y-1 text-neutral-600"><li className="text-neutral-400">No activity yet.</li></ul>;
          }
          return (
            <ul className="space-y-1 text-neutral-600">
              {rows.map((r) => <li key={r.key}>{r.render()}</li>)}
            </ul>
          );
        })()}
      </section>

      {/* Merge: fold a duplicate company into this one. */}
      <section className="mt-10 border-t border-neutral-200 pt-4 text-sm">
        <h2 className="mb-2 font-semibold text-neutral-600">Merge a duplicate into {org.name}</h2>
        <form className="mb-3 flex gap-2">
          <input name="merge_q" defaultValue={merge_q ?? ""} placeholder="Search the company to fold in…" className={`${field} flex-1`} />
          <button className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50">Search</button>
        </form>
        {merge_q && (
          <ul className="space-y-1">
            {mergeCandidates.length === 0 && <li className="text-neutral-400">No matches.</li>}
            {mergeCandidates.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded border border-neutral-200 px-2 py-1.5">
                <span>{c.name}</span>
                <form action={mergeOrg}>
                  <input type="hidden" name="source_id" value={c.id} />
                  <input type="hidden" name="target_id" value={org.id} />
                  <PendingButton className="rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700" pendingLabel="Merging…">
                    Merge into {org.name} →
                  </PendingButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-neutral-400">Re-points the other company&apos;s contacts, deals & notes here, then deletes it. Not reversible.</p>
      </section>

      <CustomFieldsManager entityType="organisation" />
    </main>
  );
}
