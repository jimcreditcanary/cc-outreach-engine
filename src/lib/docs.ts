// Dev-docs loader for the in-app Docs tab. Reads the repo's `docs/*.md` at
// request time (the folder is traced into the serverless bundle via
// next.config outputFileTracingIncludes). Read-only; no writes.

import { promises as fs } from "fs";
import path from "path";

const DOCS_DIR = path.join(process.cwd(), "docs");
const SLUG_RE = /^[A-Za-z0-9_-]+$/;

export interface DocMeta {
  slug: string;        // filename without .md (e.g. "onboarding-api")
  title: string;       // first `# ` heading, else the slug
  description: string; // first prose line after the title
  group: string;       // coarse grouping for the list page
}

function parseMeta(raw: string, slug: string): { title: string; description: string } {
  const lines = raw.split("\n");
  let title = "";
  let description = "";
  for (const line of lines) {
    const t = line.trim();
    if (!title) {
      const h = /^#\s+(.+)/.exec(t);
      if (h?.[1]) title = h[1].trim();
      continue;
    }
    if (!t || t.startsWith("#")) continue;
    description = t.replace(/^[_*>\s]+|[_*\s]+$/g, "").replace(/\*\*/g, "").slice(0, 220);
    break;
  }
  return { title: title || slug, description };
}

function groupFor(slug: string): string {
  const s = slug.toLowerCase();
  if (s.startsWith("onboarding")) return "Onboarding agent";
  if (s.startsWith("billing")) return "Billing agent";
  if (s.includes("api")) return "APIs";
  return "Platform";
}

/** All `docs/*.md` with their title + description, grouped + sorted. */
export async function listDocs(): Promise<DocMeta[]> {
  let names: string[];
  try { names = await fs.readdir(DOCS_DIR); } catch { return []; }
  const md = names.filter((n) => n.toLowerCase().endsWith(".md"));
  const metas = await Promise.all(md.map(async (name) => {
    const slug = name.replace(/\.md$/i, "");
    const raw = await fs.readFile(path.join(DOCS_DIR, name), "utf8").catch(() => "");
    return { slug, group: groupFor(slug), ...parseMeta(raw, slug) };
  }));
  return metas.sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title));
}

/** One doc's title + raw markdown, or null if the slug doesn't resolve to a
 *  real file in docs/ (the readdir match blocks any path traversal). */
export async function readDoc(slug: string): Promise<{ title: string; content: string } | null> {
  if (!SLUG_RE.test(slug)) return null;
  let names: string[];
  try { names = await fs.readdir(DOCS_DIR); } catch { return null; }
  const match = names.find((n) => n.toLowerCase().endsWith(".md") && n.replace(/\.md$/i, "") === slug);
  if (!match) return null;
  const content = await fs.readFile(path.join(DOCS_DIR, match), "utf8");
  return { title: parseMeta(content, slug).title, content };
}
