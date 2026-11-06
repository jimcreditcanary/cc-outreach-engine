// Render one dev doc (docs/<slug>.md) as styled HTML. Server-rendered with
// react-markdown + GFM (tables, fenced code). Styles are scoped under `.doc`.

import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { readDoc } from "@/lib/docs";

export const dynamic = "force-dynamic";

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = await readDoc(slug);
  if (!doc) notFound();

  return (
    <main className="px-4 py-6 md:px-8">
      <Link href="/docs" className="text-sm text-neutral-500 hover:underline">← All docs</Link>
      <div className="mt-3 max-w-3xl">
        <div className="doc">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
        </div>
      </div>

      {/* Scoped markdown styling (prefixed by .doc so it doesn't leak). */}
      <style>{`
        .doc { color: #1f2937; font-size: 14px; line-height: 1.65; }
        .doc h1 { font-size: 1.6rem; font-weight: 700; margin: 0 0 .75rem; letter-spacing: -0.01em; }
        .doc h2 { font-size: 1.2rem; font-weight: 600; margin: 1.75rem 0 .5rem; padding-bottom: .25rem; border-bottom: 1px solid #e5e7eb; }
        .doc h3 { font-size: 1rem; font-weight: 600; margin: 1.25rem 0 .35rem; }
        .doc h4 { font-size: .9rem; font-weight: 600; margin: 1rem 0 .25rem; color: #374151; }
        .doc p { margin: .6rem 0; }
        .doc a { color: #1d4ed8; text-decoration: underline; text-underline-offset: 2px; }
        .doc ul, .doc ol { margin: .6rem 0; padding-left: 1.4rem; }
        .doc li { margin: .2rem 0; }
        .doc li > ul, .doc li > ol { margin: .2rem 0; }
        .doc code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82em; background: #f3f4f6; padding: .1em .35em; border-radius: 4px; }
        .doc pre { background: #0f172a; color: #e2e8f0; padding: .85rem 1rem; border-radius: 8px; overflow-x: auto; margin: .9rem 0; font-size: 12.5px; line-height: 1.5; }
        .doc pre code { background: transparent; padding: 0; border-radius: 0; font-size: inherit; color: inherit; }
        .doc blockquote { border-left: 3px solid #cbd5e1; margin: .9rem 0; padding: .1rem 0 .1rem .85rem; color: #475569; }
        .doc table { width: 100%; border-collapse: collapse; margin: .9rem 0; font-size: 13px; display: block; overflow-x: auto; }
        .doc th, .doc td { border: 1px solid #e5e7eb; padding: .4rem .6rem; text-align: left; vertical-align: top; }
        .doc th { background: #f9fafb; font-weight: 600; }
        .doc hr { border: 0; border-top: 1px solid #e5e7eb; margin: 1.5rem 0; }
        .doc strong { font-weight: 600; color: #111827; }
        .doc img { max-width: 100%; }
      `}</style>
    </main>
  );
}
