import { serviceClient } from "@/lib/db/client";

export const dynamic = "force-dynamic";

interface ReplyEvent {
  id: string;
  ts: string;
  payload: { from?: string; subject?: string; unmatched?: boolean } | null;
  contact: { full_name: string | null; email: string | null; organisation: { name: string | null } | null } | null;
}

export default async function RepliesPage() {
  const db = serviceClient();
  const { data } = await db
    .from("events")
    .select("id, ts, payload, contact:contacts(full_name, email, organisation:organisations(name))")
    .eq("type", "reply")
    .order("ts", { ascending: false })
    .limit(100);
  const replies = (data ?? []) as unknown as ReplyEvent[];

  return (
    <main className="px-8 py-6">
      <header className="mb-6 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Replies to action</h1>
        <p className="text-sm text-neutral-500">{replies.length} reply event{replies.length === 1 ? "" : "s"}. Cadence is paused for these — handle personally.</p>
      </header>

      {replies.length === 0 ? (
        <p className="text-neutral-500">No replies yet.</p>
      ) : (
        <ul className="space-y-2">
          {replies.map((r) => (
            <li key={r.id} className="rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-sm">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium">{r.contact?.full_name ?? r.payload?.from ?? "Unknown sender"}</span>
                {r.contact?.organisation?.name && <span className="text-neutral-500">{r.contact.organisation.name}</span>}
                {r.payload?.unmatched && <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">unmatched — triage</span>}
                <span className="ml-auto text-xs text-neutral-400">{new Date(r.ts).toLocaleString("en-GB")}</span>
              </div>
              {r.payload?.subject && <div className="mt-1 text-neutral-600">re: {r.payload.subject}</div>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
