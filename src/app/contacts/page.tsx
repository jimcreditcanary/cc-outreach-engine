import Link from "next/link";
import { serviceClient } from "@/lib/db/client";

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

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const db = serviceClient();
  let query = db
    .from("contacts")
    .select("id, full_name, email, job_title, label, email_status, organisation:organisations(name)")
    .order("full_name", { ascending: true })
    .limit(200);
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
  const { data } = await query;
  const contacts = (data ?? []) as unknown as ContactRow[];

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-4 flex items-baseline justify-between border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Contacts</h1>
        <span className="text-sm text-neutral-500">{contacts.length}{q ? " matches" : " (first 200)"}</span>
      </header>

      <form className="mb-4">
        <input name="q" defaultValue={q ?? ""} placeholder="Search name or email…" className="w-full rounded border border-neutral-300 px-3 py-2 text-sm" />
      </form>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-neutral-400">
          <tr><th className="py-1">Name</th><th>Company</th><th>Title</th><th>Email</th></tr>
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
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
