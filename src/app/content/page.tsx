// In-app content map: every live creditcanary.co.uk page the drafter can cite,
// grouped by type, with who-it's-for / when-to-send guidance (migration 045 +
// npm run content-guidance). Read-only reference for reps + a window into what
// the AI drafter picks from. Refresh data: npm run crawl → npm run content-guidance.

import Link from "next/link";
import { serviceClient } from "@/lib/db/client";

export const dynamic = "force-dynamic";

interface Asset {
  url: string;
  title: string | null;
  type: string | null;
  tags_sector: string[];
  tags_problem: string[];
  description: string | null;
  audience_fit?: string | null;
  send_timing?: string | null;
}

const GROUPS: { type: string; heading: string }[] = [
  { type: "case_study", heading: "Case studies (proof)" },
  { type: "module", heading: "Platform modules" },
  { type: "data_product", heading: "Data products" },
  { type: "article", heading: "Articles & use-cases" },
];

export default async function ContentPage() {
  const db = serviceClient();
  const rich = "url, title, type, tags_sector, tags_problem, description, audience_fit, send_timing";
  const base = "url, title, type, tags_sector, tags_problem, description";
  const run = (cols: string) => db.from("content_assets").select(cols).order("type", { ascending: true }).order("title", { ascending: true });
  let r = await run(rich);
  let hasGuidance = true;
  if (r.error && /audience_fit|send_timing/.test(r.error.message)) {
    hasGuidance = false;
    r = await run(base);
  }
  const assets = (r.data ?? []) as unknown as Asset[];

  const byType = new Map<string, Asset[]>();
  for (const a of assets) (byType.get(a.type ?? "other") ?? byType.set(a.type ?? "other", []).get(a.type ?? "other")!).push(a);
  const seen = new Set<string>();
  const ordered = [
    ...GROUPS.filter((g) => byType.has(g.type)).map((g) => ({ heading: g.heading, list: (seen.add(g.type), byType.get(g.type)!) })),
    ...[...byType.entries()].filter(([t]) => !seen.has(t)).map(([, list]) => ({ heading: "Other pages", list })),
  ];

  return (
    <main className="px-8 py-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Content</h1>
        <span className="text-sm text-neutral-500">{assets.length} pages · what to send, who to, and when</span>
      </header>

      {!hasGuidance && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Who/when guidance not generated yet. Apply migration 045, then run <code>npm run content-guidance</code>.
        </p>
      )}

      <div className="space-y-6">
        {ordered.map((g) => (
          <section key={g.heading}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">{g.heading}</h2>
            <div className="space-y-2">
              {g.list.map((a) => (
                <div key={a.url} className="rounded-lg border border-neutral-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 hover:underline">{a.title ?? a.url} ↗</a>
                    {a.tags_sector.map((s) => <span key={s} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">{s}</span>)}
                  </div>
                  {a.description && <p className="mt-1 text-sm text-neutral-600">{a.description}</p>}
                  {(a.audience_fit || a.send_timing) && (
                    <dl className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                      {a.audience_fit && <div><dt className="inline font-medium text-neutral-500">Best for: </dt><dd className="inline text-neutral-700">{a.audience_fit}</dd></div>}
                      {a.send_timing && <div><dt className="inline font-medium text-neutral-500">When: </dt><dd className="inline text-neutral-700">{a.send_timing}</dd></div>}
                    </dl>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
