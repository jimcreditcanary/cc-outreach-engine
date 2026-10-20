// Generate per-page outreach guidance (who it's best for / when to send) for the
// content map, via Claude from each page's content. Writes content_assets
// .audience_fit + .send_timing (migration 045). Resumable (only fills blanks
// unless --all). Then `npm run site-markdown` folds it into creditcanary-site.md.
//
//   npm run content-guidance                        # fill missing
//   npm run content-guidance -- --all               # redo all
//   npm run content-guidance -- --types=article,case_study   # limit to types

import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { z } from "zod";

const ALL = process.argv.includes("--all");
const TYPES = (process.argv.find((a) => a.startsWith("--types="))?.slice("--types=".length) ?? "")
  .split(",").map((t) => t.trim()).filter(Boolean);

const schema = z.object({
  audience_fit: z.string().describe("Who this page is best for — sectors, roles, situations. One tight sentence."),
  send_timing: z.string().describe("When to send it — cold first-touch / warm nurture / a specific deal stage. One tight sentence."),
});

const SYSTEM = `You help a B2B sales team at Credit Canary (UK credit decisioning/origination for lenders) pick the right website content for a prospect. For the page provided, state concisely WHO it's best for and WHEN to send it. Base it ONLY on the page content — no invention. Keep each to one tight, practical sentence a rep can act on.`;

async function main() {
  const { serviceClient } = await import("../src/lib/db/client");
  const { generateStructured } = await import("../src/lib/ai/claude");
  const db = serviceClient();

  let q = db.from("content_assets").select("id, title, type, tags_sector, tags_problem, description, body_text").order("type", { ascending: true });
  if (!ALL) q = q.is("audience_fit", null);
  if (TYPES.length) q = q.in("type", TYPES);
  const { data, error } = await q;
  if (error) { console.error("✗ read failed (is migration 045 applied?):", error.message); process.exit(1); }
  const assets = (data ?? []) as { id: string; title: string | null; type: string | null; tags_sector: string[]; tags_problem: string[]; description: string | null; body_text: string | null }[];
  console.log(`Guidance for ${assets.length} page(s)${ALL ? " (all)" : " (missing only)"}${TYPES.length ? ` · types: ${TYPES.join(", ")}` : ""}…`);

  let done = 0;
  for (const a of assets) {
    const user = [
      `Title: ${a.title ?? "?"} · Type: ${a.type ?? "?"}`,
      `Sectors: ${a.tags_sector.join(", ") || "—"} · Problems: ${a.tags_problem.join(", ") || "—"}`,
      `Description: ${a.description ?? "—"}`,
      `Body: ${(a.body_text ?? "").replace(/\s+/g, " ").slice(0, 1500)}`,
    ].join("\n");
    try {
      const g = await generateStructured({ system: SYSTEM, user, schema, effort: "low", maxTokens: 400 });
      await db.from("content_assets").update({ audience_fit: g.audience_fit, send_timing: g.send_timing }).eq("id", a.id);
      done++;
      if (done % 10 === 0) console.log(`  …${done}/${assets.length}`);
    } catch (e) {
      console.error(`  ✗ ${a.title}: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`✓ Guidance written for ${done} page(s). Now: npm run site-markdown`);
}

main().catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });
