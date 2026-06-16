import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { createContact, deleteContact, markLeadActioned } from "../actions";
import { OwnerFilter } from "@/components/OwnerFilter";
import { resolveOwnerFilter } from "@/lib/auth/owner";
import { RowIconAction } from "@/components/RowIconAction";
import { PendingButton } from "@/components/PendingButton";
import { Combobox } from "@/components/Combobox";

export const dynamic = "force-dynamic";

interface ContactRow {
  id: string;
  full_name: string | null;
  email: string | null;
  job_title: string | null;
  label: string | null;
  email_status: string;
  status: string | null;
  lead_source: string | null;
  created_at: string | null;
  email_guessed: boolean | null;
  organisation: { name: string | null } | null;
}

const PAGE = 100;

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; owner?: string; status?: string }> }) {
  const { q, page: pageStr, owner, status } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? "1") || 1);
  const from = (page - 1) * PAGE;
  const db = serviceClient();
  const ownerId = await resolveOwnerFilter(owner);
  const newOnly = status === "new";

  // Select status/lead_source if migration 036 ran; fall back if not so the
  // page never blanks out before the migration is applied.
  const richCols = "id, full_name, email, job_title, label, email_status, status, lead_source, created_at, email_guessed, organisation:organisations(name)";
  const baseCols = "id, full_name, email, job_title, label, email_status, organisation:organisations(name)";
  const build = (cols: string) => {
    let query = db.from("contacts").select(cols, { count: "exact" });
    if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
    if (ownerId) query = query.eq("owner_id", ownerId);
    query = newOnly
      ? query.eq("status", "new").order("created_at", { ascending: false })
      : query.order("full_name", { ascending: true });
    return query.range(from, from + PAGE - 1);
  };
  let { data, count, error } = await build(richCols);
  let hasStatus = true;
  if (error && /status|lead_source|created_at|email_guessed/.test(error.message)) {
    hasStatus = false;
    ({ data, count } = await build(baseCols));
  }

  // Tab counts — full totals, owner-scoped, independent of search/pagination.
  let newCount = 0;
  let allCount = 0;
  if (hasStatus) {
    let nc = db.from("contacts").select("id", { count: "exact", head: true }).eq("status", "new");
    let ac = db.from("contacts").select("id", { count: "exact", head: true });
    if (ownerId) { nc = nc.eq("owner_id", ownerId); ac = ac.eq("owner_id", ownerId); }
    [newCount, allCount] = [(await nc).count ?? 0, (await ac).count ?? 0];
  }

  const { data: orgs } = await db.from("organisations").select("id, name").order("name", { ascending: true }).limit(1000);
  const contacts = (data ?? []) as unknown as ContactRow[];
  const total = count ?? contacts.length;
  const lastPage = Math.max(1, Math.ceil(total / PAGE));
  const qp = (p: number) => `/contacts?${new URLSearchParams({ ...(q ? { q } : {}), ...(owner ? { owner } : {}), ...(newOnly ? { status: "new" } : {}), page: String(p) })}`;

  return (
    <main className="px-8 py-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Contacts</h1>
        <OwnerFilter current={owner} pathname="/contacts" extraParams={{ q, ...(newOnly ? { status: "new" } : {}) }} />
        <span className="text-sm text-neutral-500">{total}{q ? " matches" : ""} · showing {contacts.length === 0 ? 0 : from + 1}–{from + contacts.length}</span>
      </header>

      {hasStatus && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <ContactTab href={`/contacts${owner ? `?owner=${owner}` : ""}`} active={!newOnly} label="All contacts" count={allCount} />
          <ContactTab href={`/contacts?status=new${owner ? `&owner=${owner}` : ""}`} active={newOnly} label="New leads" count={newCount} accent />
        </div>
      )}

      <form className="mb-3">
        <input name="q" defaultValue={q ?? ""} placeholder="Search name or email…" className="w-full rounded border border-neutral-300 px-3 py-2 text-sm" />
        {newOnly && <input type="hidden" name="status" value="new" />}
      </form>

      <form action={createContact} className="mb-5 flex flex-wrap gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <input name="full_name" placeholder="New contact name…" className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm" required />
        <input name="email" placeholder="email…" className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm" />
        <div className="w-56">
          <Combobox
            name="organisation_id"
            options={(orgs ?? []).map((o) => ({ id: o.id, label: o.name ?? "(unnamed)" }))}
            placeholder="company…"
            createField="new_organisation_name"
            createLabel="Create company"
          />
        </div>
        <PendingButton className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" pendingLabel="Adding…">+ Add contact</PendingButton>
      </form>

      {newOnly && contacts.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
          No new leads right now. Inbound leads from the website land here automatically.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-neutral-400">
            <tr><th className="py-1">Name</th><th>Company</th><th>Title</th><th>Email</th><th></th></tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id} className={`border-t border-neutral-100 hover:bg-neutral-100 ${c.status === "new" ? "bg-emerald-50/40" : ""}`}>
                <td className="py-1.5">
                  <Link href={`/contacts/${c.id}`} className="font-medium text-blue-700 hover:underline">{c.full_name}</Link>
                  {c.status === "new" && <span className="ml-2 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">New</span>}
                </td>
                <td className="text-neutral-600">{c.organisation?.name ?? "—"}</td>
                <td className="text-neutral-600">{c.job_title ?? "—"}</td>
                <td className="text-neutral-600">
                  {c.email ?? "—"}
                  {c.email_status === "bounced" && <span className="ml-1 rounded bg-red-100 px-1 text-xs text-red-700">bounced</span>}
                  {c.email_guessed && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-700" title="Inferred from the company's email pattern — unverified">guessed</span>}
                </td>
                <td className="w-28 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {c.status === "new" && (
                      <form action={markLeadActioned}>
                        <input type="hidden" name="contact_id" value={c.id} />
                        <PendingButton
                          className="rounded border border-emerald-300 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                          pendingLabel="…"
                          title="Mark this lead as actioned (removes the New flag)"
                        >
                          ✓ Actioned
                        </PendingButton>
                      </form>
                    )}
                    <form>
                      <input type="hidden" name="id" value={c.id} />
                      <RowIconAction
                        kind="delete"
                        formAction={deleteContact}
                        confirmMessage={`Delete contact ${c.full_name ?? "?"}? Their notes, sends and timeline go too.`}
                      />
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {lastPage > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? <Link href={qp(page - 1)} className="text-blue-700 hover:underline">← Prev</Link> : <span className="text-neutral-300">← Prev</span>}
          <span className="text-neutral-500">Page {page} of {lastPage}</span>
          {page < lastPage ? <Link href={qp(page + 1)} className="text-blue-700 hover:underline">Next →</Link> : <span className="text-neutral-300">Next →</span>}
        </div>
      )}
    </main>
  );
}

// Filter tabs, mirroring the /linkedin tab style: bordered pill + count chip.
function ContactTab({ href, active, label, count, accent }: { href: string; active: boolean; label: string; count: number; accent?: boolean }) {
  const on = accent
    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
    : "border-amber-300 bg-amber-50 text-amber-900";
  const chipOn = accent ? "bg-emerald-200 text-emerald-900" : "bg-amber-200 text-amber-900";
  return (
    <Link
      href={href}
      className={`rounded-md border px-3 py-1.5 font-medium transition-colors ${active ? on : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"}`}
    >
      {label} <span className={`ml-1 rounded px-1.5 text-xs ${active ? chipOn : "bg-neutral-100 text-neutral-500"}`}>{count}</span>
    </Link>
  );
}
