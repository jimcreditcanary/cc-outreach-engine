import { serviceClient } from "@/lib/db/client";
import { approveDraft, rejectDraft } from "../actions";

export const dynamic = "force-dynamic";

interface Draft {
  id: string;
  subject: string | null;
  body_text: string | null;
  angle: string | null;
  contact: {
    full_name: string | null;
    email: string | null;
    organisation: { name: string | null; sector: string | null } | null;
  } | null;
}

export default async function QueuePage() {
  const db = serviceClient();
  const { data } = await db
    .from("sends")
    .select("id, subject, body_text, angle, contact:contacts(full_name, email, organisation:organisations(name, sector))")
    .eq("status", "queued")
    .order("ts", { ascending: false });
  const drafts = (data ?? []) as unknown as Draft[];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-baseline justify-between border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Approval queue</h1>
        <span className="text-sm text-neutral-500">{drafts.length} draft{drafts.length === 1 ? "" : "s"}</span>
      </header>

      {drafts.length === 0 ? (
        <p className="text-neutral-500">
          Nothing to review. Generate drafts with <code className="rounded bg-neutral-200 px-1">npm run generate</code>.
        </p>
      ) : (
        <ul className="space-y-5">
          {drafts.map((d) => {
            const org = d.contact?.organisation;
            return (
              <li key={d.id} className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="mb-1 flex flex-wrap items-center gap-x-2 text-sm text-neutral-500">
                  <span className="font-medium text-neutral-800">{d.contact?.full_name ?? "—"}</span>
                  <span>&lt;{d.contact?.email ?? "?"}&gt;</span>
                  {org?.name && (
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5">
                      {org.name}
                      {org.sector ? ` · ${org.sector}` : ""}
                    </span>
                  )}
                </div>
                {d.angle && <p className="mb-1 text-xs uppercase tracking-wide text-amber-700">{d.angle}</p>}
                <p className="mb-2 font-semibold">{d.subject}</p>
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-neutral-700">
                  {d.body_text}
                </pre>
                <div className="mt-3 flex gap-2">
                  <form action={approveDraft}>
                    <input type="hidden" name="id" value={d.id} />
                    <button className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
                      Approve
                    </button>
                  </form>
                  <form action={rejectDraft}>
                    <input type="hidden" name="id" value={d.id} />
                    <button className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100">
                      Reject
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
