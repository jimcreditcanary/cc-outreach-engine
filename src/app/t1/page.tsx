import { serviceClient } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const MEDDICC: { key: string; label: string }[] = [
  { key: "metrics", label: "Metrics" },
  { key: "economic_buyer", label: "Econ. buyer" },
  { key: "decision_criteria", label: "Criteria" },
  { key: "decision_process", label: "Process" },
  { key: "identified_pain", label: "Pain" },
  { key: "champion", label: "Champion" },
  { key: "competition", label: "Competition" },
];

export default async function T1Page() {
  const db = serviceClient();
  const cols = MEDDICC.map((m) => `meddicc_${m.key}_filled`).join(", ");
  const { data } = await db
    .from("deals")
    .select(`id, title, value, next_best_action, ${cols}, organisation:organisations(name, sector)`)
    .eq("status", "open")
    .eq("proposal_exists", true)
    .order("value", { ascending: false });
  const deals = (data ?? []) as unknown as Array<Record<string, unknown> & { id: string; title: string | null; value: number | null; next_best_action: string | null; organisation: { name: string | null; sector: string | null } | null }>;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">T1 — active deals (MEDDICC nudges)</h1>
        <p className="text-sm text-neutral-500">
          No auto-send on T1. One next-best-action per deal + the buyer question to close the gap. Seed with{" "}
          <code className="rounded bg-neutral-200 px-1">npm run meddicc</code>.
        </p>
      </header>

      {deals.length === 0 ? (
        <p className="text-neutral-500">
          No T1 deals yet. Drop proposals in <code className="rounded bg-neutral-200 px-1">inputs/proposals/</code>, run{" "}
          <code className="rounded bg-neutral-200 px-1">npm run import-proposals</code> then{" "}
          <code className="rounded bg-neutral-200 px-1">npm run meddicc</code>.
        </p>
      ) : (
        <ul className="space-y-4">
          {deals.map((d) => (
            <li key={d.id} className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-x-2 text-sm">
                <span className="font-medium">{d.organisation?.name}</span>
                <span className="text-neutral-500">{d.title}</span>
                {typeof d.value === "number" && <span className="text-neutral-400">£{d.value.toLocaleString()}</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {MEDDICC.map((m) => {
                  const filled = d[`meddicc_${m.key}_filled`] as boolean;
                  return (
                    <span
                      key={m.key}
                      className={`rounded px-1.5 py-0.5 text-xs ${filled ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-400"}`}
                    >
                      {m.label}
                    </span>
                  );
                })}
              </div>
              {d.next_best_action && (
                <pre className="mt-3 whitespace-pre-wrap break-words rounded bg-amber-50 p-3 font-sans text-sm text-amber-900">
                  {d.next_best_action}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
