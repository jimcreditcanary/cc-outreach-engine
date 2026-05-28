import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { createContact, deleteContact } from "../actions";

export const dynamic = "force-dynamic";

interface ContactRow {
  id: string;
  full_name: string | null;
  email: string | null;
  job_title: string | null;
  label: string | null;
  email_status: string;
  organisation: { name: string | null } | null;
}

const PAGE = 100;

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q, page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? "1") || 1);
  const from = (page - 1) * PAGE;
  const db = serviceClient();
  let query = db
    .from("contacts")
    .select("id, full_name, email, job_title, label, email_status, organisation:organisations(name)", { count: "exact" })
    .order("full_name", { ascending: true })
    .range(from, from + PAGE - 1);
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
  const [{ data, count }, { data: orgs }] = await Promise.all([
    query,
    db.from("organisations").select("id, name").order("name", { ascending: true }).limit(1000),
  ]);
  const contacts = (data ?? []) as unknown as ContactRow[];
  const total = count ?? contacts.length;
  const lastPage = Math.max(1, Math.ceil(total / PAGE));
  const qp = (p: number) => `/contacts?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <main className="w-full px-[50px] py-8">
      <header className="mb-4 flex items-baseline justify-between border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Contacts</h1>
        <span className="text-sm text-neutral-500">{total}{q ? " matches" : ""} · showing {contacts.length === 0 ? 0 : from + 1}–{from + contacts.length}</span>
      </header>

      <form className="mb-3">
        <input name="q" defaultValue={q ?? ""} placeholder="Search name or email…" className="w-full rounded border border-neutral-300 px-3 py-2 text-sm" />
      </form>

      <form action={createContact} className="mb-5 flex flex-wrap gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <input name="full_name" placeholder="New contact name…" className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm" required />
        <input name="email" placeholder="email…" className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm" />
        <select name="organisation_id" className="rounded border border-neutral-300 px-2 py-1.5 text-sm" defaultValue="">
          <option value="">company…</option>
          {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">+ Add contact</button>
      </form>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-neutral-400">
          <tr><th className="py-1">Name</th><th>Company</th><th>Title</th><th>Email</th><th></th></tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id} className="border-t border-neutral-100 hover:bg-neutral-50">
              <td className="py-1.5">
                <Link href={`/contacts/${c.id}`} className="font-medium text-blue-700 hover:underline">{c.full_name}</Link>
              </td>
              <td className="text-neutral-600">{c.organisation?.name ?? "—"}</td>
              <td className="text-neutral-600">{c.job_title ?? "—"}</td>
              <td className="text-neutral-600">
                {c.email ?? "—"}
                {c.email_status === "bounced" && <span className="ml-1 rounded bg-red-100 px-1 text-xs text-red-700">bounced</span>}
              </td>
              <td className="text-right">
                <form action={deleteContact}>
                  <input type="hidden" name="id" value={c.id} />
                  <button className="text-xs text-red-600 hover:underline" title="Delete contact">×</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

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
