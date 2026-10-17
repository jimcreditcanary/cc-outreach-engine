// Generate creditcanary-site.md — a drafter-friendly map of what's live on
// creditcanary.co.uk, built from the crawled content_assets table. The AI
// outreach drafter reads this to tie each email to the RIGHT page/content for a
// prospect (by sector / problem), with the real URL to link — never inventing
// pages. Committed like creditcanary-voice-spec.md.
//
//   npm run crawl          # refresh content_assets from the live sitemap
//   npm run site-markdown  # regenerate this file from content_assets

import { config } from "dotenv";
import { writeFileSync } from "node:fs";
config({ path: ".env.local", override: true });

interface Asset {
  url: string;
  title: string | null;
  type: string | null;
  tags_sector: string[];
  tags_problem: string[];
  tags_module: string[];
  description: string | null;
  body_text: string | null;
}

// Human group headings, in order. Anything else falls into "Other pages".
const GROUPS: { type: string; heading: string }[] = [
  { type: "case_study", heading: "Case studies (proof)" },
  { type: "module", heading: "Platform modules" },
  { type: "data_product", heading: "Data products" },
  { type: "article", heading: "Articles & use-cases" },
];

function excerpt(s: string | null, max = 600): string {
  if (!s) return "";
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function tagLine(a: Asset): string {
  const parts: string[] = [];
  if (a.tags_sector.length) parts.push(`Sector: ${a.tags_sector.join(", ")}`);
  if (a.tags_problem.length) parts.push(`Problem: ${a.tags_problem.join(", ")}`);
  if (a.tags_module.length) parts.push(`Module: ${a.tags_module.join(", ")}`);
  return parts.join(" · ");
}

function renderAsset(a: Asset): string {
  const lines = [`### ${a.title ?? a.url}`, `- URL: ${a.url}`];
  const tags = tagLine(a);
  if (tags) lines.push(`- ${tags}`);
  if (a.description) lines.push(`- ${excerpt(a.description, 300)}`);
  const body = excerpt(a.body_text);
  if (body) lines.push("", body);
  return lines.join("\n");
}

async function main() {
  const { serviceClient } = await import("../src/lib/db/client");
  const db = serviceClient();
  const { data, error } = await db
    .from("content_assets")
    .select("url, title, type, tags_sector, tags_problem, tags_module, description, body_text")
    .order("type", { ascending: true })
    .order("title", { ascending: true });
  if (error) throw error;
  const assets = (data ?? []) as Asset[];

  const byType = new Map<string, Asset[]>();
  for (const a of assets) {
    const key = a.type ?? "other";
    (byType.get(key) ?? byType.set(key, []).get(key)!).push(a);
  }

  const out: string[] = [
    "# Credit Canary — website content map",
    "",
    `_Generated ${new Date().toISOString().slice(0, 10)} from ${assets.length} crawled pages._`,
    "_Refresh: `npm run crawl` then `npm run site-markdown`._",
    "",
    "**For the outreach drafter:** pick the single most relevant page for a prospect",
    "by sector/problem, link to its exact URL, and lead with that page's angle.",
    "Never invent pages or URLs — only use what's listed here.",
    "",
  ];

  const seen = new Set<string>();
  for (const g of GROUPS) {
    const list = byType.get(g.type) ?? [];
    if (list.length === 0) continue;
    seen.add(g.type);
    out.push(`## ${g.heading}`, "");
    for (const a of list) out.push(renderAsset(a), "");
  }
  // Everything not in a named group.
  const rest = [...byType.entries()].filter(([t]) => !seen.has(t)).flatMap(([, v]) => v);
  if (rest.length) {
    out.push("## Other pages", "");
    for (const a of rest) out.push(renderAsset(a), "");
  }

  writeFileSync("creditcanary-site.md", out.join("\n").trim() + "\n", "utf8");
  console.log(`✓ Wrote creditcanary-site.md — ${assets.length} pages across ${byType.size} types.`);
}

main().catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });
