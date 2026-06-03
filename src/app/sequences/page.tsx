import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { createSequenceAction, tickSequencesAction } from "./actions";
import { OwnerFilter } from "@/components/OwnerFilter";
import { resolveOwnerFilter } from "@/lib/auth/owner";
import { RowIconAction } from "@/components/RowIconAction";
import { PendingButton } from "@/components/PendingButton";
import { deleteSequenceAction } from "./actions";

export const dynamic = "force-dynamic";

interface Sequence {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

const STATUS_COLOR: Record<string, string> = {
  live: "bg-emerald-100 text-emerald-800",
  paused: "bg-amber-100 text-amber-800",
  complete: "bg-neutral-200 text-neutral-700",
};

export default async function SequencesPage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const { owner } = await searchParams;
  const db = serviceClient();
  const ownerId = await resolveOwnerFilter(owner);

  let q = db.from("sequences").select("id, name, status, created_at").order("created_at", { ascending: false }).limit(200);
  if (ownerId) q = q.eq("owner_id", ownerId);
  const { data } = await q;
  const seqs = (data ?? []) as Sequence[];

  // Aggregate per-sequence: contacts, replies, outstanding actions.
  // Three small lookups keyed by sequence_id so we don't N+1 the list view.
  const ids = seqs.map((s) => s.id);
  const counts: Record<string, { contacts: number; replied: number; actions: number }> = {};
  for (const id of ids) counts[id] = { contacts: 0, replied: 0, actions: 0 };
  if (ids.length) {
    const [{ data: cts }, { data: acts }] = await Promise.all([
      db.from("sequence_contacts").select("sequence_id, status").in("sequence_id", ids),
      db.from("sequence_actions").select("sequence_id, status").in("sequence_id", ids).eq("status", "pending"),
    ]);
    for (const r of cts ?? []) {
      const c = counts[r.sequence_id as string];
      if (!c) continue;
      c.contacts++;
      if (r.status === "replied") c.replied++;
    }
    for (const r of acts ?? []) {
      const c = counts[r.sequence_id as string];
      if (c) c.actions++;
    }
  }

  return (
    <main className="px-8 py-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <div>
          <h1 className="text-xl font-semibold">Sequences</h1>
          <p className="text-sm text-neutral-500">
            Multi-step outreach cadences — emails auto-queue for approval; calls + LinkedIn surface as actions.
          </p>
        </div>
        <OwnerFilter current={owner} pathname="/sequences" />
        <form action={tickSequencesAction}>
          <PendingButton
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
            pendingLabel="Advancing…"
          >
            ↻ Tick engine now
          </PendingButton>
        </form>
      </header>

      <form action={createSequenceAction} className="mb-6 flex flex-wrap gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <input name="name" required placeholder="New sequence name (e.g. Q1 banks)" className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm" />
        <PendingButton className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" pendingLabel="Creating…">
          + New sequence
        </PendingButton>
      </form>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-neutral-400">
          <tr><th className="py-1">Sequence</th><th>Status</th><th className="text-right">Contacts</th><th className="text-right">Replies</th><th className="text-right">Outstanding</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          {seqs.map((s) => {
            const c = counts[s.id] ?? { contacts: 0, replied: 0, actions: 0 };
            return (
              <tr key={s.id} className="border-t border-neutral-100 hover:bg-neutral-100">
                <td className="py-1.5"><Link href={`/sequences/${s.id}`} className="font-medium text-blue-700 hover:underline">{s.name}</Link></td>
                <td><span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_COLOR[s.status] ?? "bg-neutral-100"}`}>{s.status}</span></td>
                <td className="text-right text-neutral-700">{c.contacts}</td>
                <td className="text-right text-emerald-700">{c.replied || ""}</td>
                <td className="text-right text-amber-700">{c.actions || ""}</td>
                <td className="text-neutral-500 text-xs">{new Date(s.created_at).toLocaleDateString("en-GB")}</td>
                <td className="w-10 text-right">
                  <form>
                    <input type="hidden" name="id" value={s.id} />
                    <RowIconAction kind="delete" formAction={deleteSequenceAction} confirmMessage={`Delete sequence "${s.name}"? Contacts + actions + queued drafts go with it.`} />
                  </form>
                </td>
              </tr>
            );
          })}
          {seqs.length === 0 && (
            <tr><td colSpan={7} className="py-6 text-center text-neutral-400">No sequences yet — create one above.</td></tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
