import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { createNewsletter } from "./actions";

export const dynamic = "force-dynamic";

interface Issue {
  id: string;
  subject: string;
  status: string;
  sent_at: string | null;
  sent_count: number;
  created_at: string;
}

export default async function NewsletterPage() {
  const db = serviceClient();
  const [{ data: issues }, { count: subs }] = await Promise.all([
    db.from("newsletters").select("id, subject, status, sent_at, sent_count, created_at").order("created_at", { ascending: false }).limit(50),
    db.from("contacts").select("*", { count: "exact", head: true }).eq("newsletter_subscribed", true),
  ]);
  const list = (issues ?? []) as Issue[];

  return (
    <main className="px-8 py-6">
      <header className="mb-4 flex items-baseline justify-between border-b border-neutral-200 pb-3">
        <div>
          <h1 className="text-xl font-semibold">Newsletter</h1>
          <p className="text-sm text-neutral-500">
            <span className="font-medium text-neutral-800">{subs ?? 0}</span> subscriber{subs === 1 ? "" : "s"}.
            {" "}Toggle subscription on each contact page.
          </p>
        </div>
        <span className="text-sm text-neutral-500">{list.length} issue{list.length === 1 ? "" : "s"}</span>
      </header>

      <form action={createNewsletter} className="mb-6 flex flex-wrap gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <input name="subject" placeholder="Issue subject…" required className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm" />
        <button className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">+ New issue</button>
      </form>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-neutral-400">
          <tr><th className="py-1">Subject</th><th>Status</th><th className="text-right">Recipients</th><th className="text-right">Sent</th></tr>
        </thead>
        <tbody>
          {list.map((i) => (
            <tr key={i.id} className="border-t border-neutral-100 hover:bg-neutral-50">
              <td className="py-1.5">
                <Link href={`/newsletter/${i.id}`} className="font-medium text-blue-700 hover:underline">{i.subject}</Link>
              </td>
              <td>
                <span className={`rounded px-1.5 py-0.5 text-xs ${i.status === "sent" ? "bg-emerald-100 text-emerald-800" : "bg-neutral-200 text-neutral-700"}`}>
                  {i.status}
                </span>
              </td>
              <td className="text-right text-neutral-600">{i.sent_count || "—"}</td>
              <td className="text-right text-neutral-500">{i.sent_at ? new Date(i.sent_at).toLocaleDateString("en-GB") : "—"}</td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr><td colSpan={4} className="py-4 text-center text-neutral-400">No issues yet. Create one above.</td></tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
