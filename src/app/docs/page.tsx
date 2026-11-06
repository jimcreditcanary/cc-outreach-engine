// Docs tab — index of the repo's dev docs (docs/*.md), grouped. Internal,
// behind the app's auth like every other page.

import Link from "next/link";
import { listDocs, type DocMeta } from "@/lib/docs";

export const dynamic = "force-dynamic";

export default async function DocsIndexPage() {
  const docs = await listDocs();
  const groups = new Map<string, DocMeta[]>();
  for (const d of docs) {
    if (!groups.has(d.group)) groups.set(d.group, []);
    groups.get(d.group)!.push(d);
  }

  return (
    <main className="px-4 py-6 md:px-8">
      <h1 className="mb-1 text-xl font-semibold">Docs</h1>
      <p className="mb-6 text-sm text-neutral-500">Developer &amp; reference docs for the veepveep platform — API references, go-live checklists, gap analyses and runbooks.</p>

      {docs.length === 0 ? (
        <p className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-500">No docs found.</p>
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([group, items]) => (
            <section key={group}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">{group}</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {items.map((d) => (
                  <Link key={d.slug} href={`/docs/${d.slug}`} className="block rounded-lg border border-neutral-200 p-3 transition-colors hover:border-neutral-300 hover:bg-neutral-50">
                    <div className="text-sm font-medium text-neutral-900">{d.title}</div>
                    {d.description && <div className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{d.description}</div>}
                    <div className="mt-1 font-mono text-[11px] text-neutral-400">{d.slug}.md</div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
