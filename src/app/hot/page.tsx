// VP-sales beast mode: for every live deal (open + proposal), surface ONE
// MEDDICC gap-closing question. Jim types the answer, we re-seed MEDDICC and
// the next gap surfaces. One-click ✨ Draft follow-up button drops a fresh
// email into the queue for the deal's primary contact.

import Link from "next/link";
import { serviceClient } from "@/lib/db/client";
import { answerMeddiccGap, generateDraftForContact, reseedDealMeddicc } from "../actions";
import { PendingButton } from "@/components/PendingButton";

export const dynamic = "force-dynamic";
// answerMeddiccGap + ✨ Draft follow-up run Claude (sometimes both back-to-back).
export const maxDuration = 60;

const MEDDICC: { key: string; label: string }[] = [
  { key: "metrics", label: "Metrics" },
  { key: "economic_buyer", label: "Econ. buyer" },
  { key: "decision_criteria", label: "Criteria" },
  { key: "decision_process", label: "Process" },
  { key: "identified_pain", label: "Pain" },
  { key: "champion", label: "Champion" },
  { key: "competition", label: "Competition" },
];

type DealRow = Record<string, unknown> & {
  id: string;
  title: string | null;
  value: number | null;
  primary_contact_id: string | null;
  next_best_action: string | null;
  organisation: { id: string; name: string | null; sector: string | null; tier: number | null } | null;
};

/** next_best_action is stored as `[gap: KEY] ACTION\n\nAsk: "QUESTION"` */
function parseNextBest(raw: string | null): { gap: string | null; action: string | null; question: string | null } {
  if (!raw) return { gap: null, action: null, question: null };
  const m = raw.match(/^\[gap:\s*([\w_]+)\]\s*([\s\S]+?)\n\nAsk:\s*"([\s\S]+)"\s*$/);
  if (!m) return { gap: null, action: raw, question: null };
  return { gap: m[1] ?? null, action: m[2]?.trim() ?? null, question: m[3]?.trim() ?? null };
}

export default async function HotPage() {
  const db = serviceClient();
  const meddiccCols = MEDDICC.map((m) => `meddicc_${m.key}_filled`).join(", ");
  const { data } = await db
    .from("deals")
    .select(`id, title, value, primary_contact_id, next_best_action, ${meddiccCols}, organisation:organisations(id, name, sector, tier)`)
    .eq("status", "open")
    .eq("proposal_exists", true)
    .order("value", { ascending: false, nullsFirst: false });
  const deals = (data ?? []) as unknown as DealRow[];

  return (
    <main className="w-full px-[50px] py-8">
      <header className="mb-6 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Hot — VP sales beast mode</h1>
        <p className="text-sm text-neutral-500">
          One MEDDICC gap-closing question per live deal. Answer it, AI updates the deal &amp; surfaces the next move.
          Click <span className="font-medium">✨ Draft follow-up</span> to push a fresh email into the queue for the primary contact.
        </p>
      </header>

      {deals.length === 0 ? (
        <p className="text-neutral-500">
          No live deals (open + proposal). Upload proposals on the Deals tab and MEDDICC auto-seeds — they&apos;ll appear here.
        </p>
      ) : (
        <ul className="space-y-5">
          {deals.map((d) => {
            const { gap, action, question } = parseNextBest(d.next_best_action);
            const filledCount = MEDDICC.filter((m) => d[`meddicc_${m.key}_filled`]).length;
            return (
              <li key={d.id} className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm">
                  <Link href={`/companies/${d.organisation?.id}`} className="font-medium text-blue-700 hover:underline">{d.organisation?.name}</Link>
                  <Link href={`/deals/${d.id}`} className="text-neutral-500 hover:underline">{d.title}</Link>
                  {typeof d.value === "number" && <span className="text-neutral-400">£{d.value.toLocaleString()}</span>}
                  {d.organisation?.tier && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800">T{d.organisation.tier}</span>}
                  <span className="ml-auto text-xs text-neutral-400">{filledCount}/{MEDDICC.length} qualified</span>
                </div>

                <div className="mb-3 flex flex-wrap gap-1">
                  {MEDDICC.map((m) => {
                    const filled = d[`meddicc_${m.key}_filled`] as boolean;
                    const isGap = m.key === gap;
                    return (
                      <span
                        key={m.key}
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          isGap ? "bg-amber-200 text-amber-900 ring-1 ring-amber-400" :
                          filled ? "bg-emerald-100 text-emerald-800" :
                          "bg-neutral-100 text-neutral-400"
                        }`}
                      >
                        {m.label}{isGap ? " ←" : ""}
                      </span>
                    );
                  })}
                </div>

                {question ? (
                  <form action={answerMeddiccGap} className="space-y-2">
                    <input type="hidden" name="deal_id" value={d.id} />
                    <input type="hidden" name="question" value={question} />
                    <p className="text-sm font-medium text-amber-900">{question}</p>
                    {action && <p className="text-xs text-neutral-500">Recommended action: {action}</p>}
                    <textarea
                      name="answer"
                      rows={3}
                      placeholder="Your answer…"
                      required
                      className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
                    />
                    <div className="flex flex-wrap gap-2">
                      <PendingButton
                        className="rounded bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800"
                        pendingLabel="Re-qualifying…"
                      >
                        Submit answer → re-qualify
                      </PendingButton>
                    </div>
                  </form>
                ) : (
                  <form action={reseedDealMeddicc} className="text-sm">
                    <input type="hidden" name="deal_id" value={d.id} />
                    <p className="mb-2 text-neutral-500">No MEDDICC question yet — re-seed to generate one.</p>
                    <PendingButton
                      className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
                      pendingLabel="Seeding MEDDICC…"
                    >
                      Re-seed MEDDICC
                    </PendingButton>
                  </form>
                )}

                {d.primary_contact_id && (
                  <form action={generateDraftForContact} className="mt-3 border-t border-neutral-100 pt-3">
                    <input type="hidden" name="contact_id" value={d.primary_contact_id} />
                    <PendingButton
                      className="rounded border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50"
                      pendingLabel="Drafting follow-up…"
                    >
                      ✨ Draft follow-up email to primary contact
                    </PendingButton>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
