import { serviceClient } from "@/lib/db/client";

export const dynamic = "force-dynamic";

interface PressEvent {
  id: string;
  ts: string;
  source: string | null;
  payload: { title?: string; link?: string; summary?: string; feed?: string } | null;
}

export default async function SignalsPage() {
  const db = serviceClient();
  const { data } = await db
    .from("events")
    .select("id, ts, source, payload")
    .eq("type", "press")
    .order("ts", { ascending: false })
    .limit(60);
  const signals = (data ?? []) as unknown as PressEvent[];

  return (
    <main className="w-full px-[50px] py-8">
      <header className="mb-6 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Signals</h1>
        <p className="text-sm text-neutral-500">
          Regulatory &amp; market signals (FCA, BoE). Refresh with <code className="rounded bg-neutral-200 px-1">npm run signals</code>. A relevant
          one is a reason to reach out.
        </p>
      </header>

      {signals.length === 0 ? (
        <p className="text-neutral-500">No signals yet — run the monitor.</p>
      ) : (
        <ul className="space-y-2">
          {signals.map((s) => (
            <li key={s.id} className="rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-sm">
              <div className="flex items-center gap-2 text-xs text-neutral-400">
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 uppercase text-neutral-600">{s.source}</span>
                <span>{new Date(s.ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              </div>
              <a href={s.payload?.link} target="_blank" rel="noreferrer" className="font-medium text-blue-700 hover:underline">
                {s.payload?.title}
              </a>
              {s.payload?.summary && <p className="mt-1 text-neutral-600">{s.payload.summary}</p>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
